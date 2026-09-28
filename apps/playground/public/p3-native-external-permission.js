import {
  ExternalWorkspaceSourceAuthority,
  ExternalSourceMode,
  MemoryVFS
} from '/packages/vfs/src/index.js';

let handle=null;
let authority=null;
const localCanonical=new MemoryVFS();
localCanonical.mount({'linked.txt':'local-canonical-survives'});

function serializeError(error){
  return Object.freeze({
    name:error?.name??'Error',
    code:error?.code??null,
    message:error?.message??String(error),
    details:error?.details??null
  });
}

async function permissions(){
  if(!handle)return Object.freeze({read:null,readwrite:null});
  const [read,readwrite]=await Promise.all([
    handle.queryPermission({mode:'read'}),
    handle.queryPermission({mode:'readwrite'})
  ]);
  return Object.freeze({read,readwrite});
}

async function pick(){
  if(typeof globalThis.showDirectoryPicker!=='function'){
    throw new Error('showDirectoryPicker() is unavailable');
  }
  handle=await globalThis.showDirectoryPicker({mode:'readwrite'});
  authority=new ExternalWorkspaceSourceAuthority({
    mode:ExternalSourceMode.LINKED_FOLDER,
    handle
  });
  const permission=await permissions();
  return Object.freeze({
    name:handle.name,
    kind:handle.kind,
    permission,
    inspect:await authority.inspect(),
    localCanonical:localCanonical.readFile('linked.txt')
  });
}

async function requestWritePermission(){
  if(!authority)throw new Error('directory is not selected');
  const result=await authority.requestWritePermission();
  return Object.freeze({
    result,
    permission:await permissions(),
    inspect:await authority.inspect()
  });
}

async function read(path='linked.txt'){
  if(!authority)throw new Error('directory is not selected');
  const result=await authority.readFile(path);
  return Object.freeze({
    ...result,
    permission:await permissions(),
    localCanonical:localCanonical.readFile('linked.txt')
  });
}

async function write(path='linked.txt',data='opencontainer-write',expectedRevision=undefined){
  if(!authority)throw new Error('directory is not selected');
  try{
    const result=await authority.writeFile(path,data,{expectedRevision});
    return Object.freeze({
      ok:true,
      result,
      permission:await permissions(),
      localCanonical:localCanonical.readFile('linked.txt')
    });
  }catch(error){
    return Object.freeze({
      ok:false,
      error:serializeError(error),
      permission:await permissions(),
      state:authority.lastState,
      mode:authority.mode,
      localCanonical:localCanonical.readFile('linked.txt')
    });
  }
}

async function state(){
  return Object.freeze({
    selected:!!handle,
    name:handle?.name??null,
    kind:handle?.kind??null,
    permission:await permissions(),
    inspect:authority?await authority.inspect():null,
    mode:authority?.mode??null,
    localCanonical:localCanonical.readFile('linked.txt')
  });
}

globalThis.__p3NativePermissionCourt=Object.freeze({
  pick,
  requestWritePermission,
  read,
  write,
  state
});

document.body.dataset.ready='true';
document.getElementById('result').textContent='ready';
