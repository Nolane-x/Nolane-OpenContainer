import { OpenContainer } from '/packages/sdk/src/index.js';
import { BrowserEsmServiceWorkerBridge } from '/packages/package-env/src/browser-esm-edge.js';
import { OpfsPackageContentStore, PackageArtifactAuthority } from '/packages/package-env/src/index.js';
import { BrowserGuestWorkerAuthority } from '/packages/process/src/browser-guest-worker.js';
import { BrowserStoragePolicy, MemoryVFS, OpfsCheckpointAuthority } from '/packages/vfs/src/index.js';
import { BrowserPreviewServiceWorkerBridge } from '/packages/preview/src/index.js';
import { ResourceGovernor } from '/packages/resources/src/index.js';

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
  const toolchainBridgeResponse = await fetch('/packages/toolchain/src/browser-vfs-bridge.js', { cache: 'no-store' });
  assert(toolchainBridgeResponse.ok, 'failed to load production browser toolchain VFS bridge');
  const toolchainBridgeSource = await toolchainBridgeResponse.text();
  assert(toolchainBridgeSource.includes('createBrowserToolchainVfsBridge'), 'browser toolchain VFS bridge export is missing');
  runtime.mount({
    'package.json': JSON.stringify({ name: 'browser-acceptance', type: 'module' }),
    'src/browser-toolchain-vfs-bridge.mjs': toolchainBridgeSource,
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

  stage('guest-isolation-start');
  const guestWorkerResponse = await fetch('/opencontainer-guest-worker.mjs', { cache: 'no-store' });
  assert(guestWorkerResponse.ok, 'strict guest Worker bootstrap response is unavailable');
  const guestWorkerCsp = guestWorkerResponse.headers.get('content-security-policy') ?? '';
  assert(guestWorkerResponse.headers.get('x-opencontainer-worker-profile') === 'strict', 'strict guest Worker response lost profile identity');
  assert(guestWorkerCsp.includes("default-src 'none'"), 'guest Worker CSP is missing default deny');
  assert(guestWorkerCsp.includes("script-src 'self' 'wasm-unsafe-eval'"), 'guest Worker CSP does not preserve self modules + WASM compilation');
  assert(guestWorkerCsp.includes("connect-src 'self'"), 'guest Worker CSP does not restrict connect authority to self');
  assert(!guestWorkerCsp.includes("'unsafe-eval'"), 'strict guest Worker CSP accidentally permits JavaScript eval');

  const toolchainWorkerResponse = await fetch('/opencontainer-toolchain-worker.mjs', { cache: 'no-store' });
  assert(toolchainWorkerResponse.ok, 'toolchain Worker bootstrap response is unavailable');
  const toolchainWorkerCsp = toolchainWorkerResponse.headers.get('content-security-policy') ?? '';
  assert(toolchainWorkerResponse.headers.get('x-opencontainer-worker-profile') === 'toolchain', 'toolchain Worker response lost profile identity');
  assert(toolchainWorkerCsp.includes("default-src 'none'"), 'toolchain Worker CSP is missing default deny');
  assert(toolchainWorkerCsp.includes("'wasm-unsafe-eval'"), 'toolchain Worker CSP lost WASM compilation');
  assert(toolchainWorkerCsp.includes("'unsafe-eval'"), 'toolchain Worker CSP did not opt in to Vite dynamic code generation');
  assert(toolchainWorkerCsp.includes("connect-src 'self'"), 'toolchain Worker CSP widened network authority beyond self');

  runtime.fs.beginTransaction().writeFile('src/guest-isolation.mjs', [
    "import { spawn } from 'node:child_process';",
    "import net from 'node:net';",
    "import tls from 'node:tls';",
    "import https from 'node:https';",
    "const codeOf = (fn) => { try { fn(); return 'ALLOWED'; } catch (error) { return error?.code ?? error?.name ?? 'ERROR'; } };",
    "const asyncCodeOf = async (fn) => { try { await fn(); return 'ALLOWED'; } catch (error) { return error?.code ?? error?.name ?? 'ERROR'; } };",
    "export const pageRealmHidden = typeof window === 'undefined' && typeof document === 'undefined' && typeof localStorage === 'undefined' && typeof sessionStorage === 'undefined';",
    "export const globalAliasIsGuest = globalThis.global === globalThis && self === globalThis;",
    "export const childProcessCode = codeOf(() => spawn('node', ['-e', 'process.exit(0)']));",
    "export const rawTcpCode = codeOf(() => net.connect(80, 'example.com'));",
    "export const tlsCode = codeOf(() => tls.connect(443, 'example.com'));",
    "export const httpsCode = codeOf(() => https.get('https://example.com/'));",
    "export const webSocketCode = codeOf(() => new WebSocket('wss://example.com/socket'));",
    "export const broadcastCode = typeof BroadcastChannel === 'function' ? codeOf(() => new BroadcastChannel('opencontainer-escape')) : 'ABSENT';",
    "export const nestedWorkerCode = codeOf(() => new Worker(import.meta.url, { type: 'module' }));",
    "export const unknownHostCode = codeOf(() => globalThis.__opencontainer_sync_host_call__('host.escape', {}));",
    "export const externalFetchCode = await asyncCodeOf(() => fetch('https://example.com/'));",
    "export const sameOriginBypassCode = await asyncCodeOf(() => fetch(location.origin + '/package-lock.json'));",
    "const internalResponse = await fetch(import.meta.url, { cache: 'no-store' });",
    "export const internalFetchStatus = internalResponse.status;",
    "export const internalFetchEdge = internalResponse.headers.get('x-opencontainer-edge');",
    "export const opfsCode = navigator.storage?.getDirectory ? await asyncCodeOf(() => navigator.storage.getDirectory()) : 'ABSENT';",
    "export const locksCode = navigator.locks?.request ? await asyncCodeOf(() => navigator.locks.request('guest-escape', () => true)) : 'ABSENT';",
    "export const indexedDbCode = typeof indexedDB !== 'undefined' ? codeOf(() => indexedDB.open('guest-escape')) : 'ABSENT';",
    "export const cacheStorageCode = typeof caches !== 'undefined' ? await asyncCodeOf(() => caches.open('guest-escape')) : 'ABSENT';",
    "export const evalCode = codeOf(() => eval('1 + 1'));",
    "export const functionCtorCode = codeOf(() => Function('return 1')());"
  ].join('\n')).commit();

  runtime.fs.beginTransaction().writeFile(
    'src/guest-runaway.mjs',
    "while (true) {}\nexport const unreachable = true;"
  ).commit();

  runtime.fs.beginTransaction().writeFile('src/guest-export-budget.mjs', [
    "export const oversizedText = 'x'.repeat(256 * 1024);",
    "export const oversizedBytes = new Uint8Array(96 * 1024);",
    "export const small = 'ok';"
  ].join('\n')).commit();

  const securityPublication = runtime.packages.createNativeEsmPublication({
    baseURL,
    session: 'browser-security-isolation',
    builtinSource: nodeCompat.builtinSource
  });
  const securityBridge = new BrowserEsmServiceWorkerBridge({ publication: securityPublication });
  await securityBridge.start();
  const securityWorker = new BrowserGuestWorkerAuthority({
    publication: securityPublication,
    diagnostics: runtime.diagnostics,
    syncRequestHandler: nodeCompat.syncRequestHandler,
    requestTimeoutMs: 30000
  });
  securityWorker.start();
  const securityEntry = securityPublication.moduleURL('./guest-isolation.mjs', '/workspace/src/entry.mjs').href;
  const isolation = await securityWorker.execute(securityEntry, {
    exportNames: [
      'pageRealmHidden',
      'globalAliasIsGuest',
      'childProcessCode',
      'rawTcpCode',
      'tlsCode',
      'httpsCode',
      'webSocketCode',
      'broadcastCode',
      'nestedWorkerCode',
      'unknownHostCode',
      'externalFetchCode',
      'sameOriginBypassCode',
      'internalFetchStatus',
      'internalFetchEdge',
      'opfsCode',
      'locksCode',
      'indexedDbCode',
      'cacheStorageCode',
      'evalCode',
      'functionCtorCode'
    ]
  });

  assert(isolation.exports.pageRealmHidden === true, 'guest Worker leaked page DOM/storage globals');
  assert(isolation.exports.globalAliasIsGuest === true, 'guest global alias escaped the isolated Worker realm');
  for (const [name, value] of Object.entries({
    childProcessCode: isolation.exports.childProcessCode,
    rawTcpCode: isolation.exports.rawTcpCode,
    tlsCode: isolation.exports.tlsCode,
    httpsCode: isolation.exports.httpsCode,
    unknownHostCode: isolation.exports.unknownHostCode,
    opfsCode: isolation.exports.opfsCode,
    locksCode: isolation.exports.locksCode,
    indexedDbCode: isolation.exports.indexedDbCode,
    cacheStorageCode: isolation.exports.cacheStorageCode
  })) {
    assert(value === 'OC_BUILTIN_UNAVAILABLE', name + ' did not fail closed: ' + value);
  }
  for (const [name, value] of Object.entries({
    webSocketCode: isolation.exports.webSocketCode,
    nestedWorkerCode: isolation.exports.nestedWorkerCode,
    externalFetchCode: isolation.exports.externalFetchCode,
    sameOriginBypassCode: isolation.exports.sameOriginBypassCode
  })) {
    assert(value === 'OC_NETWORK_DENIED', name + ' bypassed guest network authority: ' + value);
  }
  assert(
    isolation.exports.broadcastCode === 'OC_NETWORK_DENIED' || isolation.exports.broadcastCode === 'ABSENT',
    'BroadcastChannel escaped guest isolation: ' + isolation.exports.broadcastCode
  );
  assert(isolation.exports.internalFetchStatus === 200, 'guest membrane blocked its own authoritative publication resource');
  assert(isolation.exports.internalFetchEdge === 'service-worker', 'guest internal fetch escaped the publication service-worker edge');
  assert(isolation.exports.evalCode === 'EvalError', 'guest CSP did not block direct eval: ' + isolation.exports.evalCode);
  assert(isolation.exports.functionCtorCode === 'EvalError', 'guest CSP did not block Function constructor: ' + isolation.exports.functionCtorCode);
  assert(isolation.workerCrossOriginIsolated === true, 'security court guest lost cross-origin isolation');
  stage('guest-csp-pass', {
    strictPolicy: guestWorkerCsp,
    toolchainPolicy: toolchainWorkerCsp,
    strictEval: isolation.exports.evalCode,
    strictFunctionConstructor: isolation.exports.functionCtorCode,
    profilesSeparated: true
  });

  stage('guest-runaway-timeout-start');
  const runawayWorker = new BrowserGuestWorkerAuthority({
    publication: securityPublication,
    diagnostics: runtime.diagnostics,
    syncRequestHandler: nodeCompat.syncRequestHandler,
    requestTimeoutMs: 250
  });
  const runawayEntry = securityPublication.moduleURL('./guest-runaway.mjs', '/workspace/src/entry.mjs').href;
  let runawayCode = 'ALLOWED';
  try {
    await runawayWorker.execute(runawayEntry, { exportNames: ['unreachable'] });
  } catch (error) {
    runawayCode = error?.code ?? error?.name ?? 'ERROR';
  }
  assert(runawayCode === 'OC_WORKER_TIMEOUT', 'runaway guest did not hit the hard execution deadline: ' + runawayCode);
  assert(runawayWorker.identity === null, 'timed-out guest realm remained attached after deadline');

  const recoveredAfterRunaway = await runawayWorker.execute(securityEntry, {
    exportNames: ['pageRealmHidden']
  });
  assert(recoveredAfterRunaway.exports.pageRealmHidden === true, 'guest authority did not recover on a fresh realm after hard timeout');
  runawayWorker.close();

  stage('guest-runaway-timeout-pass', {
    timeoutCode: runawayCode,
    hardTerminated: true,
    recoveredOnFreshRealm: recoveredAfterRunaway.exports.pageRealmHidden === true
  });

  stage('guest-worker-quota-start');
  const workerQuota = new ResourceGovernor({ workers: 1 });
  const quotaWorkerA = new BrowserGuestWorkerAuthority({
    publication: securityPublication,
    diagnostics: runtime.diagnostics,
    syncRequestHandler: nodeCompat.syncRequestHandler,
    requestTimeoutMs: 30000,
    resources: workerQuota
  });
  const quotaWorkerB = new BrowserGuestWorkerAuthority({
    publication: securityPublication,
    diagnostics: runtime.diagnostics,
    syncRequestHandler: nodeCompat.syncRequestHandler,
    requestTimeoutMs: 30000,
    resources: workerQuota
  });
  quotaWorkerA.start();
  assert(workerQuota.usage.workers === 1, 'first guest Worker did not reserve resource quota');
  let quotaRejectCode = 'ALLOWED';
  try {
    quotaWorkerB.start();
  } catch (error) {
    quotaRejectCode = error?.code ?? error?.name ?? 'ERROR';
  }
  assert(quotaRejectCode === 'OC_RESOURCE_EXHAUSTED', 'second guest Worker bypassed worker quota: ' + quotaRejectCode);
  assert(workerQuota.usage.workers === 1, 'failed guest Worker spawn corrupted quota usage');

  quotaWorkerA.close();
  assert(workerQuota.usage.workers === 0, 'closing guest Worker did not release worker quota');
  quotaWorkerB.start();
  assert(workerQuota.usage.workers === 1, 'released worker quota could not be reacquired');
  const quotaRecovered = await quotaWorkerB.execute(securityEntry, { exportNames: ['pageRealmHidden'] });
  assert(quotaRecovered.exports.pageRealmHidden === true, 'quota-recovered guest Worker did not execute in isolated realm');
  quotaWorkerB.close();
  assert(workerQuota.usage.workers === 0, 'final guest Worker close leaked worker quota');

  stage('guest-worker-quota-pass', {
    limit: workerQuota.limits.workers,
    rejectedCode: quotaRejectCode,
    releasedAfterClose: workerQuota.usage.workers === 0,
    recoveredAfterRelease: quotaRecovered.exports.pageRealmHidden === true
  });

  stage('guest-export-budget-start');
  const exportBudgetWorker = new BrowserGuestWorkerAuthority({
    publication: securityPublication,
    diagnostics: runtime.diagnostics,
    syncRequestHandler: nodeCompat.syncRequestHandler,
    requestTimeoutMs: 30000,
    maxExportBytes: 64 * 1024
  });
  const exportBudgetEntry = securityPublication.moduleURL('./guest-export-budget.mjs', '/workspace/src/entry.mjs').href;

  const exportFailureCodes = [];
  for (const exportName of ['oversizedText', 'oversizedBytes']) {
    try {
      await exportBudgetWorker.execute(exportBudgetEntry, { exportNames: [exportName] });
      exportFailureCodes.push('ALLOWED');
    } catch (error) {
      exportFailureCodes.push(error?.code ?? error?.name ?? 'ERROR');
    }
  }
  assert(
    exportFailureCodes.every((code) => code === 'OC_OUTPUT_LIMIT'),
    'oversized guest export escaped output budget: ' + exportFailureCodes.join(',')
  );
  assert(exportBudgetWorker.identity !== null, 'output-limit rejection unnecessarily destroyed the bounded guest realm');

  const smallExport = await exportBudgetWorker.execute(exportBudgetEntry, { exportNames: ['small'] });
  assert(smallExport.exports.small === 'ok', 'guest export budget blocked a bounded response');
  assert(
    Number.isFinite(smallExport.exportBytes) && smallExport.exportBytes > 0 && smallExport.exportBytes < exportBudgetWorker.maxExportBytes,
    'guest export receipt did not report bounded byte usage'
  );
  exportBudgetWorker.close();

  stage('guest-export-budget-pass', {
    limit: 64 * 1024,
    oversizedText: exportFailureCodes[0],
    oversizedBytes: exportFailureCodes[1],
    boundedExportBytes: smallExport.exportBytes,
    boundedExportRecovered: smallExport.exports.small === 'ok'
  });

  securityWorker.close();
  securityBridge.close();

  stage('guest-isolation-pass', {
    pageRealmHidden: isolation.exports.pageRealmHidden,
    childProcess: isolation.exports.childProcessCode,
    rawTcp: isolation.exports.rawTcpCode,
    tls: isolation.exports.tlsCode,
    https: isolation.exports.httpsCode,
    externalFetch: isolation.exports.externalFetchCode,
    sameOriginBypass: isolation.exports.sameOriginBypassCode,
    webSocket: isolation.exports.webSocketCode,
    broadcast: isolation.exports.broadcastCode,
    nestedWorker: isolation.exports.nestedWorkerCode,
    opfs: isolation.exports.opfsCode,
    webLocks: isolation.exports.locksCode,
    indexedDb: isolation.exports.indexedDbCode,
    cacheStorage: isolation.exports.cacheStorageCode,
    eval: isolation.exports.evalCode,
    functionConstructor: isolation.exports.functionCtorCode,
    unknownHostRpc: isolation.exports.unknownHostCode,
    internalPublicationFetch: isolation.exports.internalFetchStatus,
    workerCrossOriginIsolated: isolation.workerCrossOriginIsolated
  });

  stage('opfs-real-start');
  assert(navigator.storage?.getDirectory, 'OPFS API is unavailable');
  const opfsRoot = await navigator.storage.getDirectory();
  const opfsDirectory = 'opencontainer-browser-acceptance-' + crypto.randomUUID();
  try {
    assert(navigator.locks?.request, 'Web Locks API is unavailable');
    const storagePolicy = new BrowserStoragePolicy({ storageManager: navigator.storage });
    const storageBefore = await storagePolicy.inspect();
    assert(storageBefore.supported === true, 'browser storage policy did not bind StorageManager');
    assert(Number.isFinite(storageBefore.usageBytes), 'browser storage usage estimate is unavailable');
    assert(Number.isFinite(storageBefore.quotaBytes) && storageBefore.quotaBytes > 0, 'browser storage quota estimate is unavailable');
    const persistenceReceipt = await storagePolicy.requestPersistence();
    assert(typeof persistenceReceipt.granted === 'boolean', 'browser persistence request did not return a boolean receipt');

    const opfsFs = new MemoryVFS();
    opfsFs.mount({ 'value.txt': 'first' });
    const firstSnapshot = opfsFs.snapshot();
    const opfs = await new OpfsCheckpointAuthority({
      root: opfsRoot,
      directoryName: opfsDirectory,
      lockManager: navigator.locks,
      storagePolicy
    }).open();
    assert(opfs.crossContextLocking === true, 'OPFS authority did not enable cross-context locking');
    const firstCheckpoint = await opfs.checkpoint(opfsFs);

    const peer = await new OpfsCheckpointAuthority({
      root: opfsRoot,
      directoryName: opfsDirectory,
      lockManager: navigator.locks
    }).open();
    assert(peer.current?.sequence === firstCheckpoint.sequence, 'OPFS peer did not observe the first checkpoint');

    opfsFs.beginTransaction().writeFile('value.txt', 'second').commit();
    const secondCheckpoint = await opfs.checkpoint(opfsFs);
    assert(secondCheckpoint.sequence === firstCheckpoint.sequence + 1, 'OPFS manifest sequence did not advance');

    let stalePeerRejected = false;
    try {
      await peer.checkpoint(firstSnapshot);
    } catch (error) {
      stalePeerRejected = error?.code === 'OC_STALE_GENERATION';
    }
    assert(stalePeerRejected, 'OPFS stale cross-context writer was not rejected');

    const peerRestore = new MemoryVFS();
    await peer.restoreInto(peerRestore);
    assert(peerRestore.readFile('value.txt') === 'second', 'OPFS peer restore did not refresh to the latest shared checkpoint');
    assert(peer.current?.sequence === secondCheckpoint.sequence, 'OPFS peer receipt did not refresh after restore');

    opfsFs.beginTransaction().writeFile('value.txt', 'third').commit();
    const thirdCheckpoint = await opfs.checkpoint(opfsFs);
    assert(thirdCheckpoint.sequence === secondCheckpoint.sequence + 1, 'OPFS third manifest sequence did not advance');

    const workspace = await opfsRoot.getDirectoryHandle(opfsDirectory);
    const generations = await workspace.getDirectoryHandle('generations');
    const orphanName = 'generation-crash-orphan.json';
    const orphanHandle = await generations.getFileHandle(orphanName, { create: true });
    const orphanWriter = await orphanHandle.createWritable();
    await orphanWriter.write('{"orphan":true}');
    await orphanWriter.close();

    const gcDryRun = await opfs.collectGarbage({ dryRun: true });
    assert(gcDryRun.removed.includes(firstCheckpoint.payload), 'OPFS GC dry run did not find superseded payload');
    assert(gcDryRun.removed.includes(orphanName), 'OPFS GC dry run did not find crash orphan');
    assert(gcDryRun.retained.includes(secondCheckpoint.payload), 'OPFS GC dry run did not preserve fallback payload');
    assert(gcDryRun.retained.includes(thirdCheckpoint.payload), 'OPFS GC dry run did not preserve current payload');

    const gcReceipt = await opfs.collectGarbage();
    assert(gcReceipt.removed.includes(firstCheckpoint.payload), 'OPFS GC did not remove superseded payload');
    assert(gcReceipt.removed.includes(orphanName), 'OPFS GC did not remove crash orphan');

    let removedSuperseded = false;
    try {
      await generations.getFileHandle(firstCheckpoint.payload);
    } catch (error) {
      removedSuperseded = error?.name === 'NotFoundError';
    }
    assert(removedSuperseded, 'OPFS GC superseded payload is still reachable');

    let removedOrphan = false;
    try {
      await generations.getFileHandle(orphanName);
    } catch (error) {
      removedOrphan = error?.name === 'NotFoundError';
    }
    assert(removedOrphan, 'OPFS GC crash orphan is still reachable');

    const quotaOrphanName = 'generation-quota-pressure-orphan.json';
    const quotaOrphan = await generations.getFileHandle(quotaOrphanName, { create: true });
    const quotaOrphanWriter = await quotaOrphan.createWritable();
    await quotaOrphanWriter.write('{"quotaOrphan":true}');
    await quotaOrphanWriter.close();

    const quotaEstimates = [
      { usage: 9990, quota: 10_000 },
      { usage: 100, quota: 10_000 }
    ];
    let quotaEstimateIndex = 0;
    const quotaRetryPolicy = new BrowserStoragePolicy({
      storageManager: {
        async estimate() {
          const index = Math.min(quotaEstimateIndex++, quotaEstimates.length - 1);
          return quotaEstimates[index];
        },
        async persisted() { return true; }
      },
      criticalRatio: 0.95
    });
    const quotaAuthority = await new OpfsCheckpointAuthority({
      root: opfsRoot,
      directoryName: opfsDirectory,
      lockManager: navigator.locks,
      storagePolicy: quotaRetryPolicy
    }).open();

    opfsFs.beginTransaction().writeFile('value.txt', 'fourth').commit();
    const fourthCheckpoint = await quotaAuthority.checkpoint(opfsFs);
    assert(fourthCheckpoint.sequence === thirdCheckpoint.sequence + 1, 'OPFS quota retry did not publish after garbage collection');
    assert(quotaAuthority.lastStorageGuard?.gcAttempted === true, 'OPFS quota retry did not run garbage collection');
    assert(quotaAuthority.lastStorageGuard?.gcRemoved?.includes(quotaOrphanName), 'OPFS quota retry did not remove the pressure orphan');

    let quotaOrphanRemoved = false;
    try {
      await generations.getFileHandle(quotaOrphanName);
    } catch (error) {
      quotaOrphanRemoved = error?.name === 'NotFoundError';
    }
    assert(quotaOrphanRemoved, 'OPFS quota retry left the pressure orphan reachable');

    const quotaRejectPolicy = new BrowserStoragePolicy({
      storageManager: {
        async estimate() { return { usage: 9990, quota: 10_000 }; },
        async persisted() { return true; }
      },
      criticalRatio: 0.95
    });
    const quotaRejectAuthority = await new OpfsCheckpointAuthority({
      root: opfsRoot,
      directoryName: opfsDirectory,
      lockManager: navigator.locks,
      storagePolicy: quotaRejectPolicy
    }).open();

    opfsFs.beginTransaction().writeFile('value.txt', 'fifth-blocked').commit();
    let quotaRejected = false;
    try {
      await quotaRejectAuthority.checkpoint(opfsFs);
    } catch (error) {
      quotaRejected = error?.code === 'OC_RESOURCE_EXHAUSTED';
    }
    assert(quotaRejected, 'OPFS persistent quota pressure did not fail closed');
    assert(quotaRejectAuthority.current?.sequence === fourthCheckpoint.sequence, 'OPFS quota rejection advanced the committed manifest');
    assert(quotaRejectAuthority.lastStorageGuard?.rejected === true, 'OPFS quota rejection receipt was not retained');

    stage('opfs-quota-guard-pass', {
      successfulSequence: fourthCheckpoint.sequence,
      gcRetried: quotaAuthority.lastStorageGuard.gcAttempted,
      gcRemoved: quotaAuthority.lastStorageGuard.gcRemoved.length,
      quotaOrphanRemoved,
      rejected: quotaRejected,
      rejectedSequenceStayedAt: quotaRejectAuthority.current.sequence
    });

    const newestPayload = await generations.getFileHandle(fourthCheckpoint.payload);
    const corrupt = await newestPayload.createWritable();
    await corrupt.write('{"corrupt":true}');
    await corrupt.close();

    const reopened = await new OpfsCheckpointAuthority({
      root: opfsRoot,
      directoryName: opfsDirectory
    }).open();
    assert(reopened.current?.sequence === thirdCheckpoint.sequence, 'OPFS did not preserve fallback recovery root after quota guarding');

    const restored = new MemoryVFS();
    await reopened.restoreInto(restored);
    assert(restored.readFile('value.txt') === 'third', 'OPFS recovery restored the wrong generation after quota guarding');

    stage('opfs-real-pass', {
      firstSequence: firstCheckpoint.sequence,
      rejectedSequence: secondCheckpoint.sequence,
      collectedSequence: thirdCheckpoint.sequence,
      quotaCheckpointSequence: fourthCheckpoint.sequence,
      recoveredSequence: reopened.current.sequence,
      crossContextLocking: true,
      stalePeerRejected,
      peerRefreshSequence: peer.current.sequence,
      gcRemoved: gcReceipt.removed.length,
      gcRetained: gcReceipt.retained.length,
      gcSupersededRemoved: removedSuperseded,
      gcOrphanRemoved: removedOrphan,
      quotaGcRetried: quotaAuthority.lastStorageGuard.gcAttempted,
      quotaRejected,
      quotaOrphanRemoved,
      storageUsageBytes: storageBefore.usageBytes,
      storageQuotaBytes: storageBefore.quotaBytes,
      storagePressure: storageBefore.pressure,
      storagePersistedBefore: storageBefore.persisted,
      storagePersistenceRequested: persistenceReceipt.requested,
      storagePersistenceGranted: persistenceReceipt.granted
    });
  } finally {
    await opfsRoot.removeEntry(opfsDirectory, { recursive: true });
  }

  stage('sdk-workspace-persistence-start');
  const sdkWorkspaceDirectory = 'opencontainer-sdk-workspace-' + crypto.randomUUID();
  try {
    const workspaceProfile = {
      root: opfsRoot,
      directoryName: sdkWorkspaceDirectory,
      lockManager: navigator.locks,
      storagePolicy: new BrowserStoragePolicy({ storageManager: navigator.storage })
    };

    const persistentRuntimeA = await OpenContainer.boot({ workspacePersistence: workspaceProfile });
    persistentRuntimeA.mount({ 'persisted.txt': 'workspace-one' });
    const sdkFirst = await persistentRuntimeA.persistWorkspace();
    persistentRuntimeA.fs.beginTransaction().writeFile('persisted.txt', 'workspace-two').commit();
    const sdkSecond = await persistentRuntimeA.persistWorkspace();
    assert(sdkSecond.sequence === sdkFirst.sequence + 1, 'SDK workspace checkpoint sequence did not advance');
    assert(sdkSecond.generation === persistentRuntimeA.fs.generation, 'SDK workspace checkpoint generation diverged before reopen');
    await persistentRuntimeA.terminate();

    const persistentRuntimeB = await OpenContainer.boot({ workspacePersistence: workspaceProfile });
    assert(persistentRuntimeB.fs.readFile('persisted.txt') === 'workspace-two', 'SDK OPFS boot did not restore workspace content');
    assert(persistentRuntimeB.fs.generation === sdkSecond.generation, 'SDK OPFS boot did not preserve persisted VFS generation');
    assert(persistentRuntimeB.workspacePersistence?.current?.sequence === sdkSecond.sequence, 'SDK OPFS boot did not expose current persistence receipt');
    assert(persistentRuntimeB.workspacePersistence?.crossContextLocking === true, 'SDK OPFS product profile lost Web Locks coordination');

    persistentRuntimeB.fs.beginTransaction().writeFile('persisted.txt', 'workspace-three').commit();
    const sdkThird = await persistentRuntimeB.persistWorkspace();
    assert(sdkThird.sequence === sdkSecond.sequence + 1, 'SDK OPFS reopen could not continue checkpoint sequence');
    assert(sdkThird.generation === sdkSecond.generation + 1, 'SDK OPFS reopen could not continue workspace generation');

    const sdkGc = await persistentRuntimeB.collectWorkspaceGarbage();
    assert(sdkGc.removed.includes(sdkFirst.payload), 'SDK workspace GC did not collect superseded payload');
    assert(sdkGc.retained.includes(sdkSecond.payload) && sdkGc.retained.includes(sdkThird.payload), 'SDK workspace GC weakened two-slot recovery roots');
    await persistentRuntimeB.terminate();

    const persistentRuntimeC = await OpenContainer.boot({ workspacePersistence: workspaceProfile });
    assert(persistentRuntimeC.fs.readFile('persisted.txt') === 'workspace-three', 'SDK OPFS second reopen restored the wrong workspace generation');
    assert(persistentRuntimeC.fs.generation === sdkThird.generation, 'SDK OPFS second reopen generation drifted');
    await persistentRuntimeC.terminate();

    const sdkWorkspaceRoot = await opfsRoot.getDirectoryHandle(sdkWorkspaceDirectory);
    const sdkGenerations = await sdkWorkspaceRoot.getDirectoryHandle('generations');
    const sdkNewestPayload = await sdkGenerations.getFileHandle(sdkThird.payload);
    const sdkCorruptWriter = await sdkNewestPayload.createWritable();
    await sdkCorruptWriter.write('{"corrupt":true}');
    await sdkCorruptWriter.close();

    const persistentRuntimeD = await OpenContainer.boot({ workspacePersistence: workspaceProfile });
    assert(persistentRuntimeD.fs.readFile('persisted.txt') === 'workspace-two', 'SDK corruption fallback did not restore the older valid workspace');
    assert(persistentRuntimeD.fs.generation === sdkSecond.generation, 'SDK corruption fallback restored the wrong generation');
    assert(persistentRuntimeD.workspacePersistence?.current?.sequence === sdkSecond.sequence, 'SDK corruption fallback retained the corrupt newest receipt');

    persistentRuntimeD.fs.beginTransaction().writeFile('persisted.txt', 'workspace-recovered').commit();
    const sdkRecovered = await persistentRuntimeD.persistWorkspace();
    assert(sdkRecovered.sequence === sdkSecond.sequence + 1, 'SDK corruption recovery could not continue checkpoint sequence');
    assert(sdkRecovered.generation === sdkSecond.generation + 1, 'SDK corruption recovery could not continue workspace generation');
    assert(sdkRecovered.payload !== sdkThird.payload, 'SDK corruption recovery reused the corrupt payload identity');
    const sdkRecoveryGc = await persistentRuntimeD.collectWorkspaceGarbage();
    assert(sdkRecoveryGc.removed.includes(sdkThird.payload), 'SDK corruption recovery did not collect the superseded corrupt payload');
    await persistentRuntimeD.terminate();

    const persistentRuntimeE = await OpenContainer.boot({ workspacePersistence: workspaceProfile });
    assert(persistentRuntimeE.fs.readFile('persisted.txt') === 'workspace-recovered', 'SDK corruption recovery republish did not survive reopen');
    assert(persistentRuntimeE.workspacePersistence?.current?.payload === sdkRecovered.payload, 'SDK corruption recovery reopened the wrong payload');
    await persistentRuntimeE.terminate();

    stage('sdk-workspace-corruption-recovery-pass', {
      fallbackSequence: sdkSecond.sequence,
      corruptSequence: sdkThird.sequence,
      recoveredSequence: sdkRecovered.sequence,
      fallbackGeneration: sdkSecond.generation,
      recoveredGeneration: sdkRecovered.generation,
      corruptPayloadCollected: sdkRecoveryGc.removed.includes(sdkThird.payload)
    });

    stage('sdk-workspace-persistence-pass', {
      firstSequence: sdkFirst.sequence,
      secondSequence: sdkSecond.sequence,
      thirdSequence: sdkThird.sequence,
      reopenedGeneration: sdkThird.generation,
      gcRemoved: sdkGc.removed.length,
      gcRetained: sdkGc.retained.length,
      crossContextLocking: true
    });
  } finally {
    await opfsRoot.removeEntry(sdkWorkspaceDirectory, { recursive: true });
  }

  stage('browser-package-install-start');
  const lightningIntegrity = 'sha512-OLAtqEyInBSVWjPrTjpLzcZUMUHO0q+2PFBXKr86nxZOu0P38givj/ZMtRaZ0d38pMTb9wQx+LtaLtHclv+sEA==';
  const lightningUrl = location.origin + '/toolchain/vendor/lightningcss-wasm-1.33.0.tgz';
  runtime.net.allow({
    origin: location.origin,
    methods: ['GET'],
    paths: ['/toolchain/vendor/']
  });
  const browserPackageLockfile = {
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
  };
  runtime.packages.compile(browserPackageLockfile);

  const artifactAuthority = new PackageArtifactAuthority({
    fs: runtime.fs,
    network: runtime.net,
    maxArtifactBytes: 8 * 1024 * 1024,
    maxUnpackedBytes: 64 * 1024 * 1024
  });
  const packageCacheDirectory = 'opencontainer-package-cache-' + crypto.randomUUID();
  const packageDedupeDirectory = packageCacheDirectory + '-dedupe';
  let capturedPackageArtifact = null;
  try {
    const persistentContent = await new OpfsPackageContentStore({
      root: opfsRoot,
      directoryName: packageCacheDirectory,
      lockManager: navigator.locks
    }).open();
    const frozenInstaller = runtime.packages.createFrozenInstaller({ contentStore: persistentContent });
    const installReceipt = await frozenInstaller.installAll({
      artifactAuthority: {
        async fetchArtifact(options) {
          const artifact = await artifactAuthority.fetchArtifact(options);
          capturedPackageArtifact = new Uint8Array(artifact.bytes);
          return artifact;
        }
      },
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

    stage('sdk-package-persistence-start');
    const packageProductRuntime = await OpenContainer.boot({
      packagePersistence: {
        root: opfsRoot,
        directoryName: packageCacheDirectory,
        lockManager: navigator.locks
      }
    });
    packageProductRuntime.packages.compile(browserPackageLockfile);
    assert(packageProductRuntime.packageContentStore?.crossContextLocking === true, 'SDK package persistence profile lost Web Locks coordination');
    const sdkPackageInstaller = packageProductRuntime.packages.createFrozenInstaller();
    assert(sdkPackageInstaller.contentStore === packageProductRuntime.packageContentStore, 'SDK frozen installer did not inherit the persistent package store');

    let sdkPackageNetworkFetches = 0;
    const sdkPackageReceipt = await sdkPackageInstaller.installAll({
      artifactAuthority: {
        async fetchArtifact() {
          sdkPackageNetworkFetches++;
          throw new Error('SDK persistent package profile unexpectedly reached the network');
        }
      },
      concurrency: 2
    });
    assert(sdkPackageNetworkFetches === 0, 'SDK persistent package profile reached the network after reopen');
    assert(sdkPackageReceipt.requestedContents === 0 && sdkPackageReceipt.fetchedContents === 0, 'SDK persistent package profile did not hydrate from OPFS');
    assert(packageProductRuntime.packageContentStore.hydratedCount === 1, 'SDK persistent package profile did not hydrate exactly one frozen content');
    const sdkPackageMounted = sdkPackageInstaller.mountFrozenGraph();
    const sdkPackageJson = JSON.parse(
      packageProductRuntime.packages.nodeModules.readFile('/workspace/node_modules/lightningcss-wasm/package.json')
    );
    assert(sdkPackageJson.name === 'lightningcss-wasm' && sdkPackageJson.version === '1.33.0', 'SDK persistent package profile lost package identity');
    stage('sdk-package-persistence-pass', {
      networkFetches: sdkPackageNetworkFetches,
      requestedContents: sdkPackageReceipt.requestedContents,
      hydratedContents: packageProductRuntime.packageContentStore.hydratedCount,
      mountedPackages: sdkPackageMounted.packageCount,
      crossContextLocking: packageProductRuntime.packageContentStore.crossContextLocking
    });
    await packageProductRuntime.terminate();

    const reopenedContent = await new OpfsPackageContentStore({
      root: opfsRoot,
      directoryName: packageCacheDirectory,
      lockManager: navigator.locks
    }).open();
    assert(reopenedContent.hydratedCount === 0, 'OPFS package cache hydrated before frozen graph authority was supplied');
    assert(reopenedContent.corruptCount === 0, 'OPFS package cache unexpectedly reported corruption before hydration');
    let secondNetworkFetches = 0;
    const reopenedInstaller = runtime.packages.createFrozenInstaller({ contentStore: reopenedContent });
    const reopenedReceipt = await reopenedInstaller.installAll({
      artifactAuthority: {
        async fetchArtifact() {
          secondNetworkFetches++;
          throw new Error('OPFS package cache unexpectedly required a second network fetch');
        }
      },
      concurrency: 2
    });
    assert(reopenedReceipt.requestedContents === 0, 'OPFS package cache did not satisfy frozen install from persisted content');
    assert(reopenedReceipt.fetchedContents === 0, 'OPFS package cache performed a second content fetch');
    assert(secondNetworkFetches === 0, 'OPFS package cache reached the network after reopen');
    assert(reopenedContent.hydratedCount === 1, 'frozen graph authority did not hydrate the persisted package');
    assert(reopenedContent.corruptCount === 0, 'lockfile-authoritative package cache hydration reported corruption');
    const reopenedMounted = reopenedInstaller.mountFrozenGraph();
    const reopenedPackageJson = JSON.parse(
      runtime.packages.nodeModules.readFile('/workspace/node_modules/lightningcss-wasm/package.json')
    );
    assert(reopenedPackageJson.name === 'lightningcss-wasm' && reopenedPackageJson.version === '1.33.0', 'reopened OPFS package content lost package identity');

    assert(capturedPackageArtifact instanceof Uint8Array && capturedPackageArtifact.byteLength > 0, 'browser package install did not retain verified artifact bytes for dedupe court');
    const lightningNode = runtime.packages.graph.nodes.find((node) => node.location === 'node_modules/lightningcss-wasm');
    assert(lightningNode?.contentId, 'browser package graph did not expose immutable content identity');

    const packageCacheRoot = await opfsRoot.getDirectoryHandle(packageCacheDirectory);
    await packageCacheRoot.removeEntry(encodeURIComponent(lightningNode.contentId), { recursive: true });

    const evictedContent = await new OpfsPackageContentStore({
      root: opfsRoot,
      directoryName: packageCacheDirectory,
      lockManager: navigator.locks
    }).open();
    let evictionNetworkFetches = 0;
    const evictedInstaller = runtime.packages.createFrozenInstaller({ contentStore: evictedContent });
    const evictedReceipt = await evictedInstaller.installAll({
      artifactAuthority: {
        async fetchArtifact(options) {
          evictionNetworkFetches++;
          return artifactAuthority.fetchArtifact(options);
        }
      },
      concurrency: 2
    });
    assert(evictionNetworkFetches === 1, 'forced package cache eviction did not refetch exactly once');
    assert(evictedReceipt.requestedContents === 1 && evictedReceipt.fetchedContents === 1, 'forced package cache eviction did not repopulate one immutable content artifact');
    const evictedMounted = evictedInstaller.mountFrozenGraph();
    const evictedPackageJson = JSON.parse(
      runtime.packages.nodeModules.readFile('/workspace/node_modules/lightningcss-wasm/package.json')
    );
    assert(evictedPackageJson.name === 'lightningcss-wasm' && evictedPackageJson.version === '1.33.0', 'forced package cache eviction recovery lost package identity');

    const recoveredContent = await new OpfsPackageContentStore({
      root: opfsRoot,
      directoryName: packageCacheDirectory,
      lockManager: navigator.locks
    }).open();
    let recoveredNetworkFetches = 0;
    const recoveredInstaller = runtime.packages.createFrozenInstaller({ contentStore: recoveredContent });
    const recoveredReceipt = await recoveredInstaller.installAll({
      artifactAuthority: {
        async fetchArtifact() {
          recoveredNetworkFetches++;
          throw new Error('recovered package cache unexpectedly required another network fetch');
        }
      },
      concurrency: 2
    });
    assert(recoveredReceipt.requestedContents === 0 && recoveredReceipt.fetchedContents === 0, 'repopulated package cache did not satisfy the next reopen');
    assert(recoveredNetworkFetches === 0, 'repopulated package cache reached the network on the next reopen');
    assert(recoveredContent.hydratedCount === 1 && recoveredContent.corruptCount === 0, 'repopulated package cache did not hydrate cleanly after eviction');
    const recoveredMounted = recoveredInstaller.mountFrozenGraph();
    const recoveredPackageJson = JSON.parse(
      runtime.packages.nodeModules.readFile('/workspace/node_modules/lightningcss-wasm/package.json')
    );
    assert(recoveredPackageJson.name === 'lightningcss-wasm' && recoveredPackageJson.version === '1.33.0', 'post-eviction zero-network reopen lost package identity');

    stage('browser-package-eviction-recovery-pass', {
      contentId: lightningNode.contentId,
      evictedNetworkFetches: evictionNetworkFetches,
      evictedFetchedContents: evictedReceipt.fetchedContents,
      evictedMountedPackages: evictedMounted.packageCount,
      recoveredNetworkFetches,
      recoveredHydrated: recoveredContent.hydratedCount,
      recoveredMountedPackages: recoveredMounted.packageCount,
      crossContextLocking: evictedContent.crossContextLocking && recoveredContent.crossContextLocking
    });

    const dedupeA = await new OpfsPackageContentStore({
      root: opfsRoot,
      directoryName: packageDedupeDirectory,
      lockManager: navigator.locks
    }).open();
    const dedupeB = await new OpfsPackageContentStore({
      root: opfsRoot,
      directoryName: packageDedupeDirectory,
      lockManager: navigator.locks
    }).open();
    const dedupeReceipts = await Promise.all([
      dedupeA.ingest({
        contentId: lightningNode.contentId,
        integrity: lightningIntegrity,
        bytes: capturedPackageArtifact,
        expectedName: 'lightningcss-wasm',
        expectedVersion: '1.33.0'
      }),
      dedupeB.ingest({
        contentId: lightningNode.contentId,
        integrity: lightningIntegrity,
        bytes: capturedPackageArtifact,
        expectedName: 'lightningcss-wasm',
        expectedVersion: '1.33.0'
      })
    ]);
    const persistentReuseCount = dedupeReceipts.filter((receipt) => receipt.persistentReused === true).length;
    assert(persistentReuseCount === 1, 'concurrent OPFS package cache did not collapse publication to one persistent writer');

    stage('browser-package-cache-dedupe-pass', {
      contentId: lightningNode.contentId,
      artifactBytes: capturedPackageArtifact.byteLength,
      persistentReuseCount,
      crossContextLocking: dedupeA.crossContextLocking && dedupeB.crossContextLocking
    });

    stage('browser-package-install-pass', {
      bytes: installReceipt.bytes,
      fetchedContents: installReceipt.fetchedContents,
      packageInstances: installReceipt.packageInstances,
      contentCount: mountedPackages.contentCount,
      resolved: resolvedLightning.path,
      persistentHydrated: reopenedContent.hydratedCount,
      persistentCorrupt: reopenedContent.corruptCount,
      persistentNetworkRefetches: secondNetworkFetches,
      persistentMountedPackages: reopenedMounted.packageCount,
      forcedEvictionRefetches: evictionNetworkFetches,
      postEvictionNetworkRefetches: recoveredNetworkFetches,
      postEvictionHydrated: recoveredContent.hydratedCount,
      crossContextLocking: reopenedContent.crossContextLocking
    });
  } finally {
    await opfsRoot.removeEntry(packageCacheDirectory, { recursive: true });
    try { await opfsRoot.removeEntry(packageDedupeDirectory, { recursive: true }); } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
  }

  stage('browser-package-corpus-start');
  const corpusLockResponse = await fetch('/package-lock.json', { cache: 'no-store' });
  assert(corpusLockResponse.ok, 'failed to load frozen package corpus lockfile');
  const corpusLock = await corpusLockResponse.json();
  runtime.packages.compile(corpusLock);
  const lexerClosure = runtime.packages.selectDependencyClosure({ roots: ['es-module-lexer'] });
  assert(lexerClosure.locations.length === 1 && lexerClosure.locations[0] === 'node_modules/es-module-lexer', 'es-module-lexer corpus closure was not minimal');

  runtime.net.allow({
    origin: 'https://registry.npmjs.org',
    methods: ['GET'],
    paths: ['/']
  });
  const corpusArtifactAuthority = new PackageArtifactAuthority({
    fs: runtime.fs,
    network: runtime.net,
    maxArtifactBytes: 8 * 1024 * 1024,
    maxUnpackedBytes: 32 * 1024 * 1024
  });
  const corpusInstaller = runtime.packages.createFrozenInstaller();
  const corpusInstall = await corpusInstaller.installAll({
    artifactAuthority: corpusArtifactAuthority,
    locations: lexerClosure.locations,
    concurrency: 2
  });
  const corpusMounted = corpusInstaller.mountFrozenGraph({ locations: lexerClosure.locations });
  const lexerPackageJson = JSON.parse(runtime.packages.nodeModules.readFile('/workspace/node_modules/es-module-lexer/package.json'));
  assert(lexerPackageJson.name === 'es-module-lexer', 'package corpus mounted the wrong lexer package');
  assert(lexerPackageJson.version === '3.0.2', 'package corpus mounted the wrong lexer version');
  assert(corpusInstall.lifecycleScriptsSkipped.length === 0, 'package corpus silently skipped lifecycle scripts');

  runtime.fs.beginTransaction().writeFile('src/package-corpus-probe.mjs', [
    "import { init, parse } from 'es-module-lexer';",
    'await init();',
    "const [imports, exports, facade, hasModuleSyntax] = parse(`import value from 'dep'; export const marker = value;`);",
    'export const importCount = imports.length;',
    'export const exportCount = exports.length;',
    "export const firstImport = imports[0]?.specifier ?? '';",
    "export const firstImportType = imports[0]?.type ?? '';",
    "export const firstExport = exports[0]?.name ?? '';",
    'export const facadeModule = facade;',
    'export const moduleSyntax = hasModuleSyntax;'
  ].join('\n')).commit();

  const corpusCompat = runtime.packages.createBrowserNodeCompat({ cwd: '/workspace' });
  const corpusPublication = runtime.packages.createNativeEsmPublication({
    baseURL,
    session: 'browser-package-corpus',
    builtinSource: corpusCompat.builtinSource
  });
  const corpusBridge = new BrowserEsmServiceWorkerBridge({ publication: corpusPublication });
  await corpusBridge.start();
  const corpusWorker = new BrowserGuestWorkerAuthority({
    publication: corpusPublication,
    diagnostics: runtime.diagnostics,
    syncRequestHandler: corpusCompat.syncRequestHandler,
    requestTimeoutMs: 30000
  });
  corpusWorker.start();
  const corpusEntry = corpusPublication.moduleURL('./package-corpus-probe.mjs', '/workspace/src/entry.mjs').href;
  const corpusExecution = await corpusWorker.execute(corpusEntry, {
    exportNames: ['importCount', 'exportCount', 'firstImport', 'firstImportType', 'firstExport', 'facadeModule', 'moduleSyntax']
  });
  assert(corpusExecution.exports.importCount === 1, 'es-module-lexer corpus execution returned wrong import count');
  assert(corpusExecution.exports.exportCount === 1, 'es-module-lexer corpus execution returned wrong export count');
  assert(corpusExecution.exports.firstImport === 'dep', 'es-module-lexer corpus execution lost import specifier');
  assert(corpusExecution.exports.firstImportType === 'static', 'es-module-lexer corpus execution returned wrong import type');
  assert(corpusExecution.exports.firstExport === 'marker', 'es-module-lexer corpus execution returned wrong export name');
  assert(corpusExecution.exports.moduleSyntax === true, 'es-module-lexer corpus execution did not detect module syntax');
  assert(corpusExecution.workerCrossOriginIsolated === true, 'package corpus worker is not cross-origin isolated');
  corpusWorker.close();
  corpusBridge.close();

  stage('browser-package-corpus-pass', {
    package: lexerPackageJson.name,
    version: lexerPackageJson.version,
    locations: lexerClosure.locations.length,
    fetchedContents: corpusInstall.fetchedContents,
    bytes: corpusInstall.bytes,
    mountedPackages: corpusMounted.packageCount,
    importCount: corpusExecution.exports.importCount,
    exportCount: corpusExecution.exports.exportCount,
    firstImport: corpusExecution.exports.firstImport,
    firstImportType: corpusExecution.exports.firstImportType,
    firstExport: corpusExecution.exports.firstExport,
    moduleSyntax: corpusExecution.exports.moduleSyntax,
    workerCrossOriginIsolated: corpusExecution.workerCrossOriginIsolated
  });

  stage('browser-package-corpus-conditional-start');
  const nanoidClosure = runtime.packages.selectDependencyClosure({ roots: ['nanoid'] });
  assert(nanoidClosure.locations.length === 1 && nanoidClosure.locations[0] === 'node_modules/nanoid', 'nanoid corpus closure was not minimal');
  const nanoidInstall = await corpusInstaller.installAll({
    artifactAuthority: corpusArtifactAuthority,
    locations: nanoidClosure.locations,
    concurrency: 2
  });
  const nanoidMounted = corpusInstaller.mountFrozenGraph({ locations: nanoidClosure.locations });
  const nanoidPackageJson = JSON.parse(runtime.packages.nodeModules.readFile('/workspace/node_modules/nanoid/package.json'));
  assert(nanoidPackageJson.name === 'nanoid' && nanoidPackageJson.version === '3.3.19', 'conditional corpus mounted the wrong nanoid package');

  const nanoidEsmResolution = runtime.packages.resolve(
    'nanoid/non-secure',
    '/workspace/src/package-corpus-nanoid.mjs',
    { mode: 'esm' }
  );
  const nanoidCjsResolution = runtime.packages.resolve(
    'nanoid/non-secure',
    '/workspace/src/package-corpus-nanoid.cjs',
    { mode: 'cjs' }
  );
  assert(nanoidEsmResolution.path.endsWith('/nanoid/non-secure/index.js'), 'nanoid ESM conditional export resolved to the wrong target');
  assert(nanoidCjsResolution.path.endsWith('/nanoid/non-secure/index.cjs'), 'nanoid CJS conditional export resolved to the wrong target');
  assert(nanoidEsmResolution.path !== nanoidCjsResolution.path, 'nanoid conditional exports collapsed ESM and CJS targets');

  runtime.fs.beginTransaction().writeFile('src/package-corpus-nanoid.mjs', [
    "import { nanoid, customAlphabet } from 'nanoid/non-secure';",
    'const id = nanoid(13);',
    "const custom = customAlphabet('abc', 9)();",
    'export const idLength = id.length;',
    'export const customLength = custom.length;',
    "export const customAlphabetOnly = /^[abc]+$/.test(custom);"
  ].join('\n')).commit();

  const nanoidCompat = runtime.packages.createBrowserNodeCompat({ cwd: '/workspace' });
  const nanoidPublication = runtime.packages.createNativeEsmPublication({
    baseURL,
    session: 'browser-package-corpus-nanoid',
    builtinSource: nanoidCompat.builtinSource
  });
  const nanoidBridge = new BrowserEsmServiceWorkerBridge({ publication: nanoidPublication });
  await nanoidBridge.start();
  const nanoidWorker = new BrowserGuestWorkerAuthority({
    publication: nanoidPublication,
    diagnostics: runtime.diagnostics,
    syncRequestHandler: nanoidCompat.syncRequestHandler,
    requestTimeoutMs: 30000
  });
  nanoidWorker.start();
  const nanoidEntry = nanoidPublication.moduleURL('./package-corpus-nanoid.mjs', '/workspace/src/entry.mjs').href;
  const nanoidExecution = await nanoidWorker.execute(nanoidEntry, {
    exportNames: ['idLength', 'customLength', 'customAlphabetOnly']
  });
  assert(nanoidExecution.exports.idLength === 13, 'nanoid non-secure corpus returned the wrong default ID length');
  assert(nanoidExecution.exports.customLength === 9, 'nanoid customAlphabet corpus returned the wrong ID length');
  assert(nanoidExecution.exports.customAlphabetOnly === true, 'nanoid customAlphabet corpus escaped its selected alphabet');
  assert(nanoidExecution.workerCrossOriginIsolated === true, 'nanoid corpus worker is not cross-origin isolated');
  nanoidWorker.close();
  nanoidBridge.close();

  stage('browser-package-corpus-conditional-pass', {
    package: nanoidPackageJson.name,
    version: nanoidPackageJson.version,
    locations: nanoidClosure.locations.length,
    fetchedContents: nanoidInstall.fetchedContents,
    bytes: nanoidInstall.bytes,
    mountedPackages: nanoidMounted.packageCount,
    esmTarget: nanoidEsmResolution.path,
    cjsTarget: nanoidCjsResolution.path,
    idLength: nanoidExecution.exports.idLength,
    customLength: nanoidExecution.exports.customLength,
    customAlphabetOnly: nanoidExecution.exports.customAlphabetOnly,
    workerCrossOriginIsolated: nanoidExecution.workerCrossOriginIsolated
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
  assert(viteClosure.peerRequiredIgnored.length === 0, 'Vite browser closure ignored a required peer dependency');
  assert(viteClosure.peerOptionalSkipped.some((entry) => entry.includes('node_modules/vite -> @types/node')), 'Vite optional peer policy did not record skipped optional peers');
  const viteScriptedLocations = runtime.packages.graph.nodes
    .filter((node) => viteClosure.locations.includes(node.location) && node.hasInstallScript)
    .map((node) => node.location);
  assert(viteScriptedLocations.length === 0, 'Vite browser closure selected a package requiring lifecycle script execution');

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
  assert(c1Install.lifecycleScriptsSkipped.length === 0, 'Vite browser install silently skipped lifecycle scripts');
  assert(c1Mounted.lifecycleScriptsSkipped.length === 0, 'Vite browser mount silently skipped lifecycle scripts');
  stage('vite-closure-install-pass', {
    locations: viteClosure.locations.length,
    fetchedContents: c1Install.fetchedContents,
    embeddedInstances: c1Install.embeddedInstances,
    bytes: c1Install.bytes,
    mountedPackages: c1Mounted.packageCount,
    peerEdges: viteClosure.peersIncluded.length,
    optionalPeersSkipped: viteClosure.peerOptionalSkipped.length,
    lifecycleScriptsSkipped: c1Install.lifecycleScriptsSkipped.length,
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
  const viteImportAnalysisErrorIndex = viteNodeChunkSource.indexOf('Failed to parse source for import analysis');
  const viteLexerMarkerIndex = viteNodeChunkSource.indexOf('es-module-lexer');
  const viteParseImportsIndex = viteNodeChunkSource.indexOf('parseImports');
  const viteWebAssemblyCompileIndex = viteNodeChunkSource.indexOf('WebAssembly.compile');
  const viteUtf16LexerIndex = viteNodeChunkSource.indexOf('utf16le');
  const viteBufferLexerIndex = viteUtf16LexerIndex >= 0
    ? viteNodeChunkSource.lastIndexOf('Buffer', viteUtf16LexerIndex)
    : -1;
  stage('vite-import-analysis-source-shape', {
    errorIndex: viteImportAnalysisErrorIndex,
    errorSnippet: viteImportAnalysisErrorIndex >= 0
      ? viteNodeChunkSource.slice(Math.max(0, viteImportAnalysisErrorIndex - 2200), viteImportAnalysisErrorIndex + 1400)
      : null,
    lexerMarkerIndex: viteLexerMarkerIndex,
    lexerMarkerSnippet: viteLexerMarkerIndex >= 0
      ? viteNodeChunkSource.slice(Math.max(0, viteLexerMarkerIndex - 1200), viteLexerMarkerIndex + 2200)
      : null,
    parseImportsIndex: viteParseImportsIndex,
    parseImportsSnippet: viteParseImportsIndex >= 0
      ? viteNodeChunkSource.slice(Math.max(0, viteParseImportsIndex - 1200), viteParseImportsIndex + 2200)
      : null,
    webAssemblyCompileIndex: viteWebAssemblyCompileIndex,
    webAssemblyCompileSnippet: viteWebAssemblyCompileIndex >= 0
      ? viteNodeChunkSource.slice(Math.max(0, viteWebAssemblyCompileIndex - 1600), viteWebAssemblyCompileIndex + 2400)
      : null,
    utf16LexerIndex: viteUtf16LexerIndex,
    utf16LexerSnippet: viteUtf16LexerIndex >= 0
      ? viteNodeChunkSource.slice(Math.max(0, viteUtf16LexerIndex - 2200), viteUtf16LexerIndex + 2200)
      : null,
    bufferLexerIndex: viteBufferLexerIndex,
    bufferLexerSnippet: viteBufferLexerIndex >= 0
      ? viteNodeChunkSource.slice(Math.max(0, viteBufferLexerIndex - 800), viteBufferLexerIndex + 1600)
      : null,
    importAnalysisLines: viteNodeChunkLines.slice(25970, 26045).join('\n')
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
    .writeFile('c1-app/src/dep-opt.ts', [
      "import { nanoid } from 'nanoid';",
      "export const optimizedMarker: string = nanoid(4);"
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
      "import { parseAst } from 'rolldown/parseAst';",
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
      "import { createServer, DevEnvironment, transformWithOxc, version } from 'vite';",
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
      "import { dirname, resolve as pathResolve } from 'node:path';",
      "import { parseAst } from 'rolldown/parseAst';",
      "const root = '/workspace/c1-app';",
      "const cleanId = (id) => String(id).split('?')[0].split('#')[0];",
      "const vfsTrace = [];",
      "const trace = (kind, detail) => { if (vfsTrace.length < 80) vfsTrace.push(kind + ':' + detail); };",
      "const hotListeners = new Map();",
      "const hotPayloads = [];",
      "const hotDeliveries = [];",
      "const hotReplies = [];",
      "const hotClients = new Map();",
      "let hotListening = false;",
      "let hotClosed = false;",
      "const hotHandlers = (event) => { let set = hotListeners.get(event); if (!set) { set = new Set(); hotListeners.set(event, set); } return set; };",
      "const emitHot = (event, data, client) => { for (const handler of hotListeners.get(event) ?? []) handler(data, client); };",
      "const hotTransport = {",
      "  skipFsCheck: true,",
      "  send(payload) {",
      "    const copy = structuredClone(payload);",
      "    hotPayloads.push(copy);",
      "    for (const client of hotClients.values()) hotDeliveries.push({ clientId: client.id, payload: structuredClone(copy) });",
      "  },",
      "  on(event, handler) { hotHandlers(event).add(handler); },",
      "  off(event, handler) { hotListeners.get(event)?.delete(handler); },",
      "  listen() { hotListening = true; },",
      "  close() {",
      "    for (const client of [...hotClients.values()]) emitHot('vite:client:disconnect', undefined, client);",
      "    hotClients.clear();",
      "    hotClosed = true;",
      "  }",
      "};",
      "const connectHot = (id) => {",
      "  const client = { id, send(payload) { hotReplies.push({ clientId: id, payload: structuredClone(payload) }); } };",
      "  hotClients.set(id, client);",
      "  emitHot('vite:client:connect', undefined, client);",
      "  return client;",
      "};",
      "const disconnectHot = (id) => {",
      "  const client = hotClients.get(id);",
      "  if (!client) return false;",
      "  emitHot('vite:client:disconnect', undefined, client);",
      "  hotClients.delete(id);",
      "  return true;",
      "};",
      "const isJsUpdate = (payload) => payload?.type === 'update' && payload.updates?.some((update) => update.type === 'js-update' && (update.path === '/src/main.ts' || update.acceptedPath === '/src/main.ts'));",
      "const vfsPlugin = {",
      "  name: 'opencontainer-vfs-dev',",
      "  enforce: 'pre',",
      "  resolveId(source, importer) {",
      "    trace('resolve', String(source) + '<-' + String(importer ?? ''));",
      "    const raw = cleanId(source);",
      "    let candidate = null;",
      "    if (raw.startsWith('/workspace/')) candidate = raw;",
      "    else if (raw.startsWith('/') && !raw.startsWith('/@')) candidate = root + raw;",
      "    else if (importer && cleanId(importer).startsWith('/workspace/') && (raw.startsWith('./') || raw.startsWith('../'))) candidate = pathResolve(dirname(cleanId(importer)), raw);",
      "    if (candidate && existsSync(candidate)) { trace('resolved', candidate); return candidate; }",
      "    if (candidate) trace('resolve-miss', candidate);",
      "    return null;",
      "  },",
      "  async load(id) {",
      "    trace('load', String(id));",
      "    const file = cleanId(id);",
      "    if (!file.startsWith('/workspace/') || !existsSync(file)) { trace('load-miss', file); return null; }",
      "    if (/\\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|wasm)$/i.test(file)) return null;",
      "    const source = readFileSync(file, 'utf8');",
      "    if (/\\.(?:[cm]?ts|tsx)$/i.test(file)) {",
      "      const transformed = await transformWithOxc(source, file);",
      "      const hmrCode = file === root + '/src/main.ts' ? transformed.code + '\\nif (import.meta.hot) import.meta.hot.accept();' : transformed.code;",
      "      trace('load-oxc', file + ':' + String(source.length) + '->' + String(hmrCode.length));",
      "      return { code: hmrCode, map: transformed.map, moduleType: 'js' };",
      "    }",
      "    return source;",
      "  }",
      "};",
      "const server = await createServer({",
      "  root,",
      "  configFile: false,",
      "  logLevel: 'silent',",
      "  appType: 'spa',",
      "  plugins: [vfsPlugin],",
      "  optimizeDeps: { noDiscovery: true, include: [] },",
      "  environments: {",
      "    client: {",
      "      dev: {",
      "        createEnvironment(name, config, context) {",
      "          return new DevEnvironment(name, config, { ...context, hot: true, transport: hotTransport });",
      "        }",
      "      }",
      "    }",
      "  },",
      "  server: { middlewareMode: true, watch: null, ws: false, hmr: true }",
      "});",
      "const hotEnvironment = server.environments.client;",
      "let hotConnectEvents = 0;",
      "let hotDisconnectEvents = 0;",
      "hotEnvironment.hot.on('vite:client:connect', () => { hotConnectEvents += 1; });",
      "hotEnvironment.hot.on('vite:client:disconnect', () => { hotDisconnectEvents += 1; });",
      "connectHot('client-1');",
      "const clientContainer = server.environments?.client?.pluginContainer;",
      "let preImportAnalysisCode = '';",
      "let preImportAnalysisBytes = 0;",
      "let preImportAnalysisAstParsed = false;",
      "let preImportAnalysisAstError = '';",
      "const importAnalysisPlugin = clientContainer?.getSortedPlugins('transform').find((plugin) => plugin?.name === 'vite:import-analysis') ?? server.config.plugins.find((plugin) => plugin?.name === 'vite:import-analysis');",
      "const importAnalysisHook = importAnalysisPlugin?.transform;",
      "if (importAnalysisPlugin && importAnalysisHook) {",
      "  const originalHandler = typeof importAnalysisHook === 'function' ? importAnalysisHook : importAnalysisHook.handler;",
      "  const wrappedHandler = async function(code, id, options) {",
      "    if (cleanId(id) === root + '/src/main.ts') {",
      "      preImportAnalysisCode = String(code);",
      "      preImportAnalysisBytes = preImportAnalysisCode.length;",
      "      try { parseAst(preImportAnalysisCode); preImportAnalysisAstParsed = true; }",
      "      catch (error) { preImportAnalysisAstError = error?.stack ?? String(error); }",
      "    }",
      "    return originalHandler.call(this, code, id, options);",
      "  };",
      "  importAnalysisPlugin.transform = typeof importAnalysisHook === 'function'",
      "    ? wrappedHandler",
      "    : { ...importAnalysisHook, handler: wrappedHandler };",
      "}",
      "const directTsSource = readFileSync(root + '/src/main.ts', 'utf8');",
      "const directTsResult = await transformWithOxc(directTsSource, root + '/src/main.ts');",
      "const directTsTransformed = !directTsResult.code.includes('querySelector<HTMLDivElement>');",
      "const pluginNames = server.config.plugins.map((plugin) => plugin?.name ?? '<anonymous>').join('|');",
      "const oxcEnabled = server.config.oxc !== false;",
      "const manualResolved = clientContainer ? await clientContainer.resolveId('/src/main.ts', undefined) : null;",
      "const manualResolvedId = manualResolved?.id ?? '';",
      "let manualLoadType = '';",
      "let manualLoadHasTsGeneric = null;",
      "let manualLoadBytes = 0;",
      "let manualTransformError = '';",
      "let manualTransformPlugin = '';",
      "let manualTransformId = '';",
      "let manualTransformFrame = '';",
      "if (clientContainer && manualResolvedId) {",
      "  const loaded = await clientContainer.load(manualResolvedId);",
      "  const loadedCode = typeof loaded === 'string' ? loaded : loaded?.code ?? '';",
      "  manualLoadType = typeof loaded === 'string' ? 'string' : (loaded?.moduleType ?? typeof loaded);",
      "  manualLoadHasTsGeneric = loadedCode.includes('querySelector<HTMLDivElement>');",
      "  manualLoadBytes = loadedCode.length;",
      "  try {",
      "    await clientContainer.transform(loadedCode, manualResolvedId, { moduleType: typeof loaded === 'object' ? loaded?.moduleType : undefined });",
      "  } catch (error) {",
      "    manualTransformError = error?.message ?? String(error);",
      "    manualTransformPlugin = error?.plugin ?? '';",
      "    manualTransformId = error?.id ?? '';",
      "    manualTransformFrame = error?.frame ?? '';",
      "  }",
      "}",
      "let html = '';",
      "let tsCode = '';",
      "let clientCode = '';",
      "let closed = false;",
      "let devErrorPhase = '';",
      "let devErrorMessage = '';",
      "let hmrSelfAccepting = false;",
      "let hmrFirstUpdate = false;",
      "let hmrFirstDelivered = false;",
      "let hmrFailureObserved = false;",
      "let hmrFailureDidNotBroadcast = false;",
      "let hmrReconnectDelivered = false;",
      "let hmrStaleClientQuiet = false;",
      "let hmrRecovered = false;",
      "let hmrUpdateCount = 0;",
      "try {",
      "  try {",
      "    html = await server.transformIndexHtml('/', readFileSync(root + '/index.html', 'utf8'));",
      "  } catch (error) { devErrorPhase = 'index-html'; devErrorMessage = error?.stack ?? String(error); }",
      "  if (!devErrorPhase) {",
      "    try {",
      "      const ts = await server.transformRequest('/src/main.ts');",
      "      tsCode = ts?.code ?? '';",
      "    } catch (error) { devErrorPhase = 'typescript'; devErrorMessage = error?.stack ?? String(error); }",
      "  }",
      "  if (!devErrorPhase) {",
      "    try {",
      "      const client = await server.transformRequest('/@vite/client');",
      "      clientCode = client?.code ?? '';",
      "    } catch (error) { devErrorPhase = 'vite-client'; devErrorMessage = error?.stack ?? String(error); }",
      "  }",
      "  if (!devErrorPhase) {",
      "    try {",
      "      const environment = server.environments.client;",
      "      const sourcePath = root + '/src/main.ts';",
      "      const module = await environment.moduleGraph.getModuleByUrl('/src/main.ts');",
      "      hmrSelfAccepting = module?.isSelfAccepting === true;",
      "      if (!module) throw new Error('Vite C2 HMR module graph lost /src/main.ts');",
      "      const sourceV2 = readFileSync(sourcePath, 'utf8');",
      "      const sourceV3 = sourceV2.replace('source-v2', 'source-v3');",
      "      if (sourceV3 === sourceV2) throw new Error('Vite C2 HMR fixture did not contain source-v2');",
      "      const firstPayloadStart = hotPayloads.length;",
      "      writeFileSync(sourcePath, sourceV3);",
      "      environment.moduleGraph.onFileChange(sourcePath);",
      "      await environment.reloadModule(module);",
      "      const firstPayloads = hotPayloads.slice(firstPayloadStart);",
      "      hmrFirstUpdate = firstPayloads.some(isJsUpdate);",
      "      hmrFirstDelivered = hotDeliveries.some((entry) => entry.clientId === 'client-1' && isJsUpdate(entry.payload));",
      "      const updated = await environment.transformRequest('/src/main.ts?oc-hmr=1');",
      "      if (!(updated?.code ?? '').includes('source-v3')) throw new Error('Vite C2 HMR update did not expose source-v3');",
      "      const payloadCountBeforeFailure = hotPayloads.length;",
      "      writeFileSync(sourcePath, sourceV3 + '\\nexport const broken: = ;');",
      "      environment.moduleGraph.onFileChange(sourcePath);",
      "      try { await environment.transformRequest('/src/main.ts?oc-invalid=1'); }",
      "      catch { hmrFailureObserved = true; }",
      "      hmrFailureDidNotBroadcast = hotPayloads.length === payloadCountBeforeFailure;",
      "      disconnectHot('client-1');",
      "      const staleClientDeliveries = hotDeliveries.filter((entry) => entry.clientId === 'client-1').length;",
      "      connectHot('client-2');",
      "      const sourceV4 = sourceV3.replace('source-v3', 'source-v4');",
      "      writeFileSync(sourcePath, sourceV4);",
      "      environment.moduleGraph.onFileChange(sourcePath);",
      "      const reconnectModule = await environment.moduleGraph.getModuleByUrl('/src/main.ts');",
      "      if (!reconnectModule) throw new Error('Vite C2 HMR reconnect lost /src/main.ts');",
      "      const reconnectPayloadStart = hotPayloads.length;",
      "      await environment.reloadModule(reconnectModule);",
      "      const recovered = await environment.transformRequest('/src/main.ts?oc-recover=1');",
      "      hmrRecovered = (recovered?.code ?? '').includes('source-v4');",
      "      hmrReconnectDelivered = hotDeliveries.some((entry) => entry.clientId === 'client-2' && isJsUpdate(entry.payload));",
      "      hmrStaleClientQuiet = hotDeliveries.filter((entry) => entry.clientId === 'client-1').length === staleClientDeliveries;",
      "      hmrUpdateCount = hotPayloads.filter(isJsUpdate).length;",
      "      if (!hotPayloads.slice(reconnectPayloadStart).some(isJsUpdate)) throw new Error('Vite C2 reconnect did not emit js-update');",
      "    } catch (error) { devErrorPhase = 'hmr'; devErrorMessage = error?.stack ?? String(error); }",
      "  }",
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
      "export const closeSucceeded = closed;",
      "export const hotChannelListening = hotListening;",
      "export const hotChannelClosed = hotClosed;",
      "export { hotConnectEvents, hotDisconnectEvents, hmrSelfAccepting, hmrFirstUpdate, hmrFirstDelivered, hmrFailureObserved, hmrFailureDidNotBroadcast, hmrReconnectDelivered, hmrStaleClientQuiet, hmrRecovered, hmrUpdateCount };",
      "export { devErrorPhase, devErrorMessage, pluginNames, oxcEnabled, directTsTransformed, vfsTrace, manualResolvedId, manualLoadType, manualLoadHasTsGeneric, manualLoadBytes, manualTransformError, manualTransformPlugin, manualTransformId, manualTransformFrame, preImportAnalysisCode, preImportAnalysisBytes, preImportAnalysisAstParsed, preImportAnalysisAstError };"
    ].join('\n'))
    .writeFile('src/vite-dep-opt-probe.mjs', [
      "import { createServer, transformWithOxc, version } from 'vite';",
      "import { memfs } from 'rolldown/experimental';",
      "import * as nodeFs from 'node:fs';",
      "import * as nodePath from 'node:path';",
      "import { createRequire } from 'node:module';",
      "import { createBrowserToolchainVfsBridge } from './browser-toolchain-vfs-bridge.mjs';",
      "const { existsSync, readFileSync } = nodeFs;",
      "const { dirname, resolve: pathResolve } = nodePath;",
      "const root = '/workspace';",
      "const appRoot = '/workspace/c1-app';",
      "const cleanId = (id) => String(id).split('?')[0].split('#')[0];",
      "const isBare = (id) => id && !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('node:') && !id.startsWith('#') && !/^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(id);",
      "const resolvePackage = (specifier, importer) => {",
      "  if (!isBare(specifier)) return null;",
      "  const issuer = importer && cleanId(importer).startsWith('/workspace/') ? cleanId(importer) : root + '/index.js';",
      "  try { return createRequire(issuer).resolve(specifier); } catch { return null; }",
      "};",
      "const depToolchainBridge = createBrowserToolchainVfsBridge({",
      "  memfs,",
      "  sourceFs: nodeFs,",
      "  writableFs: nodeFs,",
      "  pathApi: nodePath,",
      "  workspaceRoot: '/workspace'",
      "});",
      "depToolchainBridge.mirrorTree('/workspace/node_modules/nanoid');",
      "const vfsPlugin = {",
      "  name: 'opencontainer-vfs-dep-opt',",
      "  enforce: 'pre',",
      "  resolveId(source, importer) {",
      "    const raw = cleanId(source);",
      "    let candidate = resolvePackage(raw, importer);",
      "    if (candidate) return candidate;",
      "    if (raw.startsWith('/workspace/')) candidate = raw;",
      "    else if (raw.startsWith('/c1-app/')) candidate = root + raw;",
      "    else if (raw.startsWith('/') && !raw.startsWith('/@')) candidate = appRoot + raw;",
      "    else if (importer && cleanId(importer).startsWith('/workspace/') && (raw.startsWith('./') || raw.startsWith('../'))) candidate = pathResolve(dirname(cleanId(importer)), raw);",
      "    return candidate && existsSync(candidate) ? candidate : null;",
      "  },",
      "  async load(id) {",
      "    const file = cleanId(id);",
      "    if (!file.startsWith('/workspace/') || !existsSync(file)) return null;",
      "    if (/\\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|wasm)$/i.test(file)) return null;",
      "    const source = readFileSync(file, 'utf8');",
      "    if (/\\.(?:[cm]?ts|tsx)$/i.test(file)) {",
      "      const transformed = await transformWithOxc(source, file);",
      "      return { code: transformed.code, map: transformed.map, moduleType: 'js' };",
      "    }",
      "    return source;",
      "  }",
      "};",
      "let depError = '';",
      "let depOptimizerPresent = false;",
      "let depPackageJsonExists = false;",
      "let depPackageIndexExists = false;",
      "let depPackageJsonName = '';",
      "let depManualResolvedId = '';",
      "let depManualResolveError = '';",
      "let depOptimizedKeys = [];",
      "let depDiscoveredKeys = [];",
      "let depOptimizedFile = '';",
      "let depOptimizedFileExists = false;",
      "let depOptimizedBytes = 0;",
      "let depTransformCode = '';",
      "let depTransformUsesOptimizedPath = false;",
      "let depMetadataHash = '';",
      "let depCacheDir = '';",
      "let depOptimizerClosed = false;",
      "let server;",
      "try {",
      "  server = await createServer({",
      "    root,",
      "    configFile: false,",
      "    logLevel: 'silent',",
      "    appType: 'custom',",
      "    cacheDir: root + '/node_modules/.vite',",
      "    resolve: { alias: { nanoid: '/workspace/node_modules/nanoid/index.browser.js' } },",
      "    plugins: [vfsPlugin],",
      "    optimizeDeps: { noDiscovery: true, include: ['nanoid'], force: true, holdUntilCrawlEnd: false, rolldownOptions: { plugins: [depToolchainBridge.plugin] } },",
      "    server: { middlewareMode: true, watch: null, ws: false, hmr: false }",
      "  });",
      "  const environment = server.environments.client;",
      "  depPackageJsonExists = existsSync('/workspace/node_modules/nanoid/package.json');",
      "  depPackageIndexExists = existsSync('/workspace/node_modules/nanoid/index.js');",
      "  if (depPackageJsonExists) {",
      "    try { depPackageJsonName = JSON.parse(readFileSync('/workspace/node_modules/nanoid/package.json', 'utf8')).name ?? ''; } catch {}",
      "  }",
      "  try {",
      "    const manual = await environment.pluginContainer.resolveId('nanoid', '/workspace/c1-app/src/dep-opt.ts');",
      "    depManualResolvedId = manual?.id ?? '';",
      "  } catch (error) { depManualResolveError = error?.stack ?? String(error); }",
      "  const optimizer = environment?.depsOptimizer;",
      "  depOptimizerPresent = !!optimizer;",
      "  if (!optimizer) throw new Error('Vite C2 dependency optimizer was not created');",
      "  await optimizer.init();",
      "  if (optimizer.scanProcessing) await optimizer.scanProcessing;",
      "  const pendingBefore = optimizer.metadata?.depInfoList?.map((info) => info?.processing).filter(Boolean) ?? [];",
      "  if (pendingBefore.length) await Promise.allSettled(pendingBefore);",
      "  const metadata = optimizer.metadata ?? {};",
      "  depOptimizedKeys = Object.keys(metadata.optimized ?? {});",
      "  depDiscoveredKeys = Object.keys(metadata.discovered ?? {});",
      "  const info = metadata.optimized?.nanoid ?? metadata.discovered?.nanoid ?? null;",
      "  if (info?.processing) await info.processing;",
      "  depTransformCode = (await server.transformRequest('/c1-app/src/dep-opt.ts'))?.code ?? '';",
      "  const finalMetadata = optimizer.metadata ?? metadata;",
      "  const finalInfo = finalMetadata.optimized?.nanoid ?? finalMetadata.discovered?.nanoid ?? info;",
      "  depOptimizedKeys = Object.keys(finalMetadata.optimized ?? {});",
      "  depDiscoveredKeys = Object.keys(finalMetadata.discovered ?? {});",
      "  depOptimizedFile = finalInfo?.file ?? '';",
      "  depOptimizedFileExists = !!depOptimizedFile && existsSync(depOptimizedFile);",
      "  depOptimizedBytes = depOptimizedFileExists ? readFileSync(depOptimizedFile).length : 0;",
      "  depTransformUsesOptimizedPath = /node_modules\\/.vite\\/deps|\\/\\@id\\//.test(depTransformCode);",
      "  depMetadataHash = String(finalMetadata.hash ?? finalMetadata.lockfileHash ?? finalMetadata.configHash ?? '');",
      "  depCacheDir = server.config.cacheDir;",
      "} catch (error) {",
      "  depError = error?.stack ?? String(error);",
      "} finally {",
      "  if (server) { await server.close(); depOptimizerClosed = true; }",
      "}",
      "export const viteVersion = version;",
      "export { depError, depOptimizerPresent, depPackageJsonExists, depPackageIndexExists, depPackageJsonName, depManualResolvedId, depManualResolveError, depOptimizedKeys, depDiscoveredKeys, depOptimizedFile, depOptimizedFileExists, depOptimizedBytes, depTransformCode, depTransformUsesOptimizedPath, depMetadataHash, depCacheDir, depOptimizerClosed };"
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
    modulePrelude: (path) =>
      path === '/workspace/node_modules/vite/dist/node/chunks/node.js'
        ? [
            "const __ocBrowserSetTimeout=globalThis.setTimeout.bind(globalThis);",
            "const setTimeout=(callback,delay,...args)=>{",
            "  const id=__ocBrowserSetTimeout(callback,delay,...args);",
            "  const handle={",
            "    ref(){return handle;},",
            "    unref(){return handle;},",
            "    hasRef(){return false;},",
            "    [Symbol.toPrimitive](){return id;}",
            "  };",
            "  return handle;",
            "};"
          ].join('\n')
        : '',
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
    profile: 'toolchain',
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

  stage('vite-c2-dev-start');
  const viteDevEntryUrl = vitePublication.moduleURL('./vite-dev-probe.mjs', '/workspace/src/entry.mjs');
  const viteDevGraph = await vitePublication.graph(viteDevEntryUrl);
  const viteDevExecution = await viteWorker.execute(viteDevGraph.entryURL, {
    exportNames: [
      'viteVersion',
      'created',
      'htmlHasClient',
      'htmlHasEntry',
      'tsTransformed',
      'viteClientServed',
      'clientBytes',
      'tsBytes',
      'html',
      'tsCode',
      'clientCode',
      'closeSucceeded',
      'devErrorPhase',
      'devErrorMessage',
      'pluginNames',
      'oxcEnabled',
      'directTsTransformed',
      'vfsTrace',
      'manualResolvedId',
      'manualLoadType',
      'manualLoadHasTsGeneric',
      'manualLoadBytes',
      'manualTransformError',
      'manualTransformPlugin',
      'manualTransformId',
      'manualTransformFrame',
      'preImportAnalysisCode',
      'preImportAnalysisBytes',
      'preImportAnalysisAstParsed',
      'preImportAnalysisAstError',
      'hotChannelListening',
      'hotChannelClosed',
      'hotConnectEvents',
      'hotDisconnectEvents',
      'hmrSelfAccepting',
      'hmrFirstUpdate',
      'hmrFirstDelivered',
      'hmrFailureObserved',
      'hmrFailureDidNotBroadcast',
      'hmrReconnectDelivered',
      'hmrStaleClientQuiet',
      'hmrRecovered',
      'hmrUpdateCount'
    ],
    observeNestedWorkers: true
  });
  stage('vite-c2-dev-probe', {
    devErrorPhase: viteDevExecution.exports.devErrorPhase,
    devErrorMessage: viteDevExecution.exports.devErrorMessage,
    oxcEnabled: viteDevExecution.exports.oxcEnabled,
    directTsTransformed: viteDevExecution.exports.directTsTransformed,
    pluginNames: viteDevExecution.exports.pluginNames,
    vfsTrace: viteDevExecution.exports.vfsTrace,
    manualResolvedId: viteDevExecution.exports.manualResolvedId,
    manualLoadType: viteDevExecution.exports.manualLoadType,
    manualLoadHasTsGeneric: viteDevExecution.exports.manualLoadHasTsGeneric,
    manualLoadBytes: viteDevExecution.exports.manualLoadBytes,
    manualTransformError: viteDevExecution.exports.manualTransformError,
    manualTransformPlugin: viteDevExecution.exports.manualTransformPlugin,
    manualTransformId: viteDevExecution.exports.manualTransformId,
    manualTransformFrame: viteDevExecution.exports.manualTransformFrame,
    preImportAnalysisCode: viteDevExecution.exports.preImportAnalysisCode,
    preImportAnalysisBytes: viteDevExecution.exports.preImportAnalysisBytes,
    preImportAnalysisAstParsed: viteDevExecution.exports.preImportAnalysisAstParsed,
    preImportAnalysisAstError: viteDevExecution.exports.preImportAnalysisAstError,
    hotChannelListening: viteDevExecution.exports.hotChannelListening,
    hotChannelClosed: viteDevExecution.exports.hotChannelClosed,
    hotConnectEvents: viteDevExecution.exports.hotConnectEvents,
    hotDisconnectEvents: viteDevExecution.exports.hotDisconnectEvents,
    hmrSelfAccepting: viteDevExecution.exports.hmrSelfAccepting,
    hmrFirstUpdate: viteDevExecution.exports.hmrFirstUpdate,
    hmrFirstDelivered: viteDevExecution.exports.hmrFirstDelivered,
    hmrFailureObserved: viteDevExecution.exports.hmrFailureObserved,
    hmrFailureDidNotBroadcast: viteDevExecution.exports.hmrFailureDidNotBroadcast,
    hmrReconnectDelivered: viteDevExecution.exports.hmrReconnectDelivered,
    hmrStaleClientQuiet: viteDevExecution.exports.hmrStaleClientQuiet,
    hmrRecovered: viteDevExecution.exports.hmrRecovered,
    hmrUpdateCount: viteDevExecution.exports.hmrUpdateCount
  });
  assert(!viteDevExecution.exports.devErrorPhase, 'Vite C2 dev transform failed at ' + viteDevExecution.exports.devErrorPhase + ': ' + viteDevExecution.exports.devErrorMessage);
  assert(viteDevExecution.exports.viteVersion === '8.3.0', 'Vite C2 dev server used the wrong version');
  assert(viteDevExecution.exports.created === true, 'Vite C2 middleware dev server was not created');
  assert(viteDevExecution.exports.htmlHasClient === true, 'Vite C2 transformed HTML did not inject /@vite/client');
  assert(viteDevExecution.exports.htmlHasEntry === true, 'Vite C2 transformed HTML lost source entry');
  assert(viteDevExecution.exports.tsTransformed === true, 'Vite C2 did not transform TypeScript source');
  assert(viteDevExecution.exports.viteClientServed === true, 'Vite C2 did not transform /@vite/client');
  assert(viteDevExecution.exports.hotChannelListening === true, 'Vite C2 virtual hot channel never entered listening state');
  assert(viteDevExecution.exports.hotChannelClosed === true, 'Vite C2 virtual hot channel did not close with dev server');
  assert(viteDevExecution.exports.hotConnectEvents >= 2, 'Vite C2 virtual hot channel did not observe reconnect');
  assert(viteDevExecution.exports.hotDisconnectEvents >= 1, 'Vite C2 virtual hot channel did not observe disconnect');
  assert(viteDevExecution.exports.hmrSelfAccepting === true, 'Vite C2 main module was not self-accepting');
  assert(viteDevExecution.exports.hmrFirstUpdate === true, 'Vite C2 did not emit a js-update for source edit');
  assert(viteDevExecution.exports.hmrFirstDelivered === true, 'Vite C2 js-update was not delivered to the connected client');
  assert(viteDevExecution.exports.hmrFailureObserved === true, 'Vite C2 invalid update did not fail safely');
  assert(viteDevExecution.exports.hmrFailureDidNotBroadcast === true, 'Vite C2 invalid update broadcast an HMR payload');
  assert(viteDevExecution.exports.hmrReconnectDelivered === true, 'Vite C2 reconnect client did not receive js-update');
  assert(viteDevExecution.exports.hmrStaleClientQuiet === true, 'Vite C2 disconnected client received a later update');
  assert(viteDevExecution.exports.hmrRecovered === true, 'Vite C2 did not recover after invalid update');
  assert(viteDevExecution.exports.closeSucceeded === true, 'Vite C2 dev server did not close gracefully');
  stage('vite-c2-hmr-pass', {
    updates: viteDevExecution.exports.hmrUpdateCount,
    connects: viteDevExecution.exports.hotConnectEvents,
    disconnects: viteDevExecution.exports.hotDisconnectEvents,
    safeFailure: viteDevExecution.exports.hmrFailureDidNotBroadcast,
    recovered: viteDevExecution.exports.hmrRecovered
  });

  const c2Owner = 'vite-c2-session-1';
  const c2Route = runtime.listen(5173, (request = {}) => {
    const url = String(request.url ?? '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      return new Response(viteDevExecution.exports.html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url === '/src/main.ts') {
      return new Response(viteDevExecution.exports.tsCode, { headers: { 'content-type': 'application/javascript; charset=utf-8' } });
    }
    if (url === '/@vite/client') {
      return new Response(viteDevExecution.exports.clientCode, { headers: { 'content-type': 'application/javascript; charset=utf-8' } });
    }
    return new Response('Not Found', { status: 404 });
  }, { owner: c2Owner });
  const c2IndexResponse = await runtime.preview.dispatch(5173, { url: '/' }, c2Route);
  const c2TsResponse = await runtime.preview.dispatch(5173, { url: '/src/main.ts' }, c2Route);
  const c2ClientResponse = await runtime.preview.dispatch(5173, { url: '/@vite/client' }, c2Route);
  const c2IndexBody = await c2IndexResponse.text();
  const c2TsBody = await c2TsResponse.text();
  const c2ClientBody = await c2ClientResponse.text();
  assert(c2IndexResponse.status === 200 && c2IndexBody.includes('/@vite/client'), 'Vite C2 virtual HTTP index route failed');
  assert(c2TsResponse.status === 200 && c2TsBody.includes('source-v2'), 'Vite C2 virtual HTTP TS route failed');
  assert(c2ClientResponse.status === 200 && c2ClientBody.length > 1000, 'Vite C2 virtual HTTP /@vite/client route failed');
  stage('vite-c2-http-pass', {
    port: c2Route.port,
    owner: c2Route.owner,
    epoch: c2Route.epoch,
    indexBytes: c2IndexBody.length,
    tsBytes: c2TsBody.length,
    clientBytes: c2ClientBody.length,
    gracefulClose: viteDevExecution.exports.closeSucceeded
  });

  const c2PreviewBridge = new BrowserPreviewServiceWorkerBridge({
    preview: runtime.preview,
    diagnostics: runtime.diagnostics
  });
  await c2PreviewBridge.start();
  const c2ServiceWorkerUrl = c2PreviewBridge.url(c2Route, '/');
  const c2ServiceWorkerResponse = await fetch(c2ServiceWorkerUrl, { cache: 'no-store' });
  const c2ServiceWorkerBody = await c2ServiceWorkerResponse.text();
  assert(c2ServiceWorkerResponse.status === 200 && c2ServiceWorkerBody.includes('/@vite/client'), 'Vite C2 Service Worker preview route failed');
  assert(c2ServiceWorkerResponse.headers.get('x-opencontainer-edge') === 'service-worker', 'Vite C2 preview did not traverse Service Worker edge');
  stage('vite-c2-preview-edge-pass', {
    status: c2ServiceWorkerResponse.status,
    port: c2Route.port,
    owner: c2Route.owner,
    epoch: c2Route.epoch
  });
  c2PreviewBridge.close();

  const c2RestartOwner = 'vite-c2-session-2';
  const c2RestartRoute = runtime.listen(5173, () =>
    new Response('restart-ok', { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
  { owner: c2RestartOwner });
  let c2StaleRejected = false;
  try {
    await runtime.preview.dispatch(5173, { url: '/' }, c2Route);
  } catch (error) {
    c2StaleRejected = error?.code === 'OC_PREVIEW_STALE';
  }
  assert(c2RestartRoute.epoch > c2Route.epoch, 'Vite C2 restart did not advance preview epoch');
  assert(c2StaleRejected, 'Vite C2 stale preview receipt was not rejected after restart');
  const c2RestartResponse = await runtime.preview.dispatch(5173, { url: '/' }, c2RestartRoute);
  assert(c2RestartResponse.status === 200 && await c2RestartResponse.text() === 'restart-ok', 'Vite C2 restarted route is not authoritative');
  stage('vite-c2-restart-pass', {
    port: c2RestartRoute.port,
    oldOwner: c2Route.owner,
    newOwner: c2RestartRoute.owner,
    oldEpoch: c2Route.epoch,
    newEpoch: c2RestartRoute.epoch,
    staleRejected: c2StaleRejected
  });

  const c2RehydratedBridge = new BrowserPreviewServiceWorkerBridge({
    preview: runtime.preview,
    diagnostics: runtime.diagnostics
  });
  await c2RehydratedBridge.start();
  const c2RestartServiceWorkerUrl = c2RehydratedBridge.url(c2RestartRoute, '/');
  const c2RestartServiceWorkerResponse = await fetch(c2RestartServiceWorkerUrl, { cache: 'no-store' });
  assert(
    c2RestartServiceWorkerResponse.status === 200 && await c2RestartServiceWorkerResponse.text() === 'restart-ok',
    'Vite C2 rehydrated Service Worker preview route is not authoritative'
  );
  const c2StaleServiceWorkerResponse = await fetch(c2ServiceWorkerUrl, { cache: 'no-store' });
  assert(c2StaleServiceWorkerResponse.status === 409, 'Vite C2 stale Service Worker preview receipt did not fail closed');
  stage('vite-c2-preview-rehydration-pass', {
    port: c2RestartRoute.port,
    oldEpoch: c2Route.epoch,
    newEpoch: c2RestartRoute.epoch,
    staleStatus: c2StaleServiceWorkerResponse.status
  });
  c2RehydratedBridge.close();
  runtime.preview.revoke(5173, { owner: c2RestartOwner });

  stage('vite-c2-dep-opt-start');
  const viteDepOptEntryUrl = vitePublication.moduleURL('./vite-dep-opt-probe.mjs', '/workspace/src/entry.mjs');
  const viteDepOptGraph = await vitePublication.graph(viteDepOptEntryUrl);
  const viteDepOptExecution = await viteWorker.execute(viteDepOptGraph.entryURL, {
    exportNames: [
      'viteVersion',
      'depError',
      'depOptimizerPresent',
      'depPackageJsonExists',
      'depPackageIndexExists',
      'depPackageJsonName',
      'depManualResolvedId',
      'depManualResolveError',
      'depOptimizedKeys',
      'depDiscoveredKeys',
      'depOptimizedFile',
      'depOptimizedFileExists',
      'depOptimizedBytes',
      'depTransformCode',
      'depTransformUsesOptimizedPath',
      'depMetadataHash',
      'depCacheDir',
      'depOptimizerClosed'
    ],
    observeNestedWorkers: true
  });
  stage('vite-c2-dep-opt-probe', {
    error: viteDepOptExecution.exports.depError,
    packageJsonExists: viteDepOptExecution.exports.depPackageJsonExists,
    packageIndexExists: viteDepOptExecution.exports.depPackageIndexExists,
    packageJsonName: viteDepOptExecution.exports.depPackageJsonName,
    manualResolvedId: viteDepOptExecution.exports.depManualResolvedId,
    manualResolveError: viteDepOptExecution.exports.depManualResolveError,
    optimizedKeys: viteDepOptExecution.exports.depOptimizedKeys,
    discoveredKeys: viteDepOptExecution.exports.depDiscoveredKeys,
    optimizedFile: viteDepOptExecution.exports.depOptimizedFile,
    optimizedFileExists: viteDepOptExecution.exports.depOptimizedFileExists,
    optimizedBytes: viteDepOptExecution.exports.depOptimizedBytes,
    transformPrefix: String(viteDepOptExecution.exports.depTransformCode ?? '').slice(0, 500),
    usesOptimizedPath: viteDepOptExecution.exports.depTransformUsesOptimizedPath,
    metadataHash: viteDepOptExecution.exports.depMetadataHash,
    cacheDir: viteDepOptExecution.exports.depCacheDir,
    closed: viteDepOptExecution.exports.depOptimizerClosed
  });
  assert(!viteDepOptExecution.exports.depError, 'Vite C2 dependency optimizer failed: ' + viteDepOptExecution.exports.depError);
  assert(viteDepOptExecution.exports.viteVersion === '8.3.0', 'Vite C2 dependency optimizer used the wrong Vite version');
  assert(viteDepOptExecution.exports.depOptimizerPresent === true, 'Vite C2 dependency optimizer authority was absent');
  assert(viteDepOptExecution.exports.depOptimizedKeys.includes('nanoid'), 'Vite C2 did not promote nanoid into optimized metadata');
  assert(viteDepOptExecution.exports.depOptimizedFileExists === true, 'Vite C2 optimized nanoid artifact was not materialized');
  assert(viteDepOptExecution.exports.depOptimizedBytes > 0, 'Vite C2 optimized nanoid artifact is empty');
  assert(viteDepOptExecution.exports.depTransformUsesOptimizedPath === true, 'Vite C2 transformed dependency import did not target optimized cache');
  assert(viteDepOptExecution.exports.depOptimizerClosed === true, 'Vite C2 dependency optimizer server did not close gracefully');
  stage('vite-c2-dep-opt-pass', {
    optimized: viteDepOptExecution.exports.depOptimizedKeys,
    file: viteDepOptExecution.exports.depOptimizedFile,
    bytes: viteDepOptExecution.exports.depOptimizedBytes,
    metadataHash: viteDepOptExecution.exports.depMetadataHash
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
    viteC2DevServer: true,
    viteC2VirtualHttp: true,
    viteC2Hmr: true,
    viteC2RestartEpoch: true,
    viteC2PreviewRehydration: true,
    viteC2DependencyOptimization: true,
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
