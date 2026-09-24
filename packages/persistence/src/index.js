import { ErrorCodes, assertOc } from '../../protocol/src/index.js';

export class MemoryPersistenceAuthority {
  #fs;#snapshots=new Map();#next=0;
  constructor({fs}){this.#fs=fs;}
  create(label='snapshot'){
    const id='snap-'+(++this.#next);const snapshot=Object.freeze({id,label,createdAt:new Date().toISOString(),vfs:this.#fs.snapshot()});
    this.#snapshots.set(id,snapshot);return snapshot;
  }
  get(id){return this.#snapshots.get(id);}
  list(){return [...this.#snapshots.values()];}
  restore(id){const snapshot=this.#snapshots.get(id);assertOc(snapshot,ErrorCodes.NOT_FOUND,'Snapshot not found',{id});return this.#fs.restore(snapshot.vfs);}
  export(snapshotId=null){
    const vfs=snapshotId?this.get(snapshotId)?.vfs:this.#fs.snapshot();assertOc(vfs,ErrorCodes.NOT_FOUND,'Snapshot not found',{snapshotId});
    const lines=[JSON.stringify({format:'opencontainer-ndjson',version:1,generation:vfs.generation}),...vfs.entries.map(([path,entry])=>JSON.stringify({path,entry}))];
    return lines.join('\n')+'\n';
  }
  import(ndjson){
    const lines=String(ndjson).split(/\r?\n/).filter(Boolean);assertOc(lines.length>0,ErrorCodes.IMPORT_INVALID,'Empty import');
    const header=JSON.parse(lines.shift());assertOc(header.format==='opencontainer-ndjson'&&header.version===1,ErrorCodes.IMPORT_INVALID,'Unsupported import format');
    const entries=lines.map((line)=>{const row=JSON.parse(line);return [row.path,row.entry];});
    return this.#fs.restore({version:1,generation:header.generation??0,entries});
  }
}
