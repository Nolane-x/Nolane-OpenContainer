import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P7-RESOURCE-WAVE1-EVIDENCE.v1.0.json','utf8'));
const policy=JSON.parse(readFileSync('release/RESOURCE-MEASUREMENT-POLICY.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('P7 wave-1 evidence binds declared profile and CI #428 without manufacturing a device floor',()=>{
  assert.equal(evidence.schema,'opencontainer.p7-resource-wave1-evidence.v1.0');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.minimumClosure,'PASS-INTEGRATION + declared-profile evidence');
  assert.equal(evidence.pullRequest,47);
  assert.equal(evidence.implementationHead,'506afe66d65c1df71d9fd9e585e1a82bda428ce1');
  assert.equal(evidence.ci.runNumber,428);
  assert.equal(evidence.ci.criticalTestFileExecutions,140);
  assert.equal(evidence.ci.contractUnexplainedFailures,0);
  assert.equal(evidence.ci.fullProductPathPasses,2);
  assert.equal(evidence.ci.browserUnexplainedFailures,0);
  assert.equal(evidence.ci.resourceMeasurement,'PASS');
  assert.equal(evidence.evidenceProfile.id,'desktop-chrome153-ubuntu2404-x64-ci');
  assert.equal(evidence.evidenceProfile.browser,'Google Chrome 153.0.8010.52');
  assert.equal(evidence.evidenceProfile.resourceFloorClaimed,false);
  assert.deepEqual(evidence.measurement.durationsMs,[45200,35285]);
  assert.deepEqual(
    Object.keys(evidence.measurement.validityThreats),
    ['warmup','cache','cpuThrottling','gc','thermal','network','devtools']
  );
  for(const key of Object.keys(evidence.claims))assert.equal(evidence.claims[key],false,key);
  assert.equal(evidence.productionClosed,false);
});

test('P7 wave-1 receipt closes exactly P7-07 and P7-14 and preserves its historical boundaries',()=>{
  assert.deepEqual(evidence.closedGates.map(x=>x.id),['P7-07','P7-14']);
  assert.deepEqual(
    evidence.preservedOpenGates.map(x=>x.id),
    ['P7-01','P7-08','P7-09','P7-12']
  );
  assert.equal(evidence.preservedOpenGates.find(x=>x.id==='P7-08').state,'PARTIAL');
  for(const id of ['P7-07','P7-14']){
    const row=ledger.overrides.find(x=>x.id===id);
    assert.ok(row,id+' current ledger row missing');
    assert.deepEqual(
      {state:row.state,promotion:row.promotion,evidence:row.evidence,closure_met:row.closure_met},
      {state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p7-resource-wave1',closure_met:true}
    );
    assert.equal(policy.gateAuthority[id].machineClosable,true,id);
  }
  const entry=registry.entries.find(x=>x.key==='p7-resource-wave1');
  assert.deepEqual({kind:entry.kind,level:entry.level,status:entry.status},{kind:'EXECUTABLE',level:'BROWSER',status:'PASS'});
  assert.ok(ledger.overrides.length>=185);
  assert.ok(ledger.overrides.filter(x=>x.closure_met).length>=139);
  assert.equal(ledger.production_closed,false);
});

test('P7 wave-1 cannot erase device long-run or weak-device boundaries',()=>{
  for(const id of ['P7-01','P7-09','P7-12']){
    assert.equal(policy.gateAuthority[id].machineClosable,false,id);
    assert.equal(ledger.overrides.some(x=>x.id===id&&x.closure_met===true),false,id);
  }
  assert.equal(evidence.claims.weakDeviceFloor,false);
  assert.equal(evidence.claims.eightHourPlateau,false);
  assert.equal(evidence.claims.latencyFloor,false);
  assert.equal(evidence.evidenceProfile.resourceFloorClaimed,false);
});

test('P7 wave-1 closure test remains in the repeated critical campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/resource-governance.test.js'));
  assert.ok(flake.contract.testFiles.includes('tests/p7-resource-evidence.test.js'));
  assert.ok(flake.contract.testFiles.length>=29);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.equal(flake.contract.iterations,5);
});
