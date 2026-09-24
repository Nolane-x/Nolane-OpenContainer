import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

const WORKSPACE='/workspace';
const INTERNAL='/opencontainer/internal';
const encoder=new TextEncoder();
const decoder=new TextDecoder();

function toBase64(bytes){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);}
function fromBase64(text){const binary=atob(text);return Uint8Array.from(binary,(char)=>char.charCodeAt(0));}

function normalize(path,{guest=true}={}) {
  assertOc(typeof path==='string'&&path.length>0,ErrorCodes.INVALID_ARGUMENT,'Path must be a non-empty string');
  const input=path.startsWith('/')?path:WORKSPACE+'/'+path;
  const parts=[];
  for(const part of input.split('/')){
    if(!part||part==='.')continue;
    if(part==='..'){
      if(!parts.length)throw ocError(ErrorCodes.PATH_ESCAPE,'Path escapes root',{path});
      parts.pop();
    } else parts.push(part);
  }
  const resolved='/'+parts.join('/');
  if(guest){
    assertOc(resolved===WORKSPACE||resolved.startsWith(WORKSPACE+'/'),ErrorCodes.PATH_ESCAPE,'Guest path must stay under /workspace',{path,resolved});
    assertOc(!resolved.startsWith(INTERNAL),ErrorCodes.INTERNAL_PATH,'Trusted internal namespace is not guest-visible',{path:resolved});
  }
  return resolved;
}

function parentOf(path){const index=path.lastIndexOf('/');return index<=0?'/':path.slice(0,index);}
function cloneEntry(entry){return entry.type==='file'?{...entry,data:new Uint8Array(entry.data)}:{...entry};}

export class MemoryVFS {
  #entries=new Map(); #generation=0;
  constructor(){
    this.#entries.set('/',{type:'dir'});
    this.#entries.set(WORKSPACE,{type:'dir'});
    this.#entries.set('/opencontainer',{type:'dir'});
    this.#entries.set(INTERNAL,{type:'dir'});
  }
  get generation(){return this.#generation;}
  normalize(path,options){return normalize(path,options);}
  beginTransaction(){return new VFSTransaction(this,this.#generation);}
  mount(files={}){
    const tx=this.beginTransaction();
    for(const [path,value] of Object.entries(files))tx.writeFile(path,value);
    return tx.commit();
  }
  lstat(path){
    const resolved=normalize(path);const entry=this.#entries.get(resolved);
    if(!entry)throw ocError(ErrorCodes.NOT_FOUND,'Path not found',{path:resolved});
    return Object.freeze({path:resolved,type:entry.type,size:entry.type==='file'?entry.data.byteLength:0,target:entry.target});
  }
  stat(path){
    const resolved=this.#resolve(path);const entry=this.#entries.get(resolved);
    if(!entry)throw ocError(ErrorCodes.NOT_FOUND,'Path not found',{path:resolved});
    return Object.freeze({path:resolved,type:entry.type,size:entry.type==='file'?entry.data.byteLength:0,target:entry.target});
  }
  readlink(path){
    const resolved=normalize(path);const entry=this.#entries.get(resolved);
    if(!entry)throw ocError(ErrorCodes.NOT_FOUND,'Path not found',{path:resolved});
    if(entry.type!=='symlink')throw ocError(ErrorCodes.INVALID_ARGUMENT,'Path is not a symlink',{path:resolved});
    return entry.target;
  }
  realpath(path){
    const resolved=this.#resolve(path);
    if(!this.#entries.has(resolved))throw ocError(ErrorCodes.NOT_FOUND,'Path not found',{path:resolved});
    return resolved;
  }
  readFile(path,{encoding='utf8'}={}){
    const resolved=this.#resolve(path);const entry=this.#entries.get(resolved);
    if(!entry)throw ocError(ErrorCodes.NOT_FOUND,'File not found',{path:resolved});
    if(entry.type!=='file')throw ocError(ErrorCodes.IS_DIRECTORY,'Path is not a file',{path:resolved});
    const data=new Uint8Array(entry.data);
    return encoding===null?data:decoder.decode(data);
  }
  readdir(path=WORKSPACE){
    const resolved=this.#resolve(path);const entry=this.#entries.get(resolved);
    if(!entry)throw ocError(ErrorCodes.NOT_FOUND,'Directory not found',{path:resolved});
    if(entry.type!=='dir')throw ocError(ErrorCodes.NOT_DIRECTORY,'Path is not a directory',{path:resolved});
    const prefix=resolved==='/'?'/':resolved+'/';
    const children=new Set();
    for(const key of this.#entries.keys()){
      if(!key.startsWith(prefix)||key===resolved)continue;
      const rest=key.slice(prefix.length);
      if(!rest.includes('/'))children.add(rest);
    }
    return [...children].sort();
  }
  exists(path){try{this.stat(path);return true;}catch{return false;}}
  snapshot(){
    const entries=[];
    for(const [path,entry] of this.#entries){
      if(path==='/'||path.startsWith('/opencontainer'))continue;
      entries.push([path,entry.type==='file'?{type:'file',data:toBase64(entry.data)}:{...entry}]);
    }
    entries.sort(([a],[b])=>a.localeCompare(b));
    return Object.freeze({version:1,generation:this.#generation,entries});
  }
  restore(snapshot){
    assertOc(snapshot&&snapshot.version===1&&Array.isArray(snapshot.entries),ErrorCodes.IMPORT_INVALID,'Invalid VFS snapshot');
    const next=new Map([['/',{type:'dir'}],[WORKSPACE,{type:'dir'}],['/opencontainer',{type:'dir'}],[INTERNAL,{type:'dir'}]]);
    for(const [path,entry] of snapshot.entries){
      const resolved=normalize(path);
      if(entry.type==='file')next.set(resolved,{type:'file',data:fromBase64(entry.data)});
      else if(entry.type==='dir')next.set(resolved,{type:'dir'});
      else if(entry.type==='symlink')next.set(resolved,{type:'symlink',target:normalize(entry.target)});
      else throw ocError(ErrorCodes.IMPORT_INVALID,'Unknown snapshot entry type',{path:resolved,type:entry.type});
    }
    this.#entries=next;this.#generation++;return this.#generation;
  }
  #resolve(path,depth=0){
    if(depth>32)throw ocError(ErrorCodes.INVALID_ARGUMENT,'Symlink resolution depth exceeded');
    const resolved=normalize(path);
    const parts=resolved.split('/').filter(Boolean);
    let prefix='';
    for(let index=0;index<parts.length;index++){
      prefix+='/'+parts[index];
      const entry=this.#entries.get(prefix);
      if(entry?.type!=='symlink')continue;
      const rest=parts.slice(index+1).join('/');
      const next=rest?entry.target+'/'+rest:entry.target;
      return this.#resolve(next,depth+1);
    }
    return resolved;
  }
  _commit(baseGeneration,operations){
    if(baseGeneration!==this.#generation)throw ocError(ErrorCodes.STALE_GENERATION,'VFS transaction is stale',{baseGeneration,currentGeneration:this.#generation});
    const next=new Map([...this.#entries].map(([path,entry])=>[path,cloneEntry(entry)]));
    const ensureDir=(path)=>{
      if(path==='/')return;
      const entry=next.get(path);
      if(!entry){ensureDir(parentOf(path));next.set(path,{type:'dir'});}
      else if(entry.type!=='dir')throw ocError(ErrorCodes.NOT_DIRECTORY,'Parent is not a directory',{path});
    };
    for(const op of operations){
      if(op.kind==='mkdir'){ensureDir(parentOf(op.path));if(!next.has(op.path))next.set(op.path,{type:'dir'});}
      else if(op.kind==='write'){ensureDir(parentOf(op.path));next.set(op.path,{type:'file',data:new Uint8Array(op.data)});}
      else if(op.kind==='symlink'){ensureDir(parentOf(op.path));next.set(op.path,{type:'symlink',target:op.target});}
      else if(op.kind==='remove'){const prefix=op.path+'/';for(const key of [...next.keys()])if(key===op.path||key.startsWith(prefix))next.delete(key);}
      else if(op.kind==='rename'){
        const moving=[...next.entries()].filter(([key])=>key===op.from||key.startsWith(op.from+'/'));
        if(!moving.length)throw ocError(ErrorCodes.NOT_FOUND,'Rename source not found',{path:op.from});
        ensureDir(parentOf(op.to));
        for(const [key] of moving)next.delete(key);
        for(const [key,entry] of moving)next.set(op.to+key.slice(op.from.length),entry);
      }
    }
    this.#entries=next;this.#generation++;return this.#generation;
  }
}

class VFSTransaction {
  #fs;#base;#ops=[];#closed=false;
  constructor(fs,base){this.#fs=fs;this.#base=base;}
  #assertOpen(){assertOc(!this.#closed,ErrorCodes.INVALID_STATE,'Transaction is closed');}
  mkdir(path){this.#assertOpen();this.#ops.push({kind:'mkdir',path:normalize(path)});return this;}
  writeFile(path,data){this.#assertOpen();const bytes=data instanceof Uint8Array?data:encoder.encode(String(data));this.#ops.push({kind:'write',path:normalize(path),data:bytes});return this;}
  symlink(target,path){this.#assertOpen();this.#ops.push({kind:'symlink',path:normalize(path),target:normalize(target)});return this;}
  remove(path){this.#assertOpen();this.#ops.push({kind:'remove',path:normalize(path)});return this;}
  rename(from,to){this.#assertOpen();this.#ops.push({kind:'rename',from:normalize(from),to:normalize(to)});return this;}
  commit(){this.#assertOpen();this.#closed=true;return this.#fs._commit(this.#base,this.#ops);}
  abort(){this.#closed=true;}
}

export { WORKSPACE };

export { OpfsCheckpointAuthority } from './opfs-authority.js';
