import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateExternalReleaseRequest, candidateGateState } from '../scripts/external-release-verifier.mjs';

const policy=JSON.parse(readFileSync('release/EXTERNAL-RELEASE-EVIDENCE-POLICY.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));
const workflow=readFileSync('.github/workflows/external-release-evidence.yml','utf8');
const verifier=readFileSync('scripts/external-release-verifier.mjs','utf8');

test('external release verifier request is fail-closed and channel-aware',()=>{
  assert.deepEqual(validateExternalReleaseRequest({
    version:'0.2.0-rc.1',
    tag:'v0.2.0-rc.1',
    channel:'rc',
    assetName:'nolane-opencontainer-0.2.0-rc.1.tgz',
    signerWorkflow:'.github/workflows/publish.yml'
  }),[]);
  assert.ok(validateExternalReleaseRequest({
    version:'0.2.0-rc.1',
    tag:'v0.2.0-rc.2',
    channel:'rc',
    assetName:'x.zip',
    signerWorkflow:'publish.yml'
  }).length>=3);
  assert.ok(validateExternalReleaseRequest({
    version:'0.2.0-beta.1',
    tag:'v0.2.0-beta.1',
    channel:'rc',
    assetName:'x.tgz',
    signerWorkflow:'.github/workflows/publish.yml'
  }).some(x=>x.includes('rc prerelease')));
});

test('external release evidence workflow is read-only and manually triggered',()=>{
  assert.equal(policy.status,'STAGED_AWAITING_REAL_EXTERNAL_RELEASE');
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.ok(!workflow.includes('pull_request:'));
  assert.ok(!workflow.includes('push:'));
  assert.match(workflow,/permissions:\n\s+contents:\s+read/);
  assert.doesNotMatch(workflow,/id-token:\s*write/);
  assert.doesNotMatch(workflow,/contents:\s*write/);
  assert.doesNotMatch(workflow,/packages:\s*write/);
  assert.doesNotMatch(workflow,/npm publish/);
  assert.match(workflow,/gh help release/);
  assert.match(workflow,/gh attestation verify --help/);
  assert.match(workflow,/ref: \$\{\{ inputs\.tag \}\}/);
});

test('external release verifier binds registry GitHub release immutable tag attestation and installed product path',()=>{
  for(const needle of [
    "PACKAGE+'@'+version,'--json','--pack-destination'",
    "PACKAGE+'@'+version,'--json'",
    "distTags[channel]!==version",
    "tagCommit!==localCommit",
    "localBuild.sha256!==npmSha256",
    "ghSha256!==npmSha256",
    "'release','verify-asset'",
    "'attestation','verify'",
    "'audit','signatures'",
    "examples','sdk-lifecycle.mjs",
    "examples','sdk-failure-paths.mjs",
    "scripts/browser-acceptance.mjs"
  ]) assert.ok(verifier.includes(needle),needle);
  assert.ok(verifier.includes("'--source-ref','refs/tags/'+tag"));
  assert.ok(verifier.includes("'--source-digest',localCommit"));
});

test('external release verifier never infers trusted publisher branch protection CDN or adjacent release state',()=>{
  const canary=candidateGateState({channel:'canary',allPublicationChecksPass:true});
  assert.equal(canary['P11-12'],'READY_FOR_REVIEW');
  assert.equal(canary['P13-04'],'READY_FOR_REVIEW');
  assert.equal(canary['P13-07'],'READY_FOR_REVIEW');
  assert.equal(canary['P13-09'],'READY_FOR_REVIEW');
  assert.equal(canary['P13-10'],'READY_FOR_REVIEW');
  assert.equal(canary['P13-16'],'READY_FOR_REVIEW');
  assert.equal(canary['P15-12'],'READY_FOR_REVIEW');
  assert.equal(canary['P13-03'],'BLOCKED_TRUSTED_PUBLISHER_CONFIGURATION_CERTIFICATION');
  assert.equal(canary['P13-17'],'BLOCKED_REPOSITORY_PROTECTION_CERTIFICATION');
  assert.equal(canary['P14-04'],'BLOCKED_ADJACENT_REAL_RELEASE_COURT');
  assert.equal(canary['P14-12'],'BLOCKED_PUBLIC_CDN_TOPOLOGY');

  const rc=candidateGateState({channel:'rc',allPublicationChecksPass:true});
  assert.equal(rc['P13-16'],'BLOCKED_REQUIRES_CANARY_REGISTRY_PUBLICATION');
  assert.equal(rc['P1-14'],'BLOCKED_REQUIRES_RC_MATRIX');
});

test('staging external release verification cannot close current external gates',()=>{
  for(const id of ['P1-14','P11-12','P13-03','P13-04','P13-07','P13-09','P13-10','P13-16','P13-17','P15-12']){
    const row=ledger.overrides.find(x=>x.id===id);
    assert.ok(!row||row.closure_met!==true,id+' must remain open');
  }
  assert.equal(policy.automaticLedgerClosure,false);
  assert.equal(policy.productionClosed,false);
  assert.equal(ledger.overrides.filter(x=>x.closure_met===true).length,277);
  assert.equal(ledger.production_closed,false);
});

test('external release verifier is retained by the critical contract campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/external-release-evidence.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=111);
  assert.equal(flake.contract.iterations,5);
});
