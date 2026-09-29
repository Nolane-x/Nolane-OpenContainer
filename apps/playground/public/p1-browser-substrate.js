import { BrowserStoragePolicy } from '/packages/vfs/src/index.js';

const lifecycle={
  pagehide:0,
  pageshow:0,
  pageShowPersisted:false,
  pageHidePersisted:false,
  freeze:0,
  resume:0,
  visibility:0,
  timeline:[]
};
const lockHolds=new Map();

function mark(type,extra={}){
  lifecycle.timeline.push({type,at:performance.now(),visibility:document.visibilityState,...extra});
  if(lifecycle.timeline.length>64)lifecycle.timeline.shift();
}
window.addEventListener('pagehide',event=>{
  lifecycle.pagehide++;
  lifecycle.pageHidePersisted=event.persisted===true;
  sessionStorage.setItem('opencontainer:p1:last-pagehide-persisted',String(event.persisted===true));
  mark('pagehide',{persisted:event.persisted===true});
});
window.addEventListener('pageshow',event=>{
  lifecycle.pageshow++;
  lifecycle.pageShowPersisted=event.persisted===true;
  sessionStorage.setItem('opencontainer:p1:last-pageshow-persisted',String(event.persisted===true));
  mark('pageshow',{persisted:event.persisted===true});
});
document.addEventListener('freeze',()=>{lifecycle.freeze++;mark('freeze');});
document.addEventListener('resume',()=>{lifecycle.resume++;mark('resume');});
document.addEventListener('visibilitychange',()=>{lifecycle.visibility++;mark('visibilitychange');});

async function workerProbe(){
  const worker=new Worker('/p1-module-worker.mjs',{type:'module',name:'p1-module-worker'});
  const result=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('P1 module worker timed out')),5000);
    worker.onmessage=event=>{clearTimeout(timer);resolve(event.data);};
    worker.onerror=event=>{clearTimeout(timer);reject(new Error(event.message||'P1 module worker failed'));};
    const sab=new SharedArrayBuffer(4);
    const view=new Int32Array(sab);
    Atomics.store(view,0,41);
    worker.postMessage({type:'sab',buffer:sab});
  });
  worker.terminate();
  return Object.freeze(result);
}

async function documentHeaders(){
  const response=await fetch(location.href,{cache:'no-store'});
  return Object.freeze({
    coop:response.headers.get('cross-origin-opener-policy'),
    coep:response.headers.get('cross-origin-embedder-policy'),
    corp:response.headers.get('cross-origin-resource-policy'),
    permissionsPolicy:response.headers.get('permissions-policy'),
    csp:response.headers.get('content-security-policy'),
    documentIsolationPolicy:response.headers.get('document-isolation-policy'),
    profile:response.headers.get('x-opencontainer-document-profile')
  });
}

function permissionsPolicy(){
  const policy=document.permissionsPolicy??document.featurePolicy??null;
  const features=['camera','microphone','geolocation','display-capture','usb','serial','hid','payment'];
  const disabled={};
  for(const feature of features){
    let allowed=null;
    try{
      allowed=policy?.allowsFeature?policy.allowsFeature(feature):null;
    }catch{}
    disabled[feature]=allowed===null?null:allowed===false;
  }
  return Object.freeze({api:policy?'available':'absent',disabled:Object.freeze(disabled)});
}

async function storageSeed(directoryName,value){
  const root=await navigator.storage.getDirectory();
  const dir=await root.getDirectoryHandle(String(directoryName),{create:true});
  const file=await dir.getFileHandle('state.txt',{create:true});
  const writer=await file.createWritable();
  await writer.write(String(value));
  await writer.close();
  return Object.freeze({directoryName:String(directoryName),value:String(value)});
}

async function storageRead(directoryName){
  const root=await navigator.storage.getDirectory();
  try{
    const dir=await root.getDirectoryHandle(String(directoryName));
    const file=await dir.getFileHandle('state.txt');
    return Object.freeze({exists:true,value:await (await file.getFile()).text()});
  }catch(error){
    if(error?.name==='NotFoundError')return Object.freeze({exists:false,value:null});
    throw error;
  }
}

async function storageRemove(directoryName){
  const root=await navigator.storage.getDirectory();
  try{await root.removeEntry(String(directoryName),{recursive:true});return true;}
  catch(error){if(error?.name==='NotFoundError')return true;throw error;}
}

async function storagePolicy(){
  const policy=new BrowserStoragePolicy({storageManager:navigator.storage});
  const before=await policy.inspect();
  const persistence=await policy.requestPersistence();
  const after=await policy.inspect();
  return Object.freeze({before,persistence,after});
}

async function holdLock(name){
  const key=String(name);
  if(lockHolds.has(key))throw new Error('lock already held');
  let release;
  const released=new Promise(resolve=>{release=resolve;});
  let acquiredResolve;
  const acquired=new Promise(resolve=>{acquiredResolve=resolve;});
  const promise=navigator.locks.request(key,{mode:'exclusive'},async lock=>{
    acquiredResolve(Boolean(lock));
    await released;
  });
  lockHolds.set(key,{release,promise});
  return acquired;
}

async function tryLock(name){
  let acquired=false;
  await navigator.locks.request(String(name),{mode:'exclusive',ifAvailable:true},async lock=>{
    acquired=Boolean(lock);
  });
  return acquired;
}

async function releaseLock(name){
  const key=String(name);
  const held=lockHolds.get(key);
  if(!held)return false;
  lockHolds.delete(key);
  held.release();
  await held.promise;
  return true;
}

async function framePermissionsProbe(){
  const iframe=document.createElement('iframe');
  iframe.src='/p1-permissions-frame.html';
  iframe.setAttribute('title','OpenContainer P1 permissions frame');
  const receipt=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      window.removeEventListener('message',onMessage);
      reject(new Error('P1 permissions frame timed out'));
    },5000);
    const onMessage=(event)=>{
      if(event.source!==iframe.contentWindow||event.data?.type!=='opencontainer:p1-permissions-frame')return;
      clearTimeout(timer);
      window.removeEventListener('message',onMessage);
      resolve({origin:event.origin,...event.data});
    };
    window.addEventListener('message',onMessage);
    document.body.appendChild(iframe);
  });
  iframe.remove();
  return Object.freeze(receipt);
}

async function probe(){
  const headers=await documentHeaders();
  const worker=await workerProbe();
  const storage=await storagePolicy();
  const embeddedPermissions=await framePermissionsProbe();
  return Object.freeze({
    secureContext:globalThis.isSecureContext===true,
    crossOriginIsolated:globalThis.crossOriginIsolated===true,
    sharedArrayBuffer:typeof SharedArrayBuffer==='function',
    atomics:typeof Atomics==='object',
    webLocks:Boolean(navigator.locks?.request),
    opfs:Boolean(navigator.storage?.getDirectory),
    serviceWorker:Boolean(navigator.serviceWorker),
    moduleWorker:worker?.crossOriginIsolated===true&&worker?.before===41&&worker?.after===42,
    worker,
    headers,
    permissions:permissionsPolicy(),
    embeddedPermissions,
    storage,
    lifecycle:Object.freeze({...lifecycle,timeline:Object.freeze(lifecycle.timeline.map(x=>Object.freeze({...x}))) }),
    sessionBfCache:Object.freeze({
      pagehide:sessionStorage.getItem('opencontainer:p1:last-pagehide-persisted'),
      pageshow:sessionStorage.getItem('opencontainer:p1:last-pageshow-persisted')
    })
  });
}

globalThis.__p1BrowserCourt=Object.freeze({
  probe,
  lifecycle:()=>Object.freeze({...lifecycle,timeline:Object.freeze(lifecycle.timeline.map(x=>Object.freeze({...x}))) }),
  workerProbe,
  framePermissionsProbe,
  storageSeed,
  storageRead,
  storageRemove,
  storagePolicy,
  holdLock,
  tryLock,
  releaseLock
});
document.body.dataset.ready='true';
document.getElementById('result').textContent='ready';
mark('ready');
