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
      "if (app) { app.textContent = 'OpenContainer Vite C1'; app.dataset.logo = logoUrl; app.dataset.source = 'source-v1'; }",
      "export const marker: string = 'vite-c1';"
    ].join('\n'))
    .writeFile('c1-app/src/style.css', c1CssSource)
    .writeFile('c1-app/src/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32"/></svg>')
    .writeFile('c1-app/vite.config.ts', [
      "export default {",
      "  plugins: [{",
      "    name: 'opencontainer-config-plugin',",
      "    transform(code, id) {",
      "      if (String(id).endsWith('/src/main.ts')) {",
      "        return code.replace('OpenContainer Vite C1', 'OpenContainer Vite C1 Config V1');",
      "      }",
      "      return null;",
      "    }",
      "  }]",
      "};"
    ].join('\n'))
    .writeFile('src/lightningcss-probe.mjs', [
      "import { transform } from 'lightningcss';",
      "const text = '.card { color: rgb(255, 0, 0); margin: 0px 0px 0px 0px; }';",
      "const code = new TextEncoder().encode(text);",
      "const css = new TextDecoder().decode(transform({ filename: 'style.css', code, minify: true }).code);",
      "export { css };"
    ].join('\n'))
    .writeFile('src/lightningcss-buffer-probe.mjs', [
      "import { transform } from 'lightningcss';",
      "import { Buffer } from 'node:buffer';",
      "const text = '.card { color: rgb(255, 0, 0); margin: 0px 0px 0px 0px; }';",
      "const code = Buffer.from(text);",
      "const css = new TextDecoder().decode(transform({ filename: 'style.css', code, minify: true }).code);",
      "export { css };",
      "export const bufferLength = code.byteLength;",
      "export const bufferPrefix = Array.from(code.slice(0, 12)).join(',');"
    ].join('\n'))
    .writeFile('src/vite-build-probe.mjs', [
      "import { build, version } from 'vite';",
      "import { memfs } from 'rolldown/experimental';",
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
      "import { dirname, resolve as pathResolve } from 'node:path';",
      "const root = '/workspace/c1-app';",
      "const configPath = root + '/vite.config.ts';",
      "const mirrorConfig = () => {",
      "  const configSource = readFileSync(configPath, 'utf8');",
      "  if (!memfs) throw new Error('Rolldown browser memfs is unavailable');",
      "  for (const path of [configPath, '/c1-app/vite.config.ts']) {",
      "    const slash = path.lastIndexOf('/');",
      "    memfs.fs.mkdirSync(path.slice(0, slash), { recursive: true });",
      "    memfs.fs.writeFileSync(path, configSource);",
      "  }",
      "};",
      "mirrorConfig();",
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
      "const text = (entry) => entry.type === 'chunk' ? entry.code : typeof entry.source === 'string' ? entry.source : new TextDecoder().decode(entry.source);",
      "const summarize = (outputs) => outputs.map((entry) => {",
      "  const raw = entry.type === 'chunk' ? entry.code : entry.source;",
      "  return {",
      "    type: entry.type,",
      "    fileName: entry.fileName,",
      "    content: text(entry),",
      "    rawType: typeof raw,",
      "    rawCtor: raw?.constructor?.name ?? null,",
      "    rawLength: raw?.length ?? null,",
      "    rawByteLength: raw?.byteLength ?? null,",
      "    rawByteOffset: raw?.byteOffset ?? null",
      "  };",
      "});",
      "const runBuild = async (overrides = {}) => {",
      "  const result = await build({",
      "    root,",
      "    logLevel: 'silent',",
      "    plugins: [vfsPlugin],",
      "    build: {",
      "      write: false,",
      "      sourcemap: true,",
      "      manifest: true,",
      "      assetsInlineLimit: 0,",
      "      rollupOptions: { input: root + '/index.html' },",
      "      ...(overrides.build ?? {})",
      "    },",
      "    ...overrides",
      "  });",
      "  const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry?.output ?? []);",
      "  return { outputs, summary: summarize(outputs) };",
      "};",
      "const outputBySuffix = (run, suffix) => run.summary.find((entry) => String(entry.fileName).endsWith(suffix));",
      "const normalizeObject = (value) => {",
      "  if (Array.isArray(value)) return value.map(normalizeObject);",
      "  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeObject(value[key])]));",
      "  return value;",
      "};",
      "const normalizedManifest = (run) => JSON.stringify(normalizeObject(JSON.parse(outputBySuffix(run, 'manifest.json')?.content ?? '{}')));",
      "const firstRun = await runBuild();",
      "const sourcePath = root + '/src/main.ts';",
      "const originalSource = readFileSync(sourcePath, 'utf8');",
      "const editedSource = originalSource.replace(\"source-v1\", \"source-v2\");",
      "if (editedSource === originalSource) throw new Error('Vite C1 source edit fixture did not change');",
      "writeFileSync(sourcePath, editedSource);",
      "const secondRun = await runBuild();",
      "const secondJs = outputBySuffix(secondRun, '.js')?.content ?? '';",
      "const configV1 = readFileSync(configPath, 'utf8');",
      "const configV2 = configV1.replace('OpenContainer Vite C1 Config V1', 'OpenContainer Vite C1 Config V2');",
      "if (configV2 === configV1) throw new Error('Vite C1 config edit fixture did not change');",
      "writeFileSync(configPath, configV2);",
      "mirrorConfig();",
      "const thirdRun = await runBuild();",
      "const thirdJs = outputBySuffix(thirdRun, '.js')?.content ?? '';",
      "const fourthRun = await runBuild();",
      "const sourceBeforeFailure = readFileSync(sourcePath, 'utf8');",
      "let expectedFailureObserved = false;",
      "try {",
      "  await build({",
      "    root,",
      "    configFile: false,",
      "    logLevel: 'silent',",
      "    plugins: [vfsPlugin],",
      "    build: { write: false, rollupOptions: { input: root + '/src/__opencontainer_missing_entry__.ts' } }",
      "  });",
      "} catch {",
      "  expectedFailureObserved = true;",
      "}",
      "const sourceAfterFailure = readFileSync(sourcePath, 'utf8');",
      "export const viteVersion = version;",
      "export const outputCount = firstRun.outputs.length;",
      "export const outputFiles = firstRun.outputs.map((entry) => entry.fileName).sort().join('|');",
      "export const outputJson = JSON.stringify(firstRun.summary);",
      "export const sourceEditPersisted = readFileSync(sourcePath, 'utf8').includes('source-v2');",
      "export const sourceEditObserved = secondJs.includes('source-v2');",
      "export const configReloadObserved = thirdJs.includes('OpenContainer Vite C1 Config V2');",
      "export const expectedBuildFailureObserved = expectedFailureObserved;",
      "export const sourceUnchangedAfterFailure = sourceBeforeFailure === sourceAfterFailure;",
      "export const deterministicManifest = normalizedManifest(thirdRun) === normalizedManifest(fourthRun);",
      "export const repeatedOutputFiles = thirdRun.outputs.map((entry) => entry.fileName).sort().join('|') === fourthRun.outputs.map((entry) => entry.fileName).sort().join('|');"
    ].join('\n'))
    .writeFile('src/vite-dev-probe.mjs', [
      "import { createServer, version } from 'vite';",
      "import { existsSync, readFileSync } from 'node:fs';",
      "import { dirname, resolve as pathResolve } from 'node:path';",
      "const root = '/workspace/c1-app';",
      "const cleanId = (id) => String(id).split('?')[0].split('#')[0];",
      "const vfsPlugin = {",
      "  name: 'opencontainer-vfs-dev',",
      "  enforce: 'pre',",
      "  resolveId(source, importer) {",
      "    const raw = cleanId(source);",
      "    let candidate = null;",
      "    if (raw.startsWith('/workspace/')) candidate = raw;",
      "    else if (raw.startsWith('/') && !raw.startsWith('/@')) candidate = root + raw;",
      "    else if (importer && cleanId(importer).startsWith('/workspace/') && (raw.startsWith('./') || raw.startsWith('../'))) candidate = pathResolve(dirname(cleanId(importer)), raw);",
      "    if (candidate && existsSync(candidate)) return candidate;",
      "    return null;",
      "  },",
      "  load(id) {",
      "    const file = cleanId(id);",
      "    if (!file.startsWith('/workspace/') || !existsSync(file)) return null;",
      "    if (/\\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|wasm)$/i.test(file)) return null;",
      "    return readFileSync(file, 'utf8');",
      "  }",
      "};",
      "const server = await createServer({",
      "  root,",
      "  configFile: false,",
      "  logLevel: 'silent',",
      "  appType: 'spa',",
      "  plugins: [vfsPlugin],",
      "  server: { middlewareMode: true, watch: null, ws: false, hmr: false }",
      "});",
      "let html = '';",
      "let tsCode = '';",
      "let clientCode = '';",
      "let closed = false;",
      "try {",
      "  html = await server.transformIndexHtml('/', readFileSync(root + '/index.html', 'utf8'));",
      "  const ts = await server.transformRequest('/src/main.ts');",
      "  tsCode = ts?.code ?? '';",
      "  const client = await server.transformRequest('/@vite/client');",
      "  clientCode = client?.code ?? '';",
      "} finally {",
      "  await server.close();",
      "  closed = true;",
      "}",
      "export const viteVersion = version;",
      "export const created = !!server && server.httpServer === null;",
      "export const htmlHasClient = html.includes('/@vite/client');",
      "export const htmlHasEntry = html.includes('/src/main.ts');",
      "export const tsTransformed = tsCode.includes('source-v2') && !tsCode.includes('document.querySelector<HTMLDivElement>');",
      "export const viteClientServed = clientCode.includes('createHotContext') || clientCode.includes('HotContext');",
      "export const clientBytes = clientCode.length;",
      "export const tsBytes = tsCode.length;",
      "export { html, tsCode, clientCode };",
      "export const closeSucceeded = closed;"
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

  stage('lightningcss-direct-probe-start');
  const lightningCssProbe = new BrowserGuestWorkerAuthority({
    publication: vitePublication,
    diagnostics: runtime.diagnostics,
    syncRequestHandler: viteNodeCompat.syncRequestHandler,
    requestTimeoutMs: 30000
  });
  lightningCssProbe.start();
  const lightningCssDirect = await lightningCssProbe.execute(
    vitePublication.moduleURL('./lightningcss-probe.mjs', '/workspace/src/entry.mjs').href,
    { exportNames: ['css'] }
  );
  assert(lightningCssDirect.exports.css?.includes('.card'), 'direct Lightning CSS transform lost fixture selector');
  stage('lightningcss-direct-probe-pass', {
    cssPrefix: lightningCssDirect.exports.css.slice(0, 80),
    cssLength: lightningCssDirect.exports.css.length,
    cssNulls: (lightningCssDirect.exports.css.match(/\0/g) ?? []).length
  });
  lightningCssProbe.close();

  stage('lightningcss-buffer-probe-start');
  const lightningCssBufferProbe = new BrowserGuestWorkerAuthority({
    publication: vitePublication,
    diagnostics: runtime.diagnostics,
    syncRequestHandler: viteNodeCompat.syncRequestHandler,
    requestTimeoutMs: 30000
  });
  lightningCssBufferProbe.start();
  const lightningCssBuffer = await lightningCssBufferProbe.execute(
    vitePublication.moduleURL('./lightningcss-buffer-probe.mjs', '/workspace/src/entry.mjs').href,
    { exportNames: ['css', 'bufferLength', 'bufferPrefix'] }
  );
  assert(lightningCssBuffer.exports.css?.includes('.card'), 'Buffer-backed Lightning CSS transform lost fixture selector');
  stage('lightningcss-buffer-probe-pass', {
    cssPrefix: lightningCssBuffer.exports.css.slice(0, 80),
    cssLength: lightningCssBuffer.exports.css.length,
    cssNulls: (lightningCssBuffer.exports.css.match(/\0/g) ?? []).length,
    bufferLength: lightningCssBuffer.exports.bufferLength,
    bufferPrefix: lightningCssBuffer.exports.bufferPrefix
  });
  lightningCssBufferProbe.close();

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
    exportNames: [
      'viteVersion',
      'outputCount',
      'outputFiles',
      'outputJson',
      'sourceEditPersisted',
      'sourceEditObserved',
      'configReloadObserved',
      'expectedBuildFailureObserved',
      'sourceUnchangedAfterFailure',
      'deterministicManifest',
      'repeatedOutputFiles'
    ],
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
  stage('vite-c1-css-output', {
    bytes: c1CssWithoutMapComment.length,
    nullCount: (c1CssWithoutMapComment.match(/\0/g) ?? []).length,
    prefix: c1CssWithoutMapComment.slice(0, 120),
    tail: c1CssWithoutMapComment.slice(-160),
    rawType: c1Css.rawType,
    rawCtor: c1Css.rawCtor,
    rawLength: c1Css.rawLength,
    rawByteLength: c1Css.rawByteLength,
    rawByteOffset: c1Css.rawByteOffset,
    firstNonNull: c1CssWithoutMapComment.search(/[^\0]/),
    cardIndex: c1CssWithoutMapComment.indexOf('.card')
  });
  assert(!c1CssWithoutMapComment.includes('rgb(255, 0, 0)'), 'Vite C1 Lightning CSS did not normalize color syntax');
  assert(!c1CssWithoutMapComment.includes('0px 0px 0px 0px'), 'Vite C1 Lightning CSS did not minify zero margin syntax');
  assert(!/\.card\s+\{/.test(c1CssWithoutMapComment), 'Vite C1 Lightning CSS retained unminified selector spacing');
  assert(c1Js?.content.includes('OpenContainer Vite C1 Config V1'), 'Vite C1 TypeScript config plugin did not execute');
  assert(JSON.parse(c1Map?.content ?? '{}').version === 3, 'Vite C1 source map is invalid');
  assert(c1Svg?.content.includes('<svg'), 'Vite C1 imported asset was not emitted');
  const c1Manifest = JSON.parse(c1ManifestEntry?.content ?? '{}');
  assert(Object.keys(c1Manifest).length >= 1, 'Vite C1 manifest is empty');
  assert(viteBuildExecution.exports.sourceEditPersisted === true, 'Vite C1 source edit did not persist in canonical VFS');
  assert(viteBuildExecution.exports.sourceEditObserved === true, 'Vite C1 second build did not observe source edit');
  assert(viteBuildExecution.exports.configReloadObserved === true, 'Vite C1 did not re-read edited TypeScript config');
  assert(viteBuildExecution.exports.expectedBuildFailureObserved === true, 'Vite C1 failure atomicity probe did not fail as expected');
  assert(viteBuildExecution.exports.sourceUnchangedAfterFailure === true, 'Vite C1 failed build mutated canonical source');
  assert(viteBuildExecution.exports.deterministicManifest === true, 'Vite C1 normalized manifest changed across identical builds');
  assert(viteBuildExecution.exports.repeatedOutputFiles === true, 'Vite C1 output filenames changed across identical builds');
  stage('vite-c1-build-pass', {
    outputCount: viteBuildExecution.exports.outputCount,
    outputFiles: viteBuildExecution.exports.outputFiles,
    cssBytes: c1Css.content.length,
    manifestEntries: Object.keys(c1Manifest).length,
    configPlugin: 'v1->v2',
    sourceRebuild: viteBuildExecution.exports.sourceEditObserved,
    configReload: viteBuildExecution.exports.configReloadObserved,
    failureAtomicity: viteBuildExecution.exports.sourceUnchangedAfterFailure,
    deterministicManifest: viteBuildExecution.exports.deterministicManifest
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
