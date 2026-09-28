import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P4-PUBLICATION-ATOMICITY-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const closed=['P4-04','P4-11'];

test('P4 publication atomicity evidence binds exact implementation and Chrome receipt',()=>{
  assert.equal(evidence.schema,'opencontainer.p4-publication-atomicity-evidence.v1.0');
  assert.equal(evidence.source,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.minimumClosure,'RELEASE-READY evidence');
  assert.equal(evidence.pullRequest,60);
  assert.deepEqual(evidence.closedGates.map(item=>item.id),closed);

  assert.equal(evidence.implementation.head,'b710d7f2415a72f706ae73c5b0bb12a6d159d615');
  assert.equal(evidence.implementation.ciRunNumber,677);
  assert.equal(evidence.implementation.ciRunId,36424370483);
  assert.equal(evidence.implementation.testedCheckoutCommit,'34cef8ad31b49d7f8700e507e0a9621ec8ba925b');
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.browserProductPath,'PASS');
  assert.equal(evidence.implementation.unitTests,458);
  assert.equal(evidence.implementation.unitPassed,458);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,52);
  assert.equal(evidence.implementation.contractIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,260);
  assert.equal(evidence.implementation.contractUnexplainedFailures,0);
  assert.equal(evidence.implementation.browserIterations,2);
  assert.equal(evidence.implementation.fullProductPathPasses,2);
  assert.equal(evidence.implementation.browserUnexplainedFailures,0);

  const browser=evidence.dedicatedBrowserVerification;
  assert.equal(browser.artifactId,10970556878);
  assert.equal(browser.status,'PASS');
  assert.equal(browser.browser,'Google Chrome 153.0.8010.52');
  assert.equal(browser.iterations,2);
  assert.equal(browser.passedIterations,2);
  for(const key of [
    'realOpfsGraphPublication',
    'webLocksGraphPublication',
    'persistentGraphGenerationCas',
    'stalePersistentPackageFsPublicationPrevented',
    'concurrentLostUpdatePrevented',
    'realOpfsQuotaFault',
    'realInstallerWorkerDeath',
    'cancellationBeforePublication',
    'immutableOrphansAllowedButUnpublished'
  ]) assert.equal(browser[key],true,key);
  assert.equal(browser.packageFsHalfPublicationObserved,false);
});

test('P4 persistent graph race and failure atomicity stay fail-closed',()=>{
  assert.deepEqual(evidence.persistentGraphRace,{
    concurrentWriters:2,
    exactlyOneBaseGenerationWinner:true,
    loserCode:'OC_STALE_GENERATION',
    winnerGeneration:1,
    successorGeneration:2,
    staleMountCode:'OC_STALE_GENERATION',
    crossContextLocking:true,
    lostUpdateObserved:false,
    halfPublished:false
  });
  assert.equal(evidence.failureAtomicity.cancellation.mountCode,'OC_INVALID_STATE');
  assert.equal(evidence.failureAtomicity.cancellation.retainedImmutableObjects,1);
  assert.equal(evidence.failureAtomicity.cancellation.halfPublished,false);
  assert.equal(evidence.failureAtomicity.quota.failureName,'QuotaExceededError');
  assert.equal(evidence.failureAtomicity.quota.mountCode,'OC_INVALID_STATE');
  assert.equal(evidence.failureAtomicity.quota.halfPublished,false);
  assert.equal(evidence.failureAtomicity.workerDeath.terminated,true);
  assert.equal(evidence.failureAtomicity.workerDeath.mountCode,'OC_PACKAGE_CONTENT_MISSING');
  assert.equal(evidence.failureAtomicity.workerDeath.verifiedOrphans,1);
  assert.equal(evidence.failureAtomicity.workerDeath.halfPublished,false);
});

test('P4 publication atomicity promotes exactly P4-04 and P4-11',()=>{
  const rows=ledger.overrides.filter(item=>item.evidence==='p4-publication-atomicity');
  assert.deepEqual(rows.map(item=>item.id).sort(),[...closed].sort());
  for(const row of rows){
    assert.equal(row.domain,'P4');
    assert.equal(row.state,'EVIDENCE');
    assert.equal(row.promotion,'PASS-BROWSER');
    assert.equal(row.closure_met,true);
  }
  assert.ok(
    ledger.overrides.length>=201,
    'reconciliation ledger must not shrink below the P4 Wave 2 baseline'
  );
  assert.ok(
    ledger.overrides.filter(item=>item.closure_met===true).length>=168,
    'production closure count must not regress below the P4 Wave 2 baseline'
  );
  assert.ok(
    ledger.overrides.filter(item=>item.domain==='P4'&&item.closure_met===true).length>=7,
    'P4 closure count must not regress below the Wave 2 baseline'
  );

  for(const id of evidence.preservedOpenGates){
    const row=ledger.overrides.find(item=>item.id===id);
    assert.notEqual(row?.evidence,'p4-publication-atomicity',id+' was incorrectly attributed to wave 2');
  }
  assert.equal(evidence.p4DomainClosed,false);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P4 publication atomicity evidence is registered and retained by critical flake campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p4-publication-atomicity');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/opfs-package-graph-store.test.js',
    'tests/p4-publication-atomicity.test.js',
    'tests/p4-publication-atomicity-source-audit.test.js',
    'tests/p4-publication-atomicity-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(
    flake.contract.testFiles.length>=53,
    'critical flake campaign must not shrink below the P4 Wave 2 retained baseline'
  );
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
