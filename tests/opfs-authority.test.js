import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryVFS, OpfsCheckpointAuthority } from '../packages/vfs/src/index.js';
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
