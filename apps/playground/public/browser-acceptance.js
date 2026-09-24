import { OpenContainer } from '/packages/sdk/src/index.js';
import { BrowserEsmServiceWorkerBridge } from '/packages/package-env/src/browser-esm-edge.js';
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

  const runtime = await OpenContainer.boot();
  stage('runtime-ready', { crossOriginIsolated: globalThis.crossOriginIsolated });
  runtime.mount({
    'package.json': JSON.stringify({ name: 'browser-acceptance', type: 'module' }),
    'src/dep.js': 'export let value=40; export function bump(){ value += 1 }',
    'src/dynamic.js': 'export default 1',
    'src/late.js': 'export default 2',
    'src/main.js': [
      "import { value, bump } from './dep.js';",
      'bump();',
      "const literal = await import('./dynamic.js');",
      "const latePath = './late.js';",
      'const late = await import(latePath);',
      'export const result = value + literal.default + late.default;',
      'export const moduleUrl = import.meta.url;'
    ].join('\n')
  });
  runtime.packages.mountCatalog();
  stage('catalog-mounted');

  const baseURL = location.origin + '/__opencontainer__/esm/';
  const publicationA = runtime.packages.createNativeEsmPublication({
    baseURL,
    session: 'browser-acceptance-a'
  });
  const bridgeA = new BrowserEsmServiceWorkerBridge({ publication: publicationA });
  stage('bridge-a-starting');
  await bridgeA.start();
  stage('bridge-a-ready', { controlled: !!navigator.serviceWorker.controller });

  const entryA = publicationA.moduleURL('./main.js', '/workspace/src/entry.mjs').href;
  const workerA = new BrowserGuestWorkerAuthority({
    publication: publicationA,
    diagnostics: runtime.diagnostics
  });
  workerA.start();
  stage('worker-a-started', { entryA });

  const first = await workerA.execute(entryA, { exportNames: ['result', 'moduleUrl'] });
  stage('worker-a-executed', { result: first.exports.result });
  assert(first.exports.result === 44, 'first native ESM execution result mismatch');
  assert(first.workerCrossOriginIsolated === true, 'guest worker is not cross-origin isolated');
  assert(first.exports.moduleUrl.includes('browser-acceptance-a'), 'module URL lost publication session');

  stage('edge-a-fetch');
  const edgeResponse = await fetch(entryA, { cache: 'no-store' });
  stage('edge-a-fetched', { status: edgeResponse.status });
  assert(edgeResponse.ok, 'service-worker module edge did not return 200');
  assert(edgeResponse.headers.get('x-opencontainer-edge') === 'service-worker', 'module was not served by disposable service-worker edge');
  assert(edgeResponse.headers.get('x-opencontainer-session') === 'browser-acceptance-a', 'publication session header mismatch');

  runtime.fs.beginTransaction().writeFile('src/dep.js', 'export let value=90; export function bump(){ value += 1 }').commit();

  const publicationB = runtime.packages.createNativeEsmPublication({
    baseURL,
    session: 'browser-acceptance-b'
  });
  const bridgeB = new BrowserEsmServiceWorkerBridge({ publication: publicationB });
  stage('bridge-b-starting');
  await bridgeB.start();
  stage('bridge-b-ready');

  const entryB = publicationB.moduleURL('./main.js', '/workspace/src/entry.mjs').href;
  const workerB = new BrowserGuestWorkerAuthority({
    publication: publicationB,
    diagnostics: runtime.diagnostics
  });
  workerB.start();
  stage('worker-b-started', { entryB });

  const second = await workerB.execute(entryB, { exportNames: ['result', 'moduleUrl'] });
  stage('worker-b-executed', { result: second.exports.result });
  assert(second.exports.result === 94, 'edited generation was not visible in restarted guest worker');
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

  await runtime.terminate();

  return {
    pageCrossOriginIsolated: globalThis.crossOriginIsolated,
    firstResult: first.exports.result,
    secondResult: second.exports.result,
    staleStatus: stale.status,
    serviceWorkerEdge: edgeResponse.headers.get('x-opencontainer-edge'),
    opfsRealBrowser: true,
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
