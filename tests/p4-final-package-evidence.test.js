import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P4-FINAL-PACKAGE-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const closed=['P4-07','P4-13','P4-15','P4-16'];

test('final P4 package evidence binds exact implementation and Chrome receipt',()=>{
  assert.equal(evidence.schema,'opencontainer.p4-final-package-evidence.v1.0');
  assert.equal(evidence.source,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.minimumClosure,'RELEASE-READY evidence');
  assert.equal(evidence.pullRequest,63);
  assert.deepEqual(evidence.closedGates.map(item=>item.id),closed);

  assert.equal(evidence.implementation.head,'db400b8fd53213dbefc36dbb02418508d5ef9724');
  assert.equal(evidence.implementation.ciRunNumber,789);
  assert.equal(evidence.implementation.ciRunId,36499644834);
  assert.equal(evidence.implementation.testedCheckoutCommit,'40ff570626c3f58fe88b4dc9e8da4ce09af256aa');
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.browserProductPath,'PASS');
  assert.equal(evidence.implementation.unitTests,503);
  assert.equal(evidence.implementation.unitPassed,503);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,66);
  assert.equal(evidence.implementation.contractIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,330);
  assert.equal(evidence.implementation.contractUnexplainedFailures,0);
  assert.equal(evidence.implementation.browserIterations,2);
  assert.equal(evidence.implementation.fullProductPathPasses,2);

  const court=evidence.dedicatedReleaseCourt;
  assert.equal(court.artifactId,11004449702);
  assert.equal(court.artifactDigest,'sha256:74f8ba0cac2ddf77bd4b99230e6e15e603076d2968dfaf376c29717895071941');
  assert.equal(court.status,'PASS');
  assert.equal(court.nodeVersion,'v24.21.0');
  assert.equal(court.browser,'Google Chrome 153.0.8010.52');
  assert.equal(court.iterations,2);
  assert.equal(court.passedIterations,2);
  assert.deepEqual(court.sourceGates,closed);
});

test('P4 final parser lifecycle watcher and measurement guarantees remain explicit',()=>{
  assert.equal(evidence.parserFuzzing.retainedMinimizedInputs,8);
  assert.deepEqual(evidence.parserFuzzing.retainedTargets,['tar','gzip','manifest','lockfile']);
  assert.equal(evidence.parserFuzzing.nodeMutationCampaigns,512);
  assert.equal(evidence.parserFuzzing.browserMutationCampaigns,256);
  assert.equal(evidence.parserFuzzing.rawParserExceptions,0);

  assert.equal(evidence.lifecycleScripts.separateCapability,true);
  assert.deepEqual(
    evidence.lifecycleScripts.exactGrantIdentity,
    ['package location','lifecycle event','exact command','frozen content identity']
  );
  assert.equal(evidence.lifecycleScripts.contentIdBound,true);
  assert.equal(evidence.lifecycleScripts.ambientEnvKeys,0);
  assert.equal(evidence.lifecycleScripts.secretHandleCount,0);
  assert.equal(evidence.lifecycleScripts.secretBearingInstallRejected,true);
  assert.equal(evidence.lifecycleScripts.publicationBarrierRetained,true);

  assert.equal(evidence.packageLayout.dedicatedWatcher,true);
  assert.equal(evidence.packageLayout.genericFsWatchClaimed,false);
  assert.deepEqual(evidence.packageLayout.reasons,['unmounted','install','reinstall','remove','install']);
  assert.deepEqual(evidence.packageLayout.catalogGenerations,[0,1,2,3,4]);
  assert.deepEqual(evidence.packageLayout.readdirAfterInstall,['a','ws']);
  assert.deepEqual(evidence.packageLayout.readdirAfterReinstall,['a','b','ws']);
  assert.equal(evidence.packageLayout.linkedRealpath,'/workspace/packages/ws/index.cjs');

  assert.equal(evidence.measurements.storage.formula,'physical-persistent-bytes/unique-verified-logical-content-bytes');
  assert.equal(evidence.measurements.storage.surface,'OpfsPackageContentStore');
  assert.equal(evidence.measurements.storage.physicalPersistentBytes,7636456);
  assert.equal(evidence.measurements.storage.uniqueVerifiedLogicalContentBytes,28364367);
  assert.equal(evidence.measurements.storage.storageAmplification,0.2692270904547244);
  assert.equal(evidence.measurements.storage.thresholdClaimed,false);
  assert.equal(evidence.measurements.graphLoad.thresholdClaimed,false);
});

test('final P4 wave closes exactly the remaining four gates and P4 becomes 18/18',()=>{
  const rows=ledger.overrides.filter(item=>item.evidence==='p4-final-package');
  assert.deepEqual(rows.map(item=>item.id).sort(),[...closed].sort());
  for(const row of rows){
    assert.equal(row.domain,'P4');
    assert.equal(row.state,'EVIDENCE');
    assert.equal(row.promotion,'PASS-BROWSER');
    assert.equal(row.closure_met,true);
  }

  assert.equal(ledger.overrides.length,209);
  assert.equal(ledger.overrides.filter(item=>item.closure_met===true).length,179);
  const p4=ledger.overrides.filter(item=>item.domain==='P4'&&item.closure_met===true);
  assert.equal(p4.length,18);
  assert.deepEqual(
    p4.map(item=>item.id).sort(),
    Array.from({length:18},(_,index)=>'P4-'+String(index+1).padStart(2,'0'))
  );
  assert.equal(evidence.p4DomainClosed,true);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('final P4 evidence is registered and retained by the monotonic critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p4-final-package');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/frozen-install.test.js',
    'tests/p4-package-layout-watch.test.js',
    'tests/p4-parser-fuzz.test.js',
    'tests/p4-final-package-source-audit.test.js',
    'tests/p4-final-package-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=67);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
