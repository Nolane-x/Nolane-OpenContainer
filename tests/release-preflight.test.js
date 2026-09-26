import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateReleasePreflight,
  loadReleaseInputs,
  parseSemver,
  renderChangelog,
  validateReleasePolicy
} from '../scripts/evaluate-release-preflight.mjs';

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function configureStableCandidate(inputs,{sourceCommit='d'.repeat(40)}={}){
  inputs.candidate.channel='stable';
  inputs.candidate.version='1.0.0';
  inputs.rootPackage.version='1.0.0';
  inputs.sdkPackage.version='1.0.0';
  inputs.protocolPackage.version='1.0.0';
  inputs.profile.runtime.version='1.0.0';
  inputs.profile.protocol.packageVersion='1.0.0';
  inputs.candidate.priorPromotions=[
    {channel:'canary',version:'0.1.0-alpha.1',decision:'GO',evidence:'CI canary'},
    {channel:'beta',version:'0.9.0-beta.1',decision:'GO',evidence:'CI beta'},
    {channel:'rc',version:'1.0.0-rc.1',decision:'GO',evidence:'CI rc'}
  ];
  inputs.criticalContractFlakeReceipt={
    schema:'opencontainer.critical-flake-contract.v0.1',
    sourceCommit,
    status:'PASS',
    unexplainedFailures:0,
    iterations:inputs.criticalFlakePolicy.contract.minimumIterations,
    testFiles:[...inputs.criticalFlakePolicy.contract.testFiles]
  };
  inputs.criticalBrowserFlakeReceipt={
    schema:'opencontainer.critical-flake-browser.v0.1',
    sourceCommit,
    status:'PASS',
    unexplainedFailures:0,
    iterations:inputs.criticalFlakePolicy.browser.minimumIterations,
    fullProductPathPasses:inputs.criticalFlakePolicy.browser.minimumIterations,
    profile:inputs.criticalFlakePolicy.browser.profile
  };
  return sourceCommit;
}

test('release policy freezes monotonic canary beta rc stable channels',async()=>{
  const {policy}=await loadReleaseInputs();
  assert.deepEqual(validateReleasePolicy(policy),[]);
  assert.deepEqual(policy.channels.map((item)=>item.id),['canary','beta','rc','stable']);
  assert.equal(policy.channels.at(-1).requireProductionClosed,true);
  assert.equal(policy.channels.at(-1).requireZeroUnexplainedCriticalFlakes,true);
  assert.equal(policy.channels.at(-1).allowUnresolvedRisks,false);
});

test('semantic version parser distinguishes prerelease and stable identities',()=>{
  assert.deepEqual(parseSemver('0.1.0-alpha.1').prerelease,['alpha','1']);
  assert.deepEqual(parseSemver('1.2.3').prerelease,[]);
  assert.equal(parseSemver('01.2.3'),null);
  assert.equal(parseSemver('1.2'),null);
});

test('current reviewed alpha candidate qualifies only for canary GO',async()=>{
  const inputs=await loadReleaseInputs();
  const receipt=evaluateReleasePreflight(inputs,{sourceCommit:'a'.repeat(40)});
  assert.equal(receipt.decision,'GO');
  assert.equal(receipt.eligible,true);
  assert.equal(receipt.channel,'canary');
  assert.equal(receipt.version,'0.1.0-alpha.1');
  assert.equal(receipt.checks.versionProfileCoherent,true);
  assert.equal(receipt.checks.reviewedChangesComplete,true);
  assert.equal(receipt.checks.channelEvidenceSatisfied,true);
  assert.equal(receipt.checks.priorPromotionChainSatisfied,true);
  assert.equal(receipt.productionClosed,false);
  assert.equal(receipt.reviewedChangeCount,2);
});

test('release changelog is generated from reviewed changes with compatibility implications',async()=>{
  const {candidate}=await loadReleaseInputs();
  const changelog=renderChangelog(candidate);
  for(const change of candidate.reviewedChanges){
    assert.ok(changelog.includes(change.ref));
    assert.ok(changelog.includes('API: '+change.implications.api));
    assert.ok(changelog.includes('Storage: '+change.implications.storage));
    assert.ok(changelog.includes('Security: '+change.implications.security));
  }
  assert.ok(changelog.includes('## Unresolved risks'));
});

test('version or profile drift is a KILL decision rather than a promotion downgrade',async()=>{
  const inputs=clone(await loadReleaseInputs());
  inputs.sdkPackage.version='0.1.0-alpha.2';
  const receipt=evaluateReleasePreflight(inputs,{sourceCommit:'b'.repeat(40)});
  assert.equal(receipt.decision,'KILL');
  assert.equal(receipt.eligible,false);
  assert.equal(receipt.checks.versionProfileCoherent,false);
  assert.ok(receipt.failures.fatal.some((item)=>item.includes('public SDK version')));
});

test('beta cannot skip prior promotion receipts or required closure',async()=>{
  const inputs=clone(await loadReleaseInputs());
  inputs.candidate.channel='beta';
  inputs.candidate.version='0.1.0-beta.1';
  inputs.rootPackage.version='0.1.0-beta.1';
  inputs.sdkPackage.version='0.1.0-beta.1';
  inputs.protocolPackage.version='0.1.0-beta.1';
  inputs.profile.runtime.version='0.1.0-beta.1';
  inputs.profile.protocol.packageVersion='0.1.0-beta.1';
  const receipt=evaluateReleasePreflight(inputs,{sourceCommit:'c'.repeat(40)});
  assert.equal(receipt.decision,'REDESIGN');
  assert.ok(receipt.failures.redesign.some((item)=>item.includes('missing prior GO promotion receipt for canary')));
  assert.ok(receipt.failures.redesign.some((item)=>item.includes('P11-12')));
});

test('stable uses independent flake receipts rather than candidate self-report',async()=>{
  const inputs=clone(await loadReleaseInputs());
  const sourceCommit=configureStableCandidate(inputs);
  inputs.candidate.criticalTestFlakiness={unexplained:999};
  const receipt=evaluateReleasePreflight(inputs,{sourceCommit});
  assert.equal(receipt.decision,'REDESIGN');
  assert.equal(receipt.checks.independentCriticalFlakeCampaign,true);
  assert.equal(receipt.checks.unexplainedCriticalFlakes,0);
  assert.ok(receipt.failures.redesign.some((item)=>item.includes('production_closed is false')));
  assert.ok(receipt.failures.redesign.some((item)=>item.includes('unresolved release risks remain')));
  assert.equal(receipt.failures.redesign.some((item)=>item.includes('critical flake campaign')),false);
});

test('stable blocks when an independent browser flake receipt is missing',async()=>{
  const inputs=clone(await loadReleaseInputs());
  const sourceCommit=configureStableCandidate(inputs);
  inputs.criticalBrowserFlakeReceipt=null;
  const receipt=evaluateReleasePreflight(inputs,{sourceCommit});
  assert.equal(receipt.decision,'REDESIGN');
  assert.equal(receipt.checks.independentCriticalFlakeCampaign,false);
  assert.ok(receipt.failures.redesign.some((item)=>item.includes('critical browser flake receipt is missing or invalid')));
});

test('stable blocks commit-skewed or unexplained critical flake evidence',async()=>{
  const inputs=clone(await loadReleaseInputs());
  const sourceCommit=configureStableCandidate(inputs);
  inputs.criticalContractFlakeReceipt.sourceCommit='e'.repeat(40);
  inputs.criticalBrowserFlakeReceipt.unexplainedFailures=1;
  inputs.criticalBrowserFlakeReceipt.status='FAIL';
  const receipt=evaluateReleasePreflight(inputs,{sourceCommit});
  assert.equal(receipt.decision,'REDESIGN');
  assert.equal(receipt.checks.independentCriticalFlakeCampaign,false);
  assert.ok(receipt.failures.redesign.some((item)=>item.includes('contract flake receipt source commit does not match')));
  assert.ok(receipt.failures.redesign.some((item)=>item.includes('browser flake campaign has 1 unexplained failures')));
});
