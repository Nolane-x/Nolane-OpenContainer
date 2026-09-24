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
