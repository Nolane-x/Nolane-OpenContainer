import { OpenContainer } from '/packages/sdk/src/index.js';
import { BrowserEsmServiceWorkerBridge } from '/packages/package-env/src/browser-esm-edge.js';
import { PackageArtifactAuthority } from '/packages/package-env/src/index.js';
import { BrowserGuestWorkerAuthority } from '/packages/process/src/browser-guest-worker.js';
import { MemoryVFS, OpfsCheckpointAuthority } from '/packages/vfs/src/index.js';

const resultNode = document.getElementById('result');
const stages = [];
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
  runtime.packages.compile(c1Lock);
  const viteClosure = runtime.packages.selectDependencyClosure({ roots: ['vite'] });
  assert(viteClosure.locations.includes('node_modules/vite'), 'Vite missing from selected closure');
  assert(viteClosure.locations.includes('node_modules/rolldown'), 'Rolldown missing from selected closure');
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

  stage('vite-publication-graph-start');
  const viteNodeCompat = runtime.packages.createBrowserNodeCompat({
    cwd: '/workspace',
    env: { NODE_ENV: 'production' }
  });
  const vitePublication = runtime.packages.createNativeEsmPublication({
    baseURL,
    session: 'vite-c1-graph',
    builtinSource: viteNodeCompat.builtinSource
  });
  const viteEntryUrl = vitePublication.moduleURL('vite', '/workspace/src/vite-probe.mjs');
  const viteGraph = await vitePublication.graph(viteEntryUrl);
  assert(viteGraph.modules.length > 10, 'Vite publication graph unexpectedly small');
  stage('vite-publication-graph-pass', {
    modules: viteGraph.modules.length,
    entry: viteGraph.entryURL
  });

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
    stages
  }, null, 2);
});
