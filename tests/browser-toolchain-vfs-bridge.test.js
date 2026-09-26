import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryVFS } from '../packages/vfs/src/index.js';
import { createCoreBuiltinRegistry } from '../packages/package-env/src/index.js';
import { createBrowserToolchainVfsBridge } from '../packages/toolchain/src/index.js';

function nodeFsFor(vfs) {
  return createCoreBuiltinRegistry({
    fs: vfs,
    writableFs: vfs,
    cwd: '/workspace'
  }).fs;
}

test('browser toolchain VFS bridge mirrors package trees into Rolldown memfs aliases', () => {
  const source = new MemoryVFS();
  source.mount({
    'node_modules/demo/package.json': '{"name":"demo","type":"module"}',
    'node_modules/demo/index.js': "export { value } from './nested/value.js';",
    'node_modules/demo/nested/value.js': 'export const value=42;'
  });
  const sourceFs = nodeFsFor(source);
  const writes = new Map();
  const memfs = {
    fs: {
      mkdirSync() {},
      writeFileSync(path, data) {
        const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(String(data));
        writes.set(String(path), bytes);
      }
    }
  };
  const pathApi = createCoreBuiltinRegistry({ cwd: '/workspace' }).path;
  const bridge = createBrowserToolchainVfsBridge({ memfs, sourceFs, pathApi });

  const receipt = bridge.mirrorTree('/workspace/node_modules/demo');
  assert.equal(receipt.length, 3);
  assert.equal(new TextDecoder().decode(writes.get('/workspace/node_modules/demo/index.js')), "export { value } from './nested/value.js';");
  assert.equal(new TextDecoder().decode(writes.get('/node_modules/demo/index.js')), "export { value } from './nested/value.js';");
  assert.equal(new TextDecoder().decode(writes.get('/node_modules/demo/nested/value.js')), 'export const value=42;');
});

test('browser toolchain VFS bridge publishes Rolldown writeBundle output into writable VFS', () => {
  const workspace = new MemoryVFS();
  const fs = nodeFsFor(workspace);
  const pathApi = createCoreBuiltinRegistry({ cwd: '/workspace' }).path;
  const memfs = { fs: { mkdirSync() {}, writeFileSync() {} } };
  const bridge = createBrowserToolchainVfsBridge({ memfs, sourceFs: fs, writableFs: fs, pathApi });

  bridge.plugin.writeBundle(
    { dir: '/workspace/node_modules/.vite/deps' },
    {
      'demo.js': {
        type: 'chunk',
        fileName: 'demo.js',
        code: 'export const optimized=1;',
        map: { toString: () => '{"version":3,"sources":[]}' }
      },
      'asset.txt': {
        type: 'asset',
        fileName: 'asset.txt',
        source: 'artifact'
      }
    }
  );

  assert.equal(fs.readFileSync('/workspace/node_modules/.vite/deps/demo.js', 'utf8'), 'export const optimized=1;');
  assert.equal(fs.readFileSync('/workspace/node_modules/.vite/deps/demo.js.map', 'utf8'), '{"version":3,"sources":[]}');
  assert.equal(fs.readFileSync('/workspace/node_modules/.vite/deps/asset.txt', 'utf8'), 'artifact');
});
