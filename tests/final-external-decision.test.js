import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateDecisionReceiptPath,
  validateFinalExternalDecisionReceipt
} from '../scripts/final-external-decision.mjs';

const policy=JSON.parse(readFileSync('release/FINAL-EXTERNAL-DECISION-POLICY.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));
const workflow=readFileSync('.github/workflows/final-external-decision.yml','utf8');

const head='a'.repeat(40);
const evidenceArtifactSha256='b'.repeat(64);
const base=(gate,kind,data,actor={id:'reviewer-01',role:'Reviewer',type:'human'})=>({
  schema:'opencontainer.final-external-decision-receipt.v1.0',
  gate,kind,sourceCommit:head,recordedAt:'2026-10-01T15:00:00Z',
  actor,evidenceArtifactSha256,
  attestation:{confirmedByActor:true,statement:'I reviewed the retained external evidence and confirm this non-sensitive receipt.'},
  data
});
const repoState=()=>({
  headCommit:head,
  supply:{
    gateAuthority:{
      'P13-03':{machineClosable:false,state:'OPEN_EXTERNAL'}
    }
  },
  legal:{
    projectLicense:{
      state:'OPEN_EXTERNAL',
      finalLicenseFrozen:false,
      rootDistributionLicense:'UNLICENSED'
    },
    fto:{
      state:'OPEN_EXTERNAL',
      decisionRecorded:false,
      areas:['preview','network','storage','runtime topology']
    }
  },
  files:{},
  distributionLicense:'UNLICENSED'
});

test('final external decision receipt paths stay inside retained evidence directory',()=>{
  assert.equal(validateDecisionReceiptPath('release/external-evidence/license-decision.json'),true);
  for(const path of [
    '../decision.json',
    '/tmp/decision.json',
    'release/external-evidence/../secret.json',
    'release/external-evidence/decision.yml',
    '.artifacts/decision.json'
  ]) assert.equal(validateDecisionReceiptPath(path),false,path);
});

test('AI and automation cannot impersonate last-mile external authorities',()=>{
  const receipt=base('P13-03','trusted-publisher-configuration',{
    provider:'npm',package:'@nolane/opencontainer',repository:'Nolane-x/Nolane-OpenContainer',
    trustedPublisher:true,oidc:true,longLivedPublishToken:false,
    workflowPath:'.github/workflows/publish.yml',workflowSha256:'c'.repeat(64),
    configurationSnapshotSha256:'d'.repeat(64),configuredAt:'2026-10-01T15:00:00Z'
  },{id:'bot-01',role:'Package Administrator',type:'ai'});
  const result=validateFinalExternalDecisionReceipt(receipt,{policy,repoState:repoState()});
  assert.equal(result.structuralValid,false);
  assert.ok(result.errors.some(x=>x.includes('automation/AI')));
  assert.equal(result.closureEligible,false);
});

test('P1-15 requires actual field incident plus retained regression file digest',()=>{
  const regressionPath='tests/field-browser-regression-001.test.js';
  const regressionSha='c'.repeat(64);
  const receipt=base('P1-15','field-browser-regression',{
    incidents:[{
      observedAt:'2026-10-01T14:00:00Z',
      affectedVersion:'0.2.0-rc.1',
      environment:{browser:'Chrome 154',os:'Ubuntu 24.04'},
      rootCause:'field browser behavior change',
      fixOrDisposition:'fixed and validated',
      regressionPath,
      regressionSha256:regressionSha
    }]
  });
  const state=repoState();
  state.files[regressionPath]={sha256:regressionSha};
  const pass=validateFinalExternalDecisionReceipt(receipt,{policy,repoState:state});
  assert.equal(pass.structuralValid,true);
  assert.equal(pass.repositoryStateAligned,true);
  assert.equal(pass.candidateGateState,'READY_FOR_REVIEW');
  assert.equal(pass.closureEligible,false);

  const drift=structuredClone(state);
  drift.files[regressionPath].sha256='d'.repeat(64);
  const fail=validateFinalExternalDecisionReceipt(receipt,{policy,repoState:drift});
  assert.equal(fail.repositoryStateAligned,false);
  assert.ok(fail.repositoryAlignmentErrors.some(x=>x.includes('regression SHA-256 drift')));
});

test('P13-03 stays blocked until trusted-publisher policy state and workflow bytes match real admin event',()=>{
  const workflowPath='.github/workflows/publish.yml';
  const workflowSha='c'.repeat(64);
  const receipt=base('P13-03','trusted-publisher-configuration',{
    provider:'npm',package:'@nolane/opencontainer',repository:'Nolane-x/Nolane-OpenContainer',
    trustedPublisher:true,oidc:true,longLivedPublishToken:false,
    workflowPath,workflowSha256:workflowSha,
    configurationSnapshotSha256:'d'.repeat(64),configuredAt:'2026-10-01T15:00:00Z'
  });
  const blocked=repoState();
  blocked.files[workflowPath]={sha256:workflowSha};
  const before=validateFinalExternalDecisionReceipt(receipt,{policy,repoState:blocked});
  assert.equal(before.structuralValid,true);
  assert.equal(before.candidateGateState,'BLOCKED');
  assert.ok(before.repositoryAlignmentErrors.some(x=>x.includes('OPEN_EXTERNAL')));

  const aligned=structuredClone(blocked);
  aligned.supply.gateAuthority['P13-03'].state='RECORDED_EXTERNAL';
  const ready=validateFinalExternalDecisionReceipt(receipt,{policy,repoState:aligned});
  assert.equal(ready.repositoryStateAligned,true);
  assert.equal(ready.candidateGateState,'READY_FOR_REVIEW');
});

test('P16-01 cannot become ready until legal policy root LICENSE and actual distribution all match one SPDX decision',()=>{
  const licensePath='LICENSE';
  const licenseSha='e'.repeat(64);
  const receipt=base('P16-01','final-license-decision',{
    decisionRecorded:true,
    spdxLicenseId:'Apache-2.0',
    rootLicensePath:licensePath,
    rootLicenseSha256:licenseSha,
    decisionArtifactSha256:'f'.repeat(64),
    approvedAt:'2026-10-01T15:00:00Z'
  },{id:'project-owner',role:'Project owner/legal authority',type:'human'});
  const current=repoState();
  current.files[licensePath]={sha256:licenseSha};
  const blocked=validateFinalExternalDecisionReceipt(receipt,{policy,repoState:current});
  assert.equal(blocked.structuralValid,true);
  assert.equal(blocked.candidateGateState,'BLOCKED');
  assert.ok(blocked.repositoryAlignmentErrors.some(x=>x.includes('finalLicenseFrozen')));
  assert.ok(blocked.repositoryAlignmentErrors.some(x=>x.includes('actual built distribution license')));

  const aligned=structuredClone(current);
  aligned.legal.projectLicense={state:'RECORDED_EXTERNAL',finalLicenseFrozen:true,rootDistributionLicense:'Apache-2.0'};
  aligned.distributionLicense='Apache-2.0';
  const ready=validateFinalExternalDecisionReceipt(receipt,{policy,repoState:aligned});
  assert.equal(ready.repositoryStateAligned,true);
  assert.equal(ready.candidateGateState,'READY_FOR_REVIEW');
  assert.equal(ready.closureEligible,false);
});

test('P16-05 requires counsel scope and preserves BLOCKED counsel outcome',()=>{
  const cleared=base('P16-05','fto-counsel-review',{
    counsel:{organization:'External Counsel',role:'Qualified legal counsel'},
    jurisdictions:['US'],
    areas:['preview','network','storage','runtime topology'],
    outcome:'CLEARED_WITH_CONDITIONS',
    reviewArtifactSha256:'c'.repeat(64),
    reviewedAt:'2026-10-01T15:00:00Z'
  },{id:'counsel-org-review',role:'Qualified legal counsel',type:'counsel'});
  const current=repoState();
  const before=validateFinalExternalDecisionReceipt(cleared,{policy,repoState:current});
  assert.equal(before.structuralValid,true);
  assert.equal(before.candidateGateState,'BLOCKED');

  const aligned=structuredClone(current);
  aligned.legal.fto={state:'RECORDED_EXTERNAL',decisionRecorded:true,areas:['preview','network','storage','runtime topology']};
  const ready=validateFinalExternalDecisionReceipt(cleared,{policy,repoState:aligned});
  assert.equal(ready.repositoryStateAligned,true);
  assert.equal(ready.candidateGateState,'READY_FOR_REVIEW');

  const blockedReceipt=structuredClone(cleared);
  blockedReceipt.data.outcome='BLOCKED';
  const blocked=validateFinalExternalDecisionReceipt(blockedReceipt,{policy,repoState:aligned});
  assert.equal(blocked.candidateGateState,'BLOCKED_BY_COUNSEL');
  assert.equal(blocked.closureEligible,false);
});

test('stale receipt commit can never certify a newer repository state',()=>{
  const receipt=base('P1-15','field-browser-regression',{
    incidents:[{
      observedAt:'2026-10-01T14:00:00Z',affectedVersion:'0.2.0-rc.1',
      environment:{browser:'Chrome 154',os:'Ubuntu 24.04'},
      rootCause:'field regression',fixOrDisposition:'fixed',
      regressionPath:'tests/field-browser-regression-001.test.js',regressionSha256:'c'.repeat(64)
    }]
  });
  const state=repoState();
  state.headCommit='f'.repeat(40);
  state.files['tests/field-browser-regression-001.test.js']={sha256:'c'.repeat(64)};
  const result=validateFinalExternalDecisionReceipt(receipt,{policy,repoState:state});
  assert.equal(result.repositoryStateAligned,false);
  assert.ok(result.repositoryAlignmentErrors.some(x=>x.includes('checked-out HEAD')));
});

test('final external decision workflow is manual read-only and carries no external authority itself',()=>{
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.ok(!workflow.includes('pull_request:'));
  assert.ok(!workflow.includes('push:'));
  assert.match(workflow,/permissions:\n\s+contents:\s+read/);
  assert.doesNotMatch(workflow,/\$\{\{ secrets\.|id-token:\s*write|contents:\s*write|packages:\s*write|npm publish/);
  assert.ok(workflow.includes('OC_FINAL_RECEIPT_PATH: ${{ inputs.receipt_path }}'));
  assert.ok(workflow.includes('--receipt="$OC_FINAL_RECEIPT_PATH"'));
});

test('last-mile authority never changes current production closure',()=>{
  for(const id of ['P1-15','P13-03','P16-01','P16-05']){
    const row=ledger.overrides.find(x=>x.id===id);
    assert.ok(!row||row.closure_met!==true,id);
  }
  assert.equal(policy.forbiddenAutoPromotion,true);
  assert.equal(policy.automaticLedgerClosure,false);
  assert.equal(ledger.overrides.filter(x=>x.closure_met===true).length,277);
  assert.equal(ledger.production_closed,false);
});

test('final external decision authority is retained by critical campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/final-external-decision.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=115);
  assert.equal(flake.contract.iterations,5);
});
