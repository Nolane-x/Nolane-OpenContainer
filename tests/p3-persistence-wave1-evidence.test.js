import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P3-PERSISTENCE-WAVE1-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const closed=['P3-01','P3-02','P3-04','P3-05','P3-06','P3-10','P3-11','P3-12','P3-16','P3-19'];
const preserved=['P3-03','P3-07','P3-08','P3-09','P3-13','P3-14','P3-15','P3-17','P3-18','P3-20'];

test('P3 wave1 binds exact implementation CI and preserves production boundary',()=>{
  assert.equal(evidence.schema,'opencontainer.p3-persistence-wave1-evidence.v1.0');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.pullRequest,49);
  assert.equal(evidence.implementationHead,'1cbc9df096759d4cc4b108c25add5ba0359d7a58');
  assert.equal(evidence.ci.runNumber,444);
  assert.equal(evidence.ci.contract,'PASS');
  assert.equal(evidence.ci.codeql,'PASS');
  assert.equal(evidence.ci.browserProductPath,'PASS');
  assert.equal(evidence.ci.criticalTestFiles,32);
  assert.equal(evidence.ci.criticalTestFileExecutions,160);
  assert.equal(evidence.ci.fullProductPathPasses,2);
  assert.equal(evidence.ci.explainedFailures,0);
  assert.equal(evidence.ci.unexplainedFailures,0);
  assert.equal(evidence.ci.excludedHarnessFailures,0);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P3 wave1 receipt closes exactly its ten certified gates and remains historical',()=>{
  assert.deepEqual(evidence.closedGates.map(item=>item.id),closed);
  for(const id of closed){
    const row=ledger.overrides.find(item=>item.id===id);
    assert.ok(row,id+' ledger row missing');
    assert.equal(row.state,'EVIDENCE',id);
    assert.equal(row.promotion,'PASS-BROWSER',id);
    assert.equal(row.evidence,'p3-persistence-wave1',id);
    assert.equal(row.closure_met,true,id);
  }
  assert.ok(ledger.overrides.length>=191);
  assert.ok(ledger.overrides.filter(item=>item.closure_met===true).length>=151);
});

test('P3 wave1 preserves its original open-boundary receipt without blocking later stronger evidence',()=>{
  assert.deepEqual(evidence.preservedOpenGates.map(item=>item.id),preserved);
  for(const id of ['P3-07','P3-09','P3-18']){
    const row=ledger.overrides.find(item=>item.id===id);
    assert.ok(!row||row.closure_met!==true,id+' was silently promoted');
  }
  for(const id of ['P3-03','P3-08','P3-13','P3-14','P3-15','P3-17','P3-20']){
    assert.ok(evidence.preservedOpenGates.some(item=>item.id===id),id+' wave1 history drifted');
    const row=ledger.overrides.find(item=>item.id===id);
    assert.ok(row?.closure_met===true,id+' was not promoted by later evidence');
    assert.notEqual(row.evidence,'p3-persistence-wave1',id+' later closure was misattributed to wave1');
  }
  const p3Rows=ledger.overrides.filter(item=>item.domain==='P3');
  assert.ok(p3Rows.length>=14);
  assert.ok(p3Rows.filter(item=>item.closure_met===true).length>=14);
});

test('P3 wave1 is typed browser evidence and its courts remain in critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p3-persistence-wave1');
  assert.deepEqual(
    {kind:entry.kind,level:entry.level,status:entry.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/opfs-authority.test.js',
    'tests/sdk-workspace-persistence.test.js',
    'tests/release-storage-migration.test.js',
    'tests/p3-persistence-source-audit.test.js',
    'tests/p3-persistence-wave1-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=33);
  assert.equal(flake.contract.iterations,5);
});
