import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const graph=readFileSync('packages/package-env/src/index.js','utf8');
const install=readFileSync('packages/package-env/src/frozen-install.js','utf8');
const harness=readFileSync('scripts/p4-publication-atomicity.mjs','utf8');
const worker=readFileSync('apps/playground/public/p4-install-worker.js','utf8');
const workflow=readFileSync('.github/workflows/ci.yml','utf8');

test('P4 PackageFS publication is generation-preconditioned',()=>{
  assert.match(graph,/compile\(lockfile,\{expectedGeneration=null\}=\{\}\)/);
  assert.match(graph,/ErrorCodes\.STALE_GENERATION/);
  assert.match(graph,/assertGraphGeneration\(expectedGeneration\)/);
  assert.match(graph,/expectedGraphGeneration/);
  assert.match(install,/boundGraphGeneration/);
  assert.match(install,/expectedGraphGeneration:this\.#boundGraphGeneration/);
  assert.match(install,/publicationPrecondition:'graph-generation-cas'/);
});

test('P4 failed or cancelled install cannot publish PackageFS before complete rerun',()=>{
  assert.match(install,/#lastInstallFailed = false/);
  assert.match(install,/this\.#lastInstallFailed = true/);
  assert.match(install,/Failed or cancelled package install cannot publish PackageFS/);
  assert.match(install,/this\.#assertGraphCurrent\(\)/);
});

test('P4 dedicated browser fault court uses real quota override and real module Worker termination',()=>{
  assert.match(harness,/Storage\.getUsageAndQuota/);
  assert.match(harness,/Storage\.overrideQuotaForOrigin/);
  assert.match(harness,/realOpfsQuotaFault:true/);
  assert.match(harness,/realInstallerWorkerDeath:true/);
  assert.match(worker,/new PackageArtifactAuthority|PackageArtifactAuthority/);
  assert.match(worker,/first-content-persisted/);
  assert.match(worker,/second-fetch-blocked/);
  assert.match(workflow,/p4-publication-atomicity:/);
  assert.match(workflow,/npm run p4:publication-atomicity:evidence/);
});
