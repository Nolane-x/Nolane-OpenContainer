import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserStoragePolicy, MemoryVFS, OpfsCheckpointAuthority } from '../packages/vfs/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

class FakeNotFoundError extends Error {
  constructor() {
    super('Not found');
    this.name = 'NotFoundError';
  }
}

class FakeFileHandle {
  kind = 'file';
  data = null;

  async getFile() {
    if (this.data === null) throw new FakeNotFoundError();
    return { text: async () => this.data };
  }

  async createWritable() {
    let next = '';
    return {
      write: async (value) => { next = String(value); },
      close: async () => { this.data = next; },
      abort: async () => {}
    };
  }
}

class FakeDirectoryHandle {
  kind = 'directory';
  files = new Map();
  dirs = new Map();

  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.dirs.has(name)) {
      if (!create) throw new FakeNotFoundError();
      this.dirs.set(name, new FakeDirectoryHandle());
    }
    return this.dirs.get(name);
  }

  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name)) {
      if (!create) throw new FakeNotFoundError();
      this.files.set(name, new FakeFileHandle());
    }
    return this.files.get(name);
  }

  async *entries() {
    for (const entry of this.dirs) yield entry;
    for (const entry of this.files) yield entry;
  }

  async removeEntry(name, { recursive = false } = {}) {
    if (this.files.delete(name)) return;
    if (this.dirs.has(name)) {
      const directory = this.dirs.get(name);
      if (!recursive && (directory.files.size || directory.dirs.size)) {
        const error = new Error('Directory is not empty');
        error.name = 'InvalidModificationError';
        throw error;
      }
      this.dirs.delete(name);
      return;
    }
    throw new FakeNotFoundError();
  }
}

class FakeLockManager {
  tails = new Map();
  requests = [];

  request(name, options, callback) {
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.tails.set(name, current);
    this.requests.push({ name, mode: options?.mode ?? 'exclusive' });

    return previous
      .then(() => callback({ name, mode: options?.mode ?? 'exclusive' }))
      .finally(() => {
        release();
        if (this.tails.get(name) === current) this.tails.delete(name);
      });
  }
}

test('OPFS checkpoint round-trips a committed VFS generation', async () => {
  const root = new FakeDirectoryHandle();
  const fs = new MemoryVFS();
  fs.mount({ 'src/index.js': 'export default 1' });

  const authority = await new OpfsCheckpointAuthority({ root }).open();
  const receipt = await authority.checkpoint(fs);
  assert.equal(receipt.generation, fs.generation);

  const restored = new MemoryVFS();
  await authority.restoreInto(restored);
  assert.equal(restored.readFile('src/index.js'), 'export default 1');
});

test('OPFS manifests alternate slots across generations', async () => {
  const root = new FakeDirectoryHandle();
  const fs = new MemoryVFS();
  const authority = await new OpfsCheckpointAuthority({ root }).open();

  fs.mount({ 'a.txt': 'one' });
  const first = await authority.checkpoint(fs);
  fs.beginTransaction().writeFile('a.txt', 'two').commit();
  const second = await authority.checkpoint(fs);

  assert.notEqual(first.slot, second.slot);
  assert.equal(second.sequence, first.sequence + 1);
});

test('OPFS recovery falls back when newest payload is corrupted', async () => {
  const root = new FakeDirectoryHandle();
  const fs = new MemoryVFS();
  const authority = await new OpfsCheckpointAuthority({ root }).open();

  fs.mount({ 'value.txt': 'first' });
  const first = await authority.checkpoint(fs);
  fs.beginTransaction().writeFile('value.txt', 'second').commit();
  const second = await authority.checkpoint(fs);

  const workspace = root.dirs.get('opencontainer-workspace');
  const generations = workspace.dirs.get('generations');
  generations.files.get(second.payload).data = '{"corrupt":true}';

  const reopened = await new OpfsCheckpointAuthority({ root }).open();
  assert.equal(reopened.current.sequence, first.sequence);

  const restored = new MemoryVFS();
  await reopened.restoreInto(restored);
  assert.equal(restored.readFile('value.txt'), 'first');
});

test('OPFS recovery ignores a torn newest manifest', async () => {
  const root = new FakeDirectoryHandle();
  const fs = new MemoryVFS();
  const authority = await new OpfsCheckpointAuthority({ root }).open();

  fs.mount({ 'value.txt': 'stable' });
  const first = await authority.checkpoint(fs);

  const workspace = root.dirs.get('opencontainer-workspace');
  const tornSlot = first.slot === 'a' ? 'manifest-b.json' : 'manifest-a.json';
  const torn = await workspace.getFileHandle(tornSlot, { create: true });
  torn.data = '{"version":1,"sequence":999';

  const reopened = await new OpfsCheckpointAuthority({ root }).open();
  assert.equal(reopened.current.sequence, first.sequence);
});

test('OPFS rejects publication from an older generation', async () => {
  const root = new FakeDirectoryHandle();
  const fs = new MemoryVFS();
  const authority = await new OpfsCheckpointAuthority({ root }).open();

  fs.mount({ 'a.txt': 'one' });
  const oldSnapshot = fs.snapshot();
  fs.beginTransaction().writeFile('a.txt', 'two').commit();
  await authority.checkpoint(fs);

  await assert.rejects(
    () => authority.checkpoint(oldSnapshot),
    (error) => error.code === ErrorCodes.STALE_GENERATION
  );
});

test('OPFS cross-context lock refresh rejects a stale authority after a newer writer', async () => {
  const root = new FakeDirectoryHandle();
  const locks = new FakeLockManager();
  const firstAuthority = await new OpfsCheckpointAuthority({ root, lockManager: locks }).open();
  const staleAuthority = await new OpfsCheckpointAuthority({ root, lockManager: locks }).open();

  const fs = new MemoryVFS();
  fs.mount({ 'value.txt': 'generation-one' });
  const staleSnapshot = fs.snapshot();
  fs.beginTransaction().writeFile('value.txt', 'generation-two').commit();

  const newest = await firstAuthority.checkpoint(fs);
  assert.equal(newest.generation, fs.generation);
  assert.equal(staleAuthority.current, null);

  await assert.rejects(
    () => staleAuthority.checkpoint(staleSnapshot),
    (error) => error.code === ErrorCodes.STALE_GENERATION
  );
  assert.equal(staleAuthority.current.generation, newest.generation);
  assert.ok(locks.requests.every((entry) => entry.mode === 'exclusive'));
});

test('OPFS cross-context writers share a monotonic sequence and latest restore', async () => {
  const root = new FakeDirectoryHandle();
  const locks = new FakeLockManager();
  const firstAuthority = await new OpfsCheckpointAuthority({ root, lockManager: locks }).open();
  const secondAuthority = await new OpfsCheckpointAuthority({ root, lockManager: locks }).open();

  const fs = new MemoryVFS();
  fs.mount({ 'value.txt': 'one' });
  const first = await firstAuthority.checkpoint(fs);

  fs.beginTransaction().writeFile('value.txt', 'two').commit();
  const second = await secondAuthority.checkpoint(fs);

  assert.equal(second.sequence, first.sequence + 1);
  assert.notEqual(second.slot, first.slot);
  assert.equal(firstAuthority.current.sequence, first.sequence);

  const restored = new MemoryVFS();
  await firstAuthority.restoreInto(restored);
  assert.equal(restored.readFile('value.txt'), 'two');
  assert.equal(firstAuthority.current.sequence, second.sequence);
});

test('OPFS garbage collection removes only payloads unreachable from both manifest slots', async () => {
  const root = new FakeDirectoryHandle();
  const locks = new FakeLockManager();
  const fs = new MemoryVFS();
  const authority = await new OpfsCheckpointAuthority({ root, lockManager: locks }).open();

  fs.mount({ 'value.txt': 'one' });
  const first = await authority.checkpoint(fs);
  fs.beginTransaction().writeFile('value.txt', 'two').commit();
  const second = await authority.checkpoint(fs);
  fs.beginTransaction().writeFile('value.txt', 'three').commit();
  const third = await authority.checkpoint(fs);

  const workspace = root.dirs.get('opencontainer-workspace');
  const generations = workspace.dirs.get('generations');
  const orphan = await generations.getFileHandle('generation-crash-orphan.json', { create: true });
  orphan.data = '{"orphan":true}';

  const dryRun = await authority.collectGarbage({ dryRun: true });
  assert.deepEqual(dryRun.removed, [first.payload, 'generation-crash-orphan.json'].sort());
  assert.deepEqual(dryRun.retained, [second.payload, third.payload].sort());
  assert.equal(generations.files.has(first.payload), true);
  assert.equal(generations.files.has('generation-crash-orphan.json'), true);

  const collected = await authority.collectGarbage();
  assert.deepEqual(collected.removed, dryRun.removed);
  assert.equal(generations.files.has(first.payload), false);
  assert.equal(generations.files.has('generation-crash-orphan.json'), false);
  assert.equal(generations.files.has(second.payload), true);
  assert.equal(generations.files.has(third.payload), true);

  generations.files.get(third.payload).data = '{"corrupt":true}';
  const reopened = await new OpfsCheckpointAuthority({ root, lockManager: locks }).open();
  assert.equal(reopened.current.sequence, second.sequence);

  const restored = new MemoryVFS();
  await reopened.restoreInto(restored);
  assert.equal(restored.readFile('value.txt'), 'two');
});

test('OPFS checkpoint preflights payload plus manifest bytes through storage policy', async () => {
  const root = new FakeDirectoryHandle();
  const calls = [];
  const storagePolicy = {
    async inspect() { return { supported: true, usageBytes: 1, quotaBytes: 100000 }; },
    async assertCanWrite(additionalBytes) {
      calls.push(additionalBytes);
      return { supported: true, additionalBytes };
    }
  };
  const fs = new MemoryVFS();
  fs.mount({ 'value.txt': 'storage-policy' });

  const authority = await new OpfsCheckpointAuthority({ root, storagePolicy }).open();
  await authority.checkpoint(fs);

  assert.equal(calls.length, 1);
  assert.ok(calls[0] > JSON.stringify(fs.snapshot()).length);
});

test('OPFS normalizes browser quota exhaustion into resource exhausted', async () => {
  const root = new FakeDirectoryHandle();
  const storagePolicy = {
    async inspect() {
      return { supported: true, usageBytes: 999, quotaBytes: 1000, pressure: 'critical' };
    },
    async assertCanWrite() {
      return { supported: true };
    }
  };
  const fs = new MemoryVFS();
  fs.mount({ 'value.txt': 'quota' });

  const authority = await new OpfsCheckpointAuthority({ root, storagePolicy }).open();
  const generations = root.dirs.get('opencontainer-workspace').dirs.get('generations');
  generations.getFileHandle = async () => ({
    kind: 'file',
    async createWritable() {
      return {
        async write() {
          const error = new Error('Quota exceeded');
          error.name = 'QuotaExceededError';
          throw error;
        },
        async close() {},
        async abort() {}
      };
    }
  });

  await assert.rejects(
    () => authority.checkpoint(fs),
    (error) => {
      assert.equal(error.code, ErrorCodes.RESOURCE_EXHAUSTED);
      assert.equal(error.details.phase, 'payload');
      assert.equal(error.details.storage.pressure, 'critical');
      return true;
    }
  );
});


test('OPFS retries a projected quota rejection after collecting unreachable payloads', async () => {
  const root = new FakeDirectoryHandle();
  const locks = new FakeLockManager();
  let pressured = false;
  let pressureChecks = 0;
  const storagePolicy = new BrowserStoragePolicy({
    storageManager: {
      async estimate() {
        if (!pressured) return { usage: 100, quota: 10_000 };
        pressureChecks++;
        return pressureChecks === 1
          ? { usage: 9990, quota: 10_000 }
          : { usage: 100, quota: 10_000 };
      },
      async persisted() { return true; }
    },
    criticalRatio: 0.95
  });

  const fs = new MemoryVFS();
  const authority = await new OpfsCheckpointAuthority({
    root,
    lockManager: locks,
    storagePolicy
  }).open();

  fs.mount({ 'value.txt': 'one' });
  const first = await authority.checkpoint(fs);

  const workspace = root.dirs.get('opencontainer-workspace');
  const generations = workspace.dirs.get('generations');
  const orphanName = 'generation-quota-retry-orphan.json';
  const orphan = await generations.getFileHandle(orphanName, { create: true });
  orphan.data = '{"orphan":true}';

  fs.beginTransaction().writeFile('value.txt', 'two').commit();
  pressured = true;
  const second = await authority.checkpoint(fs);

  assert.equal(second.sequence, first.sequence + 1);
  assert.equal(pressureChecks, 2);
  assert.equal(authority.lastStorageGuard.gcAttempted, true);
  assert.deepEqual(authority.lastStorageGuard.gcRemoved, [orphanName]);
  assert.equal(generations.files.has(orphanName), false);
});

test('OPFS persistent quota pressure rejects before publication and preserves the committed generation', async () => {
  const root = new FakeDirectoryHandle();
  const locks = new FakeLockManager();
  let pressured = false;
  const storagePolicy = new BrowserStoragePolicy({
    storageManager: {
      async estimate() {
        return pressured
          ? { usage: 9990, quota: 10_000 }
          : { usage: 100, quota: 10_000 };
      },
      async persisted() { return true; }
    },
    criticalRatio: 0.95
  });

  const fs = new MemoryVFS();
  const authority = await new OpfsCheckpointAuthority({
    root,
    lockManager: locks,
    storagePolicy
  }).open();

  fs.mount({ 'value.txt': 'stable' });
  const stable = await authority.checkpoint(fs);
  const workspace = root.dirs.get('opencontainer-workspace');
  const generations = workspace.dirs.get('generations');
  const payloadsBefore = [...generations.files.keys()].sort();

  fs.beginTransaction().writeFile('value.txt', 'blocked').commit();
  pressured = true;

  await assert.rejects(
    () => authority.checkpoint(fs),
    (error) => {
      assert.equal(error.code, ErrorCodes.RESOURCE_EXHAUSTED);
      assert.equal(error.details.additionalBytes > 0, true);
      assert.deepEqual(error.details.gcRemoved, []);
      return true;
    }
  );

  assert.equal(authority.current.sequence, stable.sequence);
  assert.equal(authority.current.generation, stable.generation);
  assert.equal(authority.lastStorageGuard.gcAttempted, true);
  assert.equal(authority.lastStorageGuard.rejected, true);
  assert.deepEqual([...generations.files.keys()].sort(), payloadsBefore);

  const reopened = await new OpfsCheckpointAuthority({ root, lockManager: locks }).open();
  assert.equal(reopened.current.sequence, stable.sequence);
  const restored = new MemoryVFS();
  await reopened.restoreInto(restored);
  assert.equal(restored.readFile('value.txt'), 'stable');
});


test('P3 writer election serializes competing same-generation publishers without split brain',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const first=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName:'p3-election'}).open();
  const second=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName:'p3-election'}).open();
  const fsA=new MemoryVFS();
  const fsB=new MemoryVFS();
  fsA.mount({'winner.txt':'A'});
  fsB.mount({'winner.txt':'B'});

  const outcomes=await Promise.allSettled([
    first.checkpoint(fsA),
    second.checkpoint(fsB)
  ]);
  assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(item=>item.status==='rejected').length,1);
  const rejected=outcomes.find(item=>item.status==='rejected');
  assert.equal(rejected.reason.code,ErrorCodes.STALE_GENERATION);
  assert.ok(locks.requests.length>=2);
  assert.ok(locks.requests.every(item=>item.mode==='exclusive'));

  const reopened=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName:'p3-election'}).open();
  const restored=new MemoryVFS();
  await reopened.restoreInto(restored);
  assert.ok(['A','B'].includes(restored.readFile('winner.txt')));
  assert.equal(reopened.current.sequence,1);
});

test('P3 checkpoint crash phases reopen only old-valid or new-valid canonical state',async()=>{
  for(const phase of ['after-preflight','after-payload','after-manifest']){
    const root=new FakeDirectoryHandle();
    const locks=new FakeLockManager();
    const directoryName='p3-crash-'+phase;
    const fs=new MemoryVFS();
    const authority=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();
    fs.mount({'state.txt':'old'});
    const stable=await authority.checkpoint(fs);
    fs.beginTransaction().writeFile('state.txt','new').commit();

    await assert.rejects(
      ()=>authority.checkpoint(fs,{crashAt:phase}),
      error=>error.code===ErrorCodes.INVALID_STATE&&error.details?.injectedCrash===true&&error.details?.phase===phase
    );

    const reopened=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();
    const restored=new MemoryVFS();
    await reopened.restoreInto(restored);
    if(phase==='after-manifest'){
      assert.equal(restored.readFile('state.txt'),'new');
      assert.equal(reopened.current.sequence,stable.sequence+1);
    }else{
      assert.equal(restored.readFile('state.txt'),'old');
      assert.equal(reopened.current.sequence,stable.sequence);
    }
  }
});

test('P3 canonical metadata corruption fails closed instead of silently opening an empty workspace',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const directoryName='p3-no-silent-empty';
  const fs=new MemoryVFS();
  const authority=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();
  fs.mount({'state.txt':'one'});
  const first=await authority.checkpoint(fs);
  fs.beginTransaction().writeFile('state.txt','two').commit();
  const second=await authority.checkpoint(fs);

  const generations=root.dirs.get(directoryName).dirs.get('generations');
  generations.files.get(first.payload).data='{"corrupt":true}';
  generations.files.get(second.payload).data='{"corrupt":true}';

  await assert.rejects(
    ()=>new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open(),
    error=>{
      assert.equal(error.code,ErrorCodes.IMPORT_INVALID);
      assert.equal(error.details?.silentEmptyFallback,false);
      return true;
    }
  );
});


test('P3 writer epoch fences stale authorities independently from storage generation',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const directoryName='p3-writer-epoch';
  const first=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();
  const second=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();
  assert.equal(first.writerEpoch,0);
  assert.equal(second.writerEpoch,0);

  const fs=new MemoryVFS();
  fs.mount({'state.txt':'one'});
  const firstCommit=await first.checkpoint(fs);
  assert.equal(firstCommit.writerEpoch,1);
  assert.equal(first.writerEpoch,1);
  assert.equal(first.writerState.storageGeneration,firstCommit.generation);

  fs.beginTransaction().writeFile('state.txt','two').commit();
  const secondCommit=await second.checkpoint(fs);
  assert.equal(secondCommit.writerEpoch,2);
  assert.equal(second.writerEpoch,2);
  assert.equal(secondCommit.generation,firstCommit.generation+1);

  fs.beginTransaction().writeFile('state.txt','three').commit();
  await assert.rejects(
    ()=>first.checkpoint(fs),
    error=>{
      assert.equal(error.code,ErrorCodes.STALE_GENERATION);
      assert.equal(error.details?.expectedWriterEpoch,1);
      assert.equal(error.details?.currentWriterEpoch,2);
      return true;
    }
  );

  const reopened=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();
  assert.equal(reopened.current.writerEpoch,2);
  assert.equal(reopened.writerEpoch,0);
  const restored=new MemoryVFS();
  await reopened.restoreInto(restored);
  assert.equal(restored.readFile('state.txt'),'two');
});

test('P3 writer epoch can advance without storage generation after failed writer acquisition',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const directoryName='p3-writer-epoch-no-commit';
  const fs=new MemoryVFS();
  const first=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();
  fs.mount({'state.txt':'one'});
  const stable=await first.checkpoint(fs);
  assert.equal(stable.writerEpoch,1);

  fs.beginTransaction().writeFile('state.txt','two').commit();
  const rejectingPolicy={
    async inspect(){return {supported:true,usageBytes:999,quotaBytes:1000};},
    async assertCanWrite(){
      throw Object.assign(new Error('blocked'),{
        code:ErrorCodes.RESOURCE_EXHAUSTED,
        details:{pressure:'critical'}
      });
    }
  };
  const failedWriter=await new OpfsCheckpointAuthority({
    root,lockManager:locks,directoryName,storagePolicy:rejectingPolicy
  }).open();
  await assert.rejects(
    ()=>failedWriter.checkpoint(fs),
    error=>error.code===ErrorCodes.RESOURCE_EXHAUSTED
  );
  assert.equal(failedWriter.writerEpoch,2);
  assert.equal(failedWriter.current.generation,stable.generation);

  await assert.rejects(
    ()=>first.checkpoint(fs),
    error=>error.code===ErrorCodes.STALE_GENERATION&&error.details?.currentWriterEpoch===2
  );

  const successor=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();
  const committed=await successor.checkpoint(fs);
  assert.equal(committed.writerEpoch,3);
  assert.equal(committed.generation,stable.generation+1);
});


test('P3 quota fault matrix preserves the last committed generation at every injected byte boundary',async()=>{
  const phases=['after-0-bytes','after-1-byte','after-header','mid-payload','pre-commit','post-payload-pre-manifest'];
  for(const phase of phases){
    const root=new FakeDirectoryHandle();
    const locks=new FakeLockManager();
    const directoryName='p3-quota-'+phase;
    const fs=new MemoryVFS();
    const authority=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();
    fs.mount({'state.txt':'stable'});
    const stable=await authority.checkpoint(fs);
    fs.beginTransaction().writeFile('state.txt','blocked-'+phase+'-'+'x'.repeat(256)).commit();

    await assert.rejects(
      ()=>authority.checkpoint(fs,{quotaFaultAt:phase}),
      error=>{
        assert.equal(error.code,ErrorCodes.RESOURCE_EXHAUSTED);
        assert.equal(error.details?.phase,phase);
        assert.equal(error.details?.injectedQuota,true);
        return true;
      }
    );
    assert.equal(authority.current.sequence,stable.sequence);
    assert.equal(authority.current.generation,stable.generation);

    const reopened=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();
    assert.equal(reopened.current.sequence,stable.sequence);
    assert.equal(reopened.current.generation,stable.generation);
    const restored=new MemoryVFS();
    await reopened.restoreInto(restored);
    assert.equal(restored.readFile('state.txt'),'stable');

    const gc=await reopened.collectGarbage();
    if(phase==='post-payload-pre-manifest')assert.ok(gc.removed.length>=1);
  }
});


test('P3 safe restore blocks local work that appears after restore planning',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const fs=new MemoryVFS();
  const authority=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName:'p3-safe-restore-local'}).open();

  fs.mount({'project.txt':'old','unrelated.txt':'base'});
  const target=await authority.checkpoint(fs);
  fs.beginTransaction().writeFile('project.txt','current').writeFile('unrelated.txt','newer').commit();
  const current=await authority.checkpoint(fs);

  const plan=await authority.prepareCheckpointRestore(fs,target);
  assert.equal(plan.expectedCanonicalSequence,current.sequence);
  assert.equal(plan.expectedWorkingGeneration,fs.generation);

  fs.beginTransaction().writeFile('unrelated.txt','after-plan').commit();
  await assert.rejects(
    ()=>authority.restoreCheckpoint(fs,plan),
    error=>error.code===ErrorCodes.STALE_GENERATION
  );
  assert.equal(fs.readFile('project.txt'),'current');
  assert.equal(fs.readFile('unrelated.txt'),'after-plan');

  const reopened=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName:'p3-safe-restore-local'}).open();
  assert.equal(reopened.current.sequence,current.sequence);
});

test('P3 safe restore creates a recovery point before publishing the older checkpoint as a new generation',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const fs=new MemoryVFS();
  const authority=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName:'p3-safe-restore-success'}).open();

  fs.mount({'project.txt':'old','unrelated.txt':'base'});
  const target=await authority.checkpoint(fs);
  fs.beginTransaction().writeFile('project.txt','current').writeFile('unrelated.txt','newer').commit();
  const current=await authority.checkpoint(fs);
  fs.beginTransaction().writeFile('unrelated.txt','unpersisted-newer-work').writeFile('later.txt','keep-recoverable').commit();

  const plan=await authority.prepareCheckpointRestore(fs,target);
  const receipt=await authority.restoreCheckpoint(fs,plan);

  assert.equal(receipt.status,'restored');
  assert.equal(receipt.recoveryPointCreated,true);
  assert.equal(receipt.recoveryPointReused,false);
  assert.equal(receipt.recoveryPoint.sequence,current.sequence+1);
  assert.equal(receipt.published.sequence,receipt.recoveryPoint.sequence+1);
  assert.equal(receipt.published.generation,receipt.recoveryPoint.generation+1);
  assert.equal(receipt.riskDeclared,false);
  assert.equal(receipt.blindOverwritePrevented,true);

  assert.equal(fs.readFile('project.txt'),'old');
  assert.equal(fs.readFile('unrelated.txt'),'base');
  assert.equal(fs.exists('later.txt'),false);

  const safety=await authority.readCheckpoint(receipt.recoveryPoint);
  const safetyFs=new MemoryVFS();
  safetyFs.restore(safety);
  assert.equal(safetyFs.readFile('project.txt'),'current');
  assert.equal(safetyFs.readFile('unrelated.txt'),'unpersisted-newer-work');
  assert.equal(safetyFs.readFile('later.txt'),'keep-recoverable');

  const reopened=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName:'p3-safe-restore-success'}).open();
  assert.equal(reopened.current.sequence,receipt.published.sequence);
  const restored=new MemoryVFS();
  await reopened.restoreInto(restored);
  assert.equal(restored.readFile('project.txt'),'old');
  assert.equal(restored.readFile('unrelated.txt'),'base');

  const gc=await reopened.collectGarbage({dryRun:true});
  assert.ok(gc.retained.includes(receipt.recoveryPoint.payload));
  assert.ok(gc.retained.includes(receipt.published.payload));
});

test('P3 safe restore rejects a cross-context publication after planning',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const fs=new MemoryVFS();
  const directoryName='p3-safe-restore-cross-context';
  const authority=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();

  fs.mount({'project.txt':'old'});
  const target=await authority.checkpoint(fs);
  fs.beginTransaction().writeFile('project.txt','current').commit();
  const current=await authority.checkpoint(fs);
  const plan=await authority.prepareCheckpointRestore(fs,target);

  const remoteFs=new MemoryVFS();
  remoteFs.restore(fs.snapshot());
  remoteFs.beginTransaction().writeFile('remote.txt','published-after-plan').commit();
  const remote=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();
  const newer=await remote.checkpoint(remoteFs);
  assert.equal(newer.sequence,current.sequence+1);

  await assert.rejects(
    ()=>authority.restoreCheckpoint(fs,plan),
    error=>{
      assert.equal(error.code,ErrorCodes.STALE_GENERATION);
      assert.equal(error.details?.blindOverwritePrevented,true);
      assert.equal(error.details?.restoreAborted,true);
      return true;
    }
  );
  assert.equal(fs.readFile('project.txt'),'current');
  assert.equal(fs.exists('remote.txt'),false);

  const reopened=await new OpfsCheckpointAuthority({root,lockManager:locks,directoryName}).open();
  assert.equal(reopened.current.sequence,newer.sequence);
  const remoteRestored=new MemoryVFS();
  await reopened.restoreInto(remoteRestored);
  assert.equal(remoteRestored.readFile('remote.txt'),'published-after-plan');
});

test('P3 safe restore declares risk and aborts when quota prevents the pre-restore recovery point',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  let rejectWrites=false;
  const storagePolicy={
    async inspect(){return {supported:true,usageBytes:rejectWrites?999:100,quotaBytes:1000,pressure:rejectWrites?'critical':'normal'};},
    async assertCanWrite(additionalBytes){
      if(rejectWrites){
        throw Object.assign(new Error('quota blocked'),{
          code:ErrorCodes.RESOURCE_EXHAUSTED,
          details:{additionalBytes,pressure:'critical'}
        });
      }
      return {supported:true,additionalBytes};
    }
  };
  const fs=new MemoryVFS();
  const authority=await new OpfsCheckpointAuthority({
    root,lockManager:locks,directoryName:'p3-safe-restore-quota',storagePolicy
  }).open();

  fs.mount({'project.txt':'old'});
  const target=await authority.checkpoint(fs);
  fs.beginTransaction().writeFile('project.txt','current').commit();
  const current=await authority.checkpoint(fs);
  fs.beginTransaction().writeFile('unpersisted.txt','must-survive').commit();
  const plan=await authority.prepareCheckpointRestore(fs,target);

  rejectWrites=true;
  await assert.rejects(
    ()=>authority.restoreCheckpoint(fs,plan),
    error=>{
      assert.equal(error.code,ErrorCodes.RESOURCE_EXHAUSTED);
      assert.equal(error.details?.riskDeclared,true);
      assert.equal(error.details?.recoveryPointCreated,false);
      assert.equal(error.details?.blindOverwritePrevented,true);
      assert.equal(error.details?.restoreAborted,true);
      return true;
    }
  );
  assert.equal(fs.readFile('project.txt'),'current');
  assert.equal(fs.readFile('unpersisted.txt'),'must-survive');

  rejectWrites=false;
  const reopened=await new OpfsCheckpointAuthority({
    root,lockManager:locks,directoryName:'p3-safe-restore-quota',storagePolicy
  }).open();
  assert.equal(reopened.current.sequence,current.sequence);
});

test('P3 VFS mutation lease prevents concurrent transaction commit during restore window',()=>{
  const fs=new MemoryVFS();
  fs.mount({'value.txt':'one'});
  const lease=fs.acquireMutationLease({expectedGeneration:fs.generation,reason:'restore-test'});
  const tx=fs.beginTransaction().writeFile('value.txt','two');
  assert.throws(
    ()=>tx.commit(),
    error=>error.code===ErrorCodes.INVALID_STATE&&error.details?.lease===lease.id
  );
  assert.equal(fs.readFile('value.txt'),'one');
  assert.equal(lease.release(),true);
  fs.beginTransaction().writeFile('value.txt','three').commit();
  assert.equal(fs.readFile('value.txt'),'three');
});


test('P3 canonical checkpoint waits for durability-writer flush receipts before publication returns',async()=>{
  const root=new FakeDirectoryHandle();
  const calls=[];
  const durabilityWriter={
    async write(directory,name,content){
      const handle=await directory.getFileHandle(name,{create:true});
      const writable=await handle.createWritable();
      await writable.write(content);
      await writable.close();
      const bytes=new TextEncoder().encode(String(content)).byteLength;
      calls.push({name,bytes});
      return Object.freeze({
        schema:'opencontainer.opfs-sync-flush-write.v1.0',
        name,
        bytes,
        bytesWritten:bytes,
        bytesReadAfterFlush:bytes,
        sizeAfterFlush:bytes,
        writeCalled:true,
        truncateCalled:true,
        flushCalled:true,
        closeCalled:true,
        readAfterFlushVerified:true,
        dedicatedWorker:true,
        syncAccessHandle:true,
        apiBoundary:'flush-attempts-cached-modifications-to-underlying-storage-device',
        powerLossGuaranteed:false,
        osFsyncGuaranteed:false
      });
    }
  };

  const fs=new MemoryVFS();
  fs.mount({'durable.txt':'v1'});
  const authority=await new OpfsCheckpointAuthority({root,durabilityWriter}).open();
  const receipt=await authority.checkpoint(fs);

  assert.equal(receipt.sequence,1);
  assert.equal(calls.length,3);
  assert.match(calls[0].name,/^writer-epoch-1\.json$/);
  assert.match(calls[1].name,/^generation-1-[a-f0-9]{16}\.json$/);
  assert.equal(calls[2].name,'manifest-a.json');

  const durability=authority.durabilityState;
  assert.equal(durability.mode,'sync-access-handle-flush');
  assert.equal(durability.flushBeforePublication,true);
  assert.equal(durability.dedicatedWorker,true);
  assert.equal(durability.closeAloneSufficient,false);
  assert.equal(durability.powerLossGuaranteed,false);
  assert.equal(durability.osFsyncGuaranteed,false);
  assert.equal(durability.lastWrite?.phase,'manifest');
  assert.equal(durability.lastWrite?.flushCalled,true);
  assert.equal(durability.lastWrite?.closeCalled,true);
  assert.equal(durability.lastWrite?.readAfterFlushVerified,true);

  const reopened=await new OpfsCheckpointAuthority({root,durabilityWriter}).open();
  const restored=new MemoryVFS();
  await reopened.restoreInto(restored);
  assert.equal(restored.readFile('durable.txt'),'v1');
});

test('P3 non-browser checkpoint fallback does not pretend to have an explicit flush boundary',async()=>{
  const root=new FakeDirectoryHandle();
  const fs=new MemoryVFS();
  fs.mount({'fallback.txt':'value'});
  const authority=await new OpfsCheckpointAuthority({root,durabilityWriter:null}).open();
  await authority.checkpoint(fs);
  const durability=authority.durabilityState;
  assert.equal(durability.mode,'async-writable-stream-close');
  assert.equal(durability.flushBeforePublication,false);
  assert.equal(durability.lastWrite?.flushCalled,false);
  assert.equal(durability.powerLossGuaranteed,false);
  assert.equal(durability.osFsyncGuaranteed,false);
});
