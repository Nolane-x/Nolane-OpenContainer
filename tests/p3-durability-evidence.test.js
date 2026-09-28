import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P3-OPFS-DURABILITY-BOUNDARY-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('P3 explicit OPFS durability closure binds exact declared-profile evidence',()=>{
  assert.equal(evidence.schema,'opencontainer.p3-opfs-durability-boundary-evidence.v1.0');
  assert.equal(evidence.sourceGate,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P3-07');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.pullRequest,57);

  assert.equal(evidence.implementation.head,'57e7ee4b9733cfbbceff582160a284999124f2ff');
  assert.equal(evidence.implementation.ciRunNumber,586);
  assert.equal(evidence.implementation.ciRunId,36391769739);
  assert.equal(evidence.implementation.testedCheckoutCommit,'682705a7a177e07a4f6d49e2d8770697e2eb794e');
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.browserProductPath,'PASS');
  assert.equal(evidence.implementation.unitTests,427);
  assert.equal(evidence.implementation.unitPassed,427);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,43);
  assert.equal(evidence.implementation.contractIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,215);
  assert.equal(evidence.implementation.contractUnexplainedFailures,0);
  assert.equal(evidence.implementation.browserIterations,2);
  assert.equal(evidence.implementation.fullProductPathPasses,2);
  assert.equal(evidence.implementation.browserUnexplainedFailures,0);

  assert.equal(evidence.dedicatedBrowserVerification.artifactId,10956533718);
  assert.equal(evidence.dedicatedBrowserVerification.schema,'opencontainer.p3-opfs-durability-boundary-browser.v1.0');
  assert.equal(evidence.dedicatedBrowserVerification.status,'PASS');
  assert.equal(evidence.dedicatedBrowserVerification.iterations,2);
  assert.equal(evidence.dedicatedBrowserVerification.fullProductPathPasses,2);
  assert.equal(evidence.dedicatedBrowserVerification.unexplainedFailures,0);
  assert.equal(evidence.dedicatedBrowserVerification.firstGeneration.sequence,1);
  assert.equal(evidence.dedicatedBrowserVerification.secondGeneration.sequence,2);
  assert.equal(evidence.dedicatedBrowserVerification.secondGeneration.reopenedBulkBytes,98304);
  assert.equal(
    evidence.dedicatedBrowserVerification.secondGeneration.reopenedSha256,
    'af480198b2991f900344418551bfad052296ca0b0f2e5b43e548778ad1d1709e'
  );
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P3-07 closure states the browser-visible durability boundary and explicit non-claims',()=>{
  const boundary=evidence.exactBoundary.join('\n');
  for(const term of [
    "createSyncAccessHandle({mode:'readwrite'})",
    'flush()',
    'close()',
    'manifest',
    'fresh checkpoint authority'
  ]) assert.ok(boundary.includes(term),term);

  const nonClaims=evidence.explicitNonClaims.join('\n');
  assert.ok(nonClaims.includes('power-loss durability'));
  assert.ok(nonClaims.includes('hardware/filesystem/controller cache persistence'));
  assert.ok(nonClaims.includes('eviction'));
});

test('P3-07 is the only gate promoted by durability boundary evidence',()=>{
  const row=ledger.overrides.find(item=>item.id==='P3-07');
  assert.deepEqual(
    {domain:row?.domain,state:row?.state,promotion:row?.promotion,evidence:row?.evidence,closure_met:row?.closure_met},
    {domain:'P3',state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p3-opfs-durability-boundary',closure_met:true}
  );

  assert.equal(ledger.overrides.length,196);
  assert.equal(ledger.overrides.filter(item=>item.closure_met===true).length,160);

  const p3=ledger.overrides.filter(item=>item.domain==='P3');
  assert.equal(p3.length,19);
  assert.equal(p3.filter(item=>item.closure_met===true).length,19);

  const p318=ledger.overrides.find(item=>item.id==='P3-18');
  assert.ok(!p318||p318.closure_met!==true,'P3-18 was silently promoted');
  assert.deepEqual(evidence.preservedOpenGates,['P3-18']);
});

test('P3 durability closure is typed browser evidence retained by repeated critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p3-opfs-durability-boundary');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );

  for(const file of [
    'tests/p3-durability-source-audit.test.js',
    'tests/p3-durability-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);

  assert.equal(flake.contract.testFiles.length,45);
  assert.equal(flake.contract.minimumTestFiles,45);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
