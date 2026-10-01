import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessRepositoryTrustState } from '../scripts/repository-trust-state.mjs';
import { validateExternalReviewArtifact } from '../scripts/external-security-review.mjs';

const policy=JSON.parse(readFileSync('release/EXTERNAL-TRUST-REVIEW-POLICY.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));
const trustWorkflow=readFileSync('.github/workflows/repository-trust-state.yml','utf8');
const reviewWorkflow=readFileSync('.github/workflows/external-security-review-evidence.yml','utf8');
const trustScript=readFileSync('scripts/repository-trust-state.mjs','utf8');
const reviewScript=readFileSync('scripts/external-security-review.mjs','utf8');

test('repository trust state only marks verified private intake ready and never self-closes repository protection',()=>{
  const result=assessRepositoryTrustState({
    privateVulnerability:{ok:true,status:200,body:{enabled:true}},
    branchProtection:{ok:true,status:200,body:{required_pull_request_reviews:{required_approving_review_count:1}}},
    rulesets:{ok:true,status:200,body:[{id:1,name:'main'}]}
  });
  assert.equal(result.privateVulnerabilityReporting.enabled,true);
  assert.equal(result.candidateGateState['P12-17'],'READY_FOR_REVIEW');
  assert.equal(result.candidateGateState['P13-17'],'STATE_CAPTURED_REQUIRES_POLICY_REVIEW');
  assert.equal(result.closureEligible,false);
  assert.equal(result.productionClosed,false);

  const absent=assessRepositoryTrustState({
    privateVulnerability:{ok:true,status:200,body:{enabled:false}},
    branchProtection:{ok:false,status:404,body:null},
    rulesets:{ok:true,status:200,body:[]}
  });
  assert.equal(absent.candidateGateState['P12-17'],'BLOCKED_PRIVATE_CHANNEL_NOT_VERIFIED');
  assert.equal(absent.candidateGateState['P13-17'],'BLOCKED_REPOSITORY_PROTECTION_NOT_OBSERVED');
});

test('independent P12-18 artifact requires human independent reviewer and isolation/storage/network scope',()=>{
  const base={
    schema:'opencontainer.external-security-review.v1.0',
    reviewType:'independent-security-review',
    sourceCommit:'a'.repeat(40),
    issuedAt:'2026-10-01T00:00:00Z',
    reviewer:{id:'reviewer-1',human:true,independentFromProject:true},
    scope:['isolation','storage','network'],
    findings:[],
    conclusion:'PASS'
  };
  assert.deepEqual(validateExternalReviewArtifact(base,{expectedType:'independent-security-review',expectedCommit:'a'.repeat(40)}),[]);
  const bad=structuredClone(base);
  bad.reviewer.independentFromProject=false;
  bad.scope=['isolation','storage'];
  const errors=validateExternalReviewArtifact(bad,{expectedType:'independent-security-review',expectedCommit:'a'.repeat(40)});
  assert.ok(errors.some(x=>x.includes('independent reviewer')));
  assert.ok(errors.some(x=>x.includes('missing scope network')));
});

test('human P12-20 artifact cannot be satisfied by AI/scanner-shaped evidence',()=>{
  const base={
    schema:'opencontainer.external-security-review.v1.0',
    reviewType:'human-product-security-review',
    sourceCommit:'b'.repeat(40),
    issuedAt:'2026-10-01T00:00:00Z',
    reviewer:{id:'human-reviewer',human:true,independentFromProject:false},
    scope:['product-security'],
    findings:[{severity:'LOW',status:'OPEN'}],
    reviewedProductSecurity:true,
    conclusion:'PASS_WITH_ACCEPTED_RISKS'
  };
  assert.deepEqual(validateExternalReviewArtifact(base,{expectedType:'human-product-security-review',expectedCommit:'b'.repeat(40)}),[]);
  const ai=structuredClone(base);
  ai.reviewer.human=false;
  const errors=validateExternalReviewArtifact(ai,{expectedType:'human-product-security-review',expectedCommit:'b'.repeat(40)});
  assert.ok(errors.some(x=>x.includes('reviewer must be human')));
});

test('external review rejects commit drift and unresolved critical/high findings',()=>{
  const artifact={
    schema:'opencontainer.external-security-review.v1.0',
    reviewType:'independent-security-review',
    sourceCommit:'c'.repeat(40),
    issuedAt:'2026-10-01T00:00:00Z',
    reviewer:{id:'reviewer-2',human:true,independentFromProject:true},
    scope:['isolation','storage','network'],
    findings:[{severity:'HIGH',status:'OPEN'}],
    conclusion:'PASS'
  };
  const errors=validateExternalReviewArtifact(artifact,{expectedType:'independent-security-review',expectedCommit:'d'.repeat(40)});
  assert.ok(errors.some(x=>x.includes('source commit drift')));
  assert.ok(errors.some(x=>x.includes('unresolved critical/high')));
});

test('repository trust workflow is main-only read-only and requires a separate admin-read secret',()=>{
  assert.ok(trustWorkflow.includes('workflow_dispatch:'));
  assert.ok(!trustWorkflow.includes('pull_request:'));
  assert.ok(!trustWorkflow.includes('push:'));
  assert.match(trustWorkflow,/permissions:\n\s+contents:\s+read/);
  assert.doesNotMatch(trustWorkflow,/contents:\s*write|packages:\s*write|id-token:\s*write|npm publish/);
  assert.ok(trustWorkflow.includes("github.ref == 'refs/heads/main'"));
  assert.ok(trustWorkflow.includes('secrets.OPENCONTAINER_REPO_ADMIN_READ_TOKEN'));
  assert.ok(trustWorkflow.includes('test -n "$OPENCONTAINER_REPO_ADMIN_READ_TOKEN"'));
  assert.ok(!trustWorkflow.includes('echo "$OPENCONTAINER_REPO_ADMIN_READ_TOKEN"'));
  assert.ok(trustScript.includes("'/private-vulnerability-reporting'"));
  assert.ok(trustScript.includes("'/branches/main/protection'"));
  assert.ok(trustScript.includes("'/rulesets?includes_parents=true&per_page=100'"));
});

test('external review workflow is public-artifact only, shell-safe and read-only',()=>{
  assert.ok(reviewWorkflow.includes('workflow_dispatch:'));
  assert.ok(!reviewWorkflow.includes('pull_request:'));
  assert.ok(!reviewWorkflow.includes('push:'));
  assert.match(reviewWorkflow,/permissions:\n\s+contents:\s+read/);
  assert.doesNotMatch(reviewWorkflow,/contents:\s*write|packages:\s*write|id-token:\s*write|npm publish/);
  assert.ok(reviewWorkflow.includes('git cat-file -e "$OC_REVIEW_SOURCE_COMMIT^{commit}"'));
  assert.ok(reviewWorkflow.includes('--url="$OC_REVIEW_URL"'));
  assert.ok(reviewWorkflow.includes('--sha256="$OC_REVIEW_SHA256"'));
  assert.ok(reviewScript.includes("review artifact URL must use HTTPS"));
  assert.ok(reviewScript.includes("review artifact SHA-256 mismatch"));
  assert.ok(reviewScript.includes("closureEligible:false"));
});

test('staging external trust and human review courts cannot close P12/P13 gates',()=>{
  for(const id of ['P12-17','P12-18','P12-20','P13-17']){
    const row=ledger.overrides.find(x=>x.id===id);
    assert.ok(!row||row.closure_met!==true,id+' must remain open');
  }
  assert.equal(policy.repositoryTrust.automaticLedgerClosure,false);
  assert.equal(policy.externalHumanReview.automaticLedgerClosure,false);
  assert.deepEqual(policy.preservedOpenGates,['P12-17','P12-18','P12-20','P13-17']);
  assert.equal(ledger.overrides.filter(x=>x.closure_met===true).length,277);
  assert.equal(ledger.production_closed,false);
});

test('external trust and review evidence protocol is retained by critical campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/external-trust-review.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=113);
  assert.equal(flake.contract.iterations,5);
});
