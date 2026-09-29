import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P2-RUNTIME-PROCESS-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const closed=Array.from({length:14},(_,index)=>'P2-'+String(index+1).padStart(2,'0'));

test('P2 release evidence binds exact implementation and Chrome court',()=>{
  assert.equal(evidence.schema,'opencontainer.p2-runtime-process-evidence.v1.0');
  assert.equal(evidence.source,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.minimumClosure,'RELEASE-READY evidence');
  assert.equal(evidence.pullRequest,65);
  assert.deepEqual(evidence.closedGates.map(item=>item.id),closed);

  assert.equal(evidence.implementation.head,'b2182f11cc03222da96568e06ac9951b7fe3b3fb');
  assert.equal(evidence.implementation.ciRunNumber,851);
  assert.equal(evidence.implementation.ciRunId,36531642488);
  assert.equal(evidence.implementation.testedCheckoutCommit,'adaff9d616188b227c96d37fcd0d7bec30485c83');
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.browserProductPath,'PASS');
  assert.equal(evidence.implementation.unitTests,538);
  assert.equal(evidence.implementation.unitPassed,538);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,81);
  assert.equal(evidence.implementation.contractIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,405);
  assert.equal(evidence.implementation.contractUnexplainedFailures,0);
  assert.equal(evidence.implementation.browserIterations,2);
  assert.equal(evidence.implementation.fullProductPathPasses,2);

  const court=evidence.dedicatedReleaseCourt;
  assert.equal(court.artifactId,11016743685);
  assert.equal(court.artifactDigest,'sha256:5c96152181fd0f10a9ad274e381c34c5df3d624dc2a0d92a77f7ecf7eb06fb5f');
  assert.equal(court.status,'PASS');
  assert.equal(court.nodeVersion,'v24.21.0');
  assert.equal(court.browser,'Google Chrome 153.0.8010.52');
  assert.equal(court.iterations,2);
  assert.equal(court.passedIterations,2);
  assert.deepEqual(court.sourceGates,closed);
});

test('P2 runtime guarantees remain explicit and bounded',()=>{
  assert.equal(evidence.rpc.actualBrowserWorker,true);
  assert.equal(evidence.rpc.duplicateTerminalSuppression,true);
  assert.equal(evidence.rpc.timeoutCode,'OC_WORKER_TIMEOUT');
  assert.equal(evidence.rpc.timeoutMutationState,'UNKNOWN');
  assert.equal(evidence.rpc.reconciledMutationState,'APPLIED');
  assert.equal(evidence.rpc.staleEpochCode,'OC_WORKER_STALE');
  assert.equal(evidence.rpc.workerCrashCode,'OC_GUEST_WORKER_FAILED');
  assert.equal(evidence.rpc.workerCrashStages,3);
  assert.equal(evidence.rpc.crashStageResourceLeaks,0);

  assert.deepEqual(evidence.cancellation.lineage,['root','broker','producer','consumer']);
  assert.equal(evidence.cancellation.allAborted,true);
  assert.equal(evidence.cancellation.pendingReadersAfterAbort,0);

  assert.equal(evidence.syncRpc.reentrantCode,'OC_INVALID_STATE');
  assert.equal(evidence.syncRpc.deniedCode,'OC_BUILTIN_UNAVAILABLE');

  assert.equal(evidence.process.terminalRaceCasesPerIteration,60);
  assert.deepEqual(evidence.process.terminalCountsUnique,[1]);
  assert.deepEqual(evidence.process.terminalReasons,['killed','natural-exit','throw']);
  assert.equal(evidence.process.drainTimeoutBounded,true);
  assert.equal(evidence.process.parentCode,128);
  assert.equal(evidence.process.childCode,128);
  assert.equal(evidence.process.detachedCode,0);
  assert.equal(evidence.process.staleVirtualPortCode,'OC_PREVIEW_STALE');
  assert.equal(evidence.process.floodObservedBytes,16384);
  assert.equal(evidence.process.repeatedCyclesPerIteration,200);
  assert.equal(evidence.process.retainedActiveProcesses,0);
  assert.equal(evidence.process.retainedResourceUsageZero,true);

  assert.equal(evidence.chromiumPressure.transferableBytes,8388608);
  assert.equal(evidence.chromiumPressure.transferableDetached,true);
  assert.equal(evidence.chromiumPressure.checksum,14336);
  assert.equal(evidence.chromiumPressure.pressureElements,2000000);
  assert.equal(evidence.chromiumPressure.thresholdClaimed,false);

  assert.equal(evidence.boundaries.hostOsProcessesClaimed,false);
  assert.equal(evidence.boundaries.rawTcpUdpParityClaimed,false);
  assert.equal(evidence.boundaries.fullNodeStreamsClaimed,false);
});

test('P2 promotion closes exactly all fourteen P2 gates while production remains open',()=>{
  const rows=ledger.overrides.filter(item=>item.evidence==='p2-runtime-process');
  assert.deepEqual(rows.map(item=>item.id).sort(),[...closed].sort());
  for(const row of rows){
    assert.equal(row.domain,'P2');
    assert.equal(row.state,'EVIDENCE');
    assert.equal(row.promotion,'PASS-BROWSER');
    assert.equal(row.closure_met,true);
  }

  assert.equal(ledger.overrides.length,224);
  assert.equal(ledger.overrides.filter(item=>item.closure_met===true).length,208);
  const p2=ledger.overrides.filter(item=>item.domain==='P2'&&item.closure_met===true);
  assert.equal(p2.length,14);
  assert.deepEqual(p2.map(item=>item.id).sort(),[...closed].sort());
  assert.equal(evidence.p2DomainClosed,true);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P2 evidence is registered and retained by the monotonic critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p2-runtime-process');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/runtime.test.js',
    'tests/p2-runtime-contracts.test.js',
    'tests/p2-runtime-source-audit.test.js',
    'tests/worker-authority.test.js',
    'tests/browser-guest-worker.test.js',
    'tests/sync-rpc.test.js',
    'tests/p2-runtime-evidence.test.js'
  ])assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=82);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
