import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync as hostRmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL as nodePathToFileURL, fileURLToPath as nodeFileURLToPath } from 'node:url';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { createCoreBuiltinRegistry, BufferCompat } from '../packages/package-env/src/index.js';

async function runtimeFixture() {
  const runtime = await OpenContainer.boot();
  runtime.mount({
    'package.json': '{"type":"commonjs"}',
    'src/a.txt': 'hello',
    'src/sub/b.txt': 'world'
  });
  runtime.packages.mountCatalog();
  return runtime;
}

test('Buffer subset covers utf8 hex base64 concat and identity', () => {
  const utf = BufferCompat.from('hello');
  assert.equal(utf.toString(), 'hello');
  assert.equal(BufferCompat.from('6869', 'hex').toString(), 'hi');
  assert.equal(BufferCompat.from('aGk=', 'base64').toString(), 'hi');
  assert.equal(BufferCompat.from([251,255,239]).toString('base64url'), '-__v');
  assert.equal(BufferCompat.from('-__v','base64url').toString('hex'), 'fbffef');
  assert.equal(BufferCompat.concat([BufferCompat.from('a'), BufferCompat.from('b')]).toString(), 'ab');
  assert.equal(BufferCompat.isBuffer(utf), true);
});

test('Buffer ArrayBuffer overload preserves byteOffset length and backing-store identity', () => {
  const backing = new ArrayBuffer(16);
  const bytes = new Uint8Array(backing);
  bytes.set([10, 20, 30, 40, 50, 60], 4);

  const view = BufferCompat.from(backing, 5, 3);
  assert.equal(view.byteOffset, 5);
  assert.equal(view.byteLength, 3);
  assert.equal(view.buffer, backing);
  assert.deepEqual([...view], [20, 30, 40]);

  view[1] = 99;
  assert.equal(bytes[6], 99);

  const tail = BufferCompat.from(backing, 14);
  assert.equal(tail.byteOffset, 14);
  assert.equal(tail.byteLength, 2);
  assert.throws(() => BufferCompat.from(backing, 17, 0), RangeError);
  assert.throws(() => BufferCompat.from(backing, 15, 2), RangeError);
});

test('URL file conversion selected court matches Node POSIX semantics', async () => {
  const runtime = await runtimeFixture();
  const builtins = createCoreBuiltinRegistry({ fs: runtime.packages.nodeModules, writableFs: runtime.fs, cwd: '/workspace' });
  const cases = ['/workspace/a b.txt', '/workspace/hash#name.js', '/workspace/q?name.js'];
  for (const value of cases) {
    assert.equal(builtins.url.pathToFileURL(value).href, nodePathToFileURL(value).href);
    assert.equal(builtins.url.fileURLToPath(nodePathToFileURL(value)), nodeFileURLToPath(nodePathToFileURL(value)));
  }
});

test('fs sync read/stat/readdir selected behavior matches a physical Node fixture', async () => {
  const runtime = await runtimeFixture();
  const builtins = createCoreBuiltinRegistry({ fs: runtime.packages.nodeModules, writableFs: runtime.fs, cwd: '/workspace' });
  const host = mkdtempSync(join(tmpdir(), 'oc-fs-'));
  try {
    mkdirSync(join(host, 'src/sub'), { recursive: true });
    writeFileSync(join(host, 'src/a.txt'), 'hello');
    writeFileSync(join(host, 'src/sub/b.txt'), 'world');

    assert.equal(builtins.fs.readFileSync('src/a.txt', 'utf8'), readFileSync(join(host, 'src/a.txt'), 'utf8'));
    assert.deepEqual(builtins.fs.readdirSync('src'), readdirSync(join(host, 'src')).sort());
    assert.equal(builtins.fs.statSync('src').isDirectory(), statSync(join(host, 'src')).isDirectory());
    assert.equal(builtins.fs.statSync('src/a.txt').isFile(), statSync(join(host, 'src/a.txt')).isFile());
    assert.equal(builtins.fs.existsSync('src/missing.txt'), false);
  } finally {
    hostRmSync(host, { recursive: true, force: true });
  }
});

test('fs writes are restricted to mutable WorkspaceFS but immediately visible through VNFS', async () => {
  const runtime = await runtimeFixture();
  const builtins = createCoreBuiltinRegistry({ fs: runtime.packages.nodeModules, writableFs: runtime.fs, cwd: '/workspace' });
  builtins.fs.writeFileSync('src/generated.txt', 'generated');
  assert.equal(runtime.fs.readFile('/workspace/src/generated.txt'), 'generated');
  assert.equal(builtins.fs.readFileSync('src/generated.txt', 'utf8'), 'generated');

  builtins.fs.renameSync('src/generated.txt', 'src/renamed.txt');
  assert.equal(builtins.fs.existsSync('src/generated.txt'), false);
  assert.equal(builtins.fs.readFileSync('src/renamed.txt', 'utf8'), 'generated');

  builtins.fs.rmSync('src/renamed.txt');
  assert.equal(builtins.fs.existsSync('src/renamed.txt'), false);
});

test('fs promises facade follows the same authority', async () => {
  const runtime = await runtimeFixture();
  const builtins = createCoreBuiltinRegistry({ fs: runtime.packages.nodeModules, writableFs: runtime.fs, cwd: '/workspace' });
  await builtins['fs/promises'].writeFile('src/async.txt', 'async');
  assert.equal(await builtins['fs/promises'].readFile('src/async.txt', 'utf8'), 'async');
  assert.equal((await builtins['fs/promises'].stat('src/async.txt')).isFile(), true);
});

test('process context never inherits host environment implicitly', async () => {
  const runtime = await runtimeFixture();
  const builtins = createCoreBuiltinRegistry({
    fs: runtime.packages.nodeModules,
    writableFs: runtime.fs,
    cwd: '/workspace/src',
    env: { MODE: 'test' },
    argv: ['opencontainer', 'script.js']
  });
  assert.equal(builtins.process.cwd(), '/workspace/src');
  assert.equal(builtins.process.env.MODE, 'test');
  assert.equal(Object.prototype.hasOwnProperty.call(builtins.process.env, 'HOME'), false);
  assert.equal(builtins.process.platform, 'linux');
  builtins.process.chdir('sub');
  assert.equal(builtins.process.cwd(), '/workspace/src/sub');
  assert.deepEqual(builtins.process.argv, ['opencontainer', 'script.js']);
});

test('CommonJS receives Buffer/process globals plus fs/url builtins', async () => {
  const runtime = await runtimeFixture();
  runtime.fs.beginTransaction().writeFile('main.cjs', `
    const fs=require('fs');
    const {pathToFileURL}=require('url');
    const data=fs.readFileSync('./src/a.txt','utf8');
    module.exports={
      data,
      buffer:Buffer.from('ok').toString('hex'),
      cwd:process.cwd(),
      url:pathToFileURL('./src/a.txt').href
    };
  `).commit();

  const loader = runtime.packages.createCommonJsLoader({ allowDynamicCode: true, cwd: '/workspace' });
  assert.deepEqual(loader.require('./main.cjs', '/workspace/entry.cjs'), {
    data: 'hello',
    buffer: '6f6b',
    cwd: '/workspace',
    url: 'file:///workspace/src/a.txt'
  });
});
