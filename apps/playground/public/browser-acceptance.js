import { OpenContainer } from '/packages/sdk/src/index.js';
import { BrowserEsmServiceWorkerBridge } from '/packages/package-env/src/browser-esm-edge.js';
import { PackageArtifactAuthority } from '/packages/package-env/src/index.js';
import { BrowserGuestWorkerAuthority } from '/packages/process/src/browser-guest-worker.js';
import { MemoryVFS, OpfsCheckpointAuthority } from '/packages/vfs/src/index.js';

const resultNode = document.getElementById('result');
const stages = [];
let acceptanceRuntime = null;
function stage(name, details = {}) {
  const receipt = { name, at: Date.now(), ...details };
  stages.push(receipt);
  document.body.dataset.stage = name;
  resultNode.textContent = JSON.stringify({ status: 'running', stages }, null, 2);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  stage('boot');
  assert(globalThis.isSecureContext, 'browser acceptance requires a secure context');
  assert(globalThis.crossOriginIsolated, 'COOP/COEP isolation is required');

  const runtime = await OpenContainer.boot({ network: { allowLocal: true } });
  acceptanceRuntime = runtime;
  stage('runtime-ready', { crossOriginIsolated: globalThis.crossOriginIsolated });
  runtime.mount({
    'package.json': JSON.stringify({ name: 'browser-acceptance', type: 'module' }),
    'src/dep.js': 'export let value=40; export function bump(){ value += 1 }',
    'src/dynamic.js': 'export default 1',
    'src/sync.txt': 'sync-one',
    'src/sync.js': [
      "import { readFileSync } from 'node:fs';",
      "import path from 'node:path';",
      "export const syncValue = readFileSync(path.join('/workspace','src','sync.txt'),'utf8');"
    ].join('\n'),
    'src/late.js': 'export default 2',
    'src/main.js': [
      "import { value, bump } from './dep.js';",
      "import { syncValue } from './sync.js';",
      'bump();',
      "const literal = await import('./dynamic.js');",
      "const latePath = './late.js';",
      'const late = await import(latePath);',
      'export const result = value + literal.default + late.default;',
      'export { syncValue };',
      'export const moduleUrl = import.meta.url;'
    ].join('\n')
  });
  runtime.packages.mountCatalog();
  stage('catalog-mounted');

  const baseURL = location.origin + '/__opencontainer__/esm/';
  const nodeCompat = runtime.packages.createBrowserNodeCompat({ cwd: '/workspace' });
  const publicationA = runtime.packages.createNativeEsmPublication({
    baseURL,
    session: 'browser-acceptance-a',
    builtinSource: nodeCompat.builtinSource
  });
  const bridgeA = new BrowserEsmServiceWorkerBridge({ publication: publicationA });
  stage('bridge-a-starting');
  await bridgeA.start();
  stage('bridge-a-ready', { controlled: !!navigator.serviceWorker.controller });

  const entryA = publicationA.moduleURL('./main.js', '/workspace/src/entry.mjs').href;
  const workerA = new BrowserGuestWorkerAuthority({
    publication: publicationA,
    diagnostics: runtime.diagnostics,
    syncRequestHandler: nodeCompat.syncRequestHandler
  });
  workerA.start();
  stage('worker-a-started', { entryA });

  const first = await workerA.execute(entryA, { exportNames: ['result', 'moduleUrl', 'syncValue'] });
  stage('worker-a-executed', { result: first.exports.result });
  assert(first.exports.result === 44, 'first native ESM execution result mismatch');
  assert(first.exports.syncValue === 'sync-one', 'first synchronous host read mismatch');
  assert(first.workerCrossOriginIsolated === true, 'guest worker is not cross-origin isolated');
  assert(first.exports.moduleUrl.includes('browser-acceptance-a'), 'module URL lost publication session');

  stage('edge-a-fetch');
  const edgeResponse = await fetch(entryA, { cache: 'no-store' });
  stage('edge-a-fetched', { status: edgeResponse.status });
  assert(edgeResponse.ok, 'service-worker module edge did not return 200');
  assert(edgeResponse.headers.get('x-opencontainer-edge') === 'service-worker', 'module was not served by disposable service-worker edge');
  assert(edgeResponse.headers.get('x-opencontainer-session') === 'browser-acceptance-a', 'publication session header mismatch');

  runtime.fs.beginTransaction()
    .writeFile('src/dep.js', 'export let value=90; export function bump(){ value += 1 }')
    .writeFile('src/sync.txt', 'sync-two')
    .commit();

  const publicationB = runtime.packages.createNativeEsmPublication({
    baseURL,
    session: 'browser-acceptance-b',
    builtinSource: nodeCompat.builtinSource
  });
  const bridgeB = new BrowserEsmServiceWorkerBridge({ publication: publicationB });
  stage('bridge-b-starting');
  await bridgeB.start();
  stage('bridge-b-ready');

  const entryB = publicationB.moduleURL('./main.js', '/workspace/src/entry.mjs').href;
  const workerB = new BrowserGuestWorkerAuthority({
    publication: publicationB,
    diagnostics: runtime.diagnostics,
    syncRequestHandler: nodeCompat.syncRequestHandler
  });
  workerB.start();
  stage('worker-b-started', { entryB });

  const second = await workerB.execute(entryB, { exportNames: ['result', 'moduleUrl', 'syncValue'] });
  stage('worker-b-executed', { result: second.exports.result });
  assert(second.exports.result === 94, 'edited generation was not visible in restarted guest worker');
  assert(second.exports.syncValue === 'sync-two', 'restarted Worker did not observe synchronous host read from new generation');
  assert(second.exports.moduleUrl.includes('browser-acceptance-b'), 'new publication session was not used');

  workerA.close();
  bridgeA.close();

  stage('stale-fetch');
  const stale = await fetch(entryA, { cache: 'no-store' });
  stage('stale-fetched', { status: stale.status });
  assert(stale.status === 504, 'unowned stale publication session did not fail closed');

  workerB.close();
  bridgeB.close();

  stage('opfs-real-start');
  assert(navigator.storage?.getDirectory, 'OPFS API is unavailable');
  const opfsRoot = await navigator.storage.getDirectory();
  const opfsDirectory = 'opencontainer-browser-acceptance-' + crypto.randomUUID();
  try {
    const opfsFs = new MemoryVFS();
    opfsFs.mount({ 'value.txt': 'first' });
    const opfs = await new OpfsCheckpointAuthority({
      root: opfsRoot,
      directoryName: opfsDirectory
    }).open();
    const firstCheckpoint = await opfs.checkpoint(opfsFs);

    opfsFs.beginTransaction().writeFile('value.txt', 'second').commit();
    const secondCheckpoint = await opfs.checkpoint(opfsFs);
    assert(secondCheckpoint.sequence === firstCheckpoint.sequence + 1, 'OPFS manifest sequence did not advance');

    const workspace = await opfsRoot.getDirectoryHandle(opfsDirectory);
    const generations = await workspace.getDirectoryHandle('generations');
    const newestPayload = await generations.getFileHandle(secondCheckpoint.payload);
    const corrupt = await newestPayload.createWritable();
    await corrupt.write('{"corrupt":true}');
    await corrupt.close();

    const reopened = await new OpfsCheckpointAuthority({
      root: opfsRoot,
      directoryName: opfsDirectory
    }).open();
    assert(reopened.current?.sequence === firstCheckpoint.sequence, 'OPFS did not fall back from corrupt newest payload');

    const restored = new MemoryVFS();
    await reopened.restoreInto(restored);
    assert(restored.readFile('value.txt') === 'first', 'OPFS recovery restored the wrong generation');

    stage('opfs-real-pass', {
      firstSequence: firstCheckpoint.sequence,
      rejectedSequence: secondCheckpoint.sequence,
      recoveredSequence: reopened.current.sequence
    });
  } finally {
    await opfsRoot.removeEntry(opfsDirectory, { recursive: true });
  }

  stage('browser-package-install-start');
  const lightningIntegrity = 'sha512-OLAtqEyInBSVWjPrTjpLzcZUMUHO0q+2PFBXKr86nxZOu0P38givj/ZMtRaZ0d38pMTb9wQx+LtaLtHclv+sEA==';
  const lightningUrl = location.origin + '/toolchain/vendor/lightningcss-wasm-1.33.0.tgz';
  runtime.net.allow({
    origin: location.origin,
    methods: ['GET'],
    paths: ['/toolchain/vendor/']
  });
  runtime.packages.compile({
    name: 'browser-package-acceptance',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'browser-package-acceptance', version: '1.0.0' },
      'node_modules/lightningcss-wasm': {
        name: 'lightningcss-wasm',
        version: '1.33.0',
        resolved: lightningUrl,
        integrity: lightningIntegrity
      }
    }
  });

  const artifactAuthority = new PackageArtifactAuthority({
    fs: runtime.fs,
    network: runtime.net,
    maxArtifactBytes: 8 * 1024 * 1024,
    maxUnpackedBytes: 64 * 1024 * 1024
  });
  const frozenInstaller = runtime.packages.createFrozenInstaller();
  const installReceipt = await frozenInstaller.installAll({
    artifactAuthority,
    concurrency: 2
  });
  assert(installReceipt.redirects === 0, 'same-origin retained package unexpectedly redirected');
  const mountedPackages = frozenInstaller.mountFrozenGraph();
  const resolvedLightning = runtime.packages.resolve(
    'lightningcss-wasm',
    '/workspace/src/package-consumer.mjs',
    { mode: 'esm' }
  );
  const lightningPackageJson = JSON.parse(
    runtime.packages.nodeModules.readFile('/workspace/node_modules/lightningcss-wasm/package.json')
  );
  assert(lightningPackageJson.name === 'lightningcss-wasm', 'browser-installed package name mismatch');
  assert(lightningPackageJson.version === '1.33.0', 'browser-installed package version mismatch');
  assert(resolvedLightning.path.includes('/workspace/node_modules/lightningcss-wasm/'), 'browser resolver did not target installed immutable package');
  stage('browser-package-install-pass', {
    bytes: installReceipt.bytes,
    fetchedContents: installReceipt.fetchedContents,
    packageInstances: installReceipt.packageInstances,
    contentCount: mountedPackages.contentCount,
    resolved: resolvedLightning.path
  });

  stage('vite-closure-install-start');
  const lockResponse = await fetch('/package-lock.json', { cache: 'no-store' });
  assert(lockResponse.ok, 'failed to load frozen Vite C1 package-lock');
  const c1Lock = await lockResponse.json();
  const rolldownBrowserLocation = 'node_modules/@rolldown/browser';
  c1Lock.packages[rolldownBrowserLocation] = {
    name: '@rolldown/browser',
    version: '1.2.9',
    resolved: location.origin + '/toolchain/vendor/rolldown-browser-1.2.9.tgz',
    integrity: 'sha256-mszzzf49IoetfV9JzSz83bycESq/y8KVhj5AHvRLhXY=',
    dependencies: {
      '@emnapi/core': '2.0.0-alpha.5',
      '@emnapi/runtime': '2.0.0-alpha.5',
      '@napi-rs/wasm-runtime': '1.2.4'
    }
  };
  runtime.packages.compile(c1Lock);
  const viteClosure = runtime.packages.selectDependencyClosure({ roots: ['vite', '@rolldown/browser'] });
  assert(viteClosure.locations.includes('node_modules/vite'), 'Vite missing from selected closure');
  assert(viteClosure.locations.includes('node_modules/rolldown'), 'Rolldown metadata package missing from selected closure');
  assert(viteClosure.locations.includes(rolldownBrowserLocation), 'Exact Rolldown browser package missing from selected closure');
  assert(viteClosure.locations.includes('node_modules/lightningcss'), 'Lightning CSS missing from selected closure');
  assert(!viteClosure.locations.some((location) => location.includes('@rolldown/binding-')), 'optional native Rolldown binding leaked into browser closure');

  runtime.net.allow({
    origin: 'https://registry.npmjs.org',
    methods: ['GET'],
    paths: ['/']
  });
  const c1ArtifactAuthority = new PackageArtifactAuthority({
    fs: runtime.fs,
    network: runtime.net,
    maxArtifactBytes: 16 * 1024 * 1024,
    maxUnpackedBytes: 96 * 1024 * 1024
  });
  const c1Installer = runtime.packages.createFrozenInstaller();
  const c1Progress = [];
  const c1Install = await c1Installer.installAll({
    artifactAuthority: c1ArtifactAuthority,
    locations: viteClosure.locations,
    concurrency: 4,
    onProgress: (receipt) => c1Progress.push({
      location: receipt.location,
      bytes: receipt.bytes
    })
  });
  const c1Mounted = c1Installer.mountFrozenGraph({ locations: viteClosure.locations });
  const viteResolved = runtime.packages.resolve('vite', '/workspace/src/vite-probe.mjs', { mode: 'esm' });
  const vitePackage = JSON.parse(runtime.packages.nodeModules.readFile('/workspace/node_modules/vite/package.json'));
  assert(vitePackage.version === '8.3.0', 'browser-installed Vite version mismatch');
  assert(viteResolved.path.startsWith('/workspace/node_modules/vite/'), 'Vite resolver did not target frozen browser graph');
  assert(c1Install.fetchedContents >= 10, 'Vite browser closure unexpectedly small');
  stage('vite-closure-install-pass', {
    locations: viteClosure.locations.length,
    fetchedContents: c1Install.fetchedContents,
    embeddedInstances: c1Install.embeddedInstances,
    bytes: c1Install.bytes,
    mountedPackages: c1Mounted.packageCount,
    vite: viteResolved.path,
    progress: c1Progress
  });

  const lightningBrowserResolved = runtime.packages.resolve(
    'lightningcss',
    '/workspace/node_modules/vite/dist/node/chunks/node.js',
    { mode: 'esm', conditions: ['browser', 'import', 'default'] }
  );
  assert(
    lightningBrowserResolved.path === '/workspace/node_modules/lightningcss/index.mjs',
    'Lightning CSS browser adapter resolved an unexpected entry'
  );
  assert(
    runtime.packages.nodeModules.stat('/workspace/node_modules/lightningcss/lightningcss_node.wasm')?.type === 'file',
    'Lightning CSS exact WASM payload is missing from mounted closure'
  );
  stage('lightningcss-browser-profile', {
    entry: lightningBrowserResolved.path,
    wasm: '/workspace/node_modules/lightningcss/lightningcss_node.wasm'
  });

  const viteNodeChunkSource = runtime.packages.nodeModules.readFile('/workspace/node_modules/vite/dist/node/chunks/node.js');
  const picomatchSourceIndex = viteNodeChunkSource.indexOf('picomatch');
  const viteNodeChunkLines = viteNodeChunkSource.split('\n');
  const viteCreateRequireIndex = viteNodeChunkSource.indexOf('createRequire');
  const viteRequireDeclarationIndex = viteNodeChunkSource.indexOf('__require =');
  stage('vite-create-require-source-shape', {
    createRequireIndex: viteCreateRequireIndex,
    requireDeclarationIndex: viteRequireDeclarationIndex,
    createRequireSnippet: viteCreateRequireIndex >= 0
      ? viteNodeChunkSource.slice(Math.max(0, viteCreateRequireIndex - 500), viteCreateRequireIndex + 900)
      : null,
    requireDeclarationSnippet: viteRequireDeclarationIndex >= 0
      ? viteNodeChunkSource.slice(Math.max(0, viteRequireDeclarationIndex - 500), viteRequireDeclarationIndex + 900)
      : null
  });
  const viteProcessVersionIndex = viteNodeChunkSource.indexOf('process.versions.node');
  const viteProcessDeclarationMatch = /\b(?:const|let|var|function|class)\s+process\b/.exec(viteNodeChunkSource);
  const viteProcessImportMatch = /\bimport\s+process\b/.exec(viteNodeChunkSource);
  stage('vite-picomatch-source-shape', {
    index: picomatchSourceIndex,
    snippet: picomatchSourceIndex >= 0
      ? viteNodeChunkSource.slice(Math.max(0, picomatchSourceIndex - 500), picomatchSourceIndex + 700)
      : null,
    line8763: viteNodeChunkLines.slice(8748, 8778).join('\n'),
    line8799: viteNodeChunkLines.slice(8788, 8810).join('\n'),
    line10679: viteNodeChunkLines.slice(10660, 10700).join('\n'),
    line11472: viteNodeChunkLines.slice(11460, 11484).join('\n'),
    line24241: viteNodeChunkLines.slice(24230, 24252).join('\n'),
    processVersionIndex: viteProcessVersionIndex,
    processVersionSnippet: viteProcessVersionIndex >= 0
      ? viteNodeChunkSource.slice(Math.max(0, viteProcessVersionIndex - 500), viteProcessVersionIndex + 700)
      : null,
    processDeclarationIndex: viteProcessDeclarationMatch?.index ?? -1,
    processDeclarationSnippet: viteProcessDeclarationMatch
      ? viteNodeChunkSource.slice(Math.max(0, viteProcessDeclarationMatch.index - 400), viteProcessDeclarationMatch.index + 800)
      : null,
    processImportIndex: viteProcessImportMatch?.index ?? -1,
    processImportSnippet: viteProcessImportMatch
      ? viteNodeChunkSource.slice(Math.max(0, viteProcessImportMatch.index - 400), viteProcessImportMatch.index + 800)
      : null
  });

  runtime.fs.beginTransaction().writeFile(
    'src/vite-process-probe.mjs',
    [
      "import process from 'node:process';",
      "export const nodeVersion = process?.versions?.node ?? null;",
      "export const platform = process?.platform ?? null;",
      "export const globalNodeVersion = globalThis.process?.versions?.node ?? null;"
    ].join('\n')
  ).commit();

  const c1CssSource = '.card { color: rgb(255, 0, 0); margin: 0px 0px 0px 0px; }';
  runtime.fs.beginTransaction()
    .mkdir('c1-app')
    .mkdir('c1-app/src')
    .mkdir('c1-app/public')
    .writeFile('c1-app/index.html', [
      '<!doctype html>',
      '<html><body>',
      '<div id="app" class="card"></div>',
      '<script type="module" src="/src/main.ts"></script>',
      '</body></html>'
    ].join(''))
    .writeFile('c1-app/src/main.ts', [
      "import './style.css';",
      "import logoUrl from './logo.svg';",
      "const app = document.querySelector<HTMLDivElement>('#app');",
      "if (app) { app.textContent = 'OpenContainer Vite C1'; app.dataset.logo = logoUrl; }",
      "export const marker: string = 'vite-c1';"
    ].join('\n'))
    .writeFile('c1-app/src/style.css', c1CssSource)
    .writeFile('c1-app/src/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32"/></svg>')
    .writeFile('src/vite-build-probe.mjs', [
      "import { build, version } from 'vite';",
      "import { existsSync, readFileSync } from 'node:fs';",
      "import { dirname, resolve as pathResolve } from 'node:path';",
      "const root = '/workspace/c1-app';",
      "const cleanId = (id) => String(id).split('?')[0].split('#')[0];",
      "const vfsPlugin = {",
      "  name: 'opencontainer-vfs-input',",
      "  enforce: 'pre',",
      "  resolveId(source, importer) {",
      "    const raw = cleanId(source);",
      "    let candidate = null;",
      "    if (raw.startsWith('/workspace/')) candidate = raw;",
      "    else if (!importer && (raw === 'index.html' || raw.endsWith('/index.html'))) candidate = root + '/index.html';",
      "    else if (raw.startsWith('/') && !raw.startsWith('/@')) candidate = root + raw;",
      "    else if (importer && cleanId(importer).startsWith('/workspace/') && (raw.startsWith('./') || raw.startsWith('../'))) candidate = pathResolve(dirname(cleanId(importer)), raw);",
      "    if (candidate && existsSync(candidate)) return candidate;",
      "    return null;",
      "  },",
      "  load(id) {",
      "    const path = cleanId(id);",
      "    if (!path.startsWith('/workspace/') || !existsSync(path)) return null;",
      "    if (/\\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|wasm)$/i.test(path)) return null;",
      "    return readFileSync(path, 'utf8');",
      "  }",
      "};",
      "const result = await build({",
      "  root,",
      "  configFile: false,",
      "  logLevel: 'silent',",
      "  plugins: [vfsPlugin],",
      "  build: {",
      "    write: false,",
      "    sourcemap: true,",
      "    manifest: true,",
      "    assetsInlineLimit: 0,",
      "    rollupOptions: { input: root + '/index.html' }",
      "  }",
      "});",
      "const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry?.output ?? []);",
      "const text = (entry) => entry.type === 'chunk' ? entry.code : typeof entry.source === 'string' ? entry.source : new TextDecoder().decode(entry.source);",
      "const summary = outputs.map((entry) => ({ type: entry.type, fileName: entry.fileName, content: text(entry) }));",
      "export const viteVersion = version;",
      "export const outputCount = outputs.length;",
      "export const outputFiles = outputs.map((entry) => entry.fileName).sort().join('|');",
      "export const outputJson = JSON.stringify(summary);"
    ].join('\n'))
    .commit();

  stage('vite-publication-graph-start');
  const viteNodeCompat = runtime.packages.createBrowserNodeCompat({
    cwd: '/workspace',
    env: {
      NODE_ENV: 'production',
      NAPI_RS_FORCE_WASI: 'error',
      NAPI_RS_WASI_FLAVOR: 'wasm32-wasi'
    }
  });
  const vitePublication = runtime.packages.createNativeEsmPublication({
    baseURL,
    session: 'vite-c1-graph',
    builtinSource: viteNodeCompat.builtinSource,
    resolveOptions: {
      conditions: ['browser', 'import', 'default'],
      packageAliases: { rolldown: '@rolldown/browser' },
      pathAliases: {
        '/workspace/node_modules/@rolldown/browser/dist/rolldown-binding.wasi.cjs':
          '/workspace/node_modules/@rolldown/browser/dist/rolldown-binding.wasi-browser.js'
      }
    },
    assetAllow: (path, asset) =>
      asset.kind === 'wasm' &&
      (
        path === '/workspace/node_modules/@rolldown/browser/dist/rolldown-binding.wasm32-wasi.wasm' ||
        path === '/workspace/node_modules/lightningcss/lightningcss_node.wasm'
      ),
    nodeGlobalAllow: (path) => path.startsWith('/workspace/node_modules/vite/dist/node/'),
    moduleEpilogue: (path) =>
      path === '/workspace/node_modules/lightningcss/index.mjs'
        ? 'await init();'
        : ''
  });
  const viteEntryUrl = vitePublication.moduleURL('vite', '/workspace/src/vite-probe.mjs');
  const viteGraph = await vitePublication.graph(viteEntryUrl);
  assert(viteGraph.modules.length > 10, 'Vite publication graph unexpectedly small');
  stage('vite-publication-graph-pass', {
    modules: viteGraph.modules.length,
    entry: viteGraph.entryURL
  });

  const viteBridge = new BrowserEsmServiceWorkerBridge({
    publication: vitePublication,
    diagnostics: runtime.diagnostics
  });
  await viteBridge.start();

  stage('vite-process-probe-start');
  const viteProcessProbe = new BrowserGuestWorkerAuthority({
    publication: vitePublication,
    diagnostics: runtime.diagnostics,
    syncRequestHandler: viteNodeCompat.syncRequestHandler
  });
  viteProcessProbe.start();
  const viteProcessProbeResult = await viteProcessProbe.execute(
    vitePublication.moduleURL('./vite-process-probe.mjs', '/workspace/src/entry.mjs').href,
    { exportNames: ['nodeVersion', 'platform', 'globalNodeVersion'] }
  );
  stage('vite-process-probe-pass', viteProcessProbeResult.exports);
  assert(viteProcessProbeResult.exports.nodeVersion === '24.21.0', 'node:process default export lost Node compatibility version');
  assert(viteProcessProbeResult.exports.platform === 'linux', 'node:process default export lost logical platform');
  assert(viteProcessProbeResult.exports.globalNodeVersion === null, 'browser global process incorrectly impersonates Node');
  viteProcessProbe.close();

  stage('rolldown-wasi-worker-preflight-start');
  const rolldownWasiWorkerUrl = vitePublication.moduleURL(
    './wasi-worker-browser.mjs',
    '/workspace/node_modules/@rolldown/browser/dist/rolldown-binding.wasi-browser.js'
  ).href;
  const rolldownWasiProbe = new BrowserGuestWorkerAuthority({
    publication: vitePublication,
    diagnostics: runtime.diagnostics,
    syncRequestHandler: viteNodeCompat.syncRequestHandler,
    requestTimeoutMs: 15000
  });
  rolldownWasiProbe.start();
  const rolldownWasiPreflight = await rolldownWasiProbe.execute(rolldownWasiWorkerUrl, {
    exportNames: []
  });
  assert(
    rolldownWasiPreflight.workerCrossOriginIsolated === true,
    'Rolldown WASI worker preflight is not cross-origin isolated'
  );
  stage('rolldown-wasi-worker-preflight-pass', {
    entry: rolldownWasiWorkerUrl,
    workerCrossOriginIsolated: rolldownWasiPreflight.workerCrossOriginIsolated
  });
  rolldownWasiProbe.close();

  stage('vite-module-execution-start');
  const viteWorker = new BrowserGuestWorkerAuthority({
    publication: vitePublication,
    diagnostics: runtime.diagnostics,
    syncRequestHandler: viteNodeCompat.syncRequestHandler,
    requestTimeoutMs: 60000
  });
  viteWorker.start();
  const viteExecution = await viteWorker.execute(viteGraph.entryURL, {
    exportNames: ['version'],
    observeNestedWorkers: true
  });
  assert(viteExecution.workerCrossOriginIsolated === true, 'Vite guest worker is not cross-origin isolated');
  assert(viteExecution.exports.version === '8.3.0', 'Vite module execution returned the wrong version');
  stage('vite-module-execution-pass', {
    version: viteExecution.exports.version,
    workerCrossOriginIsolated: viteExecution.workerCrossOriginIsolated
  });

  stage('vite-c1-build-start');
  const viteBuildEntryUrl = vitePublication.moduleURL('./vite-build-probe.mjs', '/workspace/src/entry.mjs');
  const viteBuildGraph = await vitePublication.graph(viteBuildEntryUrl);
  const viteBuildExecution = await viteWorker.execute(viteBuildGraph.entryURL, {
    exportNames: ['viteVersion', 'outputCount', 'outputFiles', 'outputJson'],
    observeNestedWorkers: true
  });
  assert(viteBuildExecution.exports.viteVersion === '8.3.0', 'Vite C1 build used the wrong Vite version');
  const c1Outputs = JSON.parse(viteBuildExecution.exports.outputJson);
  const bySuffix = (suffix) => c1Outputs.find((entry) => String(entry.fileName).endsWith(suffix));
  const c1Html = c1Outputs.find((entry) => entry.fileName === 'index.html');
  const c1Css = bySuffix('.css');
  const c1Js = bySuffix('.js');
  const c1Map = bySuffix('.map');
  const c1Svg = bySuffix('.svg');
  const c1ManifestEntry = bySuffix('manifest.json');
  assert(viteBuildExecution.exports.outputCount >= 5, 'Vite C1 build emitted too few outputs');
  assert(c1Html?.content.includes('type="module"'), 'Vite C1 build did not emit transformed index.html');
  assert(c1Css?.content.includes('.card'), 'Vite C1 CSS output lost fixture selector');
  const c1CssWithoutMapComment = c1Css.content.replace(/\/\*# sourceMappingURL=[\s\S]*?\*\//g, '').trim();
  assert(!c1CssWithoutMapComment.includes('rgb(255, 0, 0)'), 'Vite C1 Lightning CSS did not normalize color syntax');
  assert(!c1CssWithoutMapComment.includes('0px 0px 0px 0px'), 'Vite C1 Lightning CSS did not minify zero margin syntax');
  assert(!/\.card\s+\{/.test(c1CssWithoutMapComment), 'Vite C1 Lightning CSS retained unminified selector spacing');
  assert(c1Js?.content.includes('OpenContainer Vite C1'), 'Vite C1 JS output lost semantic marker');
  assert(JSON.parse(c1Map?.content ?? '{}').version === 3, 'Vite C1 source map is invalid');
  assert(c1Svg?.content.includes('<svg'), 'Vite C1 imported asset was not emitted');
  const c1Manifest = JSON.parse(c1ManifestEntry?.content ?? '{}');
  assert(Object.keys(c1Manifest).length >= 1, 'Vite C1 manifest is empty');
  stage('vite-c1-build-pass', {
    outputCount: viteBuildExecution.exports.outputCount,
    outputFiles: viteBuildExecution.exports.outputFiles,
    cssBytes: c1Css.content.length,
    manifestEntries: Object.keys(c1Manifest).length
  });

  viteWorker.close();
  viteBridge.close();

  await runtime.terminate();

  return {
    pageCrossOriginIsolated: globalThis.crossOriginIsolated,
    firstResult: first.exports.result,
    secondResult: second.exports.result,
    syncRpcFirst: first.exports.syncValue,
    syncRpcSecond: second.exports.syncValue,
    staleStatus: stale.status,
    serviceWorkerEdge: edgeResponse.headers.get('x-opencontainer-edge'),
    opfsRealBrowser: true,
    browserPackageInstall: true,
    viteClosureInstall: true,
    vitePublicationGraph: true,
    rolldownWasiWorkerPreflight: true,
    viteModuleExecution: true,
    viteC1Build: true,
    stages
  };
}

run().then((receipt) => {
  document.body.dataset.status = 'pass';
  resultNode.textContent = JSON.stringify(receipt);
}).catch((error) => {
  document.body.dataset.status = 'fail';
  document.body.dataset.stage = 'failed';
  resultNode.textContent = JSON.stringify({
    error: {
      name: error?.name,
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
      details: error?.details
    },
    stages,
    diagnostics: acceptanceRuntime?.diagnostics?.list?.().slice(-120) ?? []
  }, null, 2);
});
