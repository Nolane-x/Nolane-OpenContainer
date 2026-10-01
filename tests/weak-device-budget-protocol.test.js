import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeProductSourceFingerprint } from '../scripts/product-source-fingerprint.mjs';
import { freezeBudget, validateBudgetEvidence } from '../scripts/weak-device-budget.mjs';
import { validateUiRequest } from '../scripts/weak-device-ui-court.mjs';

const protocol=JSON.parse(readFileSync('release/WEAK-DEVICE-BUDGET-PROTOCOL.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));
const workflow=readFileSync('.github/workflows/weak-device-ui-evidence.yml','utf8');
const sampler=readFileSync('apps/playground/public/weak-device-ui-sampler.js','utf8');

function receipt({cls,run,device,phase='calibration',fingerprint='fp',scale=1,durationMinutes=30}){
  const agg={
    viewSwitchP95Ms:10*scale,
    aiModeSwitchP95Ms:12*scale,
    saveCanonicalP95Ms:30*scale,
    processRunP95Ms:40*scale,
    cycleP95Ms:80*scale,
    heapSlopeBytesPerHour:2*1024*1024*scale,
    heapPeakBytes:128*1024*1024*scale
  };
  return {
    schema:'opencontainer.weak-device-ui-run.v1.0',
    status:'PASS',
    productSourceFingerprint:fingerprint,
    measurementProtocolFingerprint:'protocol-v1',
    sourceCommit:'source-'+fingerprint,
    workflowRunId:String(run),
    deviceId:device,
    phase,
    targetMemoryGiB:cls,
    durationMinutes,
    closureEligible:false,
    browserSession:{
      schema:'opencontainer.weak-device-ui-session.v1.0',
      status:'PASS',
      durationObservedMs:durationMinutes*60*1000,
      aggregates:agg
    },
    boundaries:{productionClosed:false}
  };
}

test('weak-device UI workflow remains manual self-hosted and measures the real shell',()=>{
  assert.equal(protocol.status,'PREREGISTERED_NOT_VALIDATED');
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.ok(!workflow.includes('pull_request:'));
  assert.ok(workflow.includes('self-hosted'));
  assert.ok(workflow.includes('opencontainer-reference-device'));
  assert.ok(workflow.includes("github.ref == 'refs/heads/main'"));
  assert.ok(sampler.includes("frame.contentWindow"));
  assert.ok(sampler.includes("__openContainerUi"));
  assert.ok(sampler.includes("ui.saveSource()"));
  assert.ok(sampler.includes("ui.runProcess('ui:healthy')"));
});

test('UI request floors are preregistered before evidence exists',()=>{
  assert.deepEqual(validateUiRequest({phase:'calibration',targetMemoryGiB:4,durationMinutes:29}),['calibration/validation requires at least 30 minutes']);
  assert.deepEqual(validateUiRequest({phase:'soak-ui',targetMemoryGiB:4,durationMinutes:479}),['UI soak requires at least 480 minutes']);
  assert.deepEqual(validateUiRequest({phase:'validation',targetMemoryGiB:8,durationMinutes:30}),[]);
});

test('product-source fingerprint is deterministic and covers production roots',()=>{
  const a=computeProductSourceFingerprint();
  const b=computeProductSourceFingerprint();
  assert.match(a.sha256,/^[0-9a-f]{64}$/);
  assert.equal(a.sha256,b.sha256);
  assert.equal(a.fileCount,b.fileCount);
  assert.ok(a.fileCount>20);
  assert.ok(a.roots.includes('packages'));
  assert.ok(a.roots.includes('apps/playground/public/index.js'));
});

test('budget freeze requires two calibration runs per 4/8 GiB class and freezes deterministic margins',()=>{
  const rows=[
    receipt({cls:4,run:1,device:'cal4-a',scale:1}),
    receipt({cls:4,run:2,device:'cal4-b',scale:1.1}),
    receipt({cls:8,run:3,device:'cal8-a',scale:0.8}),
    receipt({cls:8,run:4,device:'cal8-b',scale:0.9})
  ];
  const budget=freezeBudget(rows);
  assert.equal(budget.status,'FROZEN');
  assert.equal(budget.productSourceFingerprint,'fp');
  assert.equal(budget.measurementProtocolFingerprint,'protocol-v1');
  assert.equal(budget.closureEligible,false);
  assert.equal(budget.formula.latencyMultiplier,1.35);
  assert.equal(budget.budgets['4GiB'].calibrationRuns.length,2);
  assert.equal(budget.budgets['8GiB'].calibrationRuns.length,2);

  const invalid=freezeBudget(rows.slice(0,3));
  assert.equal(invalid.status,'FAIL');
  assert.ok(invalid.errors.some(x=>x.includes('8 GiB requires at least 2 calibration receipts')));
});

test('independent validation rejects calibration-device reuse, fingerprint drift and budget regression',()=>{
  const calibration=[
    receipt({cls:4,run:1,device:'cal4-a',scale:1}),
    receipt({cls:4,run:2,device:'cal4-b',scale:1.1}),
    receipt({cls:8,run:3,device:'cal8-a',scale:0.8}),
    receipt({cls:8,run:4,device:'cal8-b',scale:0.9})
  ];
  const budget=freezeBudget(calibration);
  const val4=receipt({cls:4,run:10,device:'val4',phase:'validation',scale:1.05});
  const val8=receipt({cls:8,run:11,device:'val8',phase:'validation',scale:0.85});
  const soak=receipt({cls:4,run:12,device:'soak4',phase:'soak-ui',scale:1.05,durationMinutes:480});
  const pass=validateBudgetEvidence({budget,validationReceipts:[val4,val8],uiSoakReceipt:soak});
  assert.equal(pass.status,'PASS');
  assert.equal(pass.closureEligible,false);
  assert.equal(pass.candidateGateState['P9-12'],'READY_FOR_REVIEW');

  const reused=structuredClone(val4);reused.deviceId='cal4-a';
  const failReuse=validateBudgetEvidence({budget,validationReceipts:[reused,val8],uiSoakReceipt:soak});
  assert.equal(failReuse.status,'FAIL');
  assert.ok(failReuse.errors.some(x=>x.includes('reuses calibration device')));

  const drift=structuredClone(val8);drift.productSourceFingerprint='different';
  const failDrift=validateBudgetEvidence({budget,validationReceipts:[val4,drift],uiSoakReceipt:soak});
  assert.equal(failDrift.status,'FAIL');
  assert.ok(failDrift.errors.some(x=>x.includes('fingerprint drift')));

  const protocolDrift=structuredClone(val8);protocolDrift.measurementProtocolFingerprint='protocol-v2';
  const failProtocol=validateBudgetEvidence({budget,validationReceipts:[val4,protocolDrift],uiSoakReceipt:soak});
  assert.equal(failProtocol.status,'FAIL');
  assert.ok(failProtocol.errors.some(x=>x.includes('measurement-protocol fingerprint drift')));

  const regression=structuredClone(val4);
  regression.browserSession.aggregates.viewSwitchP95Ms=budget.budgets['4GiB'].latency.viewSwitchP95Ms+1;
  const failRegression=validateBudgetEvidence({budget,validationReceipts:[regression,val8],uiSoakReceipt:soak});
  assert.equal(failRegression.status,'FAIL');
  assert.ok(failRegression.errors.some(x=>x.includes('viewSwitchP95Ms regression')));
});

test('budget protocol cannot self-close P7-12, P9-12 or P14-14',()=>{
  for(const id of ['P7-12','P9-12','P14-14']){
    const row=ledger.overrides.find(x=>x.id===id);
    assert.ok(!row||row.closure_met!==true,id+' must remain open');
  }
  assert.equal(protocol.promotion.automaticLedgerClosure,false);
  assert.equal(protocol.promotion.reviewedReconciliationRequired,true);
  assert.equal(ledger.overrides.filter(x=>x.closure_met===true).length,277);
  assert.equal(ledger.production_closed,false);
});

test('weak-device budget protocol is retained by critical campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/weak-device-budget-protocol.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=110);
  assert.equal(flake.contract.iterations,5);
});
