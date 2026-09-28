import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

const encoder=new TextEncoder();
const decoder=new TextDecoder();

export const ExternalSourceMode=Object.freeze({
  IMPORTED_COPY:'imported-copy',
  LINKED_FOLDER:'linked-folder',
  READ_ONLY_SOURCE:'read-only-source'
});

export const ExternalSourceState=Object.freeze({
  CONNECTED:'connected',
  PERMISSION_NEEDED:'permission-needed',
  READ_ONLY:'read-only',
  UNAVAILABLE:'unavailable',
  EXTERNAL_CHANGE_DETECTED:'external-change-detected'
});

const MODES=new Set(Object.values(ExternalSourceMode));
const PERMISSIONS=new Set(['granted','denied','prompt']);

function relativePath(path){
  assertOc(typeof path==='string'&&path.length>0,ErrorCodes.INVALID_ARGUMENT,'External source path must be a non-empty string');
  assertOc(!path.includes('\0'),ErrorCodes.INVALID_ARGUMENT,'External source path must not contain NUL');
  const parts=[];
  for(const raw of path.replaceAll('\\','/').split('/')){
    if(!raw||raw==='.')continue;
    if(raw==='..')throw ocError(ErrorCodes.PATH_ESCAPE,'External source path escapes root',{path});
    parts.push(raw);
  }
  assertOc(parts.length>0,ErrorCodes.INVALID_ARGUMENT,'External source path resolves to root',{path});
  return parts.join('/');
}

async function sha256Hex(bytes){
  const source=bytes instanceof Uint8Array?bytes:encoder.encode(String(bytes));
  const digest=await globalThis.crypto.subtle.digest('SHA-256',source);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function readFileBytes(handle){
  const file=await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function getFile(directory,path,{create=false}={}){
  const parts=relativePath(path).split('/');
  let current=directory;
  for(const part of parts.slice(0,-1)){
    current=await current.getDirectoryHandle(part,{create});
  }
  return current.getFileHandle(parts.at(-1),{create});
}

async function scanDirectory(directory,prefix=''){
  const rows=[];
  assertOc(typeof directory?.entries==='function',ErrorCodes.INVALID_ARGUMENT,'External source directory must support entries()');
  for await(const [name,handle] of directory.entries()){
    const path=prefix?prefix+'/'+name:name;
    if(handle?.kind==='directory'){
      rows.push(...await scanDirectory(handle,path));
    }else if(handle?.kind==='file'){
      const bytes=await readFileBytes(handle);
      rows.push(Object.freeze({path,bytes,revision:await sha256Hex(bytes)}));
    }
  }
  rows.sort((a,b)=>a.path.localeCompare(b.path));
  return rows;
}

function permissionState(value){
  const state=String(value??'');
  assertOc(PERMISSIONS.has(state),ErrorCodes.INVALID_STATE,'External source permission provider returned an invalid state',{state});
  return state;
}

export class ExternalWorkspaceSourceAuthority{
  #mode;
  #handle;
  #revisions=new Map();
  #detached=false;
  #lastState=null;

  constructor({mode,handle=null}={}){
    assertOc(MODES.has(mode),ErrorCodes.INVALID_ARGUMENT,'External source mode is invalid',{mode});
    if(mode!==ExternalSourceMode.IMPORTED_COPY||handle!==null){
      assertOc(handle&&typeof handle.getFileHandle==='function'&&typeof handle.entries==='function',ErrorCodes.INVALID_ARGUMENT,'External source directory handle is required',{mode});
    }
    this.#mode=mode;
    this.#handle=handle;
  }

  get mode(){return this.#mode;}
  get detached(){return this.#detached;}
  get lastState(){return this.#lastState;}

  async inspect(){
    if(this.#mode===ExternalSourceMode.IMPORTED_COPY&&this.#detached){
      return this.#remember(Object.freeze({
        mode:this.#mode,
        state:ExternalSourceState.CONNECTED,
        externalRead:false,
        externalWrite:false,
        detached:true,
        permissionRead:'not-required',
        permissionReadwrite:'not-required',
        silentModeChange:false
      }));
    }
    if(!this.#handle){
      return this.#remember(Object.freeze({
        mode:this.#mode,
        state:ExternalSourceState.UNAVAILABLE,
        externalRead:false,
        externalWrite:false,
        detached:this.#detached,
        permissionRead:'unavailable',
        permissionReadwrite:'unavailable',
        silentModeChange:false
      }));
    }

    try{
      const read=await this.#queryPermission('read');

      if(read==='prompt'){
        return this.#remember(Object.freeze({
          mode:this.#mode,state:ExternalSourceState.PERMISSION_NEEDED,
          externalRead:false,externalWrite:false,detached:this.#detached,
          permissionRead:read,permissionReadwrite:'not-queried',silentModeChange:false
        }));
      }
      if(read==='denied'){
        return this.#remember(Object.freeze({
          mode:this.#mode,state:ExternalSourceState.UNAVAILABLE,
          externalRead:false,externalWrite:false,detached:this.#detached,
          permissionRead:read,permissionReadwrite:'not-queried',silentModeChange:false
        }));
      }

      if(this.#mode===ExternalSourceMode.IMPORTED_COPY){
        return this.#remember(Object.freeze({
          mode:this.#mode,state:ExternalSourceState.CONNECTED,
          externalRead:true,externalWrite:false,detached:this.#detached,
          permissionRead:read,permissionReadwrite:'not-queried',silentModeChange:false
        }));
      }

      if(this.#mode===ExternalSourceMode.READ_ONLY_SOURCE){
        return this.#remember(Object.freeze({
          mode:this.#mode,state:ExternalSourceState.READ_ONLY,
          externalRead:true,externalWrite:false,detached:this.#detached,
          permissionRead:read,permissionReadwrite:'not-queried',silentModeChange:false
        }));
      }

      const readwrite=await this.#queryPermission('readwrite');
      if(readwrite==='granted'){
        return this.#remember(Object.freeze({
          mode:this.#mode,state:ExternalSourceState.CONNECTED,
          externalRead:true,externalWrite:this.#mode===ExternalSourceMode.LINKED_FOLDER,
          detached:this.#detached,permissionRead:read,permissionReadwrite:readwrite,silentModeChange:false
        }));
      }
      return this.#remember(Object.freeze({
        mode:this.#mode,
        state:readwrite==='prompt'?ExternalSourceState.PERMISSION_NEEDED:ExternalSourceState.READ_ONLY,
        externalRead:true,
        externalWrite:false,
        detached:this.#detached,
        permissionRead:read,
        permissionReadwrite:readwrite,
        silentModeChange:false
      }));
    }catch(error){
      if(error?.name==='NotFoundError'||error?.name==='NotAllowedError'){
        return this.#remember(Object.freeze({
          mode:this.#mode,state:ExternalSourceState.UNAVAILABLE,
          externalRead:false,externalWrite:false,detached:this.#detached,
          permissionRead:'unavailable',permissionReadwrite:'unavailable',
          silentModeChange:false
        }));
      }
      throw error;
    }
  }

  async importCopyInto(fs){
    assertOc(this.#mode===ExternalSourceMode.IMPORTED_COPY,ErrorCodes.INVALID_STATE,'importCopyInto() requires imported-copy mode',{mode:this.#mode});
    assertOc(!this.#detached,ErrorCodes.INVALID_STATE,'Imported copy is already detached from its source');
    assertOc(fs&&typeof fs.beginTransaction==='function',ErrorCodes.INVALID_ARGUMENT,'Imported copy requires a writable VFS');

    const access=await this.inspect();
    assertOc(access.externalRead,ErrorCodes.INVALID_STATE,'Imported-copy source is not readable',{
      mode:this.#mode,state:access.state,permissionRead:access.permissionRead
    });
    const rows=await scanDirectory(this.#handle);
    const tx=fs.beginTransaction();
    for(const row of rows)tx.writeFile(row.path,row.bytes);
    const generation=tx.commit();

    this.#revisions.clear();
    for(const row of rows)this.#revisions.set(row.path,row.revision);
    this.#detached=true;
    this.#handle=null;

    return Object.freeze({
      mode:this.#mode,
      state:ExternalSourceState.CONNECTED,
      generation,
      files:rows.length,
      detached:true,
      externalWrite:false,
      silentModeChange:false
    });
  }

  async readFile(path,{encoding='utf8'}={}){
    assertOc(!this.#detached,ErrorCodes.INVALID_STATE,'Imported copy is detached; read the local canonical workspace instead',{mode:this.#mode});
    const access=await this.inspect();
    assertOc(access.externalRead,ErrorCodes.INVALID_STATE,'External source is not currently readable',{
      mode:this.#mode,state:access.state,permissionRead:access.permissionRead
    });
    let handle;
    try{handle=await getFile(this.#handle,path);}
    catch(error){
      if(error?.name==='NotFoundError')throw ocError(ErrorCodes.NOT_FOUND,'External source file not found',{path:relativePath(path),mode:this.#mode});
      throw error;
    }
    const bytes=await readFileBytes(handle);
    const revision=await sha256Hex(bytes);
    const normalized=relativePath(path);
    this.#revisions.set(normalized,revision);
    return Object.freeze({
      mode:this.#mode,
      path:normalized,
      revision,
      data:encoding===null?bytes:decoder.decode(bytes)
    });
  }

  async writeFile(path,data,{expectedRevision=undefined}={}){
    assertOc(this.#mode===ExternalSourceMode.LINKED_FOLDER,ErrorCodes.STORAGE_READ_ONLY,'External source mode does not permit privileged writes',{
      mode:this.#mode,
      state:this.#mode===ExternalSourceMode.READ_ONLY_SOURCE?ExternalSourceState.READ_ONLY:ExternalSourceState.CONNECTED,
      silentModeChange:false
    });
    assertOc(!this.#detached,ErrorCodes.INVALID_STATE,'Linked folder is detached');

    const normalized=relativePath(path);
    const permission=await this.#queryPermission('readwrite');
    if(permission!=='granted'){
      const state=permission==='prompt'?ExternalSourceState.PERMISSION_NEEDED:ExternalSourceState.READ_ONLY;
      this.#lastState=Object.freeze({
        mode:this.#mode,state,externalRead:true,externalWrite:false,
        permissionReadwrite:permission,silentModeChange:false
      });
      throw ocError(ErrorCodes.INVALID_STATE,'External write permission is not granted',{
        mode:this.#mode,
        state,
        permissionReadwrite:permission,
        privilegedWriteBlocked:true,
        localCanonicalUnaffected:true,
        silentModeChange:false
      });
    }

    let currentRevision=null;
    let existing=null;
    try{
      existing=await getFile(this.#handle,normalized);
      currentRevision=await sha256Hex(await readFileBytes(existing));
    }catch(error){
      if(error?.name!=='NotFoundError')throw error;
    }

    const baseline=expectedRevision===undefined?this.#revisions.get(normalized):expectedRevision;
    assertOc(
      baseline!==undefined,
      ErrorCodes.INVALID_STATE,
      'Privileged external write requires a previously observed revision',
      {path:normalized,mode:this.#mode,writePreconditionMissing:true}
    );

    if(baseline!==currentRevision){
      this.#lastState=Object.freeze({
        mode:this.#mode,
        state:ExternalSourceState.EXTERNAL_CHANGE_DETECTED,
        externalRead:true,
        externalWrite:false,
        permissionReadwrite:'granted',
        silentModeChange:false
      });
      throw ocError(ErrorCodes.STALE_GENERATION,'External file changed after it was read',{
        path:normalized,
        mode:this.#mode,
        state:ExternalSourceState.EXTERNAL_CHANGE_DETECTED,
        expectedRevision:baseline,
        currentRevision,
        privilegedWriteBlocked:true,
        conflict:true,
        actions:Object.freeze(['compare','reload-external-version','save-opencontainer-version-as-copy','merge']),
        silentOverwritePrevented:true,
        silentModeChange:false
      });
    }

    const handle=existing??await getFile(this.#handle,normalized,{create:true});
    const bytes=data instanceof Uint8Array?new Uint8Array(data):encoder.encode(String(data));
    const writable=await handle.createWritable();
    try{
      await writable.write(bytes);
      await writable.close();
    }catch(error){
      try{await writable.abort?.();}catch{}
      throw error;
    }
    const revision=await sha256Hex(bytes);
    this.#revisions.set(normalized,revision);
    this.#lastState=Object.freeze({
      mode:this.#mode,state:ExternalSourceState.CONNECTED,
      externalRead:true,externalWrite:true,permissionReadwrite:'granted',
      silentModeChange:false
    });
    return Object.freeze({
      mode:this.#mode,
      path:normalized,
      previousRevision:currentRevision,
      revision,
      state:ExternalSourceState.CONNECTED,
      privilegedWrite:true,
      permissionRechecked:true,
      silentOverwritePrevented:true,
      silentModeChange:false
    });
  }

  async requestWritePermission(){
    assertOc(this.#mode===ExternalSourceMode.LINKED_FOLDER,ErrorCodes.STORAGE_READ_ONLY,'Only linked-folder mode can request write permission',{mode:this.#mode});
    assertOc(this.#handle&&typeof this.#handle.requestPermission==='function',ErrorCodes.INVALID_STATE,'External source handle cannot request permission');
    return permissionState(await this.#handle.requestPermission({mode:'readwrite'}));
  }

  async #queryPermission(mode){
    assertOc(this.#handle,ErrorCodes.INVALID_STATE,'External source handle is unavailable',{mode:this.#mode});
    assertOc(typeof this.#handle.queryPermission==='function',ErrorCodes.INVALID_STATE,'External source handle cannot report permission truth',{
      mode:this.#mode,
      permissionQueryUnavailable:true
    });
    return permissionState(await this.#handle.queryPermission({mode}));
  }

  #remember(state){this.#lastState=state;return state;}
}
