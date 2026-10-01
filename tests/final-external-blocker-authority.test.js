import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateExternalBlockerReceipt,
  validateReceiptPath
} from '../scripts/verify-external-blocker-receipt.mjs';

const policy=JSON.parse(readFileSync('release/FINAL-EXTERNAL-BLOCKER-POLICY.v1.0.json','utf8'));
const security=JSON.parse(readFileSync('release/SECURITY-REVIEW-POLICY.v1.0.json','utf8'));
const supply=JSON.parse(readFileSync('release/SUPPLY-CHAIN-REVIEW-POLICY.v1.0.json','utf8'));
const legal=JSON.parse(readFileSync('release/P16-LEGAL-GOVERNANCE-POLICY.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const distributionSource=readFileSync('scripts/build-distribution.mjs','utf8');
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));
const workflow=readFileSync('.github/workflows/external-blocker-receipt.yml','utf8');

const sourceCommit='a'.repeat(40);
const evidenceArtifactSha256='b'.repeat(64);
const base=(gate,kind,data,actor={name:'Human Reviewer',role:'Reviewer',type:'human'})=>({
  schema:'opencontainer.external-blocker-receipt.v1.0',
  gate,kind,sourceCommit,recordedAt:'2026-10-01T12:00:00Z',
  actor,evidenceArtifactSha256,
  attestation:{confirmedByActor:true,statement:'I reviewed the retained evidence and confirm this record.'},
  data
});
const repoState=()=>({
  security:structuredClone(security),
  supply:structuredClone(supply),
  legal:structuredClone(legal),
  distributionSource
});

test('external blocker receipt paths are confined to retained repository evidence',()=>{
  assert.equal(validateReceiptPath('release/external-evidence/p9-screen-reader.json'),true);
  for(const path of [
    '../receipt.json',
    'release/external-evidence/../secret.json',
    '.artifacts/external-blocker/receipt.json',
    'release/external-evidence/receipt.yml',
    '/tmp/receipt.json'
  ]) assert.equal(validateReceiptPath(path),false,path);
});

test('automation or AI cannot impersonate required external authority',()=>{
  const receipt=base('P9-05','manual-screen-reader',{
    screenReader:{name:'NVDA',version:'x'},environment:{os:'Windows',browser:'Chrome'},
    scenarios:[{id:'sr-1',result:'PASS'},{id:'sr-2',result:'PASS'}],blockingIssues:0
  },{name:'bot',role:'reviewer',type:'ai'});
  const result=validateExternalBlockerReceipt(receipt,{policy,repoState:repoState()});
  assert.equal(result.structuralValid,false);
  assert.ok(result.errors.some(x=>x.includes('automation/AI')));
  assert.equal(result.closureEligible,false);
});

test('P9-05 requires two retained manual screen-reader PASS scenarios',()=>{
  const good=base('P9-05','manual-screen-reader',{
    screenReader:{name:'NVDA',version:'2026.3'},environment:{os:'Windows 11',browser:'Chrome 153'},
    scenarios:[{id:'failure-recovery-announcement',result:'PASS'},{id:'modal-focus-announcement',result:'PASS'}],
    blockingIssues:0
  });
  const pass=validateExternalBlockerReceipt(good,{policy,repoState:repoState()});
  assert.equal(pass.structuralValid,true);
  assert.equal(pass.candidateGateState,'READY_FOR_REVIEW');
  assert.equal(pass.closureEligible,false);

  const bad=structuredClone(good);
  bad.data.scenarios=bad.data.scenarios.slice(0,1);
  const fail=validateExternalBlockerReceipt(bad,{policy,repoState:repoState()});
  assert.equal(fail.structuralValid,false);
  assert.ok(fail.errors.some(x=>x.includes('two retained')));
});

test('P9-11 human comprehension requires real participant/task evidence',()=>{
  const receipt=base('P9-11','human-comprehension',{
    participantCount:1,
    tasks:[{id:'recover-after-save-failure',passed:true}],
    blockingIssues:0
  });
  const result=validateExternalBlockerReceipt(receipt,{policy,repoState:repoState()});
  assert.equal(result.structuralValid,true);
  assert.equal(result.candidateGateState,'READY_FOR_REVIEW');
});

test('P12 receipts remain blocked until repository security review status records the external event',()=>{
  const receipt=base('P12-18','second-party-security-review',{
    reviewerIndependentOrSecondParty:true,
    scope:['isolation','storage','network'],
    releaseBlockingFindings:0
  });
  const blocked=validateExternalBlockerReceipt(receipt,{policy,repoState:repoState()});
  assert.equal(blocked.structuralValid,true);
  assert.equal(blocked.repositoryStateAligned,false);
  assert.equal(blocked.candidateGateState,'BLOCKED');
  assert.ok(blocked.repositoryAlignmentErrors.some(x=>x.includes('second-party review completion')));

  const aligned=repoState();
  aligned.security.reviewStatus.independentSecondPartyReviewCompleted=true;
  const ready=validateExternalBlockerReceipt(receipt,{policy,repoState:aligned});
  assert.equal(ready.candidateGateState,'READY_FOR_REVIEW');
  assert.equal(ready.closureEligible,false);
});

test('P12-17 private channel and P12-20 human review have distinct evidence requirements',()=>{
  const privateChannel=base('P12-17','private-vulnerability-channel',{
    channel:{private:true,provider:'GitHub Private Vulnerability Reporting'},
    verification:{liveTest:true,method:'independent private intake probe',performedBy:'Security Reviewer',verifiedAt:'2026-10-01T12:00:00Z'}
  });
  assert.equal(validateExternalBlockerReceipt(privateChannel,{policy,repoState:repoState()}).structuralValid,true);

  const humanReview=base('P12-20','human-product-security-review',{
    humanReview:true,reviewScope:'Core runtime isolation/storage/network and release evidence',releaseBlockingFindings:0
  });
  assert.equal(validateExternalBlockerReceipt(humanReview,{policy,repoState:repoState()}).structuralValid,true);
});

test('P13 admin receipts cannot become ready while policy still records OPEN_EXTERNAL',()=>{
  const trusted=base('P13-03','trusted-publisher-configuration',{
    provider:'npm',package:'@nolane/opencontainer',repository:'Nolane-x/Nolane-OpenContainer',
    oidc:true,longLivedPublishToken:false,workflowPath:'.github/workflows/publish.yml'
  },{name:'Repository Administrator',role:'Package Administrator',type:'human'});
  const trustedResult=validateExternalBlockerReceipt(trusted,{policy,repoState:repoState()});
  assert.equal(trustedResult.structuralValid,true);
  assert.equal(trustedResult.candidateGateState,'BLOCKED');

  const protection=base('P13-17','repository-protection-certification',{
    branchProtectionReviewed:true,tagProtectionReviewed:true,releaseProtectionReviewed:true,
    settingsSnapshotSha256:'c'.repeat(64)
  },{name:'Repository Administrator',role:'Repository Administrator',type:'human'});
  const protectionResult=validateExternalBlockerReceipt(protection,{policy,repoState:repoState()});
  assert.equal(protectionResult.structuralValid,true);
  assert.equal(protectionResult.candidateGateState,'BLOCKED');
});

test('P16-01 receipt cannot override current UNLICENSED repository state',()=>{
  const receipt=base('P16-01','final-license-decision',{
    decisionRecorded:true,spdxLicenseId:'Apache-2.0',approvalRole:'Project owner/legal authority',
    rootDistributionLicenseMatchesDecision:true
  },{name:'Project Owner',role:'Accountable Authority',type:'human'});
  const result=validateExternalBlockerReceipt(receipt,{policy,repoState:repoState()});
  assert.equal(result.structuralValid,true);
  assert.equal(result.repositoryStateAligned,false);
  assert.equal(result.candidateGateState,'BLOCKED');
  assert.ok(result.repositoryAlignmentErrors.some(x=>x.includes('finalLicenseFrozen')));
  assert.ok(result.repositoryAlignmentErrors.some(x=>x.includes('UNLICENSED')));
});

test('P16-05 distinguishes counsel clearance from counsel blocking decision',()=>{
  const cleared=base('P16-05','fto-counsel-review',{
    counsel:{name:'Qualified Counsel',organization:'External Counsel'},
    jurisdictions:['US'],
    areas:['preview','network','storage','runtime topology'],
    outcome:'CLEARED'
  },{name:'Qualified Counsel',role:'Legal Counsel',type:'human'});
  const current=validateExternalBlockerReceipt(cleared,{policy,repoState:repoState()});
  assert.equal(current.structuralValid,true);
  assert.equal(current.candidateGateState,'BLOCKED');

  const blocked=structuredClone(cleared);
  blocked.data.outcome='BLOCKED';
  const blockedResult=validateExternalBlockerReceipt(blocked,{policy,repoState:repoState()});
  assert.equal(blockedResult.candidateGateState,'BLOCKED_BY_COUNSEL');
  assert.equal(blockedResult.closureEligible,false);
});

test('P1-15 requires real field incident identity root cause disposition and retained regression',()=>{
  const receipt=base('P1-15','field-browser-regression',{
    incidents:[{
      observedAt:'2026-10-01T12:00:00Z',
      environment:{browser:'Chrome 154',os:'Ubuntu 24.04'},
      rootCause:'browser behavior change',
      fixOrDisposition:'fixed and validated',
      regressionEvidence:'tests/browser-regression-field-001.test.js'
    }]
  });
  const result=validateExternalBlockerReceipt(receipt,{policy,repoState:repoState()});
  assert.equal(result.structuralValid,true);
  assert.equal(result.candidateGateState,'READY_FOR_REVIEW');
});

test('receipt authority never changes current ledger closure',()=>{
  const external=['P1-15','P9-05','P9-11','P12-17','P12-18','P12-20','P13-03','P13-17','P16-01','P16-05'];
  for(const id of external){
    const row=ledger.overrides.find(x=>x.id===id);
    assert.ok(!row||row.closure_met!==true,id);
  }
  assert.equal(policy.forbiddenAutoPromotion,true);
  assert.equal(ledger.overrides.filter(x=>x.closure_met===true).length,277);
  assert.equal(ledger.production_closed,false);
});

test('external blocker workflow is manual read-only and does not carry evidence authority itself',()=>{
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.ok(!workflow.includes('pull_request:'));
  assert.ok(!workflow.includes('push:'));
  assert.match(workflow,/permissions:\n\s+contents:\s+read/);
  assert.doesNotMatch(workflow,/id-token:\s*write|contents:\s*write|packages:\s*write|npm publish/);
  assert.ok(workflow.includes('OC_RECEIPT_PATH: \${{ inputs.receipt_path }}'));
  assert.ok(workflow.includes('--receipt="$OC_RECEIPT_PATH"'));
});

test('final external blocker authority is retained by critical campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/final-external-blocker-authority.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=113);
  assert.equal(flake.contract.iterations,5);
});
