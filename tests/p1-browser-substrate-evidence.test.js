import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P1-BROWSER-SUBSTRATE-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const closed=[
  'P1-01','P1-02','P1-03','P1-04','P1-05','P1-06','P1-07',
  'P1-08','P1-09','P1-10','P1-11','P1-12','P1-16'
];
const intentionallyOpen=['P1-13','P1-14','P1-15'];

test('P1 evidence binds exact implementation and browser receipt',()=>{
  assert.equal(evidence.schema,'opencontainer.p1-browser-substrate-evidence.v1.0');
  assert.equal(evidence.source,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.minimumClosure,'PASS-INTEGRATION + declared-profile evidence');
  assert.equal(evidence.pullRequest,66);
  assert.deepEqual(evidence.closedGates,closed);
  assert.deepEqual(evidence.intentionallyOpenGates.map(item=>item.id),intentionallyOpen);

  assert.equal(evidence.implementation.head,'d4a08451b78f7891aafb4cd1d10caf04075c50d2');
  assert.equal(evidence.implementation.ciRunNumber,863);
  assert.equal(evidence.implementation.ciRunId,36558101758);
  assert.equal(evidence.implementation.testedCheckoutCommit,'bd12c487d18c9bb1c3b6e99924bd2def6cbf5799');
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.browserProductPath,'PASS');
  assert.equal(evidence.implementation.unitTests,545);
  assert.equal(evidence.implementation.unitPassed,545);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,84);
  assert.equal(evidence.implementation.contractIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,420);
  assert.equal(evidence.implementation.browserIterations,2);
  assert.equal(evidence.implementation.fullProductPathPasses,2);

  const court=evidence.dedicatedReleaseCourt;
  assert.equal(court.artifactId,11028266315);
  assert.equal(court.artifactDigest,'sha256:e584c8f6f95a29d9ff1c1005f2e4139bdb445775fad15e02007845e43bb6b705');
  assert.equal(court.status,'PASS');
  assert.equal(court.browser,'Google Chrome 153.0.8010.52');
  assert.equal(court.bfcacheRestored,true);
  assert.equal(court.persistentStorageGranted,true);
});

test('P1 substrate guarantees preserve optional and external boundaries',()=>{
  assert.equal(evidence.browserHarness.managedNavigationPolicyObserved,false);
  assert.equal(evidence.browserHarness.crossOriginIsolated,true);
  assert.equal(evidence.browserHarness.sharedArrayBuffer,true);
  assert.equal(evidence.browserHarness.atomics,true);
  assert.equal(evidence.browserHarness.baselineIsolationWithoutDip,true);
  assert.equal(evidence.browserHarness.documentIsolationPolicyRequired,false);
  assert.equal(evidence.lifecycleAndRecovery.realFreezeResume,true);
  assert.equal(evidence.lifecycleAndRecovery.realBfCacheRestore,true);
  assert.equal(evidence.lifecycleAndRecovery.fullRefreshRecoveryFromOpfs,true);
  assert.equal(evidence.lifecycleAndRecovery.unloadFinalSaveDependency,false);
  assert.equal(evidence.lifecycleAndRecovery.actualMultiTabWebLocks,true);
  assert.equal(evidence.lifecycleAndRecovery.staleOpfsWriterRejected,'OC_STALE_GENERATION');
  assert.equal(evidence.storage.bestEffortEviction.reopenAsMissing,true);
  assert.equal(evidence.storage.persistentClass.persistedAfterGrant,true);
  assert.equal(evidence.storage.persistentClass.survivesTargetCloseAndReopen,true);
  assert.equal(evidence.p1DomainClosed,false);
  assert.equal(evidence.productionClosed,false);
});

test('P1 wave promotes exactly 13 gates and keeps external/field gates open',()=>{
  const rows=ledger.overrides.filter(item=>item.evidence==='p1-browser-substrate');
  assert.deepEqual(rows.map(item=>item.id).sort(),[...closed].sort());
  for(const row of rows){
    assert.equal(row.domain,'P1');
    assert.equal(row.state,'EVIDENCE');
    assert.equal(row.promotion,'PASS-INTEGRATION');
    assert.equal(row.closure_met,true);
  }

  assert.equal(ledger.overrides.length,231);
  assert.equal(ledger.overrides.filter(item=>item.closure_met===true).length,221);
  assert.equal(ledger.overrides.filter(item=>item.domain==='P1'&&item.closure_met===true).length,13);

  for(const id of intentionallyOpen){
    const row=ledger.overrides.find(item=>item.id===id);
    assert.notEqual(row?.evidence,'p1-browser-substrate',id+' was incorrectly attributed to the P1 browser substrate wave');
    assert.notEqual(row?.closure_met,true,id+' was incorrectly closed');
  }
  assert.equal(ledger.production_closed,false);
});

test('P1 evidence is registered and retained by critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p1-browser-substrate');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/p1-browser-substrate-source-audit.test.js',
    'tests/browser-storage-policy.test.js',
    'tests/opfs-authority.test.js',
    'tests/p1-browser-substrate-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=85);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
