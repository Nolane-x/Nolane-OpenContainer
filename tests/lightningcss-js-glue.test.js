import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRetainedLightningCssPackage } from '../packages/toolchain/src/index.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function materializePackage(verified, root) {
  const prefix = 'package/';
  const paths = [
    'package/package.json',
    'package/index.mjs',
    'package/wasm-node.mjs',
    'package/async.mjs',
    'package/browserslistToTargets.js',
    'package/composeVisitors.js',
    'package/flags.js',
    'package/import.meta.url-polyfill.js',
    'package/index.cjs',
    'package/wasm-node.cjs',
    'package/lightningcss_node.wasm'
  ];

  for (const path of paths) {
    const data = verified.getFile(path);
    if (!data) continue;
    const target = join(root, path.slice(prefix.length));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  // napi-wasm is intentionally bundled in the npm artifact and must come from
  // those exact retained bytes rather than from the repository's dependency set.
  const queue = [];
  for (const path of [
    'package/node_modules/napi-wasm/package.json',
    'package/node_modules/napi-wasm/index.js',
    'package/node_modules/napi-wasm/index.mjs',
    'package/node_modules/napi-wasm/dist/index.js',
    'package/node_modules/napi-wasm/dist/index.mjs',
    'package/node_modules/napi-wasm/lib/index.js'
  ]) {
    const data = verified.getFile(path);
    if (!data) continue;
    const target = join(root, path.slice(prefix.length));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    queue.push(path);
  }

  // Materialize every bundled napi-wasm file, independent of package layout.
  for (let index = 0; index < verified.fileCount; index++) {
    // fileCount is evidence metadata only; getFile intentionally does not expose iteration.
    // Exact bundled dependency presence is checked by dynamic import below.
  }
}

test('exact Lightning CSS JS glue executes and browser/default path matches node path', async () => {
  const tarball = new Uint8Array(await readFile(new URL('../toolchain/vendor/lightningcss-wasm-1.33.0.tgz', import.meta.url)));
  const verified = await verifyRetainedLightningCssPackage(tarball);

  const root = mkdtempSync(join(tmpdir(), 'opencontainer-lightningcss-'));
  try {
    // Materialize the entire verified package so its bundled napi-wasm dependency is exact.
    // Re-open the retained archive using the verifier's immutable file access.
    const required = [
      'package/package.json','package/index.mjs','package/wasm-node.mjs','package/async.mjs',
      'package/browserslistToTargets.js','package/composeVisitors.js','package/flags.js',
      'package/import.meta.url-polyfill.js','package/index.cjs','package/wasm-node.cjs',
      'package/lightningcss_node.wasm'
    ];
    for (const path of required) {
      const data = verified.getFile(path);
      if (!data) continue;
      const target = join(root, path.slice('package/'.length));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    }

    // The package bundles napi-wasm. The exact set of files is copied from the verified tarball
    // by parsing the archive a second time only inside this oracle test.
    const { inspectTarArchive } = await import('../packages/package-env/src/index.js');
    const archive = await inspectTarArchive(tarball, { requiredPrefix: 'package/', maxFiles: 2000, maxUnpackedBytes: 64 * 1024 * 1024 });
    for (const entry of archive.entries) {
      if (entry.type !== 'file' || !entry.path.startsWith('package/node_modules/napi-wasm/')) continue;
      const target = join(root, entry.path.slice('package/'.length));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.data);
    }

    const nodeGlue = await import(pathToFileURL(join(root, 'wasm-node.mjs')).href + '?node=1');
    const browserGlue = await import(pathToFileURL(join(root, 'index.mjs')).href + '?browser=1');
    const wasmBytes = verified.getFile('package/lightningcss_node.wasm');
    await browserGlue.default(Promise.resolve(wasmBytes));

    const fixtures = [
      '.foo { color: #ff0000; margin: 0px 0px 0px 0px; }',
      '@media (width >= 600px) { .grid { display: grid; gap: 0px; } }',
      '.a, .b { user-select: none; appearance: none; }'
    ];

    for (const css of fixtures) {
      const options = {
        filename: 'input.css',
        code: encoder.encode(css),
        minify: true,
        sourceMap: true
      };
      const nodeResult = nodeGlue.transform(options);
      const browserResult = browserGlue.transform(options);

      assert.equal(decoder.decode(browserResult.code), decoder.decode(nodeResult.code), css);
      assert.equal(decoder.decode(browserResult.map), decoder.decode(nodeResult.map), css);
      assert.deepEqual(browserResult.warnings, nodeResult.warnings, css);
    }

    const styleOptions = {
      filename: 'style.css',
      code: encoder.encode('color: #ff0000; margin: 0px 0px 0px 0px'),
      minify: true
    };
    assert.equal(
      decoder.decode(browserGlue.transformStyleAttribute(styleOptions).code),
      decoder.decode(nodeGlue.transformStyleAttribute(styleOptions).code)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
