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
  const reopenedSupport=reopened.supportBundle();
  assert.equal(reopenedSupport.outcomes.recovery.status,'restored');
  assert.equal(reopenedSupport.outcomes.recovery.sequence,secondReceipt.sequence);
  assert.equal(reopenedSupport.outcomes.recovery.generation,secondReceipt.generation);

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
  const recoverySupport=recovered.supportBundle();
  assert.equal(recoverySupport.outcomes.recovery.status,'restored');
  assert.equal(recoverySupport.outcomes.recovery.sequence,stable.sequence);
  assert.equal(recoverySupport.outcomes.recovery.generation,stable.generation);

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


test('P3 SDK boot fails closed when canonical metadata exists but all recovery payloads are invalid',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const directoryName='p3-sdk-fatal-recovery';
  const profile={root,directoryName,lockManager:locks};

  const runtime=await OpenContainer.boot({workspacePersistence:profile});
  runtime.mount({'state.txt':'one'});
  const first=await runtime.persistWorkspace();
  runtime.fs.beginTransaction().writeFile('state.txt','two').commit();
  const second=await runtime.persistWorkspace();
  await runtime.terminate();

  const generations=root.dirs.get(directoryName).dirs.get('generations');
  generations.files.get(first.payload).data='{"corrupt":true}';
  generations.files.get(second.payload).data='{"corrupt":true}';

  await assert.rejects(
    ()=>OpenContainer.boot({workspacePersistence:profile}),
    error=>{
      assert.equal(error.code,ErrorCodes.IMPORT_INVALID);
      assert.equal(error.details?.silentEmptyFallback,false);
      return true;
    }
  );
});


test('P3 SDK planned workspace restore creates a recoverable safety checkpoint before rollback',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const profile={root,directoryName:'sdk-safe-restore',lockManager:locks};

  const runtime=await OpenContainer.boot({workspacePersistence:profile});
  runtime.mount({'project.txt':'old','unrelated.txt':'base'});
  const target=await runtime.persistWorkspace();

  runtime.fs.beginTransaction()
    .writeFile('project.txt','current')
    .writeFile('unrelated.txt','newer')
    .commit();
  const current=await runtime.persistWorkspace();

  runtime.fs.beginTransaction()
    .writeFile('unrelated.txt','unpersisted-newer')
    .writeFile('later.txt','recover-me')
    .commit();

  const plan=await runtime.prepareWorkspaceRestore(target);
  assert.equal(plan.expectedCanonicalSequence,current.sequence);
  const receipt=await runtime.restoreWorkspaceCheckpoint(plan);

  assert.equal(receipt.status,'restored');
  assert.equal(receipt.recoveryPointCreated,true);
  assert.equal(receipt.published.sequence,receipt.recoveryPoint.sequence+1);
  assert.equal(runtime.fs.readFile('project.txt'),'old');
  assert.equal(runtime.fs.readFile('unrelated.txt'),'base');
  assert.equal(runtime.fs.exists('later.txt'),false);

  const safety=await runtime.workspacePersistence.readCheckpoint(receipt.recoveryPoint);
  const safetyFs=new (runtime.fs.constructor)();
  safetyFs.restore(safety);
  assert.equal(safetyFs.readFile('project.txt'),'current');
  assert.equal(safetyFs.readFile('unrelated.txt'),'unpersisted-newer');
  assert.equal(safetyFs.readFile('later.txt'),'recover-me');

  await runtime.terminate();

  const reopened=await OpenContainer.boot({workspacePersistence:profile});
  assert.equal(reopened.fs.readFile('project.txt'),'old');
  assert.equal(reopened.fs.readFile('unrelated.txt'),'base');
  assert.equal(reopened.workspacePersistence.current.sequence,receipt.published.sequence);
  await reopened.terminate();
});

test('P3 SDK safe restore APIs fail closed without workspace persistence',async()=>{
  const runtime=await OpenContainer.boot();
  await assert.rejects(
    ()=>runtime.prepareWorkspaceRestore({}),
    error=>error.code===ErrorCodes.INVALID_STATE
  );
  await assert.rejects(
    ()=>runtime.restoreWorkspaceCheckpoint({}),
    error=>error.code===ErrorCodes.INVALID_STATE
  );
  await runtime.terminate();
});


test('P3 SDK recoverable delete preserves tombstone and static restore re-enables boot',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const profile={root,directoryName:'sdk-recoverable-delete',lockManager:locks};

  const runtime=await OpenContainer.boot({workspacePersistence:profile});
  runtime.mount({'state.txt':'before-delete','unsaved.txt':'must-be-checkpointed'});
  const late=runtime.fs.beginTransaction().writeFile('late.txt','must-not-slip-through-delete');
  const deleting=runtime.deleteWorkspaceRecoverably({mutationId:'delete-sdk-1'});
  assert.throws(
    ()=>late.commit(),
    error=>error.code===ErrorCodes.INVALID_STATE&&error.details?.reason==='recoverable-workspace-delete'
  );
  const deleted=await deleting;
  assert.equal(deleted.state,'tombstoned');
  assert.equal(deleted.recoverable,true);
  assert.equal(deleted.recoveryPoint.sequence>=1,true);
  assert.equal(runtime.state,'terminated');

  const status=await OpenContainer.inspectWorkspaceLifecycle(profile);
  assert.equal(status.state,'tombstoned');
  assert.equal(status.workspaceExists,true);
  assert.equal(status.recoverable,true);
  assert.equal(status.recoverability,'tombstone+checkpoint');

  await assert.rejects(
    ()=>OpenContainer.boot({workspacePersistence:profile}),
    error=>{
      assert.equal(error.code,ErrorCodes.INVALID_STATE);
      assert.equal(error.details?.workspaceLifecycle,'tombstoned');
      assert.equal(error.details?.recoverable,true);
      return true;
    }
  );

  const restored=await OpenContainer.restoreDeletedWorkspace(profile,{
    deleteMutationId:'delete-sdk-1',
    restoreMutationId:'restore-sdk-1'
  });
  assert.equal(restored.state,'active');
  assert.equal(restored.recoverable,true);

  const reopened=await OpenContainer.boot({workspacePersistence:profile});
  assert.equal(reopened.fs.readFile('state.txt'),'before-delete');
  assert.equal(reopened.fs.readFile('unsaved.txt'),'must-be-checkpointed');
  assert.equal(reopened.fs.exists('late.txt'),false);
  await reopened.terminate();
});

test('P3 SDK permanent purge is separate from delete and reports unrecoverable truth',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const profile={root,directoryName:'sdk-permanent-purge',lockManager:locks};

  const runtime=await OpenContainer.boot({workspacePersistence:profile});
  runtime.mount({'state.txt':'purge-me'});
  await runtime.deleteWorkspaceRecoverably({mutationId:'delete-sdk-purge'});

  const purged=await OpenContainer.purgeDeletedWorkspace(profile,{
    deleteMutationId:'delete-sdk-purge',
    purgeMutationId:'purge-sdk-1',
    confirmation:{
      action:'PERMANENT_PURGE',
      target:'sdk-permanent-purge',
      recoverability:'none-after-purge'
    }
  });
  assert.equal(purged.state,'purged');
  assert.equal(purged.actionClass,'D4');
  assert.equal(purged.recoverable,false);
  assert.equal(purged.recoverability,'none');

  const status=await OpenContainer.inspectWorkspaceLifecycle(profile);
  assert.equal(status.state,'purged');
  assert.equal(status.workspaceExists,false);
  assert.equal(status.recoverable,false);
  assert.equal(status.recoverability,'none');

  const duplicate=await OpenContainer.purgeDeletedWorkspace(profile,{
    deleteMutationId:'delete-sdk-purge',
    purgeMutationId:'purge-sdk-1',
    confirmation:{
      action:'PERMANENT_PURGE',
      target:'sdk-permanent-purge',
      recoverability:'none-after-purge'
    }
  });
  assert.equal(duplicate.idempotent,true);

  await assert.rejects(
    ()=>OpenContainer.boot({workspacePersistence:profile}),
    error=>error.code===ErrorCodes.INVALID_STATE&&error.details?.workspaceLifecycle==='purged'
  );
});
