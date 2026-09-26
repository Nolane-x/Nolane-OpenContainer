import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

const encoder=new TextEncoder();
const decoder=new TextDecoder();

class FakeNotFoundError extends Error {
  constructor(){super('Not found');this.name='NotFoundError';}
}

class FakeFileHandle {
  kind='file';
  data=null;
  async getFile(){
    if(this.data===null)throw new FakeNotFoundError();
    const bytes=this.data instanceof Uint8Array?new Uint8Array(this.data):encoder.encode(String(this.data));
    return {
      text:async()=>decoder.decode(bytes),
      arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)
    };
  }
  async createWritable(){
    let next=null;
    return {
      write:async(value)=>{next=value instanceof Uint8Array?new Uint8Array(value):String(value);},
      close:async()=>{this.data=next;},
      abort:async()=>{}
    };
  }
}

class FakeDirectoryHandle {
  kind='directory';
  files=new Map();
  dirs=new Map();
  async getDirectoryHandle(name,{create=false}={}){
    if(!this.dirs.has(name)){
      if(!create)throw new FakeNotFoundError();
      this.dirs.set(name,new FakeDirectoryHandle());
    }
    return this.dirs.get(name);
  }
  async getFileHandle(name,{create=false}={}){
    if(!this.files.has(name)){
      if(!create)throw new FakeNotFoundError();
      this.files.set(name,new FakeFileHandle());
    }
    return this.files.get(name);
  }
  async *entries(){
    for(const entry of this.dirs)yield entry;
    for(const entry of this.files)yield entry;
  }
  async removeEntry(name,{recursive=false}={}){
    if(this.files.delete(name))return;
    if(this.dirs.has(name)){
      const directory=this.dirs.get(name);
      if(!recursive&&(directory.files.size||directory.dirs.size))throw new Error('Directory is not empty');
      this.dirs.delete(name);
      return;
    }
    throw new FakeNotFoundError();
  }
}

class FakeLockManager {
  tails=new Map();
  requests=[];
  request(name,options,callback){
    const previous=this.tails.get(name)??Promise.resolve();
    let release;
    const current=new Promise((resolve)=>{release=resolve;});
    this.tails.set(name,current);
    this.requests.push({name,mode:options?.mode??'exclusive'});
    return previous
      .then(()=>callback({name,mode:options?.mode??'exclusive'}))
      .finally(()=>{
        release();
        if(this.tails.get(name)===current)this.tails.delete(name);
      });
  }
}

test('SDK OPFS workspace profile reopens at persisted generation and continues checkpointing',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const profile={root,directoryName:'sdk-workspace-product',lockManager:locks};

  const first=await OpenContainer.boot({workspacePersistence:profile});
  first.mount({'state.txt':'one'});
  const firstReceipt=await first.persistWorkspace();
  first.fs.beginTransaction().writeFile('state.txt','two').commit();
  const secondReceipt=await first.persistWorkspace();
  assert.equal(secondReceipt.sequence,firstReceipt.sequence+1);
  assert.equal(secondReceipt.generation,first.fs.generation);
  await first.terminate();

  const reopened=await OpenContainer.boot({workspacePersistence:profile});
  assert.equal(reopened.fs.readFile('state.txt'),'two');
  assert.equal(reopened.fs.generation,secondReceipt.generation);
  assert.equal(reopened.workspacePersistence.current.sequence,secondReceipt.sequence);
  assert.equal(reopened.workspacePersistence.crossContextLocking,true);

  reopened.fs.beginTransaction().writeFile('state.txt','three').commit();
  const thirdReceipt=await reopened.persistWorkspace();
  assert.equal(thirdReceipt.sequence,secondReceipt.sequence+1);
  assert.equal(thirdReceipt.generation,secondReceipt.generation+1);

  const gc=await reopened.collectWorkspaceGarbage();
  assert.deepEqual(gc.removed,[firstReceipt.payload]);
  assert.deepEqual([...gc.retained].sort(),[secondReceipt.payload,thirdReceipt.payload].sort());
  await reopened.terminate();

  const finalRuntime=await OpenContainer.boot({workspacePersistence:profile});
  assert.equal(finalRuntime.fs.readFile('state.txt'),'three');
  assert.equal(finalRuntime.fs.generation,thirdReceipt.generation);
  await finalRuntime.terminate();
  assert.ok(locks.requests.length>=6);
  assert.ok(locks.requests.every((request)=>request.mode==='exclusive'));
});


test('SDK workspace profile falls back from corrupt newest payload and can republish',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const directoryName='sdk-workspace-corrupt-recovery';
  const profile={root,directoryName,lockManager:locks};

  const first=await OpenContainer.boot({workspacePersistence:profile});
  first.mount({'state.txt':'stable'});
  const stable=await first.persistWorkspace();
  first.fs.beginTransaction().writeFile('state.txt','newest').commit();
  const newest=await first.persistWorkspace();
  await first.terminate();

  const generations=root.dirs.get(directoryName).dirs.get('generations');
  generations.files.get(newest.payload).data='{"corrupt":true}';

  const recovered=await OpenContainer.boot({workspacePersistence:profile});
  assert.equal(recovered.fs.readFile('state.txt'),'stable');
  assert.equal(recovered.fs.generation,stable.generation);
  assert.equal(recovered.workspacePersistence.current.sequence,stable.sequence);

  recovered.fs.beginTransaction().writeFile('state.txt','recovered').commit();
  const republished=await recovered.persistWorkspace();
  assert.equal(republished.sequence,stable.sequence+1);
  assert.equal(republished.generation,stable.generation+1);
  assert.notEqual(republished.payload,newest.payload);

  const gc=await recovered.collectWorkspaceGarbage();
  assert.ok(gc.removed.includes(newest.payload));
  await recovered.terminate();

  const finalRuntime=await OpenContainer.boot({workspacePersistence:profile});
  assert.equal(finalRuntime.fs.readFile('state.txt'),'recovered');
  assert.equal(finalRuntime.workspacePersistence.current.payload,republished.payload);
  await finalRuntime.terminate();
});

test('SDK workspace persistence APIs fail closed when no OPFS profile is configured',async()=>{
  const runtime=await OpenContainer.boot();
  await assert.rejects(
    ()=>runtime.persistWorkspace(),
    (error)=>error.code===ErrorCodes.INVALID_STATE
  );
  await assert.rejects(
    ()=>runtime.collectWorkspaceGarbage(),
    (error)=>error.code===ErrorCodes.INVALID_STATE
  );
  await runtime.terminate();
});
