import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P9-UI-RENDERED-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const closed=[
  'P9-01','P9-02','P9-04','P9-06','P9-07','P9-08','P9-09',
  'P9-10','P9-13','P9-14','P9-15','P9-16','P9-17','P9-18'
];
const intentionallyOpen=['P9-03','P9-05','P9-11','P9-12'];

test('P9 rendered receipt binds CI #931 and the retained Chrome artifact',()=>{
  assert.equal(evidence.schema,'opencontainer.p9-ui-rendered-evidence.v1.0');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.minimumClosure,'PASS-INTEGRATION + declared-profile evidence');
  assert.equal(evidence.pullRequest,69);
  assert.equal(evidence.implementation.head,'4ff13eded0d073f3cb69e209d36b439ee5949f6e');
  assert.equal(evidence.implementation.ciRunNumber,931);
  assert.equal(evidence.implementation.jobsPassed,14);
  assert.equal(evidence.implementation.contractTests,597);
  assert.equal(evidence.implementation.contractPassed,597);
  assert.equal(evidence.implementation.criticalTestFileExecutions,455);
  assert.equal(evidence.implementation.criticalUnexplainedFailures,0);
  assert.equal(evidence.dedicatedCourt.artifactId,11068103043);
  assert.equal(evidence.dedicatedCourt.artifactDigest,'sha256:bf5583dff66bef7a0fe37b0de3bbf5b6bc5d2d7c68fa73251e48e70bbe8eb7d9');
  assert.equal(evidence.dedicatedCourt.browser,'Google Chrome 153.0.8010.52');
  assert.equal(evidence.dedicatedCourt.viewports,5);
  assert.deepEqual(evidence.dedicatedCourt.sourceGates,closed);
  assert.deepEqual(evidence.intentionallyOpenGates.map(x=>x.id),intentionallyOpen);
  assert.equal(evidence.boundaries.productionClosed,false);
});

test('P9 promotion closes exactly the 14 machine-closable gates with browser evidence',()=>{
  for(const id of closed){
    const row=ledger.overrides.find(x=>x.id===id);
    assert.ok(row,id+' ledger row missing');
    assert.deepEqual(
      {domain:row.domain,state:row.state,promotion:row.promotion,evidence:row.evidence,closure_met:row.closure_met},
      {domain:'P9',state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p9-ui-rendered',closure_met:true}
    );
  }
  for(const id of intentionallyOpen){
    assert.equal(
      ledger.overrides.some(x=>x.id===id&&x.evidence==='p9-ui-rendered'&&x.closure_met===true),
      false,
      id+' must not be promoted by the rendered court'
    );
  }
  const entry=registry.entries.find(x=>x.key==='p9-ui-rendered');
  assert.deepEqual(
    {kind:entry.kind,level:entry.level,status:entry.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  assert.ok(ledger.overrides.length>=264);
  assert.ok(ledger.overrides.filter(x=>x.closure_met===true).length>=254);
  assert.equal(ledger.production_closed,false);
});

test('P9 boundaries preserve human and weak-device obligations',()=>{
  assert.equal(evidence.boundaries.failureRegistry280Claimed,false);
  assert.equal(evidence.boundaries.manualScreenReaderClaimed,false);
  assert.equal(evidence.boundaries.humanComprehensionClaimed,false);
  assert.equal(evidence.boundaries.weakDeviceLongSessionClaimed,false);
  assert.equal(evidence.boundaries.crossBrowserClaimed,false);
});

test('P9 source and promotion evidence remain in the repeated critical campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/p9-ui-source-audit.test.js'));
  assert.ok(flake.contract.testFiles.includes('tests/p9-ui-evidence.test.js'));
  assert.ok(flake.contract.testFiles.length>=92);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.equal(flake.contract.iterations,5);
});
