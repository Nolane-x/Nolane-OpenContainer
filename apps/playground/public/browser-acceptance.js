import { OpenContainer } from '/packages/sdk/src/index.js';
import { BrowserEsmServiceWorkerBridge } from '/packages/package-env/src/browser-esm-edge.js';
import { OpfsPackageContentStore, PackageArtifactAuthority, inspectTarArchive } from '/packages/package-env/src/index.js';
import { BrowserGuestWorkerAuthority } from '/packages/process/src/browser-guest-worker.js';
import { WorkerRpcAuthority } from '/packages/process/src/worker-authority.js';
import { BrowserStoragePolicy, MemoryVFS, OpfsCheckpointAuthority, OpfsWorkspaceLifecycleAuthority, ExternalWorkspaceSourceAuthority, ExternalSourceMode, ExternalSourceState } from '/packages/vfs/src/index.js';
import { BrowserPreviewServiceWorkerBridge, createSandboxedPreviewFrame } from '/packages/preview/src/index.js';
import { ResourceGovernor } from '/packages/resources/src/index.js';
import { FrozenToolchains, certifyToolchain, ToolchainAuthority, SharedWasmMemoryViews } from '/packages/toolchain/src/index.js';
import { OpfsReleaseStorageAuthority, OpfsDerivedIndexStore, PersistenceCorruptionClass, corruptionDisposition, StorageCleanupCoordinator, StorageCleanupTier } from '/packages/persistence/src/index.js';
import { checkHostingHeaders } from '/scripts/hosting-self-check-lib.mjs';

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

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])])
  );
}

async function p4Gunzip(bytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    chunks.push(new Uint8Array(chunk));
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function p4TarOctal(bytes, start, length) {
  let text = '';
  for (let index = start; index < Math.min(bytes.length, start + length); index++) {
    if (bytes[index] === 0) break;
    text += String.fromCharCode(bytes[index]);
  }
  text = text.trim();
  return text ? Number.parseInt(text, 8) : 0;
}

function p4TarEndOffset(bytes) {
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return offset;
    const size = p4TarOctal(bytes, offset + 124, 12);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

function p4FirstPayload(bytes) {
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return null;
    const size = p4TarOctal(bytes, offset + 124, 12);
    if (size > 0) return { headerOffset: offset, dataStart: offset + 512, size };
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

function p4WriteTarText(bytes, start, length, value) {
  bytes.fill(0, start, start + length);
  const encoded = new TextEncoder().encode(value);
  bytes.set(encoded.subarray(0, length), start);
}

function p4RechecksumHeader(bytes, offset) {
  bytes.fill(32, offset + 148, offset + 156);
  let sum = 0;
  for (let index = 0; index < 512; index++) sum += bytes[offset + index];
  const octal = sum.toString(8).padStart(6, '0') + '\0 ';
  p4WriteTarText(bytes, offset + 148, 8, octal);
}

function p4MutateFirstTarHeader(rawTar, { path = null, type = null } = {}) {
  const copy = new Uint8Array(rawTar);
  if (path != null) p4WriteTarText(copy, 0, 100, path);
  if (type != null) copy[156] = String(type).charCodeAt(0);
  p4RechecksumHeader(copy, 0);
  return copy;
}

async function p4ExpectCode(label, operation, expectedCode) {
  let code = null;
  try {
    await operation();
  } catch (error) {
    code = error?.code ?? error?.name ?? 'ERROR';
  }
  assert(code === expectedCode, label + ' expected ' + expectedCode + ' but observed ' + code);
  return code;
}

async function run() {
  stage('boot');
  assert(globalThis.isSecureContext, 'browser acceptance requires a secure context');
  assert(globalThis.crossOriginIsolated, 'COOP/COEP isolation is required');

  const runtime = await OpenContainer.boot({ network: { allowLocal: true } });
  acceptanceRuntime = runtime;
  stage('runtime-ready', { crossOriginIsolated: globalThis.crossOriginIsolated });

  stage('p6-runtime-authority-start');

  const p6RolldownEntry={
    packageName:'@rolldown/browser',
    toolVersion:'1.2.9',
    artifactDigest:'9accf3cdfe3d2287ad7d5f49cd2cfcddbc9c112abfcbc295863e401ef44b8576',
    adapterSemanticProfile:'rolldown-browser-wasi-v1'
  };
  const p6LightningEntry={
    packageName:'lightningcss-wasm',
    toolVersion:'1.33.0',
    artifactDigest:'266866c1b0efd7ca5307fe312411e4f1895b997086fb76f392ec5b60aadf31c8',
    adapterSemanticProfile:'lightningcss-browser-default-v1'
  };
  const p6Authority=new ToolchainAuthority({
    entries:[p6RolldownEntry,p6LightningEntry],
    maxWorkers:2
  });
  const p6LeaseA=p6Authority.acquireWorker({agentId:'p6-agent-a',entry:p6RolldownEntry});
  const p6LeaseB=p6Authority.acquireWorker({agentId:'p6-agent-b',entry:p6RolldownEntry});
  let p6BudgetCode=null;
  try{
    p6Authority.acquireWorker({agentId:'p6-agent-c',entry:p6RolldownEntry});
  }catch(error){
    p6BudgetCode=error?.code??null;
  }
  assert(p6BudgetCode==='OC_RESOURCE_EXHAUSTED','P6 ToolchainAuthority did not enforce one global worker budget');
  p6LeaseA.release();
  const p6LeaseC=p6Authority.acquireWorker({agentId:'p6-agent-c',entry:p6RolldownEntry});
  p6LeaseB.release();
  p6LeaseC.release();
  assert(p6Authority.usage.workers===0,'P6 ToolchainAuthority leaked worker leases');

  const p6Exact=certifyToolchain({...FrozenToolchains.vite830});
  assert(p6Exact.status==='EXACT_PROFILE','P6 exact toolchain tuple did not certify');
  let p6SkewCode=null;
  let p6DigestCode=null;
  let p6UnsupportedCode=null;
  let p6GenericWasiCode=null;
  try{certifyToolchain({...FrozenToolchains.vite830,rolldownBinding:'1.2.8'});}catch(error){p6SkewCode=error?.code??null;}
  try{certifyToolchain({...FrozenToolchains.vite830,lightningcssWasmSha256:'0'.repeat(64)});}catch(error){p6DigestCode=error?.code??null;}
  try{certifyToolchain({...FrozenToolchains.vite830,consumerVersion:'8.2.0'});}catch(error){p6UnsupportedCode=error?.code??null;}
  try{
    p6Authority.resolve({...p6RolldownEntry,adapterSemanticProfile:'generic-wasi-linux'});
  }catch(error){
    p6GenericWasiCode=error?.code??null;
  }
  assert(p6SkewCode==='OC_TOOLCHAIN_SKEW','P6 live toolchain loader did not reject Rolldown binding skew');
  assert(p6DigestCode==='OC_DIGEST_MISMATCH','P6 live toolchain loader did not reject artifact digest substitution');
  assert(p6UnsupportedCode==='OC_TOOLCHAIN_UNSUPPORTED','P6 live toolchain loader did not reject unsupported Vite version');
  assert(p6GenericWasiCode==='OC_TOOLCHAIN_UNSUPPORTED','P6 adapter authority implicitly widened into generic WASI/Linux');

  const p6Memory=new WebAssembly.Memory({initial:1,maximum:4,shared:true});
  const p6Views=new SharedWasmMemoryViews(p6Memory);
  const p6BytesBefore=p6Views.bind('bytes',Uint8Array,0);
  const p6WordsBefore=p6Views.bind('words',Uint32Array,0,8);
  p6BytesBefore[0]=23;
  p6WordsBefore[1]=0x12345678;
  const p6OldBuffer=p6BytesBefore.buffer;
  const p6OldLength=p6BytesBefore.byteLength;
  const p6Growth=[];
  for(let index=0;index<2;index++){
    const receipt=p6Views.grow(1);
    p6Growth.push(receipt);
    assert(receipt.rebound===true,'P6 shared memory growth did not trigger view rebind');
  }
  const p6BytesAfter=p6Views.view('bytes');
  const p6WordsAfter=p6Views.view('words');
  assert(p6BytesAfter.buffer!==p6OldBuffer,'P6 shared-memory buffer identity did not advance after growth');
  assert(p6BytesBefore.byteLength===p6OldLength,'P6 stale TypedArray unexpectedly changed length instead of requiring rebind');
  assert(p6BytesAfter.byteLength===3*65536,'P6 rebound byte view did not cover grown shared memory');
  assert(p6BytesAfter[0]===23&&p6WordsAfter[1]===0x12345678,'P6 memory.grow rebind lost shared-memory contents');

  const p6ModuleBytes=Uint8Array.from([
    0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,
    0x01,0x05,0x01,0x60,0x00,0x01,0x7f,
    0x03,0x02,0x01,0x00,
    0x07,0x0a,0x01,0x06,0x61,0x6e,0x73,0x77,0x65,0x72,0x00,0x00,
    0x0a,0x06,0x01,0x04,0x00,0x41,0x2a,0x0b
  ]);
  const p6CompiledModule=await WebAssembly.compile(p6ModuleBytes);
  const p6ModuleProbe=(id)=>new Promise((resolve,reject)=>{
    const worker=new Worker('/p6-wasm-module-worker.mjs',{type:'module'});
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('P6 module reuse worker timed out'));},10000);
    worker.onmessage=(event)=>{
      if(event.data?.id!==id)return;
      clearTimeout(timer);
      worker.terminate();
      if(event.data?.ok!==true)reject(new Error('P6 module worker failed: '+event.data?.message));
      else resolve(event.data);
    };
    worker.onerror=(event)=>{
      clearTimeout(timer);
      worker.terminate();
      reject(new Error('P6 module reuse worker error: '+event.message));
    };
    worker.postMessage({id,module:p6CompiledModule});
  });
  const p6ModuleReceipts=await Promise.all([p6ModuleProbe('worker-a'),p6ModuleProbe('worker-b')]);
  assert(p6ModuleReceipts.every(item=>item.exports.includes('answer')),'P6 cloned compiled module did not instantiate in every bounded worker');

  stage('p6-runtime-authority-pass',{
    exactToolchainStatus:p6Exact.status,
    globalWorkerBudget:p6Authority.limits.workers,
    budgetFailureCode:p6BudgetCode,
    versionSkewCode:p6SkewCode,
    digestMismatchCode:p6DigestCode,
    unsupportedVersionCode:p6UnsupportedCode,
    genericWasiExpansionCode:p6GenericWasiCode,
    sharedMemoryInitialBytes:p6OldLength,
    sharedMemoryFinalBytes:p6BytesAfter.byteLength,
    sharedMemoryGrowCount:p6Growth.length,
    sharedMemoryViewGeneration:p6Views.generation,
    compiledModuleCompiles:1,
    compiledModuleWorkerClones:p6ModuleReceipts.length,
    compiledModuleExports:p6ModuleReceipts.map(item=>item.exports)
  });


  stage('p7-pressure-start');
  const p7Resources=new ResourceGovernor({tasks:1,inFlightBytes:4096,workers:1});
  const p7Channel=new MessageChannel();
  p7Channel.port1.start();
  p7Channel.port2.start();
  p7Channel.port2.addEventListener('message',(event)=>{
    const request=event.data;
    if(!request||request.type!=='request')return;
    setTimeout(()=>{
      p7Channel.port2.postMessage({
        v:1,
        type:'response',
        session:request.session,
        epoch:request.epoch,
        id:request.id,
        ok:true,
        value:{echo:request.payload?.value??null}
      });
    },25);
  });
  const p7Rpc=new WorkerRpcAuthority({
    transport:p7Channel.port1,
    resources:p7Resources,
    diagnostics:runtime.diagnostics,
    requestTimeoutMs:2000
  });
  const p7Stale=p7Rpc.request('pressure-probe',{value:'stale'},{background:true});
  const p7Critical=p7Resources.setPressure('critical');
  let p7StaleCode=null;
  try{await p7Stale;}catch(error){p7StaleCode=error?.code??error?.name??'ERROR';}
  assert(p7StaleCode==='OC_WORKER_STALE','P7 pressure cancellation allowed stale background RPC publication');
  let p7PausedCode=null;
  try{p7Rpc.request('pressure-blocked',{value:'blocked'},{background:true});}
  catch(error){p7PausedCode=error?.code??error?.name??'ERROR';}
  assert(p7PausedCode==='OC_RESOURCE_EXHAUSTED','P7 critical pressure did not pause new background admission');
  const p7Normal=p7Resources.setPressure('normal');
  const p7Fresh=await p7Rpc.request('pressure-probe',{value:'fresh'},{background:true});
  assert(p7Fresh.echo==='fresh','P7 resumed background task did not publish fresh result');
  p7Rpc.close();
  p7Channel.port1.close();
  p7Channel.port2.close();
  stage('p7-pressure-pass',{
    criticalEpoch:p7Critical.epoch,
    staleCode:p7StaleCode,
    pausedCode:p7PausedCode,
    resumed:p7Normal.paused===false,
    fresh:p7Fresh.echo
  });

  const productionProfileResponse = await fetch('/docs/production/PRODUCTION-PROFILE.json', { cache: 'no-store' });
  assert(productionProfileResponse.ok, 'machine-readable production profile is not publicly loadable');
  const publishedProductionProfile = await productionProfileResponse.json();
  assert(JSON.stringify(canonicalJson(publishedProductionProfile)) === JSON.stringify(canonicalJson(runtime.productionProfile)), 'browser SDK production profile drifted from published JSON');
  assert(runtime.productionProfile.productionClosed === false, 'production profile incorrectly claims closure');
  assert(runtime.productionProfile.oracle.node === '24.21.0' && runtime.productionProfile.oracle.npm === '11.19.0', 'production profile oracle drifted');
  stage('production-profile-pass', {
    profileId: runtime.productionProfile.profileId,
    runtimeVersion: runtime.productionProfile.runtime.version,
    workerRpcEnvelopeVersion: runtime.productionProfile.protocol.workerRpcEnvelopeVersion,
    snapshotFormatVersion: runtime.productionProfile.snapshot.portableFormatVersion,
    gateCount: runtime.productionProfile.closure.gateCount,
    productionClosed: runtime.productionProfile.productionClosed
  });

  stage('release-storage-migration-start');
  assert(typeof navigator.storage?.getDirectory === 'function', 'OPFS root is required for release storage migration court');
  const releaseRoot = await navigator.storage.getDirectory();
  const releaseBase = 'opencontainer-release-migration-' + Date.now();
  const capacityProvider = {
    async availableBytes() {
      const estimate = await navigator.storage.estimate();
      return Math.max(0, (estimate.quota ?? 0) - (estimate.usage ?? 0));
    }
  };
  const migrationStore = await new OpfsReleaseStorageAuthority({
    root: releaseRoot,
    directoryName: releaseBase + '-main',
    lockManager: navigator.locks,
    capacityProvider,
    safetyReserveBytes: 1024
  }).open();
  await migrationStore.seed({
    storageVersion: 1,
    runtimeVersion: '0.1.0-alpha.1',
    data: { marker: 'v1', workspaceGeneration: runtime.fs.generation }
  });
  const migrationDryRun = await migrationStore.dryRun({
    fromVersion: 1,
    toVersion: 2,
    runtimeVersion: '0.2.0-beta.1',
    transform: (data) => ({ ...data, marker: 'v2', migrated: true }),
    validate: (candidate) => candidate.data.migrated === true
  });
  assert(migrationDryRun.ok === true, 'release storage migration dry-run rejected browser capacity');
  assert(migrationDryRun.canonicalUnchanged === true, 'release storage dry-run changed canonical identity');
  assert((await migrationStore.readCanonical()).storageVersion === 1, 'release storage dry-run published target prematurely');
  assert(migrationDryRun.derivedCache.strategy === 'lazy-rebuild', 'derived cache migration became eager');
  assert(migrationDryRun.derivedCache.criticalOpenPath === false, 'derived cache migration entered critical open path');
  assert(migrationDryRun.derivedCache.migrateBytes === 0, 'derived cache bytes were migrated eagerly');
  assert(migrationDryRun.derivedCache.sourceNamespace !== migrationDryRun.derivedCache.targetNamespace, 'cache namespace was reused across storage versions');

  const migrationReceipt = await migrationStore.migrate({
    fromVersion: 1,
    toVersion: 2,
    runtimeVersion: '0.2.0-beta.1',
    transform: (data) => ({ ...data, marker: 'v2', migrated: true }),
    validate: (candidate) => candidate.data.migrated === true
  });
  runtime.recordSupportOutcome('migration', migrationReceipt);
  const migratedCanonical = await migrationStore.readCanonical();
  const migrationRoots = await migrationStore.recoveryRoots();
  assert(migrationReceipt.destructiveDowngrade === false, 'migration receipt allowed destructive downgrade');
  assert(migratedCanonical.storageVersion === 2 && migratedCanonical.data.marker === 'v2', 'release storage migration did not publish v2');
  assert(migrationRoots.filter((item) => item.valid).length === 2, 'release storage migration did not retain two valid recovery roots');
  assert(JSON.stringify(migrationRoots.map((item) => item.storageVersion).sort()) === JSON.stringify([1, 2]), 'release storage recovery roots do not preserve adjacent versions');

  const rollbackFs = new MemoryVFS();
  rollbackFs.mount({ 'rollback.txt': 'stable' });
  const rollback = await migrationStore.rollbackPolicy({
    runtimeStorageVersion: 1,
    readableStorageVersions: [1, 2]
  });
  assert(rollback.strategy === 'reuse-newer-storage-read-only', 'rollback attempted a destructive storage downgrade');
  assert(rollback.destructiveStorageDowngrade === false, 'rollback marked destructive storage downgrade as required');
  const rollbackApplied = await migrationStore.applyCompatibility(rollbackFs, {
    runtimeStorageVersion: 1,
    readableStorageVersions: [1, 2]
  });
  assert(rollbackApplied.mode === 'read-only' && rollbackFs.readOnly === true, 'rolled-back runtime did not enter read-only mode');
  let rollbackWriteCode = null;
  try {
    rollbackFs.beginTransaction().writeFile('rollback.txt', 'forbidden').commit();
  } catch (error) {
    rollbackWriteCode = error?.code ?? null;
  }
  assert(rollbackWriteCode === 'OC_STORAGE_READ_ONLY', 'read-only rollback did not fail writes with OC_STORAGE_READ_ONLY');
  assert(rollbackFs.readFile('rollback.txt') === 'stable', 'read-only rollback mutated canonical workspace');

  const rollbackRefusal = await migrationStore.rollbackPolicy({
    runtimeStorageVersion: 1,
    readableStorageVersions: [1]
  });
  assert(rollbackRefusal.strategy === 'refuse-open', 'incompatible rollback did not refuse open');
  assert(rollbackRefusal.destructiveStorageDowngrade === false, 'incompatible rollback requested destructive downgrade');
  const rollbackRefusalFs = new MemoryVFS();
  rollbackRefusalFs.mount({ 'rollback-refusal.txt': 'preserved' });
  let rollbackRefusalCode = null;
  try {
    await migrationStore.applyCompatibility(rollbackRefusalFs, {
      runtimeStorageVersion: 1,
      readableStorageVersions: [1]
    });
  } catch (error) {
    rollbackRefusalCode = error?.code ?? null;
  }
  assert(rollbackRefusalCode === 'OC_STORAGE_MIGRATION_INVALID', 'incompatible rollback did not fail closed');
  assert(rollbackRefusalFs.readFile('rollback-refusal.txt') === 'preserved', 'rollback refusal mutated workspace state');

  const crashResults = [];
  for (const phase of ['after-preflight', 'after-payload', 'after-verify', 'after-publish']) {
    const directoryName = releaseBase + '-crash-' + phase;
    const crashing = await new OpfsReleaseStorageAuthority({
      root: releaseRoot,
      directoryName,
      lockManager: navigator.locks,
      capacityProvider,
      safetyReserveBytes: 1024
    }).open();
    await crashing.seed({
      storageVersion: 1,
      runtimeVersion: '0.1.0-alpha.1',
      data: { phase, marker: 'old' }
    });
    let crashCode = null;
    try {
      await crashing.migrate({
        fromVersion: 1,
        toVersion: 2,
        runtimeVersion: '0.2.0-beta.1',
        transform: (data) => ({ ...data, marker: 'new' }),
        crashAt: phase
      });
    } catch (error) {
      crashCode = error?.code ?? null;
    }
    assert(crashCode === 'OC_STORAGE_MIGRATION_INVALID', 'crash injection did not stop migration at ' + phase);
    const reopened = await new OpfsReleaseStorageAuthority({
      root: releaseRoot,
      directoryName,
      lockManager: navigator.locks,
      capacityProvider,
      safetyReserveBytes: 1024
    }).open();
    const canonical = await reopened.readCanonical();
    const roots = await reopened.recoveryRoots();
    assert(canonical !== null, 'crash phase lost all canonical storage: ' + phase);
    assert(roots.some((item) => item.valid), 'crash phase lost all valid recovery roots: ' + phase);
    if (phase === 'after-publish') {
      assert(canonical.storageVersion === 2, 'post-publish crash did not recover new canonical version');
      assert(roots.filter((item) => item.valid).length === 2, 'post-publish crash lost previous recovery root');
    } else {
      assert(canonical.storageVersion === 1, 'pre-publish crash changed canonical storage');
    }
    crashResults.push({ phase, storageVersion: canonical.storageVersion, validRoots: roots.filter((item) => item.valid).length });
    await releaseRoot.removeEntry(directoryName, { recursive: true });
  }

  await releaseRoot.removeEntry(releaseBase + '-main', { recursive: true });
  stage('release-storage-migration-pass', {
    dryRunRequiredBytes: migrationDryRun.requiredBytes,
    sourceCacheNamespace: migrationDryRun.derivedCache.sourceNamespace,
    targetCacheNamespace: migrationDryRun.derivedCache.targetNamespace,
    migratedStorageVersion: migratedCanonical.storageVersion,
    recoveryRoots: migrationRoots.filter((item) => item.valid).length,
    rollbackMode: rollbackApplied.mode,
    destructiveStorageDowngrade: rollback.destructiveStorageDowngrade,
    rollbackWriteCode,
    crashResults
  });

  stage('sdk-s7-start');
  const s7Runtime = await OpenContainer.boot();
  s7Runtime.mount({ 's7-state.txt': 'one' });
  const s7Snapshot = s7Runtime.snapshot('browser-s7');
  s7Runtime.fs.beginTransaction().writeFile('s7-state.txt', 'two').commit();
  s7Runtime.restore(s7Snapshot);
  assert(s7Runtime.fs.readFile('s7-state.txt') === 'one', 'public SDK snapshot restore returned wrong content');

  const s7PinnedGeneration = s7Runtime.fs.generation;
  const s7Export = s7Runtime.export();
  s7Runtime.fs.beginTransaction().writeFile('s7-state.txt', 'after-export').commit();

  const s7Imported = await OpenContainer.boot();
  await s7Imported.import(s7Export);
  assert(s7Imported.fs.readFile('s7-state.txt') === 'one', 'public SDK streaming import did not restore pinned export content');
  assert(s7Imported.fs.generation === s7PinnedGeneration, 'public SDK export mixed a later generation');
  const s7Status = s7Runtime.status();
  assert(s7Status.state === 'READY' && s7Status.generation === s7Runtime.fs.generation, 'public SDK status receipt drifted');

  await s7Imported.teardown();
  await s7Runtime.teardown();
  assert(s7Runtime.state === 'TERMINATED', 'public SDK teardown did not terminate runtime');
  stage('sdk-s7-pass', {
    snapshotId: s7Snapshot.id,
    pinnedGeneration: s7PinnedGeneration,
    importedGeneration: s7Imported.fs.generation,
    streamingExport: true,
    teardown: true
  });
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
  const bridgeAReceipt = await bridgeA.start();
  assert(
    bridgeAReceipt.serviceWorkerCompatibilityId === runtime.productionProfile.browser.serviceWorkerCompatibilityId,
    'first Service Worker compatibility handshake drifted from production profile'
  );
  assert(
    bridgeAReceipt.serviceWorkerActivation === 'compatibility-authorized' ||
      bridgeAReceipt.serviceWorkerActivation === 'existing-compatible',
    'first Service Worker activation did not use compatibility authorization'
  );
  runtime.recordSupportOutcome('update',{
    schema:'opencontainer.service-worker-update.v0.1',
    status:'compatible',
    compatibilityId:bridgeAReceipt.serviceWorkerCompatibilityId,
    activation:bridgeAReceipt.serviceWorkerActivation
  });
  stage('bridge-a-ready', {
    controlled: !!navigator.serviceWorker.controller,
    serviceWorkerCompatibilityId: bridgeAReceipt.serviceWorkerCompatibilityId,
    serviceWorkerActivation: bridgeAReceipt.serviceWorkerActivation
  });

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
  const bridgeBReceipt = await bridgeB.start();
  assert(
    bridgeBReceipt.serviceWorkerCompatibilityId === runtime.productionProfile.browser.serviceWorkerCompatibilityId,
    'reused Service Worker compatibility profile drifted'
  );
  assert(
    bridgeBReceipt.serviceWorkerActivation === 'existing-compatible',
    'second bridge unexpectedly promoted a new Service Worker'
  );
  stage('bridge-b-ready', {
    serviceWorkerCompatibilityId: bridgeBReceipt.serviceWorkerCompatibilityId,
    serviceWorkerActivation: bridgeBReceipt.serviceWorkerActivation
  });

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

  stage('real-repository-progression-start');

  const runRealRepositorySession = async ({
    session,
    entryPath,
    importerPath,
    exportNames,
    validate
  }) => {
    const publication = runtime.packages.createNativeEsmPublication({
      baseURL,
      session,
      builtinSource: nodeCompat.builtinSource
    });
    const bridge = new BrowserEsmServiceWorkerBridge({ publication });
    await bridge.start();
    const entry = publication.moduleURL(entryPath, importerPath).href;
    const worker = new BrowserGuestWorkerAuthority({
      publication,
      diagnostics: runtime.diagnostics,
      syncRequestHandler: nodeCompat.syncRequestHandler
    });
    worker.start();
    const receipt = await worker.execute(entry, { exportNames });
    validate(receipt, entry);
    worker.close();
    bridge.close();

    const staleResponse = await fetch(entry, { cache: 'no-store' });
    assert(staleResponse.status === 504, 'closed real-repository session did not fail stale fetch: ' + session);
    return {
      session,
      staleStatus: staleResponse.status,
      workerCrossOriginIsolated: receipt.workerCrossOriginIsolated,
      exports: receipt.exports
    };
  };

  const [yoctoIndexResponse, yoctoBaseResponse, clsxSourceResponse] = await Promise.all([
    fetch('/__compat__/yoctocolors/index.js', { cache: 'no-store' }),
    fetch('/__compat__/yoctocolors/base.js', { cache: 'no-store' }),
    fetch('/__compat__/clsx/src/index.js', { cache: 'no-store' })
  ]);
  assert(yoctoIndexResponse.ok && yoctoBaseResponse.ok, 'pinned yoctocolors source proxy failed');
  assert(clsxSourceResponse.ok, 'pinned clsx source proxy failed');
  assert(yoctoIndexResponse.headers.get('x-opencontainer-compat-commit') === 'a85b98a90e5731914567d8c209e7ec45ac2d24e2', 'yoctocolors commit pin drifted');
  assert(yoctoBaseResponse.headers.get('x-opencontainer-compat-repository') === 'sindresorhus/yoctocolors', 'yoctocolors repository identity drifted');
  assert(clsxSourceResponse.headers.get('x-opencontainer-compat-commit') === '925494cf31bcd97d3337aacd34e659e80cae7fe2', 'clsx commit pin drifted');
  assert(clsxSourceResponse.headers.get('x-opencontainer-compat-repository') === 'lukeed/clsx', 'clsx repository identity drifted');

  const [yoctoIndexSource, yoctoBaseSource, clsxSource] = await Promise.all([
    yoctoIndexResponse.text(),
    yoctoBaseResponse.text(),
    clsxSourceResponse.text()
  ]);

  runtime.fs.beginTransaction()
    .writeFile('compat/yoctocolors/index.js', yoctoIndexSource)
    .writeFile('compat/yoctocolors/base.js', yoctoBaseSource)
    .writeFile('compat/yoctocolors/probe.mjs', [
      "import { red, bold } from './index.js';",
      "export const redResult = red('opencontainer');",
      "export const boldResult = bold('opencontainer');",
      "export const moduleUrl = import.meta.url;"
    ].join('\n'))
    .writeFile('compat/clsx/index.js', clsxSource)
    .writeFile('compat/clsx/probe.mjs', [
      "import clsxDefault, { clsx as clsxNamed } from './index.js';",
      "export const defaultResult = clsxDefault('a', { b: true, c: false }, ['d']);",
      "export const namedResult = clsxNamed('x', 0, { y: 1, z: 0 }, ['q']);",
      "export const moduleUrl = import.meta.url;"
    ].join('\n'))
    .commit();

  const yoctoRuns = [];
  for (const ordinal of [1, 2]) {
    yoctoRuns.push(await runRealRepositorySession({
      session: 'compat-yoctocolors-a85b98a-' + ordinal,
      entryPath: './probe.mjs',
      importerPath: '/workspace/compat/yoctocolors/entry.mjs',
      exportNames: ['redResult', 'boldResult', 'moduleUrl'],
      validate(receipt) {
        assert(receipt.exports.redResult === 'opencontainer', 'yoctocolors red() disagreed with bounded browser tty semantics');
        assert(receipt.exports.boldResult === 'opencontainer', 'yoctocolors bold() disagreed with bounded browser tty semantics');
        assert(receipt.workerCrossOriginIsolated === true, 'yoctocolors execution lost browser isolation');
        assert(receipt.exports.moduleUrl.includes('compat-yoctocolors-a85b98a-' + ordinal), 'yoctocolors publication session identity drifted');
      }
    }));
  }

  const clsxRuns = [];
  for (const ordinal of [1, 2]) {
    clsxRuns.push(await runRealRepositorySession({
      session: 'compat-clsx-925494c-' + ordinal,
      entryPath: './probe.mjs',
      importerPath: '/workspace/compat/clsx/entry.mjs',
      exportNames: ['defaultResult', 'namedResult', 'moduleUrl'],
      validate(receipt) {
        assert(receipt.exports.defaultResult === 'a b d', 'clsx default export returned wrong conditional class string');
        assert(receipt.exports.namedResult === 'x y q', 'clsx named export returned wrong conditional class string');
        assert(receipt.workerCrossOriginIsolated === true, 'clsx execution lost browser isolation');
        assert(receipt.exports.moduleUrl.includes('compat-clsx-925494c-' + ordinal), 'clsx publication session identity drifted');
      }
    }));
  }

  stage('real-repository-progression-pass', {
    repositories: [
      {
        repository: 'sindresorhus/yoctocolors',
        commit: 'a85b98a90e5731914567d8c209e7ec45ac2d24e2',
        runs: yoctoRuns.length,
        ttySemantics: 'bounded-hasColors-false',
        staleStatuses: yoctoRuns.map((run) => run.staleStatus)
      },
      {
        repository: 'lukeed/clsx',
        commit: '925494cf31bcd97d3337aacd34e659e80cae7fe2',
        runs: clsxRuns.length,
        semantics: 'pure-esm-source',
        staleStatuses: clsxRuns.map((run) => run.staleStatus)
      }
    ],
    freshPublicationSessions: yoctoRuns.length + clsxRuns.length,
    allWorkersCrossOriginIsolated: [...yoctoRuns, ...clsxRuns].every((run) => run.workerCrossOriginIsolated),
    staleSessionsFailClosed: [...yoctoRuns, ...clsxRuns].every((run) => run.staleStatus === 504)
  });

  stage('published-package-clsx-start');
  const publishedRuntime = await OpenContainer.boot({ network: { allowLocal: true } });
  publishedRuntime.net.allow({
    id: 'published-clsx-registry',
    origin: 'https://registry.npmjs.org',
    methods: ['GET'],
    paths: ['/']
  });
  publishedRuntime.packages.compile({
    name: 'published-clsx-court',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'published-clsx-court', version: '1.0.0' },
      'node_modules/clsx': {
        name: 'clsx',
        version: '2.1.1',
        resolved: 'https://registry.npmjs.org/clsx/-/clsx-2.1.1.tgz',
        integrity: 'sha512-eYm0QWBtUrBWZWG0d386OGAw16Z995PiOVo2B7bjWSbHedGl5e0ZWaq65kOGgUSNesEIDkB9ISbTg/JK9dhCZA=='
      }
    }
  });
  const publishedArtifactAuthority = new PackageArtifactAuthority({
    fs: publishedRuntime.fs,
    network: publishedRuntime.net,
    maxArtifactBytes: 1024 * 1024,
    maxUnpackedBytes: 4 * 1024 * 1024
  });
  const publishedInstaller = publishedRuntime.packages.createFrozenInstaller();
  const publishedInstallReceipt = await publishedInstaller.installAll({
    artifactAuthority: publishedArtifactAuthority,
    concurrency: 1
  });
  const publishedMountReceipt = publishedInstaller.mountFrozenGraph();
  const publishedClsxPackageJson = JSON.parse(
    publishedRuntime.packages.nodeModules.readFile('/workspace/node_modules/clsx/package.json')
  );
  assert(publishedClsxPackageJson.name === 'clsx' && publishedClsxPackageJson.version === '2.1.1', 'published clsx tarball mounted wrong package identity');

  const publishedClsxResolution = publishedRuntime.packages.resolve(
    'clsx',
    '/workspace/src/published-clsx-probe.mjs',
    { mode: 'esm' }
  );
  assert(publishedClsxResolution.path.endsWith('/node_modules/clsx/dist/clsx.mjs'), 'published clsx exports resolver selected wrong ESM target');

  publishedRuntime.fs.beginTransaction().writeFile('src/published-clsx-probe.mjs', [
    "import clsxDefault, { clsx as clsxNamed } from 'clsx';",
    "export const defaultResult = clsxDefault('p', { q: true, r: false }, ['s']);",
    "export const namedResult = clsxNamed('u', { v: 1, w: 0 });",
    "export const moduleUrl = import.meta.url;"
  ].join('\n')).commit();

  const publishedCompat = publishedRuntime.packages.createBrowserNodeCompat({ cwd: '/workspace' });
  const publishedPublication = publishedRuntime.packages.createNativeEsmPublication({
    baseURL,
    session: 'published-clsx-2-1-1',
    builtinSource: publishedCompat.builtinSource
  });
  const publishedBridge = new BrowserEsmServiceWorkerBridge({ publication: publishedPublication });
  await publishedBridge.start();
  const publishedEntry = publishedPublication.moduleURL('./published-clsx-probe.mjs', '/workspace/src/entry.mjs').href;
  const publishedWorker = new BrowserGuestWorkerAuthority({
    publication: publishedPublication,
    diagnostics: publishedRuntime.diagnostics,
    syncRequestHandler: publishedCompat.syncRequestHandler
  });
  publishedWorker.start();
  const publishedExecution = await publishedWorker.execute(publishedEntry, {
    exportNames: ['defaultResult', 'namedResult', 'moduleUrl']
  });
  assert(publishedExecution.exports.defaultResult === 'p q s', 'published clsx default export execution mismatch');
  assert(publishedExecution.exports.namedResult === 'u v', 'published clsx named export execution mismatch');
  assert(publishedExecution.workerCrossOriginIsolated === true, 'published package Worker lost browser isolation');
  publishedWorker.close();
  publishedBridge.close();
  await publishedRuntime.terminate();

  stage('published-package-clsx-pass', {
    package: publishedClsxPackageJson.name,
    version: publishedClsxPackageJson.version,
    source: 'npm-published-tarball',
    integrity: 'sha512-eYm0QWBtUrBWZWG0d386OGAw16Z995PiOVo2B7bjWSbHedGl5e0ZWaq65kOGgUSNesEIDkB9ISbTg/JK9dhCZA==',
    fetchedContents: publishedInstallReceipt.fetchedContents,
    bytes: publishedInstallReceipt.bytes,
    mountedPackages: publishedMountReceipt.packageCount,
    resolvedEsmTarget: publishedClsxResolution.path,
    defaultResult: publishedExecution.exports.defaultResult,
    namedResult: publishedExecution.exports.namedResult,
    workerCrossOriginIsolated: publishedExecution.workerCrossOriginIsolated
  });

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
  const p3CorruptionEvidence = {};

  stage('p3-durability-boundary-start');
  const p3DurabilityDirectory=opfsDirectory+'-durability-boundary';
  try{
    const durabilityFs=new MemoryVFS();
    const durabilityAuthority=await new OpfsCheckpointAuthority({
      root:opfsRoot,
      directoryName:p3DurabilityDirectory,
      lockManager:navigator.locks
    }).open();

    durabilityFs.mount({
      'durable.txt':'flush-one',
      'bulk.txt':'x'.repeat(64*1024)
    });
    const durabilityFirst=await durabilityAuthority.checkpoint(durabilityFs);
    const firstBoundary=durabilityAuthority.lastDurabilityBoundary;
    assert(firstBoundary?.explicitFlush===true,'P3 canonical checkpoint did not use explicit flush');
    assert(firstBoundary?.browserSyncAccessHandle===true,'P3 canonical checkpoint did not use SyncAccessHandle');
    assert(firstBoundary?.canonicalSwitchAfterPayloadFlush===true,'P3 manifest switched before payload/manifest flush completed');
    assert(
      JSON.stringify(firstBoundary.payload.steps)===
      JSON.stringify(['truncate','write','truncate-final','flush','close']),
      'P3 payload durability step order drifted'
    );
    assert(
      JSON.stringify(firstBoundary.manifest.steps)===
      JSON.stringify(['truncate','write','truncate-final','flush','close']),
      'P3 manifest durability step order drifted'
    );
    assert(firstBoundary.payload.boundary==='flush-returned-before-close','P3 payload durability boundary drifted');
    assert(firstBoundary.manifest.boundary==='flush-returned-before-close','P3 manifest durability boundary drifted');

    durabilityFs.beginTransaction()
      .writeFile('durable.txt','flush-two')
      .writeFile('bulk.txt','y'.repeat(96*1024))
      .commit();
    const durabilitySecond=await durabilityAuthority.checkpoint(durabilityFs);
    const secondBoundary=durabilityAuthority.lastDurabilityBoundary;
    assert(secondBoundary?.sequence===durabilitySecond.sequence,'P3 durability receipt sequence drifted');
    assert(secondBoundary?.generation===durabilitySecond.generation,'P3 durability receipt generation drifted');
    assert(secondBoundary?.explicitFlush===true&&secondBoundary?.browserSyncAccessHandle===true,'P3 second canonical checkpoint lost explicit SyncAccessHandle flush');

    const durabilityReopen=await new OpfsCheckpointAuthority({
      root:opfsRoot,
      directoryName:p3DurabilityDirectory,
      lockManager:navigator.locks
    }).open();
    const durabilityRestored=new MemoryVFS();
    await durabilityReopen.restoreInto(durabilityRestored);
    assert(durabilityRestored.readFile('durable.txt')==='flush-two','P3 fresh reopen did not observe explicitly flushed canonical bytes');
    assert(durabilityRestored.readFile('bulk.txt')==='y'.repeat(96*1024),'P3 fresh reopen observed truncated or stale flushed payload');
    assert(durabilityReopen.current?.sequence===durabilitySecond.sequence,'P3 fresh reopen canonical sequence drifted after flush');
    assert(durabilityReopen.current?.sha256===durabilitySecond.sha256,'P3 fresh reopen canonical digest drifted after flush');

    stage('p3-durability-boundary-pass',{
      first:{
        sequence:durabilityFirst.sequence,
        generation:durabilityFirst.generation,
        payload:firstBoundary.payload,
        manifest:firstBoundary.manifest,
        explicitFlush:firstBoundary.explicitFlush,
        browserSyncAccessHandle:firstBoundary.browserSyncAccessHandle
      },
      second:{
        sequence:durabilitySecond.sequence,
        generation:durabilitySecond.generation,
        payload:secondBoundary.payload,
        manifest:secondBoundary.manifest,
        explicitFlush:secondBoundary.explicitFlush,
        browserSyncAccessHandle:secondBoundary.browserSyncAccessHandle
      },
      reopen:{
        sequence:durabilityReopen.current.sequence,
        generation:durabilityReopen.current.generation,
        sha256:durabilityReopen.current.sha256,
        value:durabilityRestored.readFile('durable.txt'),
        bulkBytes:new TextEncoder().encode(durabilityRestored.readFile('bulk.txt')).byteLength
      },
      exactBoundary:'SyncAccessHandle.flush() returned, then handle.close() completed, then a fresh authority reopened and verified the same canonical bytes/digest',
      notClaimed:[
        'power-loss durability beyond the browser SyncAccessHandle flush contract',
        'hardware cache persistence guarantees not exposed by the Web API'
      ]
    });
  }finally{
    await opfsRoot.removeEntry(p3DurabilityDirectory,{recursive:true}).catch(()=>{});
  }

  stage('p3-writer-election-start');
  const p3ElectionDirectory = opfsDirectory + '-writer-election';
  try {
    const writerA = await new OpfsCheckpointAuthority({
      root: opfsRoot,
      directoryName: p3ElectionDirectory,
      lockManager: navigator.locks
    }).open();
    const writerB = await new OpfsCheckpointAuthority({
      root: opfsRoot,
      directoryName: p3ElectionDirectory,
      lockManager: navigator.locks
    }).open();
    const writerFsA = new MemoryVFS();
    const writerFsB = new MemoryVFS();
    writerFsA.mount({ 'writer.txt': 'A' });
    writerFsB.mount({ 'writer.txt': 'B' });
    const writerResults = await Promise.allSettled([
      writerA.checkpoint(writerFsA),
      writerB.checkpoint(writerFsB)
    ]);
    const writerFulfilled = writerResults.filter((item) => item.status === 'fulfilled');
    const writerRejected = writerResults.filter((item) => item.status === 'rejected');
    assert(writerFulfilled.length === 1, 'P3 writer election admitted more or fewer than one same-generation publisher');
    assert(writerRejected.length === 1, 'P3 writer election did not reject the competing publisher');
    assert(writerRejected[0].reason?.code === 'OC_STALE_GENERATION', 'P3 competing writer did not fail stale');
    const electionReopen = await new OpfsCheckpointAuthority({
      root: opfsRoot,
      directoryName: p3ElectionDirectory,
      lockManager: navigator.locks
    }).open();
    const electionRestore = new MemoryVFS();
    await electionReopen.restoreInto(electionRestore);
    assert(['A','B'].includes(electionRestore.readFile('writer.txt')), 'P3 election reopened an unknown winner');
    assert(electionReopen.current?.sequence === 1, 'P3 election produced split canonical sequence');
    assert(electionReopen.current?.writerEpoch === 1, 'P3 first canonical publisher did not persist WriterEpoch 1');
    const firstWriter = writerA.writerEpoch === 1 ? writerA : writerB;
    assert(firstWriter.writerEpoch === 1, 'P3 winning authority did not retain its writer epoch');

    electionRestore.beginTransaction().writeFile('writer.txt','successor').commit();
    const successorCommit = await electionReopen.checkpoint(electionRestore);
    assert(successorCommit.writerEpoch === 2, 'P3 successor authority did not advance WriterEpoch');
    assert(successorCommit.generation === 2, 'P3 StorageGeneration did not advance only on successor commit');

    electionRestore.beginTransaction().writeFile('writer.txt','stale-must-not-publish').commit();
    let staleWriterEpochCode = null;
    let staleWriterEpochDetails = null;
    try {
      await firstWriter.checkpoint(electionRestore);
    } catch (error) {
      staleWriterEpochCode = error?.code ?? null;
      staleWriterEpochDetails = error?.details ?? null;
    }
    assert(staleWriterEpochCode === 'OC_STALE_GENERATION', 'P3 stale WriterEpoch was allowed to publish');
    assert(staleWriterEpochDetails?.expectedWriterEpoch === 1, 'P3 stale writer did not report its fenced epoch');
    assert(staleWriterEpochDetails?.currentWriterEpoch === 2, 'P3 stale writer did not observe the successor epoch');

    stage('p3-writer-election-pass', {
      fulfilled: writerFulfilled.length,
      staleRejected: writerRejected[0].reason?.code,
      sequence: successorCommit.sequence,
      firstWriterEpoch: 1,
      successorWriterEpoch: successorCommit.writerEpoch,
      successorStorageGeneration: successorCommit.generation,
      staleWriterEpochCode,
      crossContextLocking: electionReopen.crossContextLocking
    });
  } finally {
    await opfsRoot.removeEntry(p3ElectionDirectory, { recursive: true }).catch(() => {});
  }

  stage('p3-workspace-crash-start');
  const p3CrashResults = [];
  for (const phase of ['after-preflight','after-payload','after-manifest']) {
    const directoryName = opfsDirectory + '-crash-' + phase;
    try {
      const crashFs = new MemoryVFS();
      const crashAuthority = await new OpfsCheckpointAuthority({
        root: opfsRoot,
        directoryName,
        lockManager: navigator.locks
      }).open();
      crashFs.mount({ 'state.txt': 'old' });
      const stable = await crashAuthority.checkpoint(crashFs);
      crashFs.beginTransaction().writeFile('state.txt','new').commit();
      let crashCode = null;
      let crashPhase = null;
      try {
        await crashAuthority.checkpoint(crashFs,{ crashAt: phase });
      } catch (error) {
        crashCode = error?.code ?? null;
        crashPhase = error?.details?.phase ?? null;
      }
      assert(crashCode === 'OC_INVALID_STATE' && crashPhase === phase, 'P3 crash injection did not stop at ' + phase);
      const reopened = await new OpfsCheckpointAuthority({
        root: opfsRoot,
        directoryName,
        lockManager: navigator.locks
      }).open();
      const restored = new MemoryVFS();
      await reopened.restoreInto(restored);
      const expected = phase === 'after-manifest' ? 'new' : 'old';
      assert(restored.readFile('state.txt') === expected, 'P3 crash phase reopened a half-version at ' + phase);
      assert(
        reopened.current.sequence === stable.sequence + (phase === 'after-manifest' ? 1 : 0),
        'P3 crash phase canonical sequence drifted at ' + phase
      );
      p3CrashResults.push({ phase, reopened: expected, sequence: reopened.current.sequence });
    } finally {
      await opfsRoot.removeEntry(directoryName, { recursive: true }).catch(() => {});
    }
  }
  stage('p3-workspace-crash-pass', { phases: p3CrashResults });

  stage('p3-no-silent-empty-start');
  const p3FatalDirectory = opfsDirectory + '-fatal-recovery';
  try {
    const fatalFs = new MemoryVFS();
    const fatalAuthority = await new OpfsCheckpointAuthority({
      root: opfsRoot,
      directoryName: p3FatalDirectory,
      lockManager: navigator.locks
    }).open();
    fatalFs.mount({ 'state.txt': 'one' });
    const fatalFirst = await fatalAuthority.checkpoint(fatalFs);
    fatalFs.beginTransaction().writeFile('state.txt','two').commit();
    const fatalSecond = await fatalAuthority.checkpoint(fatalFs);
    const fatalWorkspace = await opfsRoot.getDirectoryHandle(p3FatalDirectory);
    const fatalGenerations = await fatalWorkspace.getDirectoryHandle('generations');
    for (const payload of [fatalFirst.payload, fatalSecond.payload]) {
      const handle = await fatalGenerations.getFileHandle(payload);
      const writer = await handle.createWritable();
      await writer.write('{"corrupt":true}');
      await writer.close();
    }
    let fatalCode = null;
    let silentEmptyFallback = null;
    try {
      await OpenContainer.boot({
        workspacePersistence: {
          root: opfsRoot,
          directoryName: p3FatalDirectory,
          lockManager: navigator.locks
        }
      });
    } catch (error) {
      fatalCode = error?.code ?? null;
      silentEmptyFallback = error?.details?.silentEmptyFallback ?? null;
    }
    assert(fatalCode === 'OC_IMPORT_INVALID', 'P3 SDK boot silently replaced invalid canonical workspace with an empty project');
    assert(silentEmptyFallback === false, 'P3 fatal recovery did not explicitly reject silent empty fallback');
    const canonicalDisposition=corruptionDisposition(PersistenceCorruptionClass.CANONICAL_SOURCE);
    assert(canonicalDisposition.action==='fail-closed','P3 canonical corruption policy drifted');
    p3CorruptionEvidence.canonicalSource={
      corruptionClass:canonicalDisposition.kind,
      action:canonicalDisposition.action,
      code:fatalCode,
      silentEmptyFallback
    };
    stage('p3-no-silent-empty-pass', { fatalCode, silentEmptyFallback, sdkBootRejected: true });
  } finally {
    await opfsRoot.removeEntry(p3FatalDirectory, { recursive: true }).catch(() => {});
  }

  stage('p3-recovery-draft-corruption-start');
  const p3DraftDirectory=opfsDirectory+'-corrupt-recovery-draft';
  try{
    const draftFs=new MemoryVFS();
    const draftAuthority=await new OpfsCheckpointAuthority({
      root:opfsRoot,
      directoryName:p3DraftDirectory,
      lockManager:navigator.locks
    }).open();
    draftFs.mount({'draft.txt':'stable'});
    const draftStable=await draftAuthority.checkpoint(draftFs);
    draftFs.beginTransaction().writeFile('draft.txt','uncommitted').commit();
    let draftCrashCode=null;
    let draftCrashDetails=null;
    try{await draftAuthority.checkpoint(draftFs,{crashAt:'after-payload'});}
    catch(error){draftCrashCode=error?.code??null;draftCrashDetails=error?.details??null;}
    assert(draftCrashCode==='OC_INVALID_STATE','P3 recovery draft crash injection did not stop after payload');
    assert(typeof draftCrashDetails?.payload==='string','P3 recovery draft did not expose orphan payload identity');
    const draftWorkspace=await opfsRoot.getDirectoryHandle(p3DraftDirectory);
    const draftGenerations=await draftWorkspace.getDirectoryHandle('generations');
    const draftPayload=await draftGenerations.getFileHandle(draftCrashDetails.payload);
    const draftWriter=await draftPayload.createWritable();
    await draftWriter.write('{"corruptRecoveryDraft":true}');
    await draftWriter.close();

    const draftReopen=await new OpfsCheckpointAuthority({
      root:opfsRoot,
      directoryName:p3DraftDirectory,
      lockManager:navigator.locks
    }).open();
    const draftRestored=new MemoryVFS();
    await draftReopen.restoreInto(draftRestored);
    assert(draftRestored.readFile('draft.txt')==='stable','P3 corrupt recovery draft displaced canonical source');
    assert(draftReopen.current?.sequence===draftStable.sequence,'P3 corrupt recovery draft advanced canonical sequence');
    const draftGc=await draftReopen.collectGarbage();
    assert(draftGc.removed.includes(draftCrashDetails.payload),'P3 corrupt recovery draft was not discardable garbage');
    const draftDisposition=corruptionDisposition(PersistenceCorruptionClass.RECOVERY_DRAFT);
    assert(draftDisposition.action==='discard-draft','P3 recovery draft corruption policy drifted');
    p3CorruptionEvidence.recoveryDraft={
      corruptionClass:draftDisposition.kind,
      action:draftDisposition.action,
      recoveredSequence:draftReopen.current.sequence,
      recoveredGeneration:draftReopen.current.generation,
      discarded:draftGc.removed.includes(draftCrashDetails.payload)
    };
    stage('p3-recovery-draft-corruption-pass',p3CorruptionEvidence.recoveryDraft);
  }finally{
    await opfsRoot.removeEntry(p3DraftDirectory,{recursive:true}).catch(()=>{});
  }

  stage('p3-derived-index-corruption-start');
  const p3DerivedDirectory=opfsDirectory+'-derived-index';
  try{
    const derivedStore=await new OpfsDerivedIndexStore({
      root:opfsRoot,
      directoryName:p3DerivedDirectory,
      lockManager:navigator.locks
    }).open();
    await derivedStore.publish({
      sourceGeneration:runtime.fs.generation,
      value:{moduleCount:3,files:['src/main.js','src/dep.js','src/sync.js']}
    });
    const derivedVerified=await derivedStore.read({sourceGeneration:runtime.fs.generation});
    assert(derivedVerified.status==='verified','P3 derived index did not verify before corruption');

    const derivedDirectory=await opfsRoot.getDirectoryHandle(p3DerivedDirectory);
    const derivedPayload=await derivedDirectory.getFileHandle('derived-index.json');
    const derivedWriter=await derivedPayload.createWritable();
    await derivedWriter.write('{"corruptDerivedIndex":true}');
    await derivedWriter.close();

    const derivedCorrupt=await derivedStore.read({sourceGeneration:runtime.fs.generation});
    assert(derivedCorrupt.status==='corrupt','P3 derived index corruption was not detected');
    assert(derivedCorrupt.corruptionClass==='derived-index'&&derivedCorrupt.action==='discard-rebuild','P3 derived index corruption classification drifted');
    const derivedRebuilt=await derivedStore.rebuild({
      sourceGeneration:runtime.fs.generation,
      value:{moduleCount:4,files:['src/main.js','src/dep.js','src/sync.js','src/late.js']}
    });
    assert(derivedRebuilt.status==='published','P3 derived index did not rebuild after corruption');
    const derivedReopen=await new OpfsDerivedIndexStore({
      root:opfsRoot,
      directoryName:p3DerivedDirectory,
      lockManager:navigator.locks
    }).open();
    const derivedRepaired=await derivedReopen.read({sourceGeneration:runtime.fs.generation});
    assert(derivedRepaired.status==='verified'&&derivedRepaired.value.moduleCount===4,'P3 derived index rebuild did not survive reopen');
    p3CorruptionEvidence.derivedIndex={
      corruptionClass:derivedCorrupt.corruptionClass,
      action:derivedCorrupt.action,
      corruptDetected:true,
      rebuilt:true,
      reopenedVerified:derivedRepaired.status==='verified',
      crossContextLocking:derivedReopen.crossContextLocking
    };
    stage('p3-derived-index-corruption-pass',p3CorruptionEvidence.derivedIndex);
  }finally{
    await opfsRoot.removeEntry(p3DerivedDirectory,{recursive:true}).catch(()=>{});
  }

  stage('p3-quota-fault-matrix-start');
  const p3QuotaFaultResults = [];
  for (const phase of ['after-0-bytes','after-1-byte','after-header','mid-payload','pre-commit','post-payload-pre-manifest']) {
    const directoryName = opfsDirectory + '-quota-' + phase;
    try {
      const quotaFs = new MemoryVFS();
      const quotaAuthority = await new OpfsCheckpointAuthority({
        root: opfsRoot,
        directoryName,
        lockManager: navigator.locks
      }).open();
      quotaFs.mount({ 'quota.txt': 'stable' });
      const stable = await quotaAuthority.checkpoint(quotaFs);
      quotaFs.beginTransaction().writeFile('quota.txt','blocked-'+phase+'-'+'x'.repeat(256)).commit();

      let quotaCode = null;
      let quotaPhase = null;
      let injectedQuota = false;
      try {
        await quotaAuthority.checkpoint(quotaFs,{ quotaFaultAt: phase });
      } catch (error) {
        quotaCode = error?.code ?? null;
        quotaPhase = error?.details?.phase ?? null;
        injectedQuota = error?.details?.injectedQuota === true;
      }
      assert(quotaCode === 'OC_RESOURCE_EXHAUSTED', 'P3 quota injection did not normalize to OC_RESOURCE_EXHAUSTED at ' + phase);
      assert(quotaPhase === phase && injectedQuota, 'P3 quota injection receipt drifted at ' + phase);

      const reopened = await new OpfsCheckpointAuthority({
        root: opfsRoot,
        directoryName,
        lockManager: navigator.locks
      }).open();
      const restored = new MemoryVFS();
      await reopened.restoreInto(restored);
      assert(restored.readFile('quota.txt') === 'stable', 'P3 quota fault changed canonical generation at ' + phase);
      assert(reopened.current.sequence === stable.sequence, 'P3 quota fault advanced canonical sequence at ' + phase);
      assert(reopened.current.generation === stable.generation, 'P3 quota fault advanced StorageGeneration at ' + phase);
      const gc = await reopened.collectGarbage();
      p3QuotaFaultResults.push({
        phase,
        quotaCode,
        sequence: reopened.current.sequence,
        generation: reopened.current.generation,
        garbageRemoved: gc.removed.length
      });
    } finally {
      await opfsRoot.removeEntry(directoryName, { recursive: true }).catch(() => {});
    }
  }
  stage('p3-quota-fault-matrix-pass', { phases: p3QuotaFaultResults });

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
    const checkpointDisposition=corruptionDisposition(PersistenceCorruptionClass.CHECKPOINT);
    assert(checkpointDisposition.action==='fallback-checkpoint','P3 checkpoint corruption policy drifted');
    p3CorruptionEvidence.checkpoint={
      corruptionClass:checkpointDisposition.kind,
      action:checkpointDisposition.action,
      corruptSequence:fourthCheckpoint.sequence,
      recoveredSequence:reopened.current.sequence,
      recoveredGeneration:reopened.current.generation,
      fallbackValue:restored.readFile('value.txt')
    };

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

  stage('p3-safe-restore-start');
  const p3SafeRestoreDirectory='opencontainer-p3-safe-restore-'+crypto.randomUUID();
  const p3SafeRestoreCrossDirectory=p3SafeRestoreDirectory+'-cross';
  const p3SafeRestoreQuotaDirectory=p3SafeRestoreDirectory+'-quota';
  try{
    const restoreProfile={
      root:opfsRoot,
      directoryName:p3SafeRestoreDirectory,
      lockManager:navigator.locks,
      storagePolicy:new BrowserStoragePolicy({storageManager:navigator.storage})
    };
    const restoreRuntime=await OpenContainer.boot({workspacePersistence:restoreProfile});
    restoreRuntime.mount({'project.txt':'old','unrelated.txt':'base'});
    const restoreTarget=await restoreRuntime.persistWorkspace();
    restoreRuntime.fs.beginTransaction()
      .writeFile('project.txt','current')
      .writeFile('unrelated.txt','newer')
      .commit();
    const restoreCurrent=await restoreRuntime.persistWorkspace();

    const stalePlan=await restoreRuntime.prepareWorkspaceRestore(restoreTarget);
    restoreRuntime.fs.beginTransaction().writeFile('unrelated.txt','after-plan').commit();
    let localConflictCode=null;
    try{await restoreRuntime.restoreWorkspaceCheckpoint(stalePlan);}
    catch(error){localConflictCode=error?.code??null;}
    assert(localConflictCode==='OC_STALE_GENERATION','P3 restore plan overwrote local work created after planning');
    assert(restoreRuntime.fs.readFile('project.txt')==='current','P3 local restore conflict changed project state');
    assert(restoreRuntime.fs.readFile('unrelated.txt')==='after-plan','P3 local restore conflict lost unrelated work');

    restoreRuntime.fs.beginTransaction().writeFile('later.txt','recover-me').commit();
    const safePlan=await restoreRuntime.prepareWorkspaceRestore(restoreTarget);
    const restoreReceipt=await restoreRuntime.restoreWorkspaceCheckpoint(safePlan);
    assert(restoreReceipt.status==='restored','P3 safe restore did not publish');
    assert(restoreReceipt.recoveryPointCreated===true,'P3 safe restore did not create pre-restore recovery point');
    assert(restoreReceipt.published.sequence===restoreReceipt.recoveryPoint.sequence+1,'P3 restore did not publish after recovery point');
    assert(restoreReceipt.published.generation===restoreReceipt.recoveryPoint.generation+1,'P3 restore did not create a new generation');
    assert(restoreReceipt.blindOverwritePrevented===true&&restoreReceipt.riskDeclared===false,'P3 restore safety receipt drifted');
    assert(restoreRuntime.fs.readFile('project.txt')==='old','P3 safe restore did not restore target project state');
    assert(restoreRuntime.fs.readFile('unrelated.txt')==='base','P3 safe restore did not restore target unrelated state');
    assert(restoreRuntime.fs.exists('later.txt')===false,'P3 safe restore left post-target file active');

    const recoverySnapshot=await restoreRuntime.workspacePersistence.readCheckpoint(restoreReceipt.recoveryPoint);
    const recoveryFs=new MemoryVFS();
    recoveryFs.restore(recoverySnapshot);
    assert(recoveryFs.readFile('project.txt')==='current','P3 recovery point lost pre-restore project state');
    assert(recoveryFs.readFile('unrelated.txt')==='after-plan','P3 recovery point lost newer unrelated work');
    assert(recoveryFs.readFile('later.txt')==='recover-me','P3 recovery point lost post-plan work');
    await restoreRuntime.terminate();

    const restoreReopen=await OpenContainer.boot({workspacePersistence:restoreProfile});
    assert(restoreReopen.fs.readFile('project.txt')==='old','P3 safe restore did not survive OPFS reopen');
    assert(restoreReopen.workspacePersistence.current?.sequence===restoreReceipt.published.sequence,'P3 safe restore reopened wrong canonical sequence');
    const restoreGc=await restoreReopen.collectWorkspaceGarbage({dryRun:true});
    assert(restoreGc.retained.includes(restoreReceipt.recoveryPoint.payload),'P3 safe restore lost recovery-point fallback');
    assert(restoreGc.retained.includes(restoreReceipt.published.payload),'P3 safe restore lost restored canonical payload');
    await restoreReopen.terminate();

    const crossFs=new MemoryVFS();
    const crossAuthority=await new OpfsCheckpointAuthority({
      root:opfsRoot,
      directoryName:p3SafeRestoreCrossDirectory,
      lockManager:navigator.locks
    }).open();
    crossFs.mount({'project.txt':'cross-old'});
    const crossTarget=await crossAuthority.checkpoint(crossFs);
    crossFs.beginTransaction().writeFile('project.txt','cross-current').commit();
    const crossCurrent=await crossAuthority.checkpoint(crossFs);
    const crossPlan=await crossAuthority.prepareCheckpointRestore(crossFs,crossTarget);

    const remoteFs=new MemoryVFS();
    remoteFs.restore(crossFs.snapshot());
    remoteFs.beginTransaction().writeFile('remote.txt','published-after-plan').commit();
    const remoteAuthority=await new OpfsCheckpointAuthority({
      root:opfsRoot,
      directoryName:p3SafeRestoreCrossDirectory,
      lockManager:navigator.locks
    }).open();
    const remotePublished=await remoteAuthority.checkpoint(remoteFs);
    assert(remotePublished.sequence===crossCurrent.sequence+1,'P3 cross-context court did not advance canonical sequence');
    let crossConflictCode=null;
    let crossConflictProtected=false;
    try{await crossAuthority.restoreCheckpoint(crossFs,crossPlan);}
    catch(error){
      crossConflictCode=error?.code??null;
      crossConflictProtected=error?.details?.blindOverwritePrevented===true&&error?.details?.restoreAborted===true;
    }
    assert(crossConflictCode==='OC_STALE_GENERATION'&&crossConflictProtected,'P3 restore overwrote cross-context newer work');
    assert(crossFs.readFile('project.txt')==='cross-current','P3 cross-context conflict mutated local working tree');
    const remoteReopen=await new OpfsCheckpointAuthority({
      root:opfsRoot,
      directoryName:p3SafeRestoreCrossDirectory,
      lockManager:navigator.locks
    }).open();
    const remoteRestored=new MemoryVFS();
    await remoteReopen.restoreInto(remoteRestored);
    assert(remoteRestored.readFile('remote.txt')==='published-after-plan','P3 cross-context conflict damaged newer canonical work');

    let quotaReject=false;
    const quotaPolicy={
      async inspect(){return {supported:true,usageBytes:quotaReject?999:100,quotaBytes:1000,pressure:quotaReject?'critical':'normal'};},
      async assertCanWrite(additionalBytes){
        if(quotaReject){
          const error=new Error('quota blocked');
          error.code='OC_RESOURCE_EXHAUSTED';
          error.details={additionalBytes,pressure:'critical'};
          throw error;
        }
        return {supported:true,additionalBytes};
      }
    };
    const quotaFs=new MemoryVFS();
    const quotaAuthority=await new OpfsCheckpointAuthority({
      root:opfsRoot,
      directoryName:p3SafeRestoreQuotaDirectory,
      lockManager:navigator.locks,
      storagePolicy:quotaPolicy
    }).open();
    quotaFs.mount({'project.txt':'quota-old'});
    const quotaTarget=await quotaAuthority.checkpoint(quotaFs);
    quotaFs.beginTransaction().writeFile('project.txt','quota-current').commit();
    const quotaCurrent=await quotaAuthority.checkpoint(quotaFs);
    quotaFs.beginTransaction().writeFile('unpersisted.txt','must-survive').commit();
    const quotaPlan=await quotaAuthority.prepareCheckpointRestore(quotaFs,quotaTarget);
    quotaReject=true;
    let quotaRestoreCode=null;
    let quotaRiskDeclared=false;
    let quotaBlindOverwritePrevented=false;
    try{await quotaAuthority.restoreCheckpoint(quotaFs,quotaPlan);}
    catch(error){
      quotaRestoreCode=error?.code??null;
      quotaRiskDeclared=error?.details?.riskDeclared===true&&error?.details?.recoveryPointCreated===false;
      quotaBlindOverwritePrevented=error?.details?.blindOverwritePrevented===true&&error?.details?.restoreAborted===true;
    }
    assert(quotaRestoreCode==='OC_RESOURCE_EXHAUSTED','P3 quota-blocked restore did not fail resource-exhausted');
    assert(quotaRiskDeclared&&quotaBlindOverwritePrevented,'P3 quota-blocked restore did not declare risk and fail closed');
    assert(quotaFs.readFile('project.txt')==='quota-current','P3 quota-blocked restore changed project state');
    assert(quotaFs.readFile('unpersisted.txt')==='must-survive','P3 quota-blocked restore lost unpersisted work');
    quotaReject=false;
    const quotaReopen=await new OpfsCheckpointAuthority({
      root:opfsRoot,
      directoryName:p3SafeRestoreQuotaDirectory,
      lockManager:navigator.locks,
      storagePolicy:quotaPolicy
    }).open();
    assert(quotaReopen.current?.sequence===quotaCurrent.sequence,'P3 quota-blocked restore changed canonical checkpoint');

    stage('p3-safe-restore-pass',{
      targetSequence:restoreTarget.sequence,
      priorCanonicalSequence:restoreCurrent.sequence,
      recoveryPointSequence:restoreReceipt.recoveryPoint.sequence,
      restoredSequence:restoreReceipt.published.sequence,
      restoredGeneration:restoreReceipt.published.generation,
      recoveryPointCreated:restoreReceipt.recoveryPointCreated,
      recoveryPointRetained:restoreGc.retained.includes(restoreReceipt.recoveryPoint.payload),
      localConflictCode,
      crossConflictCode,
      crossConflictProtected,
      remoteSequence:remotePublished.sequence,
      quotaRestoreCode,
      quotaRiskDeclared,
      quotaBlindOverwritePrevented,
      workingTreeLeaseReleased:restoreRuntime.fs.mutationLease===null
    });
  }finally{
    await opfsRoot.removeEntry(p3SafeRestoreDirectory,{recursive:true}).catch(()=>{});
    await opfsRoot.removeEntry(p3SafeRestoreCrossDirectory,{recursive:true}).catch(()=>{});
    await opfsRoot.removeEntry(p3SafeRestoreQuotaDirectory,{recursive:true}).catch(()=>{});
  }

  stage('p3-external-source-boundary-start');
  const p3ExternalBase='opencontainer-p3-external-'+crypto.randomUUID();
  const p3ImportedDirectory=p3ExternalBase+'-imported';
  const p3ReadOnlyDirectory=p3ExternalBase+'-readonly';
  const p3LinkedDirectory=p3ExternalBase+'-linked';

  class PermissionDirectoryAdapter{
    kind='directory';
    constructor(handle,permission){
      this.handle=handle;
      this.permission=permission;
      this.requestCount=0;
    }
    async queryPermission({mode='read'}={}){
      return mode==='readwrite'?this.permission.readwrite:this.permission.read;
    }
    async requestPermission({mode='read'}={}){
      this.requestCount++;
      return mode==='readwrite'?this.permission.readwrite:this.permission.read;
    }
    async getFileHandle(name,options){return this.handle.getFileHandle(name,options);}
    async getDirectoryHandle(name,options){
      const child=await this.handle.getDirectoryHandle(name,options);
      return new PermissionDirectoryAdapter(child,this.permission);
    }
    async *entries(){
      for await(const [name,handle] of this.handle.entries()){
        yield [name,handle?.kind==='directory'?new PermissionDirectoryAdapter(handle,this.permission):handle];
      }
    }
  }

  async function writeExternalText(directory,path,text){
    const parts=path.split('/');
    let current=directory;
    for(const part of parts.slice(0,-1))current=await current.getDirectoryHandle(part,{create:true});
    const file=await current.getFileHandle(parts.at(-1),{create:true});
    const writable=await file.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async function readExternalText(directory,path){
    const parts=path.split('/');
    let current=directory;
    for(const part of parts.slice(0,-1))current=await current.getDirectoryHandle(part);
    return (await (await current.getFileHandle(parts.at(-1))).getFile()).text();
  }

  try{
    const importedRaw=await opfsRoot.getDirectoryHandle(p3ImportedDirectory,{create:true});
    await writeExternalText(importedRaw,'src/main.js','source-v1');
    await writeExternalText(importedRaw,'README.md','external-readme');
    const importedPermission={read:'granted',readwrite:'denied'};
    const importedAuthority=new ExternalWorkspaceSourceAuthority({
      mode:ExternalSourceMode.IMPORTED_COPY,
      handle:new PermissionDirectoryAdapter(importedRaw,importedPermission)
    });
    const importedFs=new MemoryVFS();
    importedFs.mount({'local.txt':'preserve-local'});
    const importedReceipt=await importedAuthority.importCopyInto(importedFs);
    assert(importedReceipt.mode==='imported-copy'&&importedReceipt.detached===true,'P3 imported copy did not detach');
    assert(importedFs.readFile('src/main.js')==='source-v1','P3 imported copy did not publish staged source bytes');
    assert(importedFs.readFile('local.txt')==='preserve-local','P3 imported copy damaged prior local canonical state');
    await writeExternalText(importedRaw,'src/main.js','source-v2-outside');
    assert(importedFs.readFile('src/main.js')==='source-v1','P3 imported copy silently remained linked after import');
    const importedState=await importedAuthority.inspect();
    assert(importedState.mode==='imported-copy'&&importedState.externalRead===false&&importedState.externalWrite===false,'P3 imported-copy mode silently changed after detach');

    const readOnlyRaw=await opfsRoot.getDirectoryHandle(p3ReadOnlyDirectory,{create:true});
    await writeExternalText(readOnlyRaw,'notes.txt','read-only-source');
    const readOnlyPermission={read:'granted',readwrite:'granted'};
    const readOnlyAuthority=new ExternalWorkspaceSourceAuthority({
      mode:ExternalSourceMode.READ_ONLY_SOURCE,
      handle:new PermissionDirectoryAdapter(readOnlyRaw,readOnlyPermission)
    });
    const readOnlyState=await readOnlyAuthority.inspect();
    assert(readOnlyState.state===ExternalSourceState.READ_ONLY&&readOnlyState.externalWrite===false,'P3 read-only-source silently widened write authority');
    const readOnlyObserved=await readOnlyAuthority.readFile('notes.txt');
    assert(readOnlyObserved.data==='read-only-source','P3 read-only-source could not read external bytes');
    let readOnlyWriteCode=null;
    try{await readOnlyAuthority.writeFile('notes.txt','must-not-write');}
    catch(error){readOnlyWriteCode=error?.code??null;}
    assert(readOnlyWriteCode==='OC_STORAGE_READ_ONLY','P3 read-only-source allowed privileged write');
    assert(await readExternalText(readOnlyRaw,'notes.txt')==='read-only-source','P3 read-only-source changed external bytes');

    const linkedRaw=await opfsRoot.getDirectoryHandle(p3LinkedDirectory,{create:true});
    await writeExternalText(linkedRaw,'app.txt','linked-v1');
    const linkedPermission={read:'granted',readwrite:'granted'};
    const linkedAdapter=new PermissionDirectoryAdapter(linkedRaw,linkedPermission);
    const linkedAuthority=new ExternalWorkspaceSourceAuthority({
      mode:ExternalSourceMode.LINKED_FOLDER,
      handle:linkedAdapter
    });
    const localCanonical=new MemoryVFS();
    localCanonical.mount({'app.txt':'local-canonical-survives'});
    const linkedObserved=await linkedAuthority.readFile('app.txt');
    assert(linkedObserved.data==='linked-v1','P3 linked-folder initial read failed');

    linkedPermission.readwrite='denied';
    let permissionRevokedCode=null;
    let permissionRevokedState=null;
    let localCanonicalUnaffected=null;
    try{await linkedAuthority.writeFile('app.txt','linked-v2');}
    catch(error){
      permissionRevokedCode=error?.code??null;
      permissionRevokedState=error?.details?.state??null;
      localCanonicalUnaffected=error?.details?.localCanonicalUnaffected??null;
    }
    assert(permissionRevokedCode==='OC_INVALID_STATE','P3 linked-folder write ignored revoked permission');
    assert(permissionRevokedState==='read-only'&&localCanonicalUnaffected===true,'P3 permission loss boundary drifted');
    assert(linkedAuthority.mode==='linked-folder','P3 permission loss silently changed linked-folder mode');
    assert(await readExternalText(linkedRaw,'app.txt')==='linked-v1','P3 permission loss still wrote external bytes');
    assert(localCanonical.readFile('app.txt')==='local-canonical-survives','P3 permission loss damaged local canonical recovery copy');

    linkedPermission.readwrite='prompt';
    const permissionNeeded=await linkedAuthority.inspect();
    assert(permissionNeeded.state==='permission-needed'&&linkedAuthority.mode==='linked-folder','P3 prompt silently changed linked-folder mode');

    linkedPermission.readwrite='granted';
    await writeExternalText(linkedRaw,'app.txt','outside-edit');
    let conflictCode=null;
    let conflictState=null;
    let conflictActions=[];
    try{await linkedAuthority.writeFile('app.txt','opencontainer-overwrite');}
    catch(error){
      conflictCode=error?.code??null;
      conflictState=error?.details?.state??null;
      conflictActions=error?.details?.actions??[];
    }
    assert(conflictCode==='OC_STALE_GENERATION'&&conflictState==='external-change-detected','P3 external edit conflict did not block overwrite');
    assert(conflictActions.includes('compare')&&conflictActions.includes('merge'),'P3 external conflict recovery actions drifted');
    assert(await readExternalText(linkedRaw,'app.txt')==='outside-edit','P3 external conflict silently overwrote newer external bytes');

    const refreshed=await linkedAuthority.readFile('app.txt');
    const merged=await linkedAuthority.writeFile('app.txt','merged-version',{expectedRevision:refreshed.revision});
    assert(merged.permissionRechecked===true&&merged.silentOverwritePrevented===true,'P3 privileged external write did not recheck permission/precondition');
    assert(await readExternalText(linkedRaw,'app.txt')==='merged-version','P3 reconciled linked write did not publish');

    stage('p3-external-source-boundary-pass',{
      evidenceScope:'real-chrome-opfs-bytes+file-system-access-compatible-permission-adapter',
      nativePickerPermissionRevocationExercised:false,
      importedCopy:{
        mode:importedReceipt.mode,
        detached:importedReceipt.detached,
        externalWrite:importedReceipt.externalWrite,
        sourceChangedAfterImport:true,
        localStayedPinned:importedFs.readFile('src/main.js')==='source-v1',
        silentModeChange:importedReceipt.silentModeChange
      },
      readOnlySource:{
        mode:readOnlyAuthority.mode,
        state:readOnlyState.state,
        externalWrite:readOnlyState.externalWrite,
        writeCode:readOnlyWriteCode,
        sourceUnchanged:(await readExternalText(readOnlyRaw,'notes.txt'))==='read-only-source'
      },
      linkedFolder:{
        mode:linkedAuthority.mode,
        permissionRevokedCode,
        permissionRevokedState,
        localCanonicalUnaffected,
        permissionNeededState:permissionNeeded.state,
        conflictCode,
        conflictState,
        conflictActions,
        reconciledWriteRevision:merged.revision,
        permissionRechecked:merged.permissionRechecked,
        finalExternalValue:await readExternalText(linkedRaw,'app.txt')
      }
    });
  }finally{
    await opfsRoot.removeEntry(p3ImportedDirectory,{recursive:true}).catch(()=>{});
    await opfsRoot.removeEntry(p3ReadOnlyDirectory,{recursive:true}).catch(()=>{});
    await opfsRoot.removeEntry(p3LinkedDirectory,{recursive:true}).catch(()=>{});
  }

  stage('p3-destructive-lifecycle-start');
  const p3DeleteDirectory='opencontainer-p3-delete-'+crypto.randomUUID();
  const p3AckLossDirectory=p3DeleteDirectory+'-ack-loss';
  try{
    const deleteProfile={
      root:opfsRoot,
      directoryName:p3DeleteDirectory,
      lockManager:navigator.locks
    };
    const deleteRuntime=await OpenContainer.boot({workspacePersistence:deleteProfile});
    deleteRuntime.mount({'state.txt':'before-delete','unsaved.txt':'must-be-checkpointed'});
    const lateTx=deleteRuntime.fs.beginTransaction().writeFile('late.txt','must-not-slip-through-delete');
    const deleting=deleteRuntime.deleteWorkspaceRecoverably({mutationId:'browser-delete-1'});
    let lateMutationCode=null;
    try{lateTx.commit();}catch(error){lateMutationCode=error?.code??null;}
    assert(lateMutationCode==='OC_INVALID_STATE','P3 recoverable delete did not fence late local mutation');
    const deleteReceipt=await deleting;
    assert(deleteReceipt.state==='tombstoned','P3 recoverable delete did not tombstone workspace');
    assert(deleteReceipt.actionClass==='D2','P3 recoverable delete action class drifted');
    assert(deleteReceipt.recoverable===true&&deleteReceipt.recoverability==='tombstone+checkpoint','P3 tombstone recoverability truth drifted');

    const deleteStatus=await OpenContainer.inspectWorkspaceLifecycle(deleteProfile);
    assert(deleteStatus.state==='tombstoned','P3 lifecycle inspection lost tombstone');
    assert(deleteStatus.workspaceExists===true&&deleteStatus.recoverable===true,'P3 tombstone did not preserve workspace recovery storage');

    let tombstoneBootCode=null;
    let tombstoneBootRecoverable=null;
    try{await OpenContainer.boot({workspacePersistence:deleteProfile});}
    catch(error){
      tombstoneBootCode=error?.code??null;
      tombstoneBootRecoverable=error?.details?.recoverable??null;
    }
    assert(tombstoneBootCode==='OC_INVALID_STATE'&&tombstoneBootRecoverable===true,'P3 tombstoned workspace silently reopened');

    const restoreDeleteReceipt=await OpenContainer.restoreDeletedWorkspace(deleteProfile,{
      deleteMutationId:'browser-delete-1',
      restoreMutationId:'browser-restore-1'
    });
    assert(restoreDeleteReceipt.state==='active'&&restoreDeleteReceipt.recoverable===true,'P3 recoverable tombstone restore failed');

    const restoredDeleteRuntime=await OpenContainer.boot({workspacePersistence:deleteProfile});
    assert(restoredDeleteRuntime.fs.readFile('state.txt')==='before-delete','P3 restored tombstone lost canonical project state');
    assert(restoredDeleteRuntime.fs.readFile('unsaved.txt')==='must-be-checkpointed','P3 delete recovery point missed current working state');
    assert(restoredDeleteRuntime.fs.exists('late.txt')===false,'P3 late local mutation slipped through recoverable delete');

    restoredDeleteRuntime.fs.beginTransaction().writeFile('state.txt','before-permanent-purge').commit();
    const secondDelete=await restoredDeleteRuntime.deleteWorkspaceRecoverably({mutationId:'browser-delete-2'});
    assert(secondDelete.state==='tombstoned'&&secondDelete.recoverable===true,'P3 second delete did not remain recoverable before purge');

    const purgeReceipt=await OpenContainer.purgeDeletedWorkspace(deleteProfile,{
      deleteMutationId:'browser-delete-2',
      purgeMutationId:'browser-purge-1',
      confirmation:{
        action:'PERMANENT_PURGE',
        target:p3DeleteDirectory,
        recoverability:'none-after-purge'
      }
    });
    assert(purgeReceipt.state==='purged'&&purgeReceipt.actionClass==='D4','P3 permanent purge action class/state drifted');
    assert(purgeReceipt.recoverable===false&&purgeReceipt.recoverability==='none','P3 permanent purge falsely claimed recovery');

    const duplicatePurge=await OpenContainer.purgeDeletedWorkspace(deleteProfile,{
      deleteMutationId:'browser-delete-2',
      purgeMutationId:'browser-purge-1',
      confirmation:{
        action:'PERMANENT_PURGE',
        target:p3DeleteDirectory,
        recoverability:'none-after-purge'
      }
    });
    assert(duplicatePurge.idempotent===true,'P3 permanent purge duplicate submit was not idempotent');

    const purgeStatus=await OpenContainer.inspectWorkspaceLifecycle(deleteProfile);
    assert(purgeStatus.state==='purged'&&purgeStatus.workspaceExists===false,'P3 purge status did not reflect physical workspace removal');
    assert(purgeStatus.recoverable===false&&purgeStatus.recoverability==='none','P3 purge inspection lied about recoverability');

    let purgedBootCode=null;
    let purgedBootRecoverable=null;
    try{await OpenContainer.boot({workspacePersistence:deleteProfile});}
    catch(error){
      purgedBootCode=error?.code??null;
      purgedBootRecoverable=error?.details?.recoverable??null;
    }
    assert(purgedBootCode==='OC_INVALID_STATE'&&purgedBootRecoverable===false,'P3 purged workspace silently recreated');

    const ackProfile={
      root:opfsRoot,
      directoryName:p3AckLossDirectory,
      lockManager:navigator.locks
    };
    const ackRuntime=await OpenContainer.boot({workspacePersistence:ackProfile});
    ackRuntime.mount({'state.txt':'ack-loss-project'});
    await ackRuntime.deleteWorkspaceRecoverably({mutationId:'browser-delete-ack'});
    const ackLifecycle=await new OpfsWorkspaceLifecycleAuthority(ackProfile).open();
    let ackLossCode=null;
    let unknownOutcome=false;
    try{
      await ackLifecycle.purge({
        deleteMutationId:'browser-delete-ack',
        purgeMutationId:'browser-purge-ack',
        confirmation:{
          action:'PERMANENT_PURGE',
          target:p3AckLossDirectory,
          recoverability:'none-after-purge'
        },
        simulateAckLossAfterCommit:true
      });
    }catch(error){
      ackLossCode=error?.code??null;
      unknownOutcome=
        error?.details?.unknownOutcome===true&&
        error?.details?.mutationCommitted===true&&
        error?.details?.reconciliationRequired===true;
    }
    assert(ackLossCode==='OC_INVALID_STATE'&&unknownOutcome,'P3 purge acknowledgement-loss court did not enter unknown outcome');

    const reconciled=await OpenContainer.reconcileWorkspacePurge(ackProfile,{purgeMutationId:'browser-purge-ack'});
    assert(reconciled.state==='purged'&&reconciled.terminal===true&&reconciled.mutationFound===true,'P3 purge unknown outcome did not reconcile authoritative terminal state');
    assert(reconciled.workspaceExists===false&&reconciled.recoverable===false,'P3 purge reconciliation falsely claimed recoverability');

    stage('p3-destructive-lifecycle-pass',{
      deleteActionClass:deleteReceipt.actionClass,
      deleteRecoverable:deleteReceipt.recoverable,
      deleteRecoverability:deleteReceipt.recoverability,
      deleteRecoverySequence:deleteReceipt.recoveryPoint.sequence,
      lateMutationCode,
      tombstoneBootCode,
      tombstoneBootRecoverable,
      restoreState:restoreDeleteReceipt.state,
      restoredState:restoredDeleteRuntime.state,
      purgeActionClass:purgeReceipt.actionClass,
      purgeRecoverable:purgeReceipt.recoverable,
      purgeRecoverability:purgeReceipt.recoverability,
      duplicatePurgeIdempotent:duplicatePurge.idempotent,
      purgedBootCode,
      purgedBootRecoverable,
      ackLossCode,
      unknownOutcome,
      reconciledState:reconciled.state,
      reconciledTerminal:reconciled.terminal,
      reconciledWorkspaceExists:reconciled.workspaceExists,
      reconciledRecoverable:reconciled.recoverable
    });
  }finally{
    await opfsRoot.removeEntry(p3DeleteDirectory,{recursive:true}).catch(()=>{});
    await opfsRoot.removeEntry(p3AckLossDirectory,{recursive:true}).catch(()=>{});
    try{
      const lifecycleRegistry=await opfsRoot.getDirectoryHandle('opencontainer-workspace-lifecycle');
      await lifecycleRegistry.removeEntry(encodeURIComponent(p3DeleteDirectory)+'.json').catch(()=>{});
      await lifecycleRegistry.removeEntry(encodeURIComponent(p3AckLossDirectory)+'.json').catch(()=>{});
    }catch{}
  }

  stage('p4-artifact-boundary-start');
  runtime.net.allow({
    origin: location.origin,
    methods: ['GET'],
    paths: ['/toolchain/vendor/']
  });

  const p4Corpus = [
    {
      name: 'lightningcss-wasm',
      version: '1.33.0',
      url: location.origin + '/toolchain/vendor/lightningcss-wasm-1.33.0.tgz',
      integrity: 'sha512-OLAtqEyInBSVWjPrTjpLzcZUMUHO0q+2PFBXKr86nxZOu0P38givj/ZMtRaZ0d38pMTb9wQx+LtaLtHclv+sEA=='
    },
    {
      name: '@rolldown/browser',
      version: '1.2.9',
      url: location.origin + '/toolchain/vendor/rolldown-browser-1.2.9.tgz',
      integrity: 'sha256-mszzzf49IoetfV9JzSz83bycESq/y8KVhj5AHvRLhXY='
    }
  ];
  const p4Authority = new PackageArtifactAuthority({
    fs: runtime.fs,
    network: runtime.net,
    maxArtifactBytes: 16 * 1024 * 1024,
    maxFiles: 20_000,
    maxUnpackedBytes: 128 * 1024 * 1024
  });
  const p4CorpusReceipts = [];
  let p4LightningBytes = null;
  for (const fixture of p4Corpus) {
    const artifact = await p4Authority.fetchArtifact({
      url: fixture.url,
      integrity: fixture.integrity
    });
    const archive = await inspectTarArchive(artifact.bytes, {
      maxFiles: 20_000,
      maxUnpackedBytes: 128 * 1024 * 1024,
      requiredPrefix: 'package/'
    });
    const packageJsonEntry = archive.entries.find((entry) => entry.path === 'package/package.json' && entry.type === 'file');
    assert(packageJsonEntry?.data instanceof Uint8Array, 'P4 frozen npm corpus is missing package/package.json for ' + fixture.name);
    const packageJson = JSON.parse(new TextDecoder().decode(packageJsonEntry.data));
    assert(packageJson.name === fixture.name, 'P4 frozen npm corpus package name drifted for ' + fixture.name);
    assert(packageJson.version === fixture.version, 'P4 frozen npm corpus package version drifted for ' + fixture.name);
    p4CorpusReceipts.push({
      name: fixture.name,
      version: fixture.version,
      integrity: artifact.verified.integrity,
      compressedBytes: artifact.bytes.byteLength,
      unpackedBytes: archive.totalBytes,
      entries: archive.entries.length
    });
    if (fixture.name === 'lightningcss-wasm') p4LightningBytes = new Uint8Array(artifact.bytes);
  }
  assert(p4CorpusReceipts.length === 2 && p4LightningBytes instanceof Uint8Array, 'P4 frozen npm tarball corpus did not execute both retained fixtures');

  const p4RawTar = await p4Gunzip(p4LightningBytes);
  const p4EndOffset = p4TarEndOffset(p4RawTar);
  const p4Payload = p4FirstPayload(p4RawTar);
  assert(Number.isInteger(p4EndOffset) && p4EndOffset >= 0, 'P4 retained TAR has no end marker');
  assert(p4Payload && p4Payload.size > 0, 'P4 retained TAR has no payload entry');

  const p4Hostile = {};
  p4Hostile.truncatedHeader = await p4ExpectCode(
    'P4 truncated header',
    () => inspectTarArchive(p4RawTar.subarray(0, 127), { requiredPrefix: 'package/' }),
    'OC_ARCHIVE_UNSAFE'
  );
  p4Hostile.truncatedPayload = await p4ExpectCode(
    'P4 truncated payload',
    () => inspectTarArchive(
      p4RawTar.subarray(0, p4Payload.dataStart + Math.max(0, p4Payload.size - 1)),
      { requiredPrefix: 'package/' }
    ),
    'OC_ARCHIVE_UNSAFE'
  );
  p4Hostile.truncatedTrailer = await p4ExpectCode(
    'P4 truncated trailer',
    () => inspectTarArchive(p4RawTar.subarray(0, p4EndOffset + 512), { requiredPrefix: 'package/' }),
    'OC_ARCHIVE_UNSAFE'
  );
  p4Hostile.truncatedGzip = await p4ExpectCode(
    'P4 truncated gzip stream',
    () => inspectTarArchive(p4LightningBytes.subarray(0, p4LightningBytes.byteLength - 8), { requiredPrefix: 'package/' }),
    'OC_ARCHIVE_UNSAFE'
  );
  p4Hostile.decompressionBudget = await p4ExpectCode(
    'P4 decompression budget',
    () => inspectTarArchive(p4LightningBytes, {
      maxFiles: 1,
      maxUnpackedBytes: 128,
      requiredPrefix: 'package/'
    }),
    'OC_ARTIFACT_TOO_LARGE'
  );

  for (const [label, mutated] of [
    ['pathTraversal', p4MutateFirstTarHeader(p4RawTar, { path: 'package/../escape.js' })],
    ['absolutePath', p4MutateFirstTarHeader(p4RawTar, { path: '/etc/passwd' })],
    ['dotSegment', p4MutateFirstTarHeader(p4RawTar, { path: 'package/./escape.js' })],
    ['symlink', p4MutateFirstTarHeader(p4RawTar, { type: '2' })],
    ['hardlink', p4MutateFirstTarHeader(p4RawTar, { type: '1' })],
    ['paxExtension', p4MutateFirstTarHeader(p4RawTar, { type: 'x' })],
    ['gnuLongNameExtension', p4MutateFirstTarHeader(p4RawTar, { type: 'L' })]
  ]) {
    p4Hostile[label] = await p4ExpectCode(
      'P4 ' + label,
      () => inspectTarArchive(mutated, { requiredPrefix: 'package/' }),
      'OC_ARCHIVE_UNSAFE'
    );
  }

  const p4IntegrityRuntime = await OpenContainer.boot({ network: { allowLocal: true } });
  p4IntegrityRuntime.net.allow({
    origin: location.origin,
    methods: ['GET'],
    paths: ['/toolchain/vendor/']
  });
  const p4IntegrityLock = {
    name: 'p4-integrity-court',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'p4-integrity-court', version: '1.0.0' },
      'node_modules/lightningcss-wasm': {
        name: 'lightningcss-wasm',
        version: '1.33.0',
        resolved: p4Corpus[0].url,
        integrity: p4Corpus[0].integrity
      }
    }
  };
  p4IntegrityRuntime.packages.compile(p4IntegrityLock);
  const p4IntegrityGeneration = p4IntegrityRuntime.packages.generation;
  const p4MutatedArtifact = new Uint8Array(p4LightningBytes);
  p4MutatedArtifact[Math.max(0, p4MutatedArtifact.length - 17)] ^= 0x01;
  const p4MismatchAuthority = new PackageArtifactAuthority({
    fs: p4IntegrityRuntime.fs,
    network: p4IntegrityRuntime.net,
    fetchImpl: async () => new Response(p4MutatedArtifact, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' }
    }),
    maxArtifactBytes: 16 * 1024 * 1024,
    maxUnpackedBytes: 128 * 1024 * 1024
  });
  const p4MismatchInstaller = p4IntegrityRuntime.packages.createFrozenInstaller();
  const p4IntegrityCode = await p4ExpectCode(
    'P4 integrity mismatch',
    () => p4MismatchInstaller.installAll({ artifactAuthority: p4MismatchAuthority, concurrency: 1 }),
    'OC_ARTIFACT_INTEGRITY'
  );
  assert(p4IntegrityRuntime.packages.generation === p4IntegrityGeneration, 'P4 integrity mismatch changed package graph generation');
  assert(p4MismatchInstaller.contentStore.size === 0, 'P4 integrity mismatch published package content');
  await p4IntegrityRuntime.terminate();

  stage('p4-artifact-boundary-pass', {
    corpus: p4CorpusReceipts,
    streamingDecompression: typeof DecompressionStream === 'function',
    hostileCases: p4Hostile,
    integrityMismatch: {
      code: p4IntegrityCode,
      graphGenerationPreserved: true,
      contentPublished: false,
      installAnywayPath: false
    },
    specialTarFeaturesDefault: 'deny',
    gates: ['P4-05', 'P4-08', 'P4-09', 'P4-10', 'P4-12']
  });

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
    const sdkGraphPublication = await packageProductRuntime.packages.publishGraph({
      baseGeneration:packageProductRuntime.packageGraphStore.current?.generation??0,
      mutationId:'browser-sdk-package-persistence'
    });
    assert(packageProductRuntime.packageContentStore?.crossContextLocking === true, 'SDK package persistence profile lost content Web Locks coordination');
    assert(packageProductRuntime.packageGraphStore?.crossContextLocking === true, 'SDK package persistence profile lost graph Web Locks coordination');
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
    const sdkPackageMounted = await sdkPackageInstaller.mountFrozenGraphPersistent();
    const sdkPackageJson = JSON.parse(
      packageProductRuntime.packages.nodeModules.readFile('/workspace/node_modules/lightningcss-wasm/package.json')
    );
    assert(sdkPackageJson.name === 'lightningcss-wasm' && sdkPackageJson.version === '1.33.0', 'SDK persistent package profile lost package identity');
    stage('sdk-package-persistence-pass', {
      networkFetches: sdkPackageNetworkFetches,
      requestedContents: sdkPackageReceipt.requestedContents,
      hydratedContents: packageProductRuntime.packageContentStore.hydratedCount,
      mountedPackages: sdkPackageMounted.packageCount,
      persistentGraphGeneration: sdkGraphPublication.generation,
      publicationPrecondition: sdkPackageMounted.publicationPrecondition,
      contentCrossContextLocking: packageProductRuntime.packageContentStore.crossContextLocking,
      graphCrossContextLocking: packageProductRuntime.packageGraphStore.crossContextLocking
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

    stage('p3-low-storage-cleanup-start');
    const cleanupTempDirectory=packageCacheDirectory+'-p3-cleanup-temp';
    const cleanupDerivedDirectory=packageCacheDirectory+'-p3-cleanup-derived';
    const cleanupWorkspaceDirectory=packageCacheDirectory+'-p3-cleanup-workspace';
    try{
      const tempDirectory=await opfsRoot.getDirectoryHandle(cleanupTempDirectory,{create:true});
      const tempFile=await tempDirectory.getFileHandle('scratch.bin',{create:true});
      const tempWriter=await tempFile.createWritable();
      await tempWriter.write('t'.repeat(4096));
      await tempWriter.close();
      const temporaryBytes=(await tempFile.getFile()).size;

      const cleanupDerived=await new OpfsDerivedIndexStore({
        root:opfsRoot,
        directoryName:cleanupDerivedDirectory,
        lockManager:navigator.locks
      }).open();
      await cleanupDerived.publish({
        sourceGeneration:runtime.fs.generation,
        value:{kind:'rebuildable-index',payload:'d'.repeat(4096)}
      });
      const derivedUsage=await cleanupDerived.inspectStorage();
      assert(derivedUsage.totalBytes>0,'P3 low-storage court did not persist derived bytes');

      const packageUsage=await reopenedContent.persistedUsage(lightningNode.contentId);
      assert(packageUsage.exists&&packageUsage.totalBytes>0,'P3 low-storage court did not observe persisted public cache');

      const cleanupFs=new MemoryVFS();
      cleanupFs.mount({'canonical.txt':'one'});
      const cleanupCheckpoint=await new OpfsCheckpointAuthority({
        root:opfsRoot,
        directoryName:cleanupWorkspaceDirectory,
        lockManager:navigator.locks
      }).open();
      const cleanupFirst=await cleanupCheckpoint.checkpoint(cleanupFs);
      cleanupFs.beginTransaction().writeFile('canonical.txt','two').commit();
      const cleanupSecond=await cleanupCheckpoint.checkpoint(cleanupFs);
      const cleanupWorkspace=await opfsRoot.getDirectoryHandle(cleanupWorkspaceDirectory);
      const cleanupGenerations=await cleanupWorkspace.getDirectoryHandle('generations');
      const cleanupOrphanName='cleanup-pressure-orphan.json';
      const cleanupOrphan=await cleanupGenerations.getFileHandle(cleanupOrphanName,{create:true});
      const cleanupOrphanWriter=await cleanupOrphan.createWritable();
      await cleanupOrphanWriter.write('{"scratch":"'+ 'x'.repeat(2048) +'"}');
      await cleanupOrphanWriter.close();

      let canonicalSourceCalled=false;
      let canonicalCheckpointCalled=false;
      const cleanupCoordinator=new StorageCleanupCoordinator({sources:[
        {
          id:'temporary-scratch',
          tier:StorageCleanupTier.TEMPORARY,
          rebuildable:true,
          async reclaim(){
            await opfsRoot.removeEntry(cleanupTempDirectory,{recursive:true});
            return {reclaimedBytes:temporaryBytes,items:['scratch.bin']};
          }
        },
        {
          id:'derived-index',
          tier:StorageCleanupTier.DERIVED_REBUILDABLE,
          rebuildable:true,
          async reclaim(){
            const receipt=await cleanupDerived.discard();
            return {reclaimedBytes:receipt.reclaimedBytes,items:receipt.removed};
          }
        },
        {
          id:'public-package-cache',
          tier:StorageCleanupTier.PUBLIC_CACHE,
          rebuildable:true,
          async reclaim(){
            const receipt=await reopenedContent.evictPersisted(lightningNode.contentId);
            return {reclaimedBytes:receipt.reclaimedBytes,items:[lightningNode.contentId]};
          }
        },
        {
          id:'checkpoint-garbage',
          tier:StorageCleanupTier.CHECKPOINT_GARBAGE,
          rebuildable:false,
          async reclaim(){
            const receipt=await cleanupCheckpoint.collectGarbage();
            return {reclaimedBytes:receipt.reclaimedBytes,items:receipt.removed};
          }
        },
        {
          id:'canonical-source',
          tier:StorageCleanupTier.CANONICAL_SOURCE,
          async reclaim(){canonicalSourceCalled=true;throw new Error('canonical source cleanup must never run');}
        },
        {
          id:'canonical-checkpoint',
          tier:StorageCleanupTier.CANONICAL_CHECKPOINT,
          async reclaim(){canonicalCheckpointCalled=true;throw new Error('canonical checkpoint cleanup must never run');}
        }
      ]});

      const cleanupReceipt=await cleanupCoordinator.cleanup({targetBytes:Number.MAX_SAFE_INTEGER});
      assert(cleanupReceipt.targetSatisfied===false,'P3 cleanup unexpectedly claimed impossible headroom target');
      assert(cleanupReceipt.canonicalDeletionAttempted===false,'P3 cleanup attempted canonical deletion');
      assert(canonicalSourceCalled===false&&canonicalCheckpointCalled===false,'P3 cleanup invoked a protected canonical reclaimer');
      assert(
        JSON.stringify(cleanupReceipt.attempts.map(item=>item.tier))===
        JSON.stringify(['temporary','derived-rebuildable','public-cache','checkpoint-garbage']),
        'P3 low-storage cleanup order drifted'
      );
      assert(
        JSON.stringify(cleanupReceipt.protectedSkipped.map(item=>item.tier))===
        JSON.stringify(['canonical-source','canonical-checkpoint']),
        'P3 low-storage cleanup did not preserve canonical tiers'
      );

      let temporaryRemoved=false;
      try{await opfsRoot.getDirectoryHandle(cleanupTempDirectory);}
      catch(error){temporaryRemoved=error?.name==='NotFoundError';}
      assert(temporaryRemoved,'P3 low-storage cleanup retained temporary scratch');

      const derivedAfter=await cleanupDerived.read({sourceGeneration:runtime.fs.generation});
      assert(derivedAfter.status==='missing','P3 low-storage cleanup retained rebuildable derived index');
      const packageAfter=await reopenedContent.persistedUsage(lightningNode.contentId);
      assert(packageAfter.exists===false&&packageAfter.totalBytes===0,'P3 low-storage cleanup retained public package cache');

      const cleanupReopen=await new OpfsCheckpointAuthority({
        root:opfsRoot,
        directoryName:cleanupWorkspaceDirectory,
        lockManager:navigator.locks
      }).open();
      assert(cleanupReopen.current?.sequence===cleanupSecond.sequence,'P3 low-storage cleanup changed canonical checkpoint');
      const cleanupRestored=new MemoryVFS();
      await cleanupReopen.restoreInto(cleanupRestored);
      assert(cleanupRestored.readFile('canonical.txt')==='two','P3 low-storage cleanup damaged canonical workspace state');
      const cleanupGcDry=await cleanupReopen.collectGarbage({dryRun:true});
      assert(cleanupGcDry.retained.includes(cleanupFirst.payload),'P3 low-storage cleanup deleted fallback checkpoint');
      assert(cleanupGcDry.retained.includes(cleanupSecond.payload),'P3 low-storage cleanup deleted current checkpoint');
      assert(!cleanupGcDry.removed.includes(cleanupOrphanName),'P3 low-storage cleanup failed to remove checkpoint garbage before verification');

      const repopulatedPackage=await reopenedContent.ingest({
        contentId:lightningNode.contentId,
        integrity:lightningIntegrity,
        bytes:capturedPackageArtifact,
        expectedName:'lightningcss-wasm',
        expectedVersion:'1.33.0'
      });
      const packageRestoredUsage=await reopenedContent.persistedUsage(lightningNode.contentId);
      assert(repopulatedPackage.persisted===true&&packageRestoredUsage.exists===true,'P3 low-storage court did not restore package cache for later courts');

      stage('p3-low-storage-cleanup-pass',{
        order:cleanupReceipt.attempts.map(item=>item.tier),
        protected:cleanupReceipt.protectedSkipped.map(item=>item.tier),
        reclaimedBytes:cleanupReceipt.reclaimedBytes,
        targetSatisfied:cleanupReceipt.targetSatisfied,
        canonicalDeletionAttempted:cleanupReceipt.canonicalDeletionAttempted,
        canonicalSourceCalled,
        canonicalCheckpointCalled,
        currentSequence:cleanupReopen.current.sequence,
        fallbackSequence:cleanupFirst.sequence,
        restoredValue:cleanupRestored.readFile('canonical.txt'),
        packageCacheRebuildable:packageUsage.rebuildable,
        derivedRebuildable:derivedUsage.rebuildable
      });
    }finally{
      await opfsRoot.removeEntry(cleanupTempDirectory,{recursive:true}).catch(()=>{});
      await opfsRoot.removeEntry(cleanupDerivedDirectory,{recursive:true}).catch(()=>{});
      await opfsRoot.removeEntry(cleanupWorkspaceDirectory,{recursive:true}).catch(()=>{});
    }

    stage('p3-package-cache-corruption-start');
    const packageContentDirectory=await packageCacheRoot.getDirectoryHandle(encodeURIComponent(lightningNode.contentId));
    const corruptPackageArtifact=await packageContentDirectory.getFileHandle('artifact.tgz');
    const corruptPackageWriter=await corruptPackageArtifact.createWritable();
    await corruptPackageWriter.write(new Uint8Array([1,2,3,4]));
    await corruptPackageWriter.close();

    const corruptPackageStore=await new OpfsPackageContentStore({
      root:opfsRoot,
      directoryName:packageCacheDirectory,
      lockManager:navigator.locks
    }).open();
    const corruptHydrated=await corruptPackageStore.hydrate({
      contentId:lightningNode.contentId,
      integrity:lightningIntegrity,
      expectedName:'lightningcss-wasm',
      expectedVersion:'1.33.0'
    });
    assert(corruptHydrated===false,'P3 corrupt package cache was trusted');
    assert(corruptPackageStore.corruptCount===1,'P3 corrupt package cache was not classified as corrupt');
    let corruptPackageRefetches=0;
    const corruptPackageInstaller=runtime.packages.createFrozenInstaller({contentStore:corruptPackageStore});
    const corruptPackageRepair=await corruptPackageInstaller.installAll({
      artifactAuthority:{
        async fetchArtifact(options){
          corruptPackageRefetches++;
          return artifactAuthority.fetchArtifact(options);
        }
      },
      concurrency:1
    });
    assert(corruptPackageRefetches===1,'P3 corrupt package cache did not refetch exactly once');
    assert(corruptPackageRepair.fetchedContents===1,'P3 corrupt package cache did not republish verified content');
    assert(corruptPackageStore.corruptCount===0,'P3 package cache remained corrupt after authoritative repair');
    const packageDisposition=corruptionDisposition(PersistenceCorruptionClass.PACKAGE_CACHE);
    assert(packageDisposition.action==='discard-refetch','P3 package cache corruption policy drifted');
    p3CorruptionEvidence.packageCache={
      corruptionClass:packageDisposition.kind,
      action:packageDisposition.action,
      corruptDetected:true,
      refetches:corruptPackageRefetches,
      repaired:true
    };
    stage('p3-package-cache-corruption-pass',p3CorruptionEvidence.packageCache);

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

  const p3CorruptionClasses=[
    p3CorruptionEvidence.canonicalSource,
    p3CorruptionEvidence.recoveryDraft,
    p3CorruptionEvidence.checkpoint,
    p3CorruptionEvidence.packageCache,
    p3CorruptionEvidence.derivedIndex
  ];
  assert(p3CorruptionClasses.every(Boolean),'P3 corruption matrix did not exercise all five artifact classes');
  assert(new Set(p3CorruptionClasses.map(item=>item.corruptionClass)).size===5,'P3 corruption matrix collapsed distinct artifact classes');
  assert(new Set(p3CorruptionClasses.map(item=>item.action)).size===5,'P3 corruption matrix collapsed distinct recovery actions');
  stage('p3-corruption-matrix-pass',{
    classes:p3CorruptionEvidence,
    classCount:p3CorruptionClasses.length,
    distinctActions:new Set(p3CorruptionClasses.map(item=>item.action)).size
  });

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
      "let expectedFailureMessage = '';",
      "try {",
      "  await build({",
      "    root,",
      "    configFile: false,",
      "    logLevel: 'silent',",
      "    plugins: [vfsPlugin],",
      "    build: { write: false, rollupOptions: { input: root + '/src/__opencontainer_missing_entry__.ts' } }",
      "  });",
      "} catch (error) {",
      "  expectedFailureObserved = true;",
      "  expectedFailureMessage = error?.stack ?? error?.message ?? String(error);",
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
      "export const expectedBuildFailureMessage = expectedFailureMessage;",
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
  const p6ColdStartAt=performance.now();
  const viteExecution = await viteWorker.execute(viteGraph.entryURL, {
    exportNames: ['version'],
    observeNestedWorkers: true
  });
  const p6ColdStartMs=performance.now()-p6ColdStartAt;
  assert(viteExecution.workerCrossOriginIsolated === true, 'Vite guest worker is not cross-origin isolated');
  assert(viteExecution.exports.version === '8.3.0', 'Vite module execution returned the wrong version');
  const p6HeapSamples=[];
  const p6HeapSample=()=>Number(globalThis.performance?.memory?.usedJSHeapSize??0);
  p6HeapSamples.push(p6HeapSample());
  const p6WarmStartAt=performance.now();
  const p6WarmExecution=await viteWorker.execute(viteGraph.entryURL,{exportNames:['version'],observeNestedWorkers:true});
  const p6WarmStartMs=performance.now()-p6WarmStartAt;
  assert(p6WarmExecution.exports.version==='8.3.0','P6 warm Vite module execution returned wrong version');
  p6HeapSamples.push(p6HeapSample());
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
      'expectedBuildFailureMessage',
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
  const c1MapData=JSON.parse(c1Map?.content ?? '{}');
  assert(c1MapData.version === 3, 'Vite C1 source map is invalid');
  assert(Array.isArray(c1MapData.sources)&&c1MapData.sources.some(source=>String(source).includes('src/main.ts')), 'Vite C1 source map is invalid: TypeScript source identity missing');
  assert(Array.isArray(c1MapData.sourcesContent)&&c1MapData.sourcesContent.some(source=>String(source).includes('source-v1')), 'Vite C1 source map is invalid: original source content missing');
  assert(c1Svg?.content.includes('<svg'), 'Vite C1 imported asset was not emitted');
  const c1Manifest = JSON.parse(c1ManifestEntry?.content ?? '{}');
  assert(Object.keys(c1Manifest).length >= 1, 'Vite C1 manifest is empty');
  assert(viteBuildExecution.exports.sourceEditPersisted === true, 'Vite C1 source edit did not persist in canonical VFS');
  assert(viteBuildExecution.exports.sourceEditObserved === true, 'Vite C1 second build did not observe source edit');
  assert(viteBuildExecution.exports.configReloadObserved === true, 'Vite C1 did not re-read edited TypeScript config');
  assert(viteBuildExecution.exports.expectedBuildFailureObserved === true, 'Vite C1 failure atomicity probe did not fail as expected');
  assert(String(viteBuildExecution.exports.expectedBuildFailureMessage).includes('__opencontainer_missing_entry__'), 'Vite C1 failure diagnostic lost failing source path');
  assert(viteBuildExecution.exports.sourceUnchangedAfterFailure === true, 'Vite C1 failed build mutated canonical source');
  assert(viteBuildExecution.exports.deterministicManifest === true, 'Vite C1 normalized manifest changed across identical builds');
  assert(viteBuildExecution.exports.repeatedOutputFiles === true, 'Vite C1 output filenames changed across identical builds');
  p6HeapSamples.push(p6HeapSample());
  stage('vite-c1-build-pass', {
    outputCount: viteBuildExecution.exports.outputCount,
    outputFiles: viteBuildExecution.exports.outputFiles,
    cssBytes: c1Css.content.length,
    manifestEntries: Object.keys(c1Manifest).length,
    configPlugin: 'v1->v2',
    sourceRebuild: viteBuildExecution.exports.sourceEditObserved,
    configReload: viteBuildExecution.exports.configReloadObserved,
    failureAtomicity: viteBuildExecution.exports.sourceUnchangedAfterFailure,
    mapVersion:c1MapData.version,
    mapSources:c1MapData.sources,
    mapSourcesContent:c1MapData.sourcesContent?.length??0,
    failureDiagnosticPath:String(viteBuildExecution.exports.expectedBuildFailureMessage).includes('__opencontainer_missing_entry__'),
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

  p6HeapSamples.push(p6HeapSample());
  assert(p6HeapSamples.every(value=>Number.isFinite(value)&&value>=0),'P6 toolchain heap measurement produced invalid data');
  stage('p6-toolchain-measurement-pass',{
    coldModuleStartMs:p6ColdStartMs,
    warmModuleStartMs:p6WarmStartMs,
    warmNotClaimedAsThreshold:true,
    compiledModuleCacheEvidence:{
      compiles:1,
      workerClones:2
    },
    heapSamples:p6HeapSamples,
    heapMeasurementApi:globalThis.performance?.memory?'performance.memory.usedJSHeapSize':'unavailable-zero-sentinel',
    plateauThresholdClaimed:false
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


  stage('p5-network-secrets-preview-start');
  const p5FixturePort = Number(location.port) + 1;
  const p5FixtureOrigin = location.protocol + '//' + location.hostname + ':' + p5FixturePort;

  const p5CorsAllowed = await fetch(p5FixtureOrigin + '/allowed', { mode: 'cors', cache: 'no-store' });
  assert(p5CorsAllowed.ok && await p5CorsAllowed.text() === 'cors-allowed', 'P5 direct-browser allowed CORS court failed');
  let p5CorsDenied = false;
  try {
    await fetch(p5FixtureOrigin + '/denied', { mode: 'cors', cache: 'no-store' });
  } catch {
    p5CorsDenied = true;
  }
  assert(p5CorsDenied, 'P5 direct-browser denied CORS response unexpectedly became readable');
  const p5Opaque = await fetch(p5FixtureOrigin + '/opaque', { mode: 'no-cors', cache: 'no-store' });
  assert(p5Opaque.type === 'opaque' && p5Opaque.status === 0, 'P5 opaque response court did not stay opaque');

  let p5LnaPermission = 'descriptor-unsupported';
  try {
    const permission = await navigator.permissions.query({ name: 'local-network-access' });
    p5LnaPermission = permission.state;
  } catch (error) {
    p5LnaPermission = 'unsupported:' + (error?.name ?? 'Error');
  }
  const p5LnaResponse = await fetch(p5FixtureOrigin + '/lna', { mode: 'cors', cache: 'no-store' });
  assert(p5LnaResponse.ok && await p5LnaResponse.text() === 'lna-allowed', 'P5 declared-profile local network access fixture failed');

  const p5Runtime = await OpenContainer.boot({
    network: {
      allowLocal: true,
      maxResponseBytes: 4096,
      policyVersion: 'opencontainer-p5-browser-v1'
    }
  });
  p5Runtime.net.allow({
    origin: p5FixtureOrigin,
    methods: ['GET'],
    paths: ['/allowed','/denied','/opaque','/lna','/stream','/slow','/provider-fail','/secret-echo']
  });
  p5Runtime.net.allow({
    origin: location.origin,
    methods: ['GET'],
    paths: ['/__p5__/redirect-allowed','/__p5__/redirect-denied','/__p5__/redirect-final']
  });

  const p5Decision = p5Runtime.net.authorize(p5FixtureOrigin + '/allowed');
  assert(p5Decision.allowed === true, 'P5 capability decision did not allow explicit fixture path');
  assert(p5Decision.policyVersion === 'opencontainer-p5-browser-v1', 'P5 policy version was not retained');
  assert(/^ocnp:[0-9a-f]{16}$/.test(p5Decision.policyHash), 'P5 policy hash was not retained');

  const p5LocalGuard = await OpenContainer.boot({ network: { allowLocal: false } });
  p5LocalGuard.net.allow({ origin: 'http://127.0.0.1:' + p5FixturePort, paths: ['/allowed'] });
  p5LocalGuard.net.allow({ origin: 'http://[::1]:' + p5FixturePort, paths: ['/allowed'] });
  const p5LoopbackCases = [
    'http://127.0.0.1:' + p5FixturePort + '/allowed',
    'http://127.1:' + p5FixturePort + '/allowed',
    'http://2130706433:' + p5FixturePort + '/allowed',
    'http://[::1]:' + p5FixturePort + '/allowed'
  ];
  const p5LoopbackCodes = [];
  for (const candidate of p5LoopbackCases) {
    try {
      p5LocalGuard.net.authorize(candidate);
      p5LoopbackCodes.push('ALLOWED');
    } catch (error) {
      p5LoopbackCodes.push(error?.code ?? error?.name ?? 'ERROR');
    }
  }
  assert(p5LoopbackCodes.every((code) => code === 'OC_NETWORK_DENIED'), 'P5 alternate loopback spellings bypassed local-network deny');

  const p5AmbiguousCodes = [];
  for (const candidate of [
    'http://user:pass@127.0.0.1:' + p5FixturePort + '/allowed',
    'http://127.0.0.1\\@evil.test:' + p5FixturePort + '/allowed',
    'http://%31%32%37.0.0.1:' + p5FixturePort + '/allowed'
  ]) {
    try {
      p5Runtime.net.authorize(candidate);
      p5AmbiguousCodes.push('ALLOWED');
    } catch (error) {
      p5AmbiguousCodes.push(error?.code ?? error?.name ?? 'ERROR');
    }
  }
  assert(p5AmbiguousCodes.every((code) => code === 'OC_NETWORK_DENIED'), 'P5 ambiguous URL syntax bypassed canonical policy');

  let p5OpaqueRedirectCode = 'ALLOWED';
  try {
    await p5Runtime.net.fetch(location.origin + '/__p5__/redirect-allowed');
  } catch (error) {
    p5OpaqueRedirectCode = error?.code ?? error?.name ?? 'ERROR';
  }
  assert(
    p5OpaqueRedirectCode === 'OC_NETWORK_DENIED',
    'P5 browser manual redirect did not fail closed when Location was opaque'
  );
  let p5RedirectDeniedCode = 'ALLOWED';
  try {
    await p5Runtime.net.fetch(location.origin + '/__p5__/redirect-denied');
  } catch (error) {
    p5RedirectDeniedCode = error?.code ?? error?.name ?? 'ERROR';
  }
  assert(p5RedirectDeniedCode === 'OC_NETWORK_DENIED', 'P5 redirect widened path capability');

  let p5BudgetCode = 'ALLOWED';
  try {
    await p5Runtime.net.fetch(p5FixtureOrigin + '/stream', { maxResponseBytes: 1500 });
  } catch (error) {
    p5BudgetCode = error?.code ?? error?.name ?? 'ERROR';
  }
  assert(p5BudgetCode === 'OC_OUTPUT_LIMIT', 'P5 decoded response budget did not stop streamed bytes');

  const p5AbortController = new AbortController();
  const p5SlowFetch = p5Runtime.net.fetch(p5FixtureOrigin + '/slow', { signal: p5AbortController.signal });
  setTimeout(() => p5AbortController.abort(new DOMException('p5 abort','AbortError')), 30);
  let p5AbortName = 'ALLOWED';
  try {
    await p5SlowFetch;
  } catch (error) {
    p5AbortName = error?.name ?? error?.code ?? 'ERROR';
  }
  assert(p5AbortName === 'AbortError', 'P5 network cancellation did not propagate to body/fetch');

  const p5SecretValue = 'p5-browser-secret-' + crypto.randomUUID() + '-abcdefghijklmnopqrstuvwxyz';
  const p5SecretBinding = p5Runtime.net.bindSecret({
    value: p5SecretValue,
    header: 'authorization',
    prefix: 'Bearer ',
    scope: {
      schemes: ['http:'],
      hosts: [location.hostname],
      methods: ['GET'],
      paths: ['/secret-echo'],
      session: 'p5-session',
      process: 'p5-process',
      task: 'p5-task'
    }
  });
  assert(!JSON.stringify(p5SecretBinding).includes(p5SecretValue), 'P5 opaque secret binding exposed plaintext');
  const p5SecretResult = await p5Runtime.net.fetch(p5FixtureOrigin + '/secret-echo', {
    secretHandles: [p5SecretBinding.handle],
    context: { session: 'p5-session', process: 'p5-process', task: 'p5-task' }
  });
  const p5SecretEcho = await p5SecretResult.response.json();
  assert(p5SecretEcho.authorizationPresent === true, 'P5 authority did not inject scoped secret');
  assert(p5SecretEcho.cookiePresent === false, 'P5 authority unexpectedly sent browser cookies');
  assert(!JSON.stringify(p5SecretResult.receipt).includes(p5SecretValue), 'P5 fetch receipt leaked secret plaintext');
  assert(!JSON.stringify(p5SecretResult.receipt).includes(p5SecretBinding.handle), 'P5 fetch receipt leaked opaque secret handle');

  let p5WrongTaskCode = 'ALLOWED';
  try {
    await p5Runtime.net.fetch(p5FixtureOrigin + '/secret-echo', {
      secretHandles: [p5SecretBinding.handle],
      context: { session: 'p5-session', process: 'p5-process', task: 'wrong-task' }
    });
  } catch (error) {
    p5WrongTaskCode = error?.code ?? error?.name ?? 'ERROR';
  }
  assert(p5WrongTaskCode === 'OC_NETWORK_DENIED', 'P5 secret task scope was not enforced');

  p5Runtime.packages.compile({
    name: 'p5-no-secret-install',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: { '': { name: 'p5-no-secret-install', version: '1.0.0' } }
  });
  let p5PackageSecretCode = 'ALLOWED';
  try {
    await p5Runtime.packages.createFrozenInstaller().installAll({
      artifactAuthority: { async fetchArtifact() { throw new Error('secret-handle package fetch must not run'); } },
      secretHandles: [p5SecretBinding.handle]
    });
  } catch (error) {
    p5PackageSecretCode = error?.code ?? error?.name ?? 'ERROR';
  }
  assert(p5PackageSecretCode === 'OC_NETWORK_DENIED', 'P5 package installer accepted secret handles');

  p5Runtime.mount({ 'p5-provider-state.txt': 'canonical-before-provider-failure' });
  const p5ProviderGeneration = p5Runtime.fs.generation;
  const p5ProviderSecret = p5Runtime.net.bindSecret({
    value: 'p5-provider-key-' + crypto.randomUUID() + '-abcdefghijklmnop',
    header: 'authorization',
    prefix: 'Bearer ',
    scope: {
      schemes: ['http:'],
      hosts: [location.hostname],
      methods: ['GET'],
      paths: ['/provider-fail'],
      session: 'p5-provider-session'
    }
  });
  const p5ProviderFailure = await p5Runtime.net.fetch(p5FixtureOrigin + '/provider-fail', {
    secretHandles: [p5ProviderSecret.handle],
    context: { session: 'p5-provider-session' }
  });
  assert(p5ProviderFailure.response.status === 401, 'P5 provider failure fixture did not return 401');
  assert(p5Runtime.fs.generation === p5ProviderGeneration, 'P5 provider/API-key failure mutated canonical project generation');
  assert(p5Runtime.fs.readFile('p5-provider-state.txt') === 'canonical-before-provider-failure', 'P5 provider failure mutated canonical workspace bytes');

  p5Runtime.diagnostics.record('runtime.network', {
    authorization: 'Bearer ' + p5SecretValue,
    cookie: 'sid=' + p5SecretValue,
    url: p5FixtureOrigin + '/allowed?signature=' + encodeURIComponent(p5SecretValue),
    responseBody: 'body-' + p5SecretValue
  });
  const p5Support = p5Runtime.supportBundle();
  assert(!JSON.stringify(p5Support).includes(p5SecretValue), 'P5 diagnostics/support bundle leaked auth/cookie/query/body secret material');

  const p5PreviewBridge = new BrowserPreviewServiceWorkerBridge({
    preview: p5Runtime.preview,
    diagnostics: p5Runtime.diagnostics
  });
  await p5PreviewBridge.start();

  let p5PreviewRoute = null;
  const p5PreviewHandler = async (request) => {
    const requestUrl = new URL(request.url, 'http://opencontainer-preview.invalid');
    if (requestUrl.pathname === '/head') {
      return new Response('head-body-must-not-cross-edge', {
        status: 200,
        headers: { 'content-type': 'text/plain', 'x-p5-preview': 'head' }
      });
    }
    if (requestUrl.pathname === '/range') {
      const range = request.headers?.range ?? request.headers?.Range ?? '';
      if (range === 'bytes=1-3') {
        return new Response('bcd', {
          status: 206,
          headers: {
            'content-type': 'text/plain',
            'content-range': 'bytes 1-3/6',
            'accept-ranges': 'bytes',
            'x-p5-preview': 'range'
          }
        });
      }
      return new Response('abcdef', { status: 200, headers: { 'accept-ranges': 'bytes' } });
    }
    if (requestUrl.pathname === '/redirect') {
      return new Response(null, {
        status: 302,
        headers: { location: p5PreviewBridge.url(p5PreviewRoute, '/final'), 'x-p5-preview': 'redirect' }
      });
    }
    if (requestUrl.pathname === '/slow') {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return new Response('slow-preview', { status: 200 });
    }
    if (requestUrl.pathname === '/credential-check') {
      const hostCredentialHeaders = Boolean(
        request.headers?.cookie ||
        request.headers?.authorization ||
        request.headers?.['x-api-key'] ||
        request.headers?.['x-auth-token']
      );
      return new Response(JSON.stringify({ hostCredentialHeaders }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', 'x-p5-preview': 'credential-check' }
      });
    }
    return new Response('preview-final', {
      status: 200,
      headers: { 'content-type': 'text/plain', 'x-p5-preview': 'final' }
    });
  };
  p5PreviewRoute = p5Runtime.listen(4305, p5PreviewHandler, {
    owner: 'p5-preview-v1',
    identity: { workspace: 'p5-workspace-a', session: 'p5-session-a', version: 'p5-version-1' }
  });

  const p5Head = await fetch(p5PreviewBridge.url(p5PreviewRoute, '/head'), { method: 'HEAD', cache: 'no-store' });
  assert(p5Head.status === 200 && await p5Head.text() === '', 'P5 virtual HTTP HEAD semantics failed');
  assert(p5Head.headers.get('x-p5-preview') === 'head', 'P5 virtual HTTP response header did not cross preview edge');

  const p5Range = await fetch(p5PreviewBridge.url(p5PreviewRoute, '/range'), {
    headers: { Range: 'bytes=1-3' },
    cache: 'no-store'
  });
  assert(p5Range.status === 206 && await p5Range.text() === 'bcd', 'P5 virtual HTTP range semantics failed');
  assert(p5Range.headers.get('content-range') === 'bytes 1-3/6', 'P5 virtual HTTP Content-Range drifted');

  const p5PreviewRedirect = await fetch(p5PreviewBridge.url(p5PreviewRoute, '/redirect'), { cache: 'no-store' });
  assert(p5PreviewRedirect.status === 200 && await p5PreviewRedirect.text() === 'preview-final', 'P5 virtual HTTP redirect semantics failed');
  assert(p5PreviewRedirect.headers.get('x-p5-preview') === 'final', 'P5 virtual redirect did not reach final route');

  const p5PreviewAbort = new AbortController();
  const p5PreviewSlow = fetch(p5PreviewBridge.url(p5PreviewRoute, '/slow'), {
    signal: p5PreviewAbort.signal,
    cache: 'no-store'
  });
  setTimeout(() => p5PreviewAbort.abort(), 30);
  let p5PreviewAbortName = 'ALLOWED';
  try {
    await p5PreviewSlow;
  } catch (error) {
    p5PreviewAbortName = error?.name ?? 'ERROR';
  }
  assert(p5PreviewAbortName === 'AbortError', 'P5 virtual HTTP abort semantics failed');

  const p5OldPreviewUrl = p5PreviewBridge.url(p5PreviewRoute, '/final');
  p5PreviewRoute = p5Runtime.listen(4305, p5PreviewHandler, {
    owner: 'p5-preview-v2',
    identity: { workspace: 'p5-workspace-a', session: 'p5-session-a', version: 'p5-version-2' }
  });
  const p5StalePreview = await fetch(p5OldPreviewUrl, { redirect: 'manual', cache: 'no-store' });
  assert(p5StalePreview.status === 409, 'P5 stale Service Worker preview identity did not fail closed');
  const p5FreshPreviewUrl = p5PreviewBridge.url(p5PreviewRoute, '/final');
  const p5FreshPreview = await fetch(p5FreshPreviewUrl, { cache: 'no-store' });
  assert(p5FreshPreview.status === 200 && await p5FreshPreview.text() === 'preview-final', 'P5 fresh preview identity failed');

  const p5IdentityTamperStatus = {};
  for(const [parameter,value] of [
    ['__oc_workspace','p5-workspace-b'],
    ['__oc_session','p5-session-b'],
    ['__oc_version','p5-version-cross']
  ]){
    const tampered=new URL(p5FreshPreviewUrl);
    tampered.searchParams.set(parameter,value);
    const response=await fetch(tampered,{redirect:'manual',cache:'no-store'});
    p5IdentityTamperStatus[parameter]=response.status;
  }
  assert(
    Object.values(p5IdentityTamperStatus).every((status)=>status===409),
    'P5 Service Worker preview identity tuple allowed a cross workspace/session/version route'
  );

  const p5OfflineReceipt = p5Runtime.net.setProfile('offline');
  let p5OfflineCode = 'ALLOWED';
  try {
    p5Runtime.net.authorize(p5FixtureOrigin + '/allowed');
  } catch (error) {
    p5OfflineCode = error?.code ?? error?.name ?? 'ERROR';
  }
  assert(p5OfflineCode === 'OC_NETWORK_DENIED', 'P5 Offline profile still authorized external networking');
  const p5PreviewWhileOffline = await fetch(p5PreviewBridge.url(p5PreviewRoute, '/final'), { cache: 'no-store' });
  assert(p5PreviewWhileOffline.ok && await p5PreviewWhileOffline.text() === 'preview-final', 'P5 preview incorrectly depended on external network permission');

  globalThis.__opencontainerTrustedCanary = 'trusted-parent-' + crypto.randomUUID();
  localStorage.setItem('opencontainer-p5-host', 'trusted-storage-' + crypto.randomUUID());
  document.cookie = 'opencontainer_p5_host=trusted-cookie-' + crypto.randomUUID() + '; SameSite=Lax; path=/';

  const p5CredentialCheck = await fetch(
    p5PreviewBridge.url(p5PreviewRoute, '/credential-check'),
    { cache: 'no-store' }
  );
  assert(p5CredentialCheck.ok, 'P5 preview credential-stripping route failed');
  const p5CredentialReceipt = await p5CredentialCheck.json();
  assert(
    p5CredentialReceipt.hostCredentialHeaders === false,
    'P5 trusted preview edge forwarded host credential headers to untrusted preview authority'
  );

  const p5MaliciousHtml = '<!doctype html><meta charset="utf-8"><script>' +
    '(function(){' +
    'let parentAccess="readable";try{void parent.__opencontainerTrustedCanary;}catch(e){parentAccess=e.name;}' +
    'let storageAccess="readable";try{localStorage.getItem("opencontainer-p5-host");}catch(e){storageAccess=e.name;}' +
    'parent.postMessage({type:"opencontainer:p5-frame",parentAccess:parentAccess,storageAccess:storageAccess,locationOrigin:location.origin},"*");' +
    '})();</script>';
  const p5Frame = createSandboxedPreviewFrame({
    html: p5MaliciousHtml,
    title: 'OpenContainer P5 sandbox court'
  });
  assert(!p5Frame.sandbox.contains('allow-same-origin'), 'P5 preview sandbox accidentally grants trusted origin');

  const p5FrameReceiptPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('P5 sandboxed preview frame did not report'));
    }, 5000);
    const onMessage = (event) => {
      if (event.source !== p5Frame.contentWindow || event.data?.type !== 'opencontainer:p5-frame') return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve({ ...event.data, eventOrigin: event.origin });
    };
    window.addEventListener('message', onMessage);
  });
  document.body.appendChild(p5Frame);
  const p5FrameReceipt = await p5FrameReceiptPromise;
  assert(p5FrameReceipt.eventOrigin === 'null', 'P5 preview frame retained trusted same-origin identity');
  assert(p5FrameReceipt.parentAccess !== 'readable', 'P5 preview frame reached trusted parent credential state');
  assert(p5FrameReceipt.storageAccess !== 'readable', 'P5 preview frame reached trusted browser storage');
  p5Frame.remove();
  delete globalThis.__opencontainerTrustedCanary;
  localStorage.removeItem('opencontainer-p5-host');
  document.cookie = 'opencontainer_p5_host=; Max-Age=0; SameSite=Lax; path=/';

  p5PreviewBridge.close();
  await p5LocalGuard.teardown();
  await p5Runtime.teardown();

  stage('p5-network-secrets-preview-pass', {
    corsAllowed: p5CorsAllowed.status,
    corsDenied: p5CorsDenied,
    opaqueType: p5Opaque.type,
    lnaPermission: p5LnaPermission,
    lnaFetchStatus: p5LnaResponse.status,
    loopbackDenyCodes: p5LoopbackCodes,
    ambiguousUrlCodes: p5AmbiguousCodes,
    browserOpaqueRedirectCode: p5OpaqueRedirectCode,
    redirectDeniedCode: p5RedirectDeniedCode,
    responseBudgetCode: p5BudgetCode,
    cancellation: p5AbortName,
    secretTaskScope: p5WrongTaskCode,
    packageSecretHandles: p5PackageSecretCode,
    providerStatus: p5ProviderFailure.response.status,
    providerCanonicalGenerationUnchanged: p5Runtime.fs.generation === p5ProviderGeneration,
    supportSecretLeak: false,
    previewHead: p5Head.status,
    previewRange: p5Range.status,
    previewRedirect: p5PreviewRedirect.status,
    previewAbort: p5PreviewAbortName,
    stalePreview: p5StalePreview.status,
    identityTamperStatus: p5IdentityTamperStatus,
    previewOfflineSeparation: p5OfflineCode === 'OC_NETWORK_DENIED' && p5PreviewWhileOffline.status === 200,
    frameEventOrigin: p5FrameReceipt.eventOrigin,
    frameLocationOrigin: p5FrameReceipt.locationOrigin,
    frameParentAccess: p5FrameReceipt.parentAccess,
    frameStorageAccess: p5FrameReceipt.storageAccess,
    previewHostCredentialHeaders: p5CredentialReceipt.hostCredentialHeaders,
    frameCredentialless: 'credentialless' in p5Frame ? p5Frame.credentialless : null,
    policyVersion: p5Decision.policyVersion,
    policyHash: p5Decision.policyHash,
    downgradedProfile: p5OfflineReceipt.profile
  });

  stage('p8-support-bundle-start');
  const hostingDiagnostics = await checkHostingHeaders(location.origin + '/');
  assert(hostingDiagnostics.ok === true, 'P8 hosting diagnostics failed inside browser product path');
  const supportSecret = 'browser-support-secret-abcdefghijklmnopqrstuvwxyz-0123456789';
  runtime.diagnostics.record('custom-' + supportSecret, {
    token: supportSecret,
    requestBody: 'body-' + supportSecret,
    sourceCode: 'const secret = "' + supportSecret + '"',
    url: location.origin + '/signed?token=' + supportSecret
  });
  const supportError = Object.assign(new Error('hidden ' + supportSecret), {
    code: 'OC_INVALID_STATE',
    details: { secret: supportSecret }
  });
  const supportBefore = {
    generation: runtime.fs.generation,
    packageGeneration: runtime.packages.generation,
    previewEpoch: runtime.preview.epoch,
    diagnosticSequence: runtime.diagnostics.summary().latestSequence
  };
  const supportPreview = runtime.supportBundlePreview({
    error: supportError,
    hostingDiagnostics,
    ai: { prompt: supportSecret, transcript: supportSecret }
  });
  assert(supportPreview.categories.includes('browser-capabilities'), 'P8 preview omitted browser capabilities category');
  assert(supportPreview.categories.includes('deployment-headers'), 'P8 preview omitted deployment header category');
  assert(supportPreview.categories.includes('package-graph-identity'), 'P8 preview omitted package graph category');
  assert(supportPreview.categories.includes('storage-generation'), 'P8 preview omitted storage generation category');
  assert(supportPreview.privacy.aiContentIncluded === false, 'P8 support preview included AI content without opt-in');
  assert(supportPreview.privacy.workspaceContentsIncluded === false, 'P8 support preview includes workspace contents');

  const supportBundle = runtime.supportBundle(supportError, {
    hostingDiagnostics,
    ai: { prompt: supportSecret, transcript: supportSecret }
  });
  const supportBundleAgain = runtime.supportBundle(supportError, {
    hostingDiagnostics,
    ai: { prompt: supportSecret, transcript: supportSecret }
  });
  const supportSerialized = JSON.stringify(supportBundle);
  assert(/^ocfp:[0-9a-f]{16}$/.test(supportBundle.fingerprint), 'P8 support fingerprint format drifted');
  assert(supportBundleAgain.fingerprint === supportBundle.fingerprint, 'P8 support fingerprint is not deterministic for stable state');
  assert(supportBundle.browser.crossOriginIsolated === true, 'P8 browser probe lost crossOriginIsolated');
  assert(supportBundle.browser.sharedArrayBuffer === true, 'P8 browser probe lost SharedArrayBuffer');
  assert(supportBundle.browser.serviceWorker === true, 'P8 browser probe lost Service Worker');
  assert(supportBundle.browser.opfs === true, 'P8 browser probe lost OPFS');
  assert(supportBundle.browser.webLocks === true, 'P8 browser probe lost Web Locks');
  assert(supportBundle.hosting?.ok === true && supportBundle.hosting.failures.length === 0, 'P8 bundle hosting diagnostics are not clean');
  assert(supportBundle.packages.compiled === true && supportBundle.packages.nodeCount > 0, 'P8 package graph identity is missing');
  assert(/^ocfp:[0-9a-f]{16}$/.test(supportBundle.packages.graphFingerprint), 'P8 package graph fingerprint missing');
  assert(supportBundle.storage.workspaceGeneration === runtime.fs.generation, 'P8 storage generation drifted');
  assert(supportBundle.outcomes.recovery?.status === 'not-configured', 'P8 recovery outcome is missing');
  assert(supportBundle.outcomes.migration?.toVersion === 2, 'P8 migration outcome is missing');
  assert(
    supportBundle.outcomes.update?.compatibilityId === runtime.productionProfile.browser.serviceWorkerCompatibilityId,
    'P8 Service Worker update outcome is missing'
  );
  assert(supportBundle.telemetry.remoteEnabled === false, 'P8 Core unexpectedly enabled remote telemetry');
  assert(supportBundle.ai === null, 'P8 AI prompt/transcript was included without opt-in');
  assert(supportBundle.diagnostics.events.some((event) => event.type === '[custom]'), 'P8 custom diagnostic label was not collapsed');
  assert(supportBundle.privacy.privateSourceIncluded === false, 'P8 bundle includes private source');
  assert(supportBundle.privacy.httpBodiesIncluded === false, 'P8 bundle includes HTTP bodies');
  assert(supportBundle.privacy.rawTerminalContentIncluded === false, 'P8 bundle includes raw terminal content');
  assert(supportSerialized.includes(supportSecret) === false, 'P8 support bundle leaked secret sentinel');

  const supportAfter = {
    generation: runtime.fs.generation,
    packageGeneration: runtime.packages.generation,
    previewEpoch: runtime.preview.epoch,
    diagnosticSequence: runtime.diagnostics.summary().latestSequence
  };
  assert(JSON.stringify(supportAfter) === JSON.stringify(supportBefore), 'P8 support bundle generation mutated canonical runtime state');
  stage('p8-support-bundle-pass', {
    fingerprint: supportBundle.fingerprint,
    packageGraphFingerprint: supportBundle.packages.graphFingerprint,
    browser: supportBundle.browser,
    hostingFailures: supportBundle.hosting.failures.length,
    recovery: supportBundle.outcomes.recovery,
    migration: supportBundle.outcomes.migration,
    update: supportBundle.outcomes.update,
    diagnostics: supportBundle.diagnostics.summary,
    privacy: supportBundle.privacy,
    leakedSecret: supportSerialized.includes(supportSecret)
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
    rolldownWasiWorkerPreflight: true,
    viteModuleExecution: true,
    viteC1Build: true,
    viteC2DevServer: true,
    viteC2VirtualHttp: true,
    viteC2Hmr: true,
    viteC2RestartEpoch: true,
    viteC2PreviewRehydration: true,
    viteC2DependencyOptimization: true,
    p8SupportBundle: true,
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
