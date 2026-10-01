import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyMemory, validateRequest, SOAK_MIN_MINUTES, evaluateEnvironment } from '../scripts/p7-external-device-court.mjs';
import { aggregateCandidate, SOAK_MIN_MS } from '../scripts/p7-external-device-aggregate.mjs';
import { deriveBudgetProposal } from '../scripts/p7-freeze-weak-device-budget.mjs';
import { validateAgainstFrozenBudgets } from '../scripts/p7-validate-weak-device-budgets.mjs';

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


test('external-device aggregation requires exact-source 4/8 GiB, 8h soak and real lifecycle evidence',()=>{
  const base={
    schema:'opencontainer.p7-external-device-run.v1.0',
    status:'PASS',
    sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
    sourceCommit:'abc123',
    closureEligible:false,
    boundaries:{productionClosed:false},
    browserSession:{status:'PASS',sampleCount:60,suspendEvents:[],durationObservedMs:30*60*1000}
  };
  const four={...structuredClone(base),mode:'weak-device',targetMemoryGiB:4,deviceId:'device-4'};
  const eight={...structuredClone(base),mode:'weak-device',targetMemoryGiB:8,deviceId:'device-8'};
  const soak={...structuredClone(base),mode:'soak',targetMemoryGiB:8,deviceId:'device-8',durationMinutes:480,browserSession:{...structuredClone(base.browserSession),durationObservedMs:SOAK_MIN_MS}};
  const lifecycle={...structuredClone(base),mode:'lifecycle',targetMemoryGiB:4,deviceId:'device-4',cpuContention:true,expectSuspend:true,browserSession:{...structuredClone(base.browserSession),suspendEvents:[{suspendGapMs:30000}]}};
  const result=aggregateCandidate({four,eight,soak,lifecycle});
  assert.equal(result.status,'PASS');
  assert.equal(result.sourceCommit,'abc123');
  assert.equal(result.readyForBudgetFreeze,true);
  assert.equal(result.closureEligible,false);
  assert.equal(result.candidateGateState['P7-01'],'READY_FOR_REVIEW');
  assert.equal(result.candidateGateState['P7-12'],'BLOCKED_BUDGET_FREEZE_AND_INDEPENDENT_VALIDATION');

  const stale=structuredClone(eight);
  stale.sourceCommit='different';
  const rejected=aggregateCandidate({four,eight:stale,soak,lifecycle});
  assert.equal(rejected.status,'FAIL');
  assert.ok(rejected.errors.some(x=>x.includes('one exact source commit')));
});


test('weak-device budget derivation is preregistered and deterministic',()=>{
  const method=JSON.parse(readFileSync('release/P7-WEAK-DEVICE-BUDGET-METHOD.v1.0.json','utf8'));
  assert.equal(method.status,'PREREGISTERED_METHOD_NO_BUDGET_VALUES');
  assert.equal(method.derivation.formulaId,'P7-WEAK-BUDGET-v1');
  assert.equal(method.derivation.latencyMultiplier,1.5);
  assert.equal(method.derivation.heapSlopeMinimumBytesPerHour,8388608);
  assert.deepEqual(method.gateBoundary.mayPrepareForReview,['P7-12','P14-14']);
  assert.deepEqual(method.gateBoundary.explicitlyNotCovered,['P9-12']);

  const common={
    schema:'opencontainer.p7-external-device-run.v1.0',status:'PASS',mode:'weak-device',
    durationMinutes:30,sourceCommit:'calibration-commit',closureEligible:false,workflowRunId:'run-a',
    browserSession:{sampleCount:30,aggregates:{
      cycleP95Ms:100,warmBootP95Ms:20,commandP95Ms:10,vfsWrite64KiBP95Ms:5,vfsRead64KiBP95Ms:4,packageGraphP95Ms:30,heapSlopeBytesPerHour:2_000_000
    }}
  };
  const four={...structuredClone(common),targetMemoryGiB:4,deviceId:'device-4'};
  const eight={...structuredClone(common),targetMemoryGiB:8,deviceId:'device-8',workflowRunId:'run-b'};
  eight.browserSession.aggregates.cycleP95Ms=120;
  eight.browserSession.aggregates.heapSlopeBytesPerHour=6_000_000;
  const proposal=deriveBudgetProposal({four,eight,method});
  assert.deepEqual(proposal.errors,[]);
  assert.equal(proposal.state,'PROPOSED_NOT_VALIDATABLE');
  assert.equal(proposal.budgets.latencyMs.cycleP95Ms,180);
  assert.equal(proposal.budgets.heapSlopeBytesPerHour,9_000_000);
  assert.equal(proposal.validationAllowed,false);
  assert.equal(proposal.closureEligible,false);
});

test('frozen weak-device budgets require fresh post-freeze validation and leave P9-12 separate',()=>{
  const method=JSON.parse(readFileSync('release/P7-WEAK-DEVICE-BUDGET-METHOD.v1.0.json','utf8'));
  const frozenAt='2026-10-01T10:30:00.000Z';
  const budget={
    schema:'opencontainer.p7-weak-device-budgets.v1.0',state:'FROZEN',formulaId:'P7-WEAK-BUDGET-v1',
    frozenAt,frozenAtSourceCommit:'freeze-commit',
    calibration:{
      fourGiB:{sha256:'cal-four',workflowRunId:'cal-run-4'},
      eightGiB:{sha256:'cal-eight',workflowRunId:'cal-run-8'}
    },
    budgets:{
      latencyMs:{
        cycleP95Ms:200,warmBootP95Ms:50,commandP95Ms:40,vfsWrite64KiBP95Ms:30,
        vfsRead64KiBP95Ms:30,packageGraphP95Ms:80
      },
      heapSlopeBytesPerHour:12_000_000
    }
  };
  const base={
    schema:'opencontainer.p7-external-device-run.v1.0',status:'PASS',mode:'weak-device',
    durationMinutes:30,startedAt:'2026-10-01T11:00:00.000Z',closureEligible:false,
    browserSession:{sampleCount:30,aggregates:{
      cycleP95Ms:150,warmBootP95Ms:30,commandP95Ms:20,vfsWrite64KiBP95Ms:10,
      vfsRead64KiBP95Ms:10,packageGraphP95Ms:50,heapSlopeBytesPerHour:5_000_000
    }}
  };
  const four={...structuredClone(base),targetMemoryGiB:4,deviceId:'validation-4',workflowRunId:'val-run-4',sourceCommit:'validation-commit'};
  const eight={...structuredClone(base),targetMemoryGiB:8,deviceId:'validation-8',workflowRunId:'val-run-8',sourceCommit:'validation-commit'};
  const result=validateAgainstFrozenBudgets({budget,four,eight,method,budgetSha256:'budget',fourSha256:'val-four',eightSha256:'val-eight'});
  assert.equal(result.status,'PASS');
  assert.equal(result.candidateGateState['P7-12'],'READY_FOR_REVIEW');
  assert.equal(result.candidateGateState['P14-14'],'READY_FOR_REVIEW');
  assert.equal(result.candidateGateState['P9-12'],'BLOCKED_SEPARATE_RENDERED_UI_EVIDENCE');
  assert.equal(result.closureEligible,false);

  const reused=structuredClone(four);
  reused.workflowRunId='cal-run-4';
  reused.startedAt='2026-10-01T10:00:00.000Z';
  const rejected=validateAgainstFrozenBudgets({budget,four:reused,eight,method,budgetSha256:'budget',fourSha256:'cal-four',eightSha256:'val-eight'});
  assert.equal(rejected.status,'FAIL');
  assert.ok(rejected.errors.some(x=>x.includes('did not start after budget freeze')));
  assert.ok(rejected.errors.some(x=>x.includes('reuses calibration')));
});
