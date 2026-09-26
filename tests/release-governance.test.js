import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateHotfixPolicy,
  validateHotfixRequest,
  validateDeprecationPolicy,
  validateDeprecationEntry,
  verifyReleaseGovernance
} from '../scripts/verify-release-governance.mjs';

const hotfixPolicy=JSON.parse(await (await import('node:fs/promises')).readFile('release/HOTFIX-POLICY.v0.1.json','utf8'));
const deprecationPolicy=JSON.parse(await (await import('node:fs/promises')).readFile('release/DEPRECATION-POLICY.v0.1.json','utf8'));

function validHotfix(){
  return {
    schema:'opencontainer.hotfix-request.v0.1',
    reason:'Fix a release-critical browser regression',
    sourceRelease:{
      version:'0.1.0-alpha.1',
      sourceCommit:'a'.repeat(40),
      artifactSha256:'b'.repeat(64),
      artifactSha512:'c'.repeat(128),
      sbomDigest:'d'.repeat(64),
      provenanceDigest:'e'.repeat(64),
      decisionReceipt:'release-decision.json'
    },
    targetVersion:'0.1.0-alpha.2',
    completedEvidenceCommands:[...hotfixPolicy.requiredEvidenceCommands],
    artifactStrategy:'rebuild-from-source',
    directArtifactMutation:false,
    archivedDecision:true,
    storageImpact:'migration',
    migrationEvidence:{
      dryRun:true,
      crashPhases:['after-preflight','after-payload','after-verify','after-publish'],
      rollbackPlan:'Reuse newer storage read-only or refuse open; never downgrade storage.',
      destructiveStorageDowngrade:false
    },
    securityImpact:'security',
    incidentId:'INC-2026-001',
    fullBrowserRegression:true
  };
}

test('hotfix policy preserves provenance migration and release courts',()=>{
  assert.deepEqual(validateHotfixPolicy(hotfixPolicy),[]);
  assert.equal(hotfixPolicy.releaseRules.directArtifactMutationForbidden,true);
  assert.equal(hotfixPolicy.releaseRules.destructiveStorageDowngradeForbidden,true);
  assert.equal(hotfixPolicy.releaseRules.archivedDecisionRequired,true);
});

test('valid prerelease hotfix requires full provenance and migration discipline',()=>{
  assert.deepEqual(validateHotfixRequest(hotfixPolicy,validHotfix()),[]);
});

test('hotfix cannot bypass provenance rebuild migration crash matrix or browser regression',()=>{
  const request=validHotfix();
  request.sourceRelease.provenanceDigest='';
  request.completedEvidenceCommands=request.completedEvidenceCommands.filter((item)=>item!=='npm run release:verify');
  request.artifactStrategy='edit-published-tarball';
  request.directArtifactMutation=true;
  request.migrationEvidence.crashPhases=['after-preflight'];
  request.migrationEvidence.destructiveStorageDowngrade=true;
  request.fullBrowserRegression=false;
  const errors=validateHotfixRequest(hotfixPolicy,request);
  assert.ok(errors.some((item)=>item.includes('provenanceDigest')));
  assert.ok(errors.some((item)=>item.includes('npm run release:verify')));
  assert.ok(errors.some((item)=>item.includes('rebuilt from source')));
  assert.ok(errors.some((item)=>item.includes('cannot mutate')));
  assert.ok(errors.some((item)=>item.includes('after-payload')));
  assert.ok(errors.some((item)=>item.includes('destructive downgrade')));
  assert.ok(errors.some((item)=>item.includes('full browser regression')));
});

test('stable hotfix is patch-only while prerelease hotfix stays on same prerelease channel',()=>{
  const stable=validHotfix();
  stable.sourceRelease.version='1.4.2';
  stable.targetVersion='1.4.3';
  stable.securityImpact='none';
  delete stable.incidentId;
  delete stable.fullBrowserRegression;
  assert.deepEqual(validateHotfixRequest(hotfixPolicy,stable),[]);

  stable.targetVersion='1.5.0';
  assert.ok(validateHotfixRequest(hotfixPolicy,stable).some((item)=>item.includes('patch exactly once')));

  const pre=validHotfix();
  pre.targetVersion='0.1.0-beta.1';
  assert.ok(validateHotfixRequest(hotfixPolicy,pre).some((item)=>item.includes('retain the prerelease channel label')));
});

test('deprecation policy freezes both release and calendar windows',()=>{
  assert.deepEqual(validateDeprecationPolicy(deprecationPolicy),[]);
  assert.equal(deprecationPolicy.minimumStableReleaseWindow,2);
  assert.equal(deprecationPolicy.minimumDays,90);
});

test('normal deprecation requires at least two stable releases and ninety days plus migration notice',()=>{
  const entry={
    schema:'opencontainer.deprecation-entry.v0.1',
    surface:'public-api',
    id:'runtime.oldMethod',
    deprecatedVersion:'1.2.0',
    removalVersion:'2.0.0',
    stableReleasesElapsed:2,
    deprecatedAt:'2026-01-01T00:00:00Z',
    removalNotBefore:'2026-04-01T00:00:00Z',
    noticePublished:true,
    replacementOrRationale:'Use runtime.newMethod',
    migrationGuide:'docs/migrate-old-method.md',
    releaseNotesUpdated:true,
    securityEmergency:false
  };
  assert.deepEqual(validateDeprecationEntry(deprecationPolicy,entry),[]);

  const tooEarly={...entry,stableReleasesElapsed:1,removalNotBefore:'2026-02-01T00:00:00Z'};
  const errors=validateDeprecationEntry(deprecationPolicy,tooEarly);
  assert.ok(errors.some((item)=>item.includes('stable-release window')));
  assert.ok(errors.some((item)=>item.includes('calendar window')));
});

test('security emergency may bypass time window only with full incident trail',()=>{
  const emergency={
    schema:'opencontainer.deprecation-entry.v0.1',
    surface:'adapter',
    id:'adapter.compromised',
    deprecatedVersion:'1.2.0',
    removalVersion:'1.2.1',
    stableReleasesElapsed:0,
    deprecatedAt:'2026-09-26T00:00:00Z',
    removalNotBefore:'2026-09-26T00:00:00Z',
    securityEmergency:true,
    emergency:{
      severity:'critical',
      incidentId:'SEC-2026-004',
      customerWarning:'Published advisory with affected versions.',
      recoveryOrAlternative:'Disable adapter and use isolated replacement.',
      postIncidentReview:'Complete root-cause and policy review.'
    }
  };
  assert.deepEqual(validateDeprecationEntry(deprecationPolicy,emergency),[]);

  const invalid=structuredClone(emergency);
  invalid.emergency.incidentId='';
  invalid.emergency.severity='medium';
  const errors=validateDeprecationEntry(deprecationPolicy,invalid);
  assert.ok(errors.some((item)=>item.includes('severity')));
  assert.ok(errors.some((item)=>item.includes('incident ID')));
});

test('repository release governance registry verifies cleanly',async()=>{
  const receipt=await verifyReleaseGovernance();
  assert.equal(receipt.ok,true,JSON.stringify(receipt.errors));
  assert.equal(receipt.deprecationEntries,0);
});
