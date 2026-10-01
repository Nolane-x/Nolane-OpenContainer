import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyMemory, validateRequest, SOAK_MIN_MINUTES, evaluateEnvironment } from '../scripts/p7-external-device-court.mjs';

const harness=JSON.parse(readFileSync('release/P7-EXTERNAL-DEVICE-HARNESS.v1.0.json','utf8'));
const policy=JSON.parse(readFileSync('release/RESOURCE-MEASUREMENT-POLICY.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));
const workflow=readFileSync('.github/workflows/p7-external-device-evidence.yml','utf8');
const page=readFileSync('apps/playground/public/p7-external-device.js','utf8');

test('P7 external-device harness classifies only the frozen 4/8 GiB ranges',()=>{
  assert.equal(classifyMemory(4*1024**3),4);
  assert.equal(classifyMemory(8*1024**3),8);
  assert.equal(classifyMemory(16*1024**3),null);
  assert.equal(classifyMemory(2*1024**3),null);
});

test('P7 external-device requests fail closed on shortened soak or simulated lifecycle',()=>{
  assert.equal(SOAK_MIN_MINUTES,480);
  assert.deepEqual(validateRequest({mode:'soak',targetMemoryGiB:4,durationMinutes:479,cpuContention:false,expectSuspend:false}),['soak evidence requires at least 480 minutes']);
  const lifecycle=validateRequest({mode:'lifecycle',targetMemoryGiB:8,durationMinutes:20,cpuContention:false,expectSuspend:false});
  assert.ok(lifecycle.includes('lifecycle evidence requires a real suspend/resume event'));
  assert.ok(lifecycle.includes('lifecycle evidence requires host CPU contention'));
  assert.deepEqual(validateRequest({mode:'lifecycle',targetMemoryGiB:8,durationMinutes:20,cpuContention:true,expectSuspend:true}),[]);
});

test('synthetic cgroup memory down-cap cannot masquerade as reference-device evidence',()=>{
  const result=evaluateEnvironment({
    physicalMemoryBytes:32*1024**3,effectiveMemoryBytes:4*1024**3,targetMemoryGiB:4,cgroupMemoryBytes:4*1024**3,
    runnerEnvironment:'self-hosted',nodeVersion:'v24.21.0',npmVersionValue:'11.19.0',
    browserVersionValue:'Google Chrome 153.0.8010.52',githubActions:true
  });
  assert.ok(result.errors.some(x=>x.includes('physical/VM memory')));
  assert.ok(result.errors.some(x=>x.includes('synthetic cgroup/container down-cap')));
});

test('P7 external-device workflow is manual main-only self-hosted evidence collection',()=>{
  assert.equal(harness.status,'STAGED_NOT_PROMOTED');
  assert.equal(harness.runner.workflowDispatchOnly,true);
  assert.equal(harness.phases.soak.minimumMinutes,480);
  assert.equal(harness.promotion.automaticLedgerClosure,false);
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.ok(!workflow.includes('pull_request:'));
  assert.ok(workflow.includes("github.ref == 'refs/heads/main'"));
  for(const label of ['self-hosted','opencontainer-reference-device'])assert.ok(workflow.includes(label));
  assert.ok(workflow.includes('timeout-minutes: 720'));
  assert.ok(page.includes('suspendEvents'));
  assert.ok(page.includes('heapSlopeBytesPerHour'));
});

test('Wave 5 infrastructure cannot close external/device gates',()=>{
  for(const id of ['P7-01','P7-09','P7-10','P7-12']){
    assert.equal(policy.gateAuthority[id].machineClosable,false,id);
    assert.equal(policy.gateAuthority[id].evidenceHarness,'p7-external-device',id);
    const row=ledger.overrides.find(x=>x.id===id);
    assert.ok(!row||row.closure_met!==true,id+' must remain open');
  }
  for(const id of ['P9-12','P14-14']){
    const row=ledger.overrides.find(x=>x.id===id);
    assert.ok(!row||row.closure_met!==true,id+' must remain open');
  }
  assert.deepEqual(harness.preservedOpenGates,['P7-01','P7-09','P7-10','P7-12','P9-12','P14-14']);
  assert.equal(harness.productionClosed,false);
  assert.equal(ledger.overrides.filter(x=>x.closure_met===true).length,277);
  assert.equal(ledger.production_closed,false);
});

test('external-device harness is retained by the critical contract campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/p7-external-device-harness.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=109);
  assert.equal(flake.contract.iterations,5);
});
