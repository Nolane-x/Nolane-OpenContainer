import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const policy=JSON.parse(readFileSync('release/SUPPLY-CHAIN-REVIEW-POLICY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));
const workflow=readFileSync('.github/workflows/scorecard.yml','utf8');
const verifier=readFileSync('scripts/p13-openssf-scorecard.mjs','utf8');

test('P13-18 OpenSSF hygiene court is immutable, read-only and supplemental',()=>{
  assert.ok(policy.workflowFiles.includes('.github/workflows/scorecard.yml'));
  assert.equal(policy.openssfHygiene.actionRelease,'v2.4.4');
  assert.equal(policy.openssfHygiene.actionCommit,'2d1146689b8cda280b9bc96326124645441f03bc');
  assert.equal(policy.openssfHygiene.publishResults,false);
  assert.equal(policy.openssfHygiene.artifactRetentionDays,90);
  assert.equal(policy.openssfHygiene.releaseProof,false);

  assert.match(workflow,/permissions:\s*\n\s+contents:\s*read/);
  assert.match(workflow,/ossf\/scorecard-action@2d1146689b8cda280b9bc96326124645441f03bc/);
  assert.match(workflow,/results_format:\s*json/);
  assert.match(workflow,/publish_results:\s*false/);
  assert.match(workflow,/retention-days:\s*90/);
  assert.doesNotMatch(workflow,/id-token:\s*write/);
  assert.doesNotMatch(workflow,/contents:\s*write/);

  assert.match(verifier,/checkCount:checks\.length/);
  assert.match(verifier,/GITHUB_REPOSITORY/);
  assert.match(verifier,/GITHUB_SHA/);
  assert.match(verifier,/pull_request/);
  assert.match(verifier,/repository==='file:\/\/\.'/);
  assert.match(verifier,/local-pr-worktree/);
  assert.match(verifier,/minimumScoreThresholdClaimed:false/);
  assert.match(verifier,/releaseProofClaimed:false/);
  assert.match(verifier,/rawSha256:receipt\.raw\.sha256/);
  assert.equal(policy.gateAuthority['P13-18'].machineClosable,false);
});

test('P13-18 implementation audit is repeated in critical contract campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/p13-openssf-scorecard-source-audit.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=100);
  assert.equal(flake.contract.iterations,5);
});
