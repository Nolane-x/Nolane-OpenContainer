import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { OpfsPackageContentStore } from '../packages/package-env/src/index.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class FakeNotFoundError extends Error {
  constructor() {
    super('Not found');
    this.name = 'NotFoundError';
  }
}

class FakeFileHandle {
  kind = 'file';
  data = null;
  writeCount = 0;

  async getFile() {
    if (this.data === null) throw new FakeNotFoundError();
    const data = this.data instanceof Uint8Array
      ? new Uint8Array(this.data)
      : encoder.encode(String(this.data));
    return {
      text: async () => decoder.decode(data),
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    };
  }

  async createWritable() {
    let next = null;
    return {
      write: async (value) => {
        next = value instanceof Uint8Array
          ? new Uint8Array(value)
          : String(value);
      },
      close: async () => {
        this.data = next;
        this.writeCount++;
      },
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

function writeOctal(buffer, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, '0') + '\0';
  buffer.set(encoder.encode(text), offset);
}

function tarEntry(path, content = '', type = '0') {
  const data = content instanceof Uint8Array ? content : encoder.encode(content);
  const header = new Uint8Array(512);
  header.set(encoder.encode(path), 0);
  writeOctal(header, 100, 8, type === '5' ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, type === '5' ? 0 : data.byteLength);
  writeOctal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header[156] = type.charCodeAt(0);
  header.set(encoder.encode('ustar\0'), 257);
  header.set(encoder.encode('00'), 263);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.set(encoder.encode(checksum.toString(8).padStart(6, '0') + '\0 '), 148);
  const padded = Math.ceil(data.byteLength / 512) * 512;
  const out = new Uint8Array(512 + padded);
  out.set(header);
  out.set(data, 512);
  return out;
}

function tar(entries) {
  const chunks = entries.map((entry) => tarEntry(entry.path, entry.content, entry.type ?? '0'));
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) + 1024);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function packageTar(name = 'a', version = '1.0.0') {
  return tar([
    { path: 'package/', type: '5' },
    { path: 'package/package.json', content: JSON.stringify({ name, version, main: 'index.cjs', type: 'commonjs' }) },
    { path: 'package/index.cjs', content: 'module.exports={name:"' + name + '",persisted:true}' }
  ]);
}

function sri(bytes) {
  return 'sha512-' + createHash('sha512').update(bytes).digest('base64');
}

test('OPFS package content reopens verified content and skips network fetch', async () => {
  const root = new FakeDirectoryHandle();
  const locks = new FakeLockManager();
  const bytes = packageTar('a', '1.0.0');
  const integrity = sri(bytes);
  const runtime = await OpenContainer.boot();
  runtime.packages.compile({
    name: 'app',
    version: '1',
    lockfileVersion: 3,
    packages: {
      '': { name: 'app', version: '1' },
      'node_modules/a': {
        name: 'a',
        version: '1.0.0',
        resolved: 'https://registry.example/a.tgz',
        integrity
      }
    }
  });

  const firstStore = await new OpfsPackageContentStore({ root, lockManager: locks }).open();
  const firstInstaller = runtime.packages.createFrozenInstaller({ contentStore: firstStore });
  const firstReceipt = await firstInstaller.ingestLocation('node_modules/a', bytes);
  assert.equal(firstReceipt.persisted, true);
  assert.equal(firstReceipt.persistentReused, false);
  assert.equal(firstStore.size, 1);

  const reopenedStore = await new OpfsPackageContentStore({ root, lockManager: locks }).open();
  assert.equal(reopenedStore.hydratedCount, 1);
  assert.equal(reopenedStore.corruptCount, 0);
  assert.equal(reopenedStore.size, 1);

  let networkCalls = 0;
  const reopenedInstaller = runtime.packages.createFrozenInstaller({ contentStore: reopenedStore });
  const installReceipt = await reopenedInstaller.installAll({
    artifactAuthority: {
      async fetchArtifact() {
        networkCalls++;
        throw new Error('persistent cache unexpectedly fetched the network');
      }
    }
  });

  assert.equal(networkCalls, 0);
  assert.equal(installReceipt.requestedContents, 0);
  assert.equal(installReceipt.fetchedContents, 0);
  const mounted = reopenedInstaller.mountFrozenGraph();
  assert.equal(mounted.packageCount, 1);

  const loader = runtime.packages.createCommonJsLoader({ allowDynamicCode: true });
  assert.deepEqual(loader.require('a', '/workspace/src/app.cjs'), { name: 'a', persisted: true });
});

test('OPFS package content uses one cross-context publication for concurrent identical ingest', async () => {
  const root = new FakeDirectoryHandle();
  const locks = new FakeLockManager();
  const bytes = packageTar('shared', '1.0.0');
  const integrity = sri(bytes);
  const contentId = 'content:shared';

  const first = await new OpfsPackageContentStore({ root, lockManager: locks }).open();
  const second = await new OpfsPackageContentStore({ root, lockManager: locks }).open();

  const [a, b] = await Promise.all([
    first.ingest({ contentId, integrity, bytes, expectedName: 'shared', expectedVersion: '1.0.0' }),
    second.ingest({ contentId, integrity, bytes, expectedName: 'shared', expectedVersion: '1.0.0' })
  ]);

  assert.equal([a.persistentReused, b.persistentReused].filter(Boolean).length, 1);
  assert.equal(first.crossContextLocking, true);
  assert.equal(second.crossContextLocking, true);

  const cache = root.dirs.get('opencontainer-package-content');
  const directory = cache.dirs.get(encodeURIComponent(contentId));
  assert.equal(directory.files.get('artifact.tgz').writeCount, 1);
  assert.equal(directory.files.get('manifest.json').writeCount, 1);
  assert.ok(locks.requests.every((request) => request.mode === 'exclusive'));
});

test('OPFS package content ignores corrupt persisted bytes and repairs them on valid ingest', async () => {
  const root = new FakeDirectoryHandle();
  const locks = new FakeLockManager();
  const bytes = packageTar('repair', '1.0.0');
  const integrity = sri(bytes);
  const contentId = 'content:repair';

  const first = await new OpfsPackageContentStore({ root, lockManager: locks }).open();
  await first.ingest({ contentId, integrity, bytes, expectedName: 'repair', expectedVersion: '1.0.0' });

  const cache = root.dirs.get('opencontainer-package-content');
  const directory = cache.dirs.get(encodeURIComponent(contentId));
  directory.files.get('artifact.tgz').data = new Uint8Array([1, 2, 3, 4]);

  const corrupted = await new OpfsPackageContentStore({ root, lockManager: locks }).open();
  assert.equal(corrupted.size, 0);
  assert.equal(corrupted.hydratedCount, 0);
  assert.equal(corrupted.corruptCount, 1);

  const repaired = await corrupted.ingest({
    contentId,
    integrity,
    bytes,
    expectedName: 'repair',
    expectedVersion: '1.0.0'
  });
  assert.equal(repaired.persistentReused, false);

  const reopened = await new OpfsPackageContentStore({ root, lockManager: locks }).open();
  assert.equal(reopened.corruptCount, 0);
  assert.equal(reopened.hydratedCount, 1);
  assert.equal(reopened.get(contentId).packageJson.name, 'repair');
});
