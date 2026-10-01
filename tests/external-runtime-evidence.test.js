import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPublicAddress, validatePublicDeploymentRequest } from '../scripts/public-deployment-court.mjs';
import { validateAdjacentVersions } from '../scripts/adjacent-release-court.mjs';

const policy=JSON.parse(readFileSync('release/EXTERNAL-RUNTIME-EVIDENCE-POLICY.v1.0.json','utf8'));
const storageProfile=JSON.parse(readFileSync('docs/production/RELEASE-STORAGE-PROFILE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));
const packageJson=JSON.parse(readFileSync('package.json','utf8'));
const publicWorkflow=readFileSync('.github/workflows/public-deployment-evidence.yml','utf8');
const adjacentWorkflow=readFileSync('.github/workflows/adjacent-release-evidence.yml','utf8');
const publicCourt=readFileSync('scripts/public-deployment-court.mjs','utf8');
const adjacentCourt=readFileSync('scripts/adjacent-release-court.mjs','utf8');
const adjacentProbe=readFileSync('apps/playground/public/adjacent-release-probe.js','utf8');
const server=readFileSync('apps/playground/server.mjs','utf8');
const distribution=readFileSync('scripts/build-distribution.mjs','utf8');

test('public topology request rejects local/insecure/unbound deployment inputs',()=>{
  assert.deepEqual(validatePublicDeploymentRequest({
    url:'https://opencontainer.example/',
    version:'0.2.0-rc.1',
    tag:'v0.2.0-rc.1',
    topologyId:'edge-prod-01',
    edgeProvider:'example-edge',
    edgeMarkerHeader:'x-opencontainer-edge-id'
  }),[]);
  const invalid=validatePublicDeploymentRequest({
    url:'http://127.0.0.1:4173/',
    version:'bad',
    tag:'main',
    topologyId:'x',
    edgeProvider:'',
    edgeMarkerHeader:'server'
  });
  assert.ok(invalid.length>=6);
  for(const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.2','169.254.1.1','::1','fd00::1'])assert.equal(isPublicAddress(address),false,address);
  assert.equal(isPublicAddress('8.8.8.8'),true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'),true);
});

test('public topology court binds exact tag version edge marker TLS hosting and real browser state',()=>{
  for(const needle of [
    "tag!=='v'+version",
    "lookup(base.hostname,{all:true,verbatim:true})",
    "tlsConnect({host:hostname,port:443",
    "edge marker",
    "strict-transport-security",
    "checkHostingHeaders(base.href)",
    "deploymentProfile?.runtime?.version!==version",
    "probeBrowserPage(base.href",
    "browser.snapshot?.crossOriginIsolated!==true",
    "'P1-13':'READY_FOR_REVIEW'",
    "'P14-12':'READY_FOR_REVIEW'",
    "closureEligible:false"
  ]) assert.ok(publicCourt.includes(needle),needle);
});

test('public topology workflow is manual read-only and checks out exact release tag',()=>{
  assert.ok(publicWorkflow.includes('workflow_dispatch:'));
  assert.ok(!publicWorkflow.includes('pull_request:'));
  assert.ok(!publicWorkflow.includes('push:'));
  assert.match(publicWorkflow,/permissions:\n\s+contents:\s+read/);
  assert.doesNotMatch(publicWorkflow,/id-token:\s*write|contents:\s*write|packages:\s*write|npm publish/);
  assert.match(publicWorkflow,/ref: \$\{\{ inputs\.tag \}\}/);
  assert.ok(publicWorkflow.includes('OC_PUBLIC_URL: ${{ inputs.url }}'));
  assert.ok(publicWorkflow.includes('--topology-id="$OC_TOPOLOGY_ID"'));
  assert.ok(publicWorkflow.includes('--edge-marker-header="$OC_EDGE_MARKER_HEADER"'));
});

test('adjacent publication selection must use directly adjacent npm versions',()=>{
  const versions=['0.1.0-alpha.1','0.1.0-alpha.2','0.1.0-beta.1'];
  assert.deepEqual(validateAdjacentVersions({previousVersion:versions[0],currentVersion:versions[1],publishedVersions:versions}),[]);
  assert.ok(validateAdjacentVersions({previousVersion:versions[0],currentVersion:versions[2],publishedVersions:versions}).some(x=>x.includes('not adjacent')));
  assert.ok(validateAdjacentVersions({previousVersion:'0.0.9',currentVersion:versions[0],publishedVersions:versions}).some(x=>x.includes('not published')));
});

test('adjacent release court runs actual published packages across one origin and one persistent browser profile',()=>{
  for(const needle of [
    "'view',PACKAGE,'versions','--json'",
    "'install','--ignore-scripts'",
    "'audit','signatures'",
    "profilePath=await mkdtemp",
    "phase:'seed'",
    "phase:'upgrade'",
    "phase:'rollback'",
    "phase:'verify-current'",
    "sameBrowserProfile:true",
    "'P14-04':'READY_FOR_REVIEW'",
    "closureEligible:false"
  ]) assert.ok(adjacentCourt.includes(needle),needle);
  assert.ok(adjacentProbe.includes("OpfsReleaseStorageAuthority"));
  assert.ok(adjacentProbe.includes("directoryName='opencontainer-adjacent-release-'"));
  assert.ok(adjacentProbe.includes("authority.migrate"));
  assert.ok(adjacentProbe.includes("rollbackPolicy"));
  assert.ok(adjacentProbe.includes("rollback-compatible-read-write"));
  assert.ok(adjacentProbe.includes("rollback-read-only"));
  assert.ok(adjacentProbe.includes("rollback-refuse-open"));
  assert.ok(adjacentProbe.includes("verified-current-after-rollback"));
});

test('release storage evidence profile is shipped and fail-closed against destructive downgrade',()=>{
  assert.equal(storageProfile.schema,'opencontainer.release-storage-profile.v1.0');
  assert.equal(storageProfile.runtimeVersion,packageJson.version);
  assert.equal(storageProfile.storageVersion,1);
  assert.deepEqual(storageProfile.readableStorageVersions,[1]);
  assert.equal(storageProfile.adjacentEvidenceEligible,true);
  assert.equal(storageProfile.destructiveStorageDowngrade,false);
  assert.ok(server.includes("'/adjacent-release-probe.html'"));
  assert.ok(server.includes("'/adjacent-release-probe.js'"));
  assert.ok(server.includes("'/docs/production/RELEASE-STORAGE-PROFILE.v1.0.json'"));
  for(const path of [
    'package/apps/playground/public/adjacent-release-probe.html',
    'package/apps/playground/public/adjacent-release-probe.js',
    'package/docs/production/RELEASE-STORAGE-PROFILE.v1.0.json'
  ]) assert.ok(distribution.includes(path),path);
});

test('adjacent release workflow is manual main-only and read-only',()=>{
  assert.ok(adjacentWorkflow.includes('workflow_dispatch:'));
  assert.ok(!adjacentWorkflow.includes('pull_request:'));
  assert.ok(!adjacentWorkflow.includes('push:'));
  assert.match(adjacentWorkflow,/permissions:\n\s+contents:\s+read/);
  assert.doesNotMatch(adjacentWorkflow,/id-token:\s*write|contents:\s*write|packages:\s*write|npm publish/);
  assert.ok(adjacentWorkflow.includes("github.ref == 'refs/heads/main'"));
  assert.ok(adjacentWorkflow.includes('OC_PREVIOUS_VERSION: ${{ inputs.previous_version }}'));
  assert.ok(adjacentWorkflow.includes('--previous="$OC_PREVIOUS_VERSION"'));
});

test('staging external runtime courts cannot self-close current gates',()=>{
  assert.equal(policy.status,'STAGED_AWAITING_EXTERNAL_CAMPAIGNS');
  assert.equal(policy.publicDeployment.automaticLedgerClosure,false);
  assert.equal(policy.adjacentPublishedRelease.automaticLedgerClosure,false);
  for(const id of ['P1-13','P14-04','P14-12']){
    const row=ledger.overrides.find(x=>x.id===id);
    assert.ok(!row||row.closure_met!==true,id+' must remain open without real campaign');
  }
  assert.equal(ledger.overrides.filter(x=>x.closure_met===true).length,277);
  assert.equal(ledger.production_closed,false);
});

test('external runtime evidence protocol is retained by critical campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/external-runtime-evidence.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=112);
  assert.equal(flake.contract.iterations,5);
});
