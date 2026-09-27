import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P15-RELEASE-COMPATIBILITY-MATRIX-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const matrix=JSON.parse(readFileSync('release/RELEASE-COMPATIBILITY-MATRIX.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('P15-05 evidence binds the per-release matrix to CI #421 and the declared profile',()=>{
  assert.equal(evidence.schema,'opencontainer.p15-release-compatibility-matrix-evidence.v1.0');
  assert.equal(evidence.sourceGate,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P15-05');
  assert.equal(evidence.minimumClosure,'RELEASE-READY evidence');
  assert.equal(evidence.pullRequest,45);
  assert.equal(evidence.implementationHead,'51142c03da23bee52dd85c1beeba40a8184ca00e');
  assert.equal(evidence.ci.runNumber,421);
  assert.equal(evidence.ci.matrixStatus,'PASS');
  assert.equal(evidence.ci.matrixRows,7);
  assert.equal(evidence.ci.evidenceBackedRows,1);
  assert.equal(evidence.ci.unverifiedRows,6);
  assert.equal(evidence.ci.sourceDigestCount,6);
  assert.equal(evidence.ci.criticalTestFileExecutions,120);
  assert.equal(evidence.ci.contractUnexplainedFailures,0);
  assert.equal(evidence.ci.fullProductPathPasses,2);
  assert.equal(evidence.ci.browserUnexplainedFailures,0);
  assert.equal(evidence.evidenceProfile.id,'desktop-chrome153-ubuntu2404-x64-ci');
  assert.equal(evidence.evidenceProfile.browserMinimumsFrozen,false);
  assert.equal(evidence.evidenceProfile.resourceFloorClaimed,false);
  assert.equal(evidence.productionClosed,false);
});

test('P15-05 closes while P15-12 and broader browser/resource gates remain open',()=>{
  const rows=ledger.overrides.filter(x=>x.domain==='P15');
  assert.equal(rows.length,14);
  assert.equal(rows.filter(x=>x.closure_met===true).length,13);
  assert.deepEqual(rows.filter(x=>x.state==='PARTIAL').map(x=>x.id),['P15-12']);
  const p1505=rows.find(x=>x.id==='P15-05');
  assert.deepEqual(
    {state:p1505.state,promotion:p1505.promotion,evidence:p1505.evidence,closure_met:p1505.closure_met},
    {state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p15-release-compatibility-matrix',closure_met:true}
  );
  const entry=registry.entries.find(x=>x.key==='p15-release-compatibility-matrix');
  assert.deepEqual({kind:entry.kind,level:entry.level,status:entry.status},{kind:'EXECUTABLE',level:'BROWSER',status:'PASS'});
  assert.equal(ledger.overrides.some(x=>x.id==='P11-13'&&x.closure_met===true),false);
  assert.equal(ledger.overrides.some(x=>x.id==='P14-13'&&x.closure_met===true),false);
  assert.equal(matrix.browserMinimumsFrozen,false);
  assert.equal(matrix.resourceFloorClaimed,false);
  // P15 owns exact P15 closure; later domains may legitimately grow global totals.
  assert.ok(ledger.overrides.length>=183);
  assert.ok(ledger.overrides.filter(x=>x.closure_met===true).length>=126);
  assert.equal(rows.filter(x=>x.state==='PARTIAL').length,1);
  assert.equal(ledger.production_closed,false);
});

test('P15-05 closure evidence is repeated in the critical contract campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/release-compatibility-matrix.test.js'));
  assert.ok(flake.contract.testFiles.includes('tests/p15-compatibility-matrix-evidence.test.js'));
  assert.ok(flake.contract.testFiles.length>=25);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.equal(flake.contract.iterations,5);
});
