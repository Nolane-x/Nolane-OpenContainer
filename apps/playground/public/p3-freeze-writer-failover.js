import { MemoryVFS, OpfsCheckpointAuthority } from '/packages/vfs/src/index.js';

let root=null;
let directoryName=null;
let authority=null;
let fs=null;

const lifecycle={
  freezeEvents:0,
  resumeEvents:0,
  visibilityChanges:0,
  lastVisibility:document.visibilityState,
  timeline:[]
};

function mark(type){
  lifecycle.timeline.push({type,at:performance.now(),visibility:document.visibilityState});
  if(lifecycle.timeline.length>32)lifecycle.timeline.shift();
}

document.addEventListener('freeze',()=>{
  lifecycle.freezeEvents++;
  lifecycle.lastVisibility=document.visibilityState;
  mark('freeze');
});
document.addEventListener('resume',()=>{
  lifecycle.resumeEvents++;
  lifecycle.lastVisibility=document.visibilityState;
  mark('resume');
});
document.addEventListener('visibilitychange',()=>{
  lifecycle.visibilityChanges++;
  lifecycle.lastVisibility=document.visibilityState;
  mark('visibilitychange');
});

function snapshotState(){
  return Object.freeze({
    directoryName,
    fsGeneration:fs?.generation??null,
    writerState:authority?.writerState??null,
    current:authority?.current??null,
    lifecycle:Object.freeze({
      freezeEvents:lifecycle.freezeEvents,
      resumeEvents:lifecycle.resumeEvents,
      visibilityChanges:lifecycle.visibilityChanges,
      lastVisibility:lifecycle.lastVisibility,
      timeline:Object.freeze(lifecycle.timeline.map(item=>Object.freeze({...item})))
    })
  });
}

async function open(name){
  if(!root)root=await navigator.storage.getDirectory();
  directoryName=String(name);
  authority=await new OpfsCheckpointAuthority({
    root,
    directoryName,
    lockManager:navigator.locks
  }).open();
  fs=new MemoryVFS();
  const restoredGeneration=await authority.restoreInto(fs);
  return Object.freeze({...snapshotState(),restoredGeneration});
}

async function seed(value='A0'){
  if(!authority||!fs)throw new Error('court not opened');
  if(fs.generation!==0)throw new Error('seed requires an empty local VFS');
  fs.mount({'state.txt':String(value)});
  const receipt=await authority.checkpoint(fs);
  return Object.freeze({receipt,localValue:fs.readFile('state.txt'),...snapshotState()});
}

async function mutate(value){
  if(!authority||!fs)throw new Error('court not opened');
  fs.beginTransaction().writeFile('state.txt',String(value)).commit();
  return Object.freeze({localValue:fs.readFile('state.txt'),...snapshotState()});
}

async function publish(){
  if(!authority||!fs)throw new Error('court not opened');
  try{
    const receipt=await authority.checkpoint(fs);
    return Object.freeze({ok:true,receipt,localValue:fs.readFile('state.txt'),...snapshotState()});
  }catch(error){
    return Object.freeze({
      ok:false,
      error:Object.freeze({
        name:error?.name??'Error',
        code:error?.code??null,
        message:error?.message??String(error),
        details:error?.details??null
      }),
      localValue:fs.readFile('state.txt'),
      ...snapshotState()
    });
  }
}

async function mutateAndPublish(value){
  await mutate(value);
  return publish();
}

async function readCanonical(){
  if(!root||!directoryName)throw new Error('court not opened');
  const fresh=await new OpfsCheckpointAuthority({
    root,
    directoryName,
    lockManager:navigator.locks
  }).open();
  const verifyFs=new MemoryVFS();
  const restoredGeneration=await fresh.restoreInto(verifyFs);
  return Object.freeze({
    restoredGeneration,
    value:verifyFs.exists('state.txt')?verifyFs.readFile('state.txt'):null,
    current:fresh.current,
    writerState:fresh.writerState
  });
}

async function cleanup(){
  if(!root||!directoryName)return false;
  try{
    await root.removeEntry(directoryName,{recursive:true});
    return true;
  }catch(error){
    if(error?.name==='NotFoundError')return true;
    throw error;
  }
}

globalThis.__p3WriterCourt=Object.freeze({
  open,
  seed,
  mutate,
  publish,
  mutateAndPublish,
  readCanonical,
  state:snapshotState,
  cleanup
});

document.body.dataset.ready='true';
document.getElementById('result').textContent='ready';
mark('ready');
