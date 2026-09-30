import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P7-RESOURCE-WAVE2-EVIDENCE.v1.0.json','utf8'));
const policy=JSON.parse(readFileSync('release/RESOURCE-MEASUREMENT-POLICY.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('P7 wave2 binds exact implementation evidence and keeps production open',()=>{
  assert.equal(evidence.schema,'opencontainer.p7-resource-wave2-evidence.v1.0');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.pullRequest,48);
  assert.equal(evidence.implementationHead,'0f71f7492ae0175d929c98c6e032dd4cf522d728');
  assert.equal(evidence.ci.runNumber,432);
  assert.equal(evidence.ci.contract,'PASS');
  assert.equal(evidence.ci.codeql,'PASS');
  assert.equal(evidence.ci.browserProductPath,'PASS');
  assert.equal(evidence.ci.resourceMeasurement,'PASS');
  assert.equal(evidence.ci.criticalTestFiles,30);
  assert.equal(evidence.ci.criticalTestFileExecutions,150);
  assert.equal(evidence.ci.fullProductPathPasses,2);
  assert.equal(evidence.ci.unexplainedFailures,0);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P7 wave2 closes exactly P7-08 and P7-13 without promoting measurement-only gates',()=>{
  assert.deepEqual(evidence.closedGates.map(item=>item.id),['P7-08','P7-13']);
  assert.deepEqual(evidence.measurementEvidenceOnly,['P7-02','P7-03','P7-04','P7-05']);
  for(const id of ['P7-08','P7-13']){
    const gate=ledger.overrides.find(item=>item.id===id);
    assert.ok(gate,id+' ledger row missing');
    assert.equal(gate.closure_met,true,id);
    assert.equal(gate.promotion,'PASS-BROWSER',id);
    assert.equal(gate.evidence,'p7-resource-wave2',id);
  }
  for(const id of evidence.measurementEvidenceOnly){
    assert.equal(evidence.closedGates.some(item=>item.id===id),false,id+' was historically closed by Wave 2');
    const gate=ledger.overrides.find(item=>item.id===id);
    if(gate?.closure_met===true){
      assert.notEqual(gate.evidence,'p7-resource-wave2',id+' was promoted from Wave 2 timing evidence alone');
      assert.equal(gate.evidence,'p7-resource-wave3',id+' later promotion must bind the stronger Wave 3 court');
    }
  }
  for(const id of ['P7-01','P7-09','P7-10','P7-12']){
    const gate=ledger.overrides.find(item=>item.id===id);
    assert.ok(!gate||gate.closure_met!==true,id+' external/device obligation was erased');
  }
  for(const id of ['P7-06','P7-11']){
    const gate=ledger.overrides.find(item=>item.id===id);
    if(gate?.closure_met===true)assert.equal(gate.evidence,'p7-resource-wave4',id+' later promotion must bind Wave 4 evidence');
  }
});

test('P7 wave2 policy and registry retain closure boundaries',()=>{
  const entry=registry.entries.find(item=>item.key==='p7-resource-wave2');
  assert.deepEqual(
    {kind:entry.kind,level:entry.level,status:entry.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  assert.equal(policy.gateAuthority['P7-08'].machineClosable,true);
  assert.equal(policy.gateAuthority['P7-13'].machineClosable,true);
  assert.deepEqual(evidence.measurementEvidenceOnly,['P7-02','P7-03','P7-04','P7-05']);
  assert.deepEqual(policy.stageMeasurements.evidenceOnlyFor,[]);
  assert.deepEqual(policy.stageMeasurements.promotedByWave3,['P7-02','P7-03','P7-04','P7-05']);
  for(const value of Object.values(evidence.boundaries))assert.equal(value,false);
});

test('P7 wave2 evidence itself is retained in the repeated critical campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/resource-governance.test.js'));
  assert.ok(flake.contract.testFiles.includes('tests/resource-retention-audit.test.js'));
  assert.ok(flake.contract.testFiles.includes('tests/p7-resource-wave2-evidence.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=31);
  assert.equal(flake.contract.iterations,5);
});
