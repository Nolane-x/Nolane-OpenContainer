import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryVFS } from '../packages/vfs/src/index.js';
import {
  OpfsReleaseStorageAuthority,
  releaseCacheNamespace,
  assessReleaseStorageCompatibility,
  applyReleaseStorageCompatibility
} from '../packages/persistence/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

const encoder=new TextEncoder();

class FakeNotFoundError extends Error{
  constructor(){super('Not found');this.name='NotFoundError';}
}

class FakeFileHandle{
  kind='file';
  data=null;
  async getFile(){
    if(this.data===null)throw new FakeNotFoundError();
    const text=this.data instanceof Uint8Array?new TextDecoder().decode(this.data):String(this.data);
    return {text:async()=>text};
  }
  async createWritable(){
    let next='';
    return {
      write:async(value)=>{next=value instanceof Uint8Array?new Uint8Array(value):String(value);},
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
}

class FakeLockManager{
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

function authority(root,{
  availableBytes=10_000_000,
  directoryName='release-storage'
}={}){
  return new OpfsReleaseStorageAuthority({
    root,
    directoryName,
    lockManager:new FakeLockManager(),
    safetyReserveBytes:128,
    capacityProvider:{async availableBytes(){return availableBytes;}}
  });
}

async function seeded(root,options={}){
  const store=await authority(root,options).open();
  await store.seed({
    storageVersion:1,
    runtimeVersion:'0.1.0-alpha.1',
    data:{workspace:{files:2},marker:'v1'}
  });
  return store;
}

test('release storage dry-run validates adjacent target and leaves canonical identity unchanged',async()=>{
  const root=new FakeDirectoryHandle();
  const store=await seeded(root);
  const before=store.current;
  const plan=await store.dryRun({
    fromVersion:1,
    toVersion:2,
    runtimeVersion:'0.2.0-beta.1',
    transform:(data)=>({...data,marker:'v2',migrated:true}),
    validate:(candidate)=>candidate.data.migrated===true
  });

  assert.equal(plan.ok,true);
  assert.equal(plan.canonicalUnchanged,true);
  assert.equal(plan.sourceGeneration,1);
  assert.equal(plan.targetGeneration,2);
  assert.equal(plan.derivedCache.strategy,'lazy-rebuild');
  assert.equal(plan.derivedCache.criticalOpenPath,false);
  assert.equal(plan.derivedCache.migrateBytes,0);
  assert.notEqual(plan.derivedCache.sourceNamespace,plan.derivedCache.targetNamespace);
  assert.deepEqual(store.current,before);
  assert.equal((await store.readCanonical()).storageVersion,1);

  await assert.rejects(
    ()=>store.dryRun({fromVersion:1,toVersion:3}),
    (error)=>error.code===ErrorCodes.STORAGE_MIGRATION_INVALID
  );
});

test('release storage dry-run fails before publication when migration capacity is insufficient',async()=>{
  const root=new FakeDirectoryHandle();
  const store=await seeded(root,{availableBytes:1});
  const before=store.current;
  const plan=await store.dryRun({
    fromVersion:1,
    toVersion:2,
    transform:(data)=>({...data,large:'x'.repeat(1024)})
  });
  assert.equal(plan.ok,false);
  assert.equal(plan.canonicalUnchanged,true);
  assert.ok(plan.requiredBytes>1);
  assert.deepEqual(store.current,before);

  await assert.rejects(
    ()=>store.migrate({
      fromVersion:1,
      toVersion:2,
      transform:(data)=>({...data,large:'x'.repeat(1024)})
    }),
    (error)=>error.code===ErrorCodes.RESOURCE_EXHAUSTED
  );
  assert.equal((await store.readCanonical()).storageVersion,1);
});

test('successful adjacent migration publishes target last and preserves both recovery roots',async()=>{
  const root=new FakeDirectoryHandle();
  const store=await seeded(root);
  const first=store.current;
  const receipt=await store.migrate({
    fromVersion:1,
    toVersion:2,
    runtimeVersion:'0.2.0-beta.1',
    transform:(data)=>({...data,marker:'v2',newField:'ready'}),
    validate:(candidate,source)=>candidate.data.marker==='v2'&&source.data.marker==='v1'
  });

  assert.equal(receipt.canonicalPublished,true);
  assert.equal(receipt.destructiveDowngrade,false);
  assert.equal(receipt.toVersion,2);
  assert.equal(receipt.generation,2);
  assert.notEqual(receipt.slot,first.slot);
  assert.equal(receipt.derivedCache.strategy,'lazy-rebuild');

  const canonical=await store.readCanonical();
  assert.equal(canonical.storageVersion,2);
  assert.equal(canonical.data.marker,'v2');
  assert.equal(canonical.data.newField,'ready');
  const roots=await store.recoveryRoots();
  assert.equal(roots.length,2);
  assert.deepEqual(roots.map((item)=>item.storageVersion).sort(),[1,2]);
  assert.ok(roots.every((item)=>item.valid));
});

test('crash injection preserves at least one valid canonical generation at every migration phase',async()=>{
  for(const phase of ['after-preflight','after-payload','after-verify','after-publish']){
    const root=new FakeDirectoryHandle();
    const store=await seeded(root,{directoryName:'crash-'+phase});
    await assert.rejects(
      ()=>store.migrate({
        fromVersion:1,
        toVersion:2,
        runtimeVersion:'0.2.0-beta.1',
        transform:(data)=>({...data,phase}),
        crashAt:phase
      }),
      (error)=>error.code===ErrorCodes.STORAGE_MIGRATION_INVALID&&error.details?.phase===phase
    );

    const reopened=await authority(root,{directoryName:'crash-'+phase}).open();
    const canonical=await reopened.readCanonical();
    const roots=await reopened.recoveryRoots();
    assert.ok(canonical);
    assert.ok(roots.some((item)=>item.valid));
    if(phase==='after-publish'){
      assert.equal(canonical.storageVersion,2);
      assert.deepEqual(roots.filter((item)=>item.valid).map((item)=>item.storageVersion).sort(),[1,2]);
    }else{
      assert.equal(canonical.storageVersion,1);
      assert.ok(roots.some((item)=>item.storageVersion===1&&item.valid));
    }
  }
});

test('rollback reuses newer readable storage in emergency read-only mode instead of downgrading it',async()=>{
  const root=new FakeDirectoryHandle();
  const store=await seeded(root);
  await store.migrate({
    fromVersion:1,
    toVersion:2,
    runtimeVersion:'0.2.0-beta.1',
    transform:(data)=>({...data,marker:'v2'})
  });

  const rollback=await store.rollbackPolicy({
    runtimeStorageVersion:1,
    readableStorageVersions:[1,2]
  });
  assert.equal(rollback.strategy,'reuse-newer-storage-read-only');
  assert.equal(rollback.mode,'read-only');
  assert.equal(rollback.destructiveStorageDowngrade,false);

  const fs=new MemoryVFS();
  fs.mount({'state.txt':'stable'});
  const applied=await store.applyCompatibility(fs,{
    runtimeStorageVersion:1,
    readableStorageVersions:[1,2]
  });
  assert.equal(applied.mode,'read-only');
  assert.equal(fs.readOnly,true);
  assert.match(fs.readOnlyReason,/release-storage:2:runtime:1/);

  await assert.rejects(
    async()=>fs.beginTransaction().writeFile('state.txt','forbidden').commit(),
    (error)=>error.code===ErrorCodes.STORAGE_READ_ONLY
  );
  assert.equal(fs.readFile('state.txt'),'stable');

  const currentRuntime=assessReleaseStorageCompatibility({
    runtimeStorageVersion:2,
    canonicalStorageVersion:2,
    readableStorageVersions:[1,2]
  });
  applyReleaseStorageCompatibility(fs,currentRuntime);
  assert.equal(fs.readOnly,false);
  fs.beginTransaction().writeFile('state.txt','writable-again').commit();
  assert.equal(fs.readFile('state.txt'),'writable-again');
});

test('rollback refuses open when older runtime cannot read newer canonical storage',async()=>{
  const root=new FakeDirectoryHandle();
  const store=await seeded(root);
  await store.migrate({fromVersion:1,toVersion:2,runtimeVersion:'0.2.0-beta.1'});
  const rollback=await store.rollbackPolicy({
    runtimeStorageVersion:1,
    readableStorageVersions:[1]
  });
  assert.equal(rollback.strategy,'refuse-open');
  assert.equal(rollback.mode,'unsupported');
  assert.equal(rollback.destructiveStorageDowngrade,false);

  const fs=new MemoryVFS();
  await assert.rejects(
    ()=>store.applyCompatibility(fs,{runtimeStorageVersion:1,readableStorageVersions:[1]}),
    (error)=>error.code===ErrorCodes.STORAGE_MIGRATION_INVALID
  );
});

test('derived-cache namespaces are versioned and never reused across storage profiles',()=>{
  const first=releaseCacheNamespace({runtimeVersion:'0.1.0-alpha.1',storageVersion:1,cacheSchemaVersion:1});
  const second=releaseCacheNamespace({runtimeVersion:'0.2.0-beta.1',storageVersion:2,cacheSchemaVersion:1});
  const changedSchema=releaseCacheNamespace({runtimeVersion:'0.2.0-beta.1',storageVersion:2,cacheSchemaVersion:2});
  assert.notEqual(first,second);
  assert.notEqual(second,changedSchema);
  assert.match(first,/storage-v1-cache-v1$/);
  assert.match(second,/storage-v2-cache-v1$/);
});
