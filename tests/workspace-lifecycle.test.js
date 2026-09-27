import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryVFS,
  OpfsCheckpointAuthority,
  OpfsWorkspaceLifecycleAuthority
} from '../packages/vfs/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

class FakeNotFoundError extends Error{
  constructor(){super('Not found');this.name='NotFoundError';}
}
class FakeFileHandle{
  kind='file';
  data=null;
  async getFile(){
    if(this.data===null)throw new FakeNotFoundError();
    const text=String(this.data);
    return {text:async()=>text};
  }
  async createWritable(){
    let next='';
    return {
      write:async value=>{next=String(value);},
      close:async()=>{this.data=next;},
      abort:async()=>{}
    };
  }
}
class FakeDirectoryHandle{
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
      const dir=this.dirs.get(name);
      if(!recursive&&(dir.files.size||dir.dirs.size)){
        const error=new Error('Directory is not empty');
        error.name='InvalidModificationError';
        throw error;
      }
      this.dirs.delete(name);
      return;
    }
    throw new FakeNotFoundError();
  }
}
class FakeLockManager{
  tails=new Map();
  requests=[];
  request(name,options,callback){
    const previous=this.tails.get(name)??Promise.resolve();
    let release;
    const current=new Promise(resolve=>{release=resolve;});
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

async function seeded({directoryName='workspace'}={}){
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const fs=new MemoryVFS();
  const checkpoints=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();
  fs.mount({'state.txt':'one'});
  await checkpoints.checkpoint(fs);
  fs.beginTransaction().writeFile('state.txt','two').commit();
  const recoveryPoint=await checkpoints.checkpoint(fs);
  const lifecycle=await new OpfsWorkspaceLifecycleAuthority({root,lockManager:locks,directoryName}).open();
  return {root,locks,fs,checkpoints,lifecycle,recoveryPoint,directoryName};
}

test('P3 recoverable delete tombstones exact checkpoint and blocks boot/publication until restore',async()=>{
  const {root,locks,fs,checkpoints,lifecycle,recoveryPoint,directoryName}=await seeded({directoryName:'p3-delete-restore'});

  const first=await lifecycle.deleteRecoverably({mutationId:'delete-1',recoveryPoint});
  assert.deepEqual(
    {state:first.state,actionClass:first.actionClass,recoverable:first.recoverable,recoverability:first.recoverability,idempotent:first.idempotent},
    {state:'tombstoned',actionClass:'D2',recoverable:true,recoverability:'tombstone+checkpoint',idempotent:false}
  );
  assert.equal(first.recoveryPoint.sequence,recoveryPoint.sequence);

  const duplicate=await lifecycle.deleteRecoverably({mutationId:'delete-1',recoveryPoint});
  assert.equal(duplicate.idempotent,true);
  await assert.rejects(
    ()=>lifecycle.deleteRecoverably({mutationId:'delete-other',recoveryPoint}),
    error=>error.code===ErrorCodes.INVALID_STATE
  );

  await assert.rejects(
    ()=>checkpoints.checkpoint(fs),
    error=>error.code===ErrorCodes.INVALID_STATE&&error.details?.workspaceLifecycle==='tombstoned'
  );
  await assert.rejects(
    ()=>new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open(),
    error=>error.code===ErrorCodes.INVALID_STATE&&error.details?.recoverable===true
  );

  const status=await lifecycle.inspect();
  assert.equal(status.state,'tombstoned');
  assert.equal(status.workspaceExists,true);
  assert.equal(status.recoverable,true);
  assert.equal(status.recoverability,'tombstone+checkpoint');

  const restored=await lifecycle.restoreRecoverable({
    deleteMutationId:'delete-1',
    restoreMutationId:'restore-1'
  });
  assert.equal(restored.state,'active');
  assert.equal(restored.restored,true);
  assert.equal(restored.idempotent,false);

  const restoredDuplicate=await lifecycle.restoreRecoverable({
    deleteMutationId:'delete-1',
    restoreMutationId:'restore-1'
  });
  assert.equal(restoredDuplicate.idempotent,true);

  const reopened=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();
  const restoredFs=new MemoryVFS();
  await reopened.restoreInto(restoredFs);
  assert.equal(restoredFs.readFile('state.txt'),'two');
  assert.ok(locks.requests.every(request=>request.mode==='exclusive'));
});

test('P3 permanent purge requires tombstone, exact confirmation and leaves explicit unrecoverable truth',async()=>{
  const {root,locks,lifecycle,recoveryPoint,directoryName}=await seeded({directoryName:'p3-permanent-purge'});

  await assert.rejects(
    ()=>lifecycle.purge({
      deleteMutationId:'delete-2',
      purgeMutationId:'purge-2',
      confirmation:{action:'PERMANENT_PURGE',target:directoryName,recoverability:'none-after-purge'}
    }),
    error=>error.code===ErrorCodes.INVALID_STATE
  );

  await lifecycle.deleteRecoverably({mutationId:'delete-2',recoveryPoint});

  await assert.rejects(
    ()=>lifecycle.purge({
      deleteMutationId:'delete-2',
      purgeMutationId:'purge-2',
      confirmation:{action:'PERMANENT_PURGE',target:'wrong-target',recoverability:'none-after-purge'}
    }),
    error=>error.code===ErrorCodes.INVALID_ARGUMENT
  );

  const purged=await lifecycle.purge({
    deleteMutationId:'delete-2',
    purgeMutationId:'purge-2',
    confirmation:{action:'PERMANENT_PURGE',target:directoryName,recoverability:'none-after-purge'}
  });
  assert.deepEqual(
    {state:purged.state,actionClass:purged.actionClass,recoverable:purged.recoverable,recoverability:purged.recoverability,idempotent:purged.idempotent},
    {state:'purged',actionClass:'D4',recoverable:false,recoverability:'none',idempotent:false}
  );

  const duplicate=await lifecycle.purge({
    deleteMutationId:'delete-2',
    purgeMutationId:'purge-2',
    confirmation:{action:'PERMANENT_PURGE',target:directoryName,recoverability:'none-after-purge'}
  });
  assert.equal(duplicate.idempotent,true);

  const status=await lifecycle.inspect();
  assert.equal(status.state,'purged');
  assert.equal(status.workspaceExists,false);
  assert.equal(status.recoverable,false);
  assert.equal(status.recoverability,'none');

  await assert.rejects(
    ()=>lifecycle.restoreRecoverable({deleteMutationId:'delete-2',restoreMutationId:'restore-too-late'}),
    error=>error.code===ErrorCodes.INVALID_STATE
  );
  await assert.rejects(
    ()=>new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open(),
    error=>error.code===ErrorCodes.INVALID_STATE&&error.details?.workspaceLifecycle==='purged'
  );
});

test('P3 purge ack loss reconciles authoritative terminal state before retry',async()=>{
  const {root,locks,lifecycle,recoveryPoint,directoryName}=await seeded({directoryName:'p3-purge-ack-loss'});
  await lifecycle.deleteRecoverably({mutationId:'delete-ack',recoveryPoint});

  await assert.rejects(
    ()=>lifecycle.purge({
      deleteMutationId:'delete-ack',
      purgeMutationId:'purge-ack',
      confirmation:{action:'PERMANENT_PURGE',target:directoryName,recoverability:'none-after-purge'},
      simulateAckLossAfterCommit:true
    }),
    error=>{
      assert.equal(error.code,ErrorCodes.INVALID_STATE);
      assert.equal(error.details?.unknownOutcome,true);
      assert.equal(error.details?.mutationCommitted,true);
      assert.equal(error.details?.reconciliationRequired,true);
      return true;
    }
  );

  const reconciled=await lifecycle.reconcileMutation({purgeMutationId:'purge-ack'});
  assert.equal(reconciled.state,'purged');
  assert.equal(reconciled.terminal,true);
  assert.equal(reconciled.mutationFound,true);
  assert.equal(reconciled.workspaceExists,false);
  assert.equal(reconciled.recoverable,false);

  const retry=await lifecycle.purge({
    deleteMutationId:'delete-ack',
    purgeMutationId:'purge-ack',
    confirmation:{action:'PERMANENT_PURGE',target:directoryName,recoverability:'none-after-purge'}
  });
  assert.equal(retry.state,'purged');
  assert.equal(retry.idempotent,true);
});

test('P3 lifecycle refuses a recovery point that is not a retained canonical or fallback root',async()=>{
  const {lifecycle,recoveryPoint}=await seeded({directoryName:'p3-delete-invalid-root'});
  await assert.rejects(
    ()=>lifecycle.deleteRecoverably({
      mutationId:'delete-invalid',
      recoveryPoint:{...recoveryPoint,sequence:recoveryPoint.sequence+100}
    }),
    error=>error.code===ErrorCodes.IMPORT_INVALID
  );
  const status=await lifecycle.inspect();
  assert.equal(status.state,'active');
  assert.equal(status.recoverable,true);
});
