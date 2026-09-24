import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  existsSync
} from 'node:fs';
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  rm
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { inspectTarArchive } from '../packages/package-env/src/index.js';
import { verifyRetainedRolldownBrowserPackage } from '../packages/toolchain/src/index.js';

const require = createRequire(import.meta.url);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function hashFile(path) {
  return sha256(await readFile(path));
}

async function listFiles(root, current = root, out = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) await listFiles(root, path, out);
    else if (entry.isFile()) out.push(relative(root, path).replaceAll('\\', '/'));
  }
  return out.sort();
}

async function snapshotDirectory(root) {
  const files = await listFiles(root);
  const rows = [];
  for (const file of files) rows.push([file, await hashFile(join(root, file))]);
  return rows;
}

async function readOutputs(root) {
  const dist = join(root, 'dist');
  const files = await listFiles(dist);
  const jsFiles = files.filter((file) => file.endsWith('.js'));
  const cssFiles = files.filter((file) => file.endsWith('.css'));
  const mapFiles = files.filter((file) => file.endsWith('.map'));
  const js = (await Promise.all(jsFiles.map((file) => readFile(join(dist, file), 'utf8')))).join('\n');
  const css = (await Promise.all(cssFiles.map((file) => readFile(join(dist, file), 'utf8')))).join('\n');
  const manifestPath = join(dist, '.vite', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  return { dist, files, jsFiles, cssFiles, mapFiles, js, css, manifest };
}

function configSource({ configMarker, pluginMarker }) {
  return `import { defineConfig } from 'vite'

export default defineConfig({
  define: {
    __CONFIG_MARKER__: JSON.stringify(${JSON.stringify(configMarker)})
  },
  plugins: [{
    name: 'opencontainer-c1-plugin',
    transform(code, id) {
      if (!id.replaceAll('\\\\', '/').endsWith('/src/main.ts')) return null
      return code.replace('__PLUGIN_SENTINEL__', ${JSON.stringify(JSON.stringify(pluginMarker))})
    }
  }],
  build: {
    sourcemap: true,
    manifest: true,
    assetsInlineLimit: 0
  }
})
`;
}

function mainSource(value) {
  return `import './style.css'
import logo from './logo.svg?url'

const typed: number = ${value}
const plugin = __PLUGIN_SENTINEL__
const config = __CONFIG_MARKER__
document.querySelector<HTMLDivElement>('#app')!.textContent =
  config + '|' + plugin + '|' + typed + '|' + logo
export { typed, plugin, config }
`;
}

async function materializeRetainedRolldownBinding(root) {
  const tarball = new Uint8Array(
    await readFile(new URL('../toolchain/vendor/rolldown-browser-1.2.9.tgz', import.meta.url))
  );
  await verifyRetainedRolldownBrowserPackage(tarball);
  const archive = await inspectTarArchive(tarball, {
    requiredPrefix: 'package/',
    maxFiles: 5000,
    maxUnpackedBytes: 96 * 1024 * 1024
  });
  const bindingRoot = join(root, '.rolldown-wasi-binding');
  await mkdir(bindingRoot, { recursive: true });
  for (const entry of archive.entries) {
    if (entry.type !== 'file' || !entry.path.startsWith('package/dist/')) continue;
    const relativePath = entry.path.slice('package/dist/'.length);
    const target = join(bindingRoot, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.data);
  }
  const loaderPath = join(bindingRoot, 'rolldown-binding.wasi.cjs');
  const wasmPath = join(bindingRoot, 'rolldown-binding.wasm32-wasi.wasm');
  assert.equal(
    await hashFile(loaderPath),
    '5f4ad0a90dd97b1e5d96517c31068575a6e7b6163a54172a8d39b9753d2b2457'
  );
  assert.equal(
    await hashFile(wasmPath),
    '629aa10c37a9920cd5729a35af148983c881f4ff9edd6368a7d63b5acbf89dc2'
  );
  return { bindingRoot, loaderPath, wasmPath };
}

test('VITE-C1 exact native oracle closes production-build composition', { timeout: 120000 }, async () => {
  const previous = {
    nativeLibraryPath: process.env.NAPI_RS_NATIVE_LIBRARY_PATH,
    forceWasi: process.env.NAPI_RS_FORCE_WASI,
    wasiFlavor: process.env.NAPI_RS_WASI_FLAVOR,
    versionCheck: process.env.NAPI_RS_ENFORCE_VERSION_CHECK
  };

  const root = mkdtempSync(join(process.cwd(), '.tmp-vite-c1-'));
  try {
    const retainedBinding = await materializeRetainedRolldownBinding(root);
    process.env.NAPI_RS_NATIVE_LIBRARY_PATH = retainedBinding.loaderPath;
    delete process.env.NAPI_RS_FORCE_WASI;
    delete process.env.NAPI_RS_WASI_FLAVOR;
    process.env.NAPI_RS_ENFORCE_VERSION_CHECK = '1';
    // Prove the installed build inputs still match the frozen executable artifacts.
    const vitePackage = JSON.parse(await readFile(require.resolve('vite/package.json'), 'utf8'));
    assert.equal(vitePackage.version, '8.3.0');

    const rolldownPackagePath = require.resolve('rolldown/package.json');
    const rolldownRoot = dirname(rolldownPackagePath);
    const rolldownPackage = JSON.parse(await readFile(rolldownPackagePath, 'utf8'));
    assert.equal(rolldownPackage.version, '1.2.9');
    assert.equal(
      process.env.NAPI_RS_NATIVE_LIBRARY_PATH,
      retainedBinding.loaderPath,
      'Vite/Rolldown must use the retained exact WASI loader override'
    );

    const lightningEntryPath = require.resolve('lightningcss');
    const lightningRoot = dirname(lightningEntryPath);
    const lightningPackagePath = join(lightningRoot, 'package.json');
    const lightningPackage = JSON.parse(await readFile(lightningPackagePath, 'utf8'));
    assert.equal(lightningPackage.name, 'lightningcss-wasm');
    assert.equal(lightningPackage.version, '1.33.0');
    assert.equal(
      await hashFile(join(lightningRoot, 'lightningcss_node.wasm')),
      '479c64bb651164b6fd9a834055e65ab507d3e39f8d8a8b683b7e83787a69e7b1'
    );

    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'index.html'),
      '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>'
    );
    await writeFile(
      join(root, 'src/style.css'),
      '.hero { color: #ff0000; margin: 0px 0px 0px 0px; user-select: none; }'
    );
    await writeFile(
      join(root, 'src/logo.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><rect width="80" height="20" fill="red"/></svg>'
    );
    await writeFile(join(root, 'src/main.ts'), mainSource(42));
    await writeFile(join(root, 'vite.config.ts'), configSource({ configMarker: 'config-one', pluginMarker: 'plugin-one' }));

    // Dynamic import happens only after the strict WASI env is installed.
    const vite = await import('vite');

    const resolved = await vite.resolveConfig({ root, logLevel: 'silent' }, 'build');
    assert.equal(resolved.build.cssMinify, 'lightningcss', 'client default CSS minifier must remain Lightning CSS');

    const buildOnce = async () => {
      await vite.build({ root, logLevel: 'silent' });
      return readOutputs(root);
    };

    const first = await buildOnce();
    assert.ok(first.jsFiles.length >= 1);
    assert.ok(first.cssFiles.length >= 1);
    assert.ok(first.mapFiles.some((file) => file.endsWith('.js.map')), 'JS source map must be emitted');
    assert.ok(first.files.some((file) => file.endsWith('.svg')), 'asset pipeline must emit SVG');
    assert.match(first.js, /config-one/);
    assert.match(first.js, /plugin-one/);
    assert.match(first.js, /42/);
    assert.match(first.css, /\.hero\{/);
    assert.doesNotMatch(first.css, /0px 0px 0px 0px/);
    assert.ok(Object.keys(first.manifest).length >= 1);

    // Source edit must invalidate the production build.
    await writeFile(join(root, 'src/main.ts'), mainSource(43));
    const second = await buildOnce();
    assert.match(second.js, /43/);
    assert.notDeepEqual(await snapshotDirectory(first.dist), [], 'dist must remain populated');

    // Config edit must be re-bundled by the default config loader and affect the build.
    await writeFile(join(root, 'vite.config.ts'), configSource({ configMarker: 'config-two', pluginMarker: 'plugin-two' }));
    const third = await buildOnce();
    assert.match(third.js, /config-two/);
    assert.match(third.js, /plugin-two/);
    assert.match(third.js, /43/);

    // An identical fourth build must be byte-deterministic at the normalized dist-tree level.
    const thirdSnapshot = await snapshotDirectory(third.dist);
    const fourth = await buildOnce();
    const fourthSnapshot = await snapshotDirectory(fourth.dist);
    assert.deepEqual(fourthSnapshot, thirdSnapshot);

    // The forced binding is the exact WASI target, never a native optional binding.
    const binding = require(retainedBinding.loaderPath);
    assert.equal(binding.__napiBindingTarget, 'wasm32-wasi');
    const dispose = binding[Symbol.for('napi.rs.wasi.dispose')];
    if (typeof dispose === 'function') await dispose.call(binding);
  } finally {
    if (previous.nativeLibraryPath === undefined) delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
    else process.env.NAPI_RS_NATIVE_LIBRARY_PATH = previous.nativeLibraryPath;
    if (previous.forceWasi === undefined) delete process.env.NAPI_RS_FORCE_WASI;
    else process.env.NAPI_RS_FORCE_WASI = previous.forceWasi;
    if (previous.wasiFlavor === undefined) delete process.env.NAPI_RS_WASI_FLAVOR;
    else process.env.NAPI_RS_WASI_FLAVOR = previous.wasiFlavor;
    if (previous.versionCheck === undefined) delete process.env.NAPI_RS_ENFORCE_VERSION_CHECK;
    else process.env.NAPI_RS_ENFORCE_VERSION_CHECK = previous.versionCheck;
    await rm(root, { recursive: true, force: true });
  }
});
