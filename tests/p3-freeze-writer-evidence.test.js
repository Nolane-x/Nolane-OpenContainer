import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P3-FREEZE-WRITER-FAILOVER-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('P3 frozen-tab writer failover closure binds exact browser evidence',()=>{
  assert.equal(evidence.schema,'opencontainer.p3-freeze-writer-failover-evidence.v1.0');
  assert.equal(evidence.sourceGate,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P3-09');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.pullRequest,56);
  assert.equal(evidence.implementation.head,'74b1fb598e652f2650b0c37e28e67deab3db6d8b');
  assert.equal(evidence.implementation.ciRunNumber,565);
  assert.equal(evidence.implementation.ciRunId,36387920789);
  assert.equal(evidence.implementation.testedCheckoutCommit,'64749c2c1e20427c9cfabd4ef4b5979ada6bb144');
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.browserProductPath,'PASS');
  assert.equal(evidence.implementation.unitTests,419);
  assert.equal(evidence.implementation.unitPassed,419);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,42);
  assert.equal(evidence.implementation.contractIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,210);
  assert.equal(evidence.implementation.contractUnexplainedFailures,0);
  assert.equal(evidence.dedicatedBrowserVerification.artifactId,10954814739);
  assert.equal(evidence.dedicatedBrowserVerification.status,'PASS');
  assert.equal(evidence.dedicatedBrowserVerification.browser,'Google Chrome 153.0.8010.52');
  assert.equal(evidence.dedicatedBrowserVerification.iterations,2);
  assert.equal(evidence.dedicatedBrowserVerification.passedIterations,2);
  assert.equal(evidence.dedicatedBrowserVerification.realMultiTab,true);
  assert.equal(evidence.dedicatedBrowserVerification.realPageLifecycleFreeze,true);
  assert.equal(evidence.dedicatedBrowserVerification.writerEpochTakeover,true);
  assert.equal(evidence.dedicatedBrowserVerification.staleResumePublicationRejected,true);
  assert.equal(evidence.dedicatedBrowserVerification.canonicalPreserved,true);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P3-09 is the only gate promoted by frozen-tab failover evidence',()=>{
  const row=ledger.overrides.find(item=>item.id==='P3-09');
  assert.deepEqual(
    {domain:row?.domain,state:row?.state,promotion:row?.promotion,evidence:row?.evidence,closure_met:row?.closure_met},
    {domain:'P3',state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p3-freeze-writer-failover',closure_met:true}
  );
  assert.equal(ledger.overrides.length,195);
  assert.equal(ledger.overrides.filter(item=>item.closure_met===true).length,159);
  const p3=ledger.overrides.filter(item=>item.domain==='P3');
  assert.equal(p3.length,18);
  assert.equal(p3.filter(item=>item.closure_met===true).length,18);
  for(const id of ['P3-07','P3-18']){
    const open=ledger.overrides.find(item=>item.id===id);
    assert.ok(!open||open.closure_met!==true,id+' was silently promoted');
  }
  assert.deepEqual(evidence.preservedOpenGates,['P3-07','P3-18']);
});

test('P3-09 evidence retains exact freeze resume takeover and stale reject invariants',()=>{
  assert.ok(evidence.invariants.some(line=>line.includes('freeze lifecycle event')));
  assert.ok(evidence.invariants.some(line=>line.includes('WriterEpoch 2')));
  assert.ok(evidence.invariants.some(line=>line.includes('OC_STALE_GENERATION')));
  assert.ok(evidence.invariants.some(line=>line.includes('B1')));
  const entry=registry.entries.find(item=>item.key==='p3-freeze-writer-failover');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
});

test('P3 frozen-tab closure invariant is retained by repeated critical campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/p3-freeze-writer-evidence.test.js'));
  assert.equal(flake.contract.testFiles.length,43);
  assert.equal(flake.contract.minimumTestFiles,43);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
