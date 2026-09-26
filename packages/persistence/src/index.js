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

async function readImportSource(source){
  if(typeof source==='string')return source;
  if(source instanceof Uint8Array)return decoder.decode(source);
  if(source instanceof ArrayBuffer)return decoder.decode(new Uint8Array(source));
  if(source&&typeof source.getReader==='function'){
    const reader=source.getReader();
    const chunks=[];
    let total=0;
    try{
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        const bytes=typeof value==='string'?encoder.encode(value):value instanceof Uint8Array?value:new Uint8Array(value);
        chunks.push(bytes);
        total+=bytes.byteLength;
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
  #fs;#snapshots=new Map();#next=0;
  constructor({fs}){this.#fs=fs;}
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
    const lines=String(ndjson).split(/\r?\n/).filter(Boolean);
    assertOc(lines.length>0,ErrorCodes.IMPORT_INVALID,'Empty import');
    let header;
    try{header=JSON.parse(lines.shift());}
    catch(error){throw Object.assign(new Error('Invalid import header'),{code:ErrorCodes.IMPORT_INVALID,cause:error});}
    assertOc(header.format==='opencontainer-ndjson'&&header.version===1,ErrorCodes.IMPORT_INVALID,'Unsupported import format');
    const entries=lines.map((line)=>{
      let row;
      try{row=JSON.parse(line);}
      catch(error){throw Object.assign(new Error('Invalid import row'),{code:ErrorCodes.IMPORT_INVALID,cause:error});}
      return [row.path,row.entry];
    });
    return this.#fs.restore({version:1,generation:header.generation??0,entries});
  }
  async importStream(source){return this.import(await readImportSource(source));}
}

export { OpfsReleaseStorageAuthority, releaseCacheNamespace, assessReleaseStorageCompatibility, applyReleaseStorageCompatibility } from './release-storage.js';
