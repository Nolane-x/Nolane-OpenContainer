import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PersistenceCorruptionClass,
  PersistenceCorruptionAction,
  corruptionDisposition,
  persistenceCorruptionMatrix,
  OpfsDerivedIndexStore
} from '../packages/persistence/src/index.js';

class FakeFileHandle{
  kind='file';
  constructor(){this.data='';}
  async getFile(){
    const data=this.data;
    return {async text(){return String(data);}};
  }
  async createWritable(){
    const handle=this;
    let next='';
    return {
      async write(value){next=String(value);},
      async close(){handle.data=next;},
      async abort(){}
    };
  }
}
class FakeDirectoryHandle{
  kind='directory';
  constructor(){this.files=new Map();this.dirs=new Map();}
  async getDirectoryHandle(name,{create=false}={}){
    if(this.dirs.has(name))return this.dirs.get(name);
    if(!create)throw Object.assign(new Error('missing'),{name:'NotFoundError'});
    const dir=new FakeDirectoryHandle();
    this.dirs.set(name,dir);
    return dir;
  }
  async getFileHandle(name,{create=false}={}){
    if(this.files.has(name))return this.files.get(name);
    if(!create)throw Object.assign(new Error('missing'),{name:'NotFoundError'});
    const file=new FakeFileHandle();
    this.files.set(name,file);
    return file;
  }
  async removeEntry(name){
    if(this.files.delete(name)||this.dirs.delete(name))return;
    throw Object.assign(new Error('missing'),{name:'NotFoundError'});
  }
}
class FakeLocks{
  async request(_name,_options,callback){return callback();}
}

test('P3 corruption taxonomy keeps five artifact classes semantically distinct',()=>{
  const matrix=persistenceCorruptionMatrix();
  assert.deepEqual(matrix.map(item=>item.kind),[
    'canonical-source',
    'recovery-draft',
    'checkpoint',
    'package-cache',
    'derived-index'
  ]);
  assert.equal(corruptionDisposition(PersistenceCorruptionClass.CANONICAL_SOURCE).action,PersistenceCorruptionAction.FAIL_CLOSED);
  assert.equal(corruptionDisposition(PersistenceCorruptionClass.RECOVERY_DRAFT).action,PersistenceCorruptionAction.DISCARD_DRAFT);
  assert.equal(corruptionDisposition(PersistenceCorruptionClass.CHECKPOINT).action,PersistenceCorruptionAction.FALLBACK_CHECKPOINT);
  assert.equal(corruptionDisposition(PersistenceCorruptionClass.PACKAGE_CACHE).action,PersistenceCorruptionAction.DISCARD_REFETCH);
  assert.equal(corruptionDisposition(PersistenceCorruptionClass.DERIVED_INDEX).action,PersistenceCorruptionAction.DISCARD_REBUILD);
  assert.equal(new Set(matrix.map(item=>item.action)).size,5);
});

test('P3 derived index corruption is detected and rebuilt from canonical generation',async()=>{
  const root=new FakeDirectoryHandle();
  const store=await new OpfsDerivedIndexStore({
    root,
    directoryName:'p3-derived-index',
    lockManager:new FakeLocks()
  }).open();

  const first=await store.publish({sourceGeneration:7,value:{files:['a.js','b.js'],count:2}});
  assert.equal(first.status,'published');
  const verified=await store.read({sourceGeneration:7});
  assert.equal(verified.status,'verified');
  assert.deepEqual(verified.value,{files:['a.js','b.js'],count:2});

  const dir=root.dirs.get('p3-derived-index');
  dir.files.get('derived-index.json').data='{"corrupt":true}';
  const corrupt=await store.read({sourceGeneration:7});
  assert.deepEqual(
    {status:corrupt.status,corruptionClass:corrupt.corruptionClass,action:corrupt.action,rebuildable:corrupt.rebuildable},
    {status:'corrupt',corruptionClass:'derived-index',action:'discard-rebuild',rebuildable:true}
  );

  const rebuilt=await store.rebuild({sourceGeneration:8,value:{files:['c.js'],count:1}});
  assert.equal(rebuilt.status,'published');
  const reopened=await new OpfsDerivedIndexStore({
    root,
    directoryName:'p3-derived-index',
    lockManager:new FakeLocks()
  }).open();
  const repaired=await reopened.read({sourceGeneration:8});
  assert.equal(repaired.status,'verified');
  assert.deepEqual(repaired.value,{files:['c.js'],count:1});
  assert.equal(reopened.crossContextLocking,true);

  const usage=await reopened.inspectStorage();
  assert.ok(usage.totalBytes>0);
  assert.equal(usage.totalBytes,usage.manifestBytes+usage.payloadBytes);
  assert.equal(usage.rebuildable,true);
  const discarded=await reopened.discard();
  assert.equal(discarded.reclaimedBytes,usage.totalBytes);
  assert.equal(discarded.rebuildable,true);
  assert.equal((await reopened.inspectStorage()).totalBytes,0);
});
