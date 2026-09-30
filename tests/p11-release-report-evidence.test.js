import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const matrix=JSON.parse(readFileSync('release/P11-RELEASE-COMPATIBILITY-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('P11-14 release compatibility report is bound to CI #417 and the declared profile',()=>{
  assert.equal(matrix.schema,'opencontainer.p11-release-compatibility-evidence.v1.0');
  assert.equal(matrix.sourceGate,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P11-14');
  assert.equal(matrix.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(matrix.minimumClosure,'PASS-INTEGRATION + declared-profile evidence');
  assert.equal(matrix.pullRequest,44);
  assert.equal(matrix.implementationHead,'676fcec1b4b8b1fad108c28ab7d71595d5b368db');
  assert.equal(matrix.ci.runNumber,417);
  assert.equal(matrix.ci.reportStatus,'PASS');
  assert.equal(matrix.ci.limitationCount,5);
  assert.equal(matrix.ci.unsupportedClassCount,4);
  assert.equal(matrix.ci.knownIssueCount,4);
  assert.equal(matrix.ci.sourceDigestCount,7);
  assert.equal(matrix.ci.criticalTestFileExecutions,110);
  assert.equal(matrix.ci.contractUnexplainedFailures,0);
  assert.equal(matrix.ci.fullProductPathPasses,2);
  assert.equal(matrix.ci.browserUnexplainedFailures,0);
  assert.equal(matrix.report.declaredEvidenceProfile,'desktop-chrome153-ubuntu2404-x64-ci');
  assert.equal(matrix.productionClosed,false);
});

test('P11-14 closes without promoting P11-12 publication or P11-13 browser floors',()=>{
  const p1114=ledger.overrides.find(x=>x.id==='P11-14');
  assert.deepEqual(
    {state:p1114.state,promotion:p1114.promotion,evidence:p1114.evidence,closure_met:p1114.closure_met},
    {state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p11-release-compatibility-report',closure_met:true}
  );
  const p1112=ledger.overrides.find(x=>x.id==='P11-12');
  assert.equal(p1112.state,'PARTIAL');
  assert.equal(p1112.closure_met,false);
  const p1113=ledger.overrides.find(x=>x.id==='P11-13');
  if(p1113?.closure_met===true)assert.equal(p1113.evidence,'p11-browser-floor');
  assert.deepEqual(matrix.preservedOpenGates.map(x=>x.id),['P11-12','P11-13']);
  const entry=registry.entries.find(x=>x.key==='p11-release-compatibility-report');
  assert.deepEqual({kind:entry.kind,level:entry.level,status:entry.status},{kind:'EXECUTABLE',level:'BROWSER',status:'PASS'});
  const p11rows=ledger.overrides.filter(x=>x.domain==='P11');
  assert.ok(p11rows.length>=13,'later P11 promotions may add reconciliation rows');
  assert.ok(p11rows.filter(x=>x.closure_met===true).length>=12,'later P11 promotions may increase closure');
  assert.deepEqual(p11rows.filter(x=>x.state==='PARTIAL').map(x=>x.id),['P11-12']);
  assert.ok(ledger.overrides.length>=182);
  assert.ok(ledger.overrides.filter(x=>x.closure_met===true).length>=125);
  assert.equal(ledger.production_closed,false);
});

test('P11-14 closure evidence is itself repeated in the critical campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/release-compatibility-report.test.js'));
  assert.ok(flake.contract.testFiles.includes('tests/p11-release-report-evidence.test.js'));
  assert.ok(flake.contract.testFiles.length>=23);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.equal(flake.contract.iterations,5);
});
