import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { OpenContainer } from '../packages/sdk/src/index.js';

const EXACT_ORACLE = process.version === 'v24.21.0';

function write(root, relativePath, content) {
  const file = join(root, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function logicalPath(root, physicalPath) {
  return '/workspace/' + relative(root, physicalPath).split(sep).join('/');
}

function logicalUrl(root, nodeUrl) {
  const url = new URL(nodeUrl);
  const suffix = url.search + url.hash;
  return 'file://' + logicalPath(root, fileURLToPath(url)).split('/').map((part, index) => index === 0 ? '' : encodeURIComponent(part)).join('/') + suffix;
}

async function createOpenContainer() {
  const runtime = await OpenContainer.boot();
  runtime.mount({
    'package.json': JSON.stringify({
      name: 'app',
      type: 'module',
      imports: { '#internal': './src/internal.js' },
      exports: { './self': './src/self.js' }
    }),
    'src/app.mjs': '',
    'src/app.cjs': '',
    'src/internal.js': 'export default 1',
    'src/self.js': 'export default 2',
    'src/local.js': 'module.exports=1',
    'packages/ws/package.json': JSON.stringify({ name: 'ws', main: 'index.js', type: 'commonjs' }),
    'packages/ws/index.js': 'module.exports="ws"'
  });
  runtime.packages.mountCatalog({
    packages: [
      {
        location: 'node_modules/dual',
        packageJson: {
          name: 'dual',
          type: 'module',
          exports: {
            '.': { import: './esm.js', require: './cjs.cjs', default: './fallback.js' },
            './feature/*': { node: './node/*.js', default: './browser/*.js' }
          }
        },
        files: {
          'esm.js': 'export default 1',
          'cjs.cjs': 'module.exports=1',
          'fallback.js': '',
          'node/x.js': '',
          'browser/x.js': ''
        }
      },
      { location: 'node_modules/b', packageJson: { name: 'b', main: 'index.js', type: 'commonjs' }, files: { 'index.js': 'module.exports="root-b"' } },
      { location: 'node_modules/a', packageJson: { name: 'a', main: 'index.js', type: 'commonjs' }, files: { 'index.js': 'module.exports=require("b")' } },
      { location: 'node_modules/a/node_modules/b', packageJson: { name: 'b', main: 'index.js', type: 'commonjs' }, files: { 'index.js': 'module.exports="nested-b"' } }
    ],
    symlinks: [{ path: '/workspace/node_modules/ws', target: '/workspace/packages/ws' }]
  });
  return runtime;
}

function createNodeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'opencontainer-node24-'));

  write(root, 'package.json', JSON.stringify({
    name: 'app',
    type: 'module',
    imports: { '#internal': './src/internal.js' },
    exports: { './self': './src/self.js' }
  }));
  write(root, 'src/app.mjs', '');
  write(root, 'src/app.cjs', '');
  write(root, 'src/internal.js', 'export default 1');
  write(root, 'src/self.js', 'export default 2');
  write(root, 'src/local.js', 'module.exports=1');

  write(root, 'node_modules/dual/package.json', JSON.stringify({
    name: 'dual',
    type: 'module',
    exports: {
      '.': { import: './esm.js', require: './cjs.cjs', default: './fallback.js' },
      './feature/*': { node: './node/*.js', default: './browser/*.js' }
    }
  }));
  write(root, 'node_modules/dual/esm.js', 'export default 1');
  write(root, 'node_modules/dual/cjs.cjs', 'module.exports=1');
  write(root, 'node_modules/dual/fallback.js', '');
  write(root, 'node_modules/dual/node/x.js', '');
  write(root, 'node_modules/dual/browser/x.js', '');

  write(root, 'node_modules/b/package.json', JSON.stringify({ name: 'b', main: 'index.js', type: 'commonjs' }));
  write(root, 'node_modules/b/index.js', 'module.exports="root-b"');
  write(root, 'node_modules/a/package.json', JSON.stringify({ name: 'a', main: 'index.js', type: 'commonjs' }));
  write(root, 'node_modules/a/index.js', 'module.exports=require("b")');
  write(root, 'node_modules/a/node_modules/b/package.json', JSON.stringify({ name: 'b', main: 'index.js', type: 'commonjs' }));
  write(root, 'node_modules/a/node_modules/b/index.js', 'module.exports="nested-b"');

  write(root, 'packages/ws/package.json', JSON.stringify({ name: 'ws', main: 'index.js', type: 'commonjs' }));
  write(root, 'packages/ws/index.js', 'module.exports="ws"');
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync('../packages/ws', join(root, 'node_modules/ws'));

  write(root, 'src/oracle.mjs', `
    const specs = ['dual', 'dual/feature/x', '#internal', 'app/self', './internal.js?x=1'];
    const out = {};
    for (const spec of specs) out[spec] = import.meta.resolve(spec);
    console.log(JSON.stringify(out));
  `);

  return root;
}

test('OpenContainer resolver matches selected exact Node 24.21.0 oracle cases', { skip: !EXACT_ORACLE }, async () => {
  const root = createNodeFixture();
  const runtime = await createOpenContainer();

  try {
    const { createRequire } = await import('node:module');
    const requireFromApp = createRequire(pathToFileURL(join(root, 'src/app.cjs')));
    const requireFromA = createRequire(pathToFileURL(join(root, 'node_modules/a/index.js')));

    const cjsCases = [
      ['relative extension', requireFromApp.resolve('./local'), runtime.packages.resolve('./local', '/workspace/src/app.cjs', { mode: 'cjs' }).path],
      ['conditional require', requireFromApp.resolve('dual'), runtime.packages.resolve('dual', '/workspace/src/app.cjs', { mode: 'cjs' }).path],
      ['root dependency', requireFromApp.resolve('b'), runtime.packages.resolve('b', '/workspace/src/app.cjs', { mode: 'cjs' }).path],
      ['nested dependency', requireFromA.resolve('b'), runtime.packages.resolve('b', '/workspace/node_modules/a/index.js', { mode: 'cjs' }).path],
      ['symlink default realpath', requireFromApp.resolve('ws'), runtime.packages.resolve('ws', '/workspace/src/app.cjs', { mode: 'cjs' }).path]
    ];

    for (const [name, nodeResolved, openResolved] of cjsCases) {
      assert.equal(openResolved, logicalPath(root, nodeResolved), name);
    }

    const stdout = execFileSync(process.execPath, [join(root, 'src/oracle.mjs')], { encoding: 'utf8' }).trim();
    const esmOracle = JSON.parse(stdout);
    const esmCases = [
      ['dual', runtime.packages.resolve('dual', '/workspace/src/app.mjs', { mode: 'esm' }).url],
      ['dual/feature/x', runtime.packages.resolve('dual/feature/x', '/workspace/src/app.mjs', { mode: 'esm' }).url],
      ['#internal', runtime.packages.resolve('#internal', '/workspace/src/app.mjs', { mode: 'esm' }).url],
      ['app/self', runtime.packages.resolve('app/self', '/workspace/src/app.mjs', { mode: 'esm' }).url],
      ['./internal.js?x=1', runtime.packages.resolve('./internal.js?x=1', '/workspace/src/app.mjs', { mode: 'esm' }).url]
    ];

    for (const [specifier, openUrl] of esmCases) {
      assert.equal(openUrl, logicalUrl(root, esmOracle[specifier]), specifier);
    }
  } finally {
    await runtime.terminate();
    rmSync(root, { recursive: true, force: true });
  }
});
