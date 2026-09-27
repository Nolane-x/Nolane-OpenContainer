import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P3-PERSISTENCE-WAVE2-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const closed=['P3-03','P3-08'];
const remaining=['P3-07','P3-09','P3-13','P3-14','P3-15','P3-17','P3-18','P3-20'];
const quotaPhases=['after-0-bytes','after-1-byte','after-header','mid-payload','pre-commit','post-payload-pre-manifest'];

test('P3 wave2 binds exact implementation and repeated browser evidence',()=>{
  assert.equal(evidence.schema,'opencontainer.p3-persistence-wave2-evidence.v1.0');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.pullRequest,50);
  assert.equal(evidence.implementationHead,'4c8d5b1fc88ad2db49e0431dbdbd86786f50552a');
  assert.equal(evidence.ci.runNumber,459);
  assert.equal(evidence.ci.runId,36323228270);
  assert.equal(evidence.ci.testedCheckoutCommit,'e525f2be2671f81b3d416bee23f4aa15afee1e70');
  assert.equal(evidence.ci.contract,'PASS');
  assert.equal(evidence.ci.codeql,'PASS');
  assert.equal(evidence.ci.browserProductPath,'PASS');
  assert.equal(evidence.ci.criticalTestFiles,33);
  assert.equal(evidence.ci.criticalTestFileExecutions,165);
  assert.equal(evidence.ci.contractUnexplainedFailures,0);
  assert.equal(evidence.ci.browserIterations,2);
  assert.equal(evidence.ci.fullProductPathPasses,2);
  assert.equal(evidence.ci.browserUnexplainedFailures,0);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P3 wave2 closes exactly WriterEpoch fencing and quota phase safety',()=>{
  assert.deepEqual(evidence.closedGates.map(item=>item.id),closed);
  for(const id of closed){
    const row=ledger.overrides.find(item=>item.id===id);
    assert.ok(row,id+' ledger row missing');
    assert.deepEqual(
      {state:row.state,promotion:row.promotion,evidence:row.evidence,closure_met:row.closure_met},
      {state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p3-persistence-wave2',closure_met:true},
      id
    );
  }
  assert.deepEqual(evidence.browserReceiptAuthority.quotaFaultPhases,quotaPhases);
  assert.deepEqual(evidence.preservedOpenGates.map(item=>item.id),remaining);
  for(const id of remaining){
    const row=ledger.overrides.find(item=>item.id===id);
    assert.ok(!row||row.closure_met!==true,id+' stronger obligation was silently erased');
  }
});

test('P3 wave2 updates only closure state without manufacturing reconciliation rows',()=>{
  assert.equal(ledger.overrides.length,191);
  assert.equal(ledger.overrides.filter(item=>item.closure_met===true).length,153);
  const p3Rows=ledger.overrides.filter(item=>item.domain==='P3');
  assert.equal(p3Rows.length,14);
  assert.equal(p3Rows.filter(item=>item.closure_met===true).length,12);
});

test('P3 wave2 is typed executable browser evidence retained by the critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p3-persistence-wave2');
  assert.deepEqual(
    {kind:entry.kind,level:entry.level,status:entry.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/opfs-authority.test.js',
    'tests/p3-persistence-source-audit.test.js',
    'tests/p3-persistence-wave1-evidence.test.js',
    'tests/p3-persistence-wave2-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=34);
  assert.equal(flake.contract.iterations,5);
});
