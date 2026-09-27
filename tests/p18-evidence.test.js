import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const matrix=JSON.parse(readFileSync('release/P18-EVIDENCE-ASSURANCE-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('P18 evidence matrix binds all 12 research-integrity gates to CI #401',()=>{
  assert.equal(matrix.schema,'opencontainer.p18-evidence-assurance-evidence.v1.0');
  assert.equal(matrix.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(matrix.minimumClosure,'RELEASE-READY evidence');
  assert.equal(matrix.pullRequest,41);
  assert.equal(matrix.implementationHead,'bc283647ee9ab04a5ee645eb0a41c8236e97fb40');
  assert.equal(matrix.ci.runNumber,401);
  assert.equal(matrix.ci.contractIterations,5);
  assert.equal(matrix.ci.criticalTestFileExecutions,65);
  assert.equal(matrix.ci.fullProductPathPasses,2);
  assert.equal(matrix.ci.unexplainedFailures,0);
  assert.equal(matrix.assuranceBundles.contract.verified,true);
  assert.equal(matrix.assuranceBundles.browser.verified,true);
  assert.equal(matrix.productionClosed,false);
  assert.deepEqual(matrix.gates.map(item=>item.id),Array.from({length:12},(_,i)=>'P18-'+String(i+1).padStart(2,'0')));
  assert.ok(matrix.gates.every(item=>item.state==='EVIDENCE'&&item.promotion==='PASS-BROWSER'&&item.closureMet===true&&item.evidence.length>30));
});

test('P18 ledger and registry cannot drift from the closed evidence matrix',()=>{
  const rows=ledger.overrides.filter(item=>item.domain==='P18');
  assert.equal(rows.length,12);
  assert.deepEqual(rows.map(item=>item.id),matrix.gates.map(item=>item.id));
  assert.ok(rows.every(item=>item.state==='EVIDENCE'&&item.promotion==='PASS-BROWSER'&&item.evidence==='p18-evidence-assurance'&&item.closure_met===true));
  const entry=registry.entries.find(item=>item.key==='p18-evidence-assurance');
  assert.deepEqual({kind:entry.kind,level:entry.level,status:entry.status},{kind:'EXECUTABLE',level:'BROWSER',status:'PASS'});
  assert.equal(ledger.overrides.length,150);
  assert.equal(ledger.overrides.filter(item=>item.closure_met===true).length,93);
  assert.equal(ledger.overrides.filter(item=>item.state==='PARTIAL').length,37);
  assert.equal(ledger.production_closed,false);
});

test('P18 closure test is itself inside the repeated critical contract campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/evidence-assurance.test.js'));
  assert.ok(flake.contract.testFiles.includes('tests/p18-evidence.test.js'));
  assert.equal(flake.contract.minimumTestFiles,14);
});
