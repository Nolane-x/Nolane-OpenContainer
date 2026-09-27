import { ErrorCodes, assertOc } from '../../protocol/src/index.js';

const encoder=new TextEncoder();
const decoder=new TextDecoder();

function snapshotToNdjson(vfs){
  const lines=[
    JSON.stringify({format:'opencontainer-ndjson',version:1,generation:vfs.generation}),
    ...vfs.entries.map(([path,entry])=>JSON.stringify({path,entry}))
  ];
  return lines.join('\n')+'\n';
}

async function readImportSource(source,{maxBytes=64*1024*1024}={}){
  if(typeof source==='string'){
    const bytes=encoder.encode(source).byteLength;
    assertOc(bytes<=maxBytes,ErrorCodes.RESOURCE_EXHAUSTED,'Import exceeds byte budget',{bytes,limit:maxBytes});
    return source;
  }
  if(source instanceof Uint8Array){
    assertOc(source.byteLength<=maxBytes,ErrorCodes.RESOURCE_EXHAUSTED,'Import exceeds byte budget',{bytes:source.byteLength,limit:maxBytes});
    return decoder.decode(source);
  }
  if(source instanceof ArrayBuffer){
    assertOc(source.byteLength<=maxBytes,ErrorCodes.RESOURCE_EXHAUSTED,'Import exceeds byte budget',{bytes:source.byteLength,limit:maxBytes});
    return decoder.decode(new Uint8Array(source));
  }
  if(source&&typeof source.getReader==='function'){
    const reader=source.getReader();
    const chunks=[];
    let total=0;
    try{
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        const bytes=typeof value==='string'?encoder.encode(value):value instanceof Uint8Array?value:new Uint8Array(value);
        total+=bytes.byteLength;
        if(total>maxBytes){
          try{await reader.cancel('OpenContainer import byte budget exceeded');}catch{}
          throw Object.assign(new Error('Import exceeds byte budget'),{code:ErrorCodes.RESOURCE_EXHAUSTED,details:{bytes:total,limit:maxBytes}});
        }
        chunks.push(bytes);
      }
    }finally{
      reader.releaseLock?.();
    }
    const joined=new Uint8Array(total);
    let offset=0;
    for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
    return decoder.decode(joined);
  }
  throw Object.assign(new TypeError('Import source must be NDJSON text, bytes, ArrayBuffer, or ReadableStream'),{code:ErrorCodes.IMPORT_INVALID});
}

export class MemoryPersistenceAuthority {
  #fs;#snapshots=new Map();#next=0;#maxImportBytes;#maxImportEntries;
  constructor({fs,maxImportBytes=64*1024*1024,maxImportEntries=100000}={}){
    assertOc(fs&&typeof fs.restore==='function',ErrorCodes.INVALID_ARGUMENT,'Persistence authority requires a VFS');
    assertOc(Number.isFinite(Number(maxImportBytes))&&Number(maxImportBytes)>0,ErrorCodes.INVALID_ARGUMENT,'maxImportBytes must be positive');
    assertOc(Number.isInteger(Number(maxImportEntries))&&Number(maxImportEntries)>0,ErrorCodes.INVALID_ARGUMENT,'maxImportEntries must be a positive integer');
    this.#fs=fs;
    this.#maxImportBytes=Math.floor(Number(maxImportBytes));
    this.#maxImportEntries=Math.floor(Number(maxImportEntries));
  }
  create(label='snapshot'){
    const id='snap-'+(++this.#next);
    const snapshot=Object.freeze({id,label,createdAt:new Date().toISOString(),vfs:this.#fs.snapshot()});
    this.#snapshots.set(id,snapshot);
    return snapshot;
  }
  get(id){return this.#snapshots.get(id);}
  list(){return [...this.#snapshots.values()];}
  restore(id){
    const snapshot=this.#snapshots.get(id);
    assertOc(snapshot,ErrorCodes.NOT_FOUND,'Snapshot not found',{id});
    return this.#fs.restore(snapshot.vfs);
  }
  export(snapshotId=null){
    const vfs=snapshotId?this.get(snapshotId)?.vfs:this.#fs.snapshot();
    assertOc(vfs,ErrorCodes.NOT_FOUND,'Snapshot not found',{snapshotId});
    return snapshotToNdjson(vfs);
  }
  exportStream(snapshotId=null){
    const vfs=snapshotId?this.get(snapshotId)?.vfs:this.#fs.snapshot();
    assertOc(vfs,ErrorCodes.NOT_FOUND,'Snapshot not found',{snapshotId});
    const bytes=encoder.encode(snapshotToNdjson(vfs));
    return new ReadableStream({
      start(controller){
        controller.enqueue(bytes);
        controller.close();
      }
    });
  }
  import(ndjson){
    const text=String(ndjson);
    const bytes=encoder.encode(text).byteLength;
    assertOc(bytes<=this.#maxImportBytes,ErrorCodes.RESOURCE_EXHAUSTED,'Import exceeds byte budget',{bytes,limit:this.#maxImportBytes});
    const lines=text.split(/\r?\n/).filter(Boolean);
    assertOc(lines.length>0,ErrorCodes.IMPORT_INVALID,'Empty import');
    assertOc(lines.length-1<=this.#maxImportEntries,ErrorCodes.RESOURCE_EXHAUSTED,'Import exceeds entry budget',{entries:Math.max(0,lines.length-1),limit:this.#maxImportEntries});
    let header;
    try{header=JSON.parse(lines.shift());}
    catch(error){throw Object.assign(new Error('Invalid import header'),{code:ErrorCodes.IMPORT_INVALID,cause:error});}
    assertOc(header.format==='opencontainer-ndjson'&&header.version===1,ErrorCodes.IMPORT_INVALID,'Unsupported import format');
    const entries=lines.map((line)=>{
      let row;
      try{row=JSON.parse(line);}
      catch(error){throw Object.assign(new Error('Invalid import row'),{code:ErrorCodes.IMPORT_INVALID,cause:error});}
      assertOc(row&&typeof row==='object',ErrorCodes.IMPORT_INVALID,'Import row must be an object');
      assertOc(typeof row.path==='string'&&row.path.length>0,ErrorCodes.IMPORT_INVALID,'Import row path is required');
      assertOc(row.entry&&typeof row.entry==='object'&&['file','dir','symlink'].includes(row.entry.type),ErrorCodes.IMPORT_INVALID,'Import row entry is invalid',{path:row.path});
      return [row.path,row.entry];
    });
    return this.#fs.restore({version:1,generation:header.generation??0,entries});
  }
  async importStream(source){return this.import(await readImportSource(source,{maxBytes:this.#maxImportBytes}));}
}

export { OpfsReleaseStorageAuthority, releaseCacheNamespace, assessReleaseStorageCompatibility, applyReleaseStorageCompatibility } from './release-storage.js';

export { OpfsDerivedIndexStore } from './opfs-derived-index-store.js';
export { PersistenceCorruptionClass, PersistenceCorruptionAction, corruptionDisposition, persistenceCorruptionMatrix } from './corruption.js';
