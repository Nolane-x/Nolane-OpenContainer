import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P4-ECOSYSTEM-LAYOUT-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const closed=['P4-01','P4-02','P4-03','P4-06'];

test('P4 ecosystem layout evidence binds exact Node Chrome and implementation receipts',()=>{
  assert.equal(evidence.schema,'opencontainer.p4-ecosystem-layout-evidence.v1.0');
  assert.equal(evidence.source,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.minimumClosure,'RELEASE-READY evidence');
  assert.equal(evidence.pullRequest,61);
  assert.deepEqual(evidence.closedGates.map(item=>item.id),closed);

  assert.equal(evidence.implementation.head,'54334c52e1a73d992dbd0ea46006016089e9afcd');
  assert.equal(evidence.implementation.ciRunNumber,693);
  assert.equal(evidence.implementation.ciRunId,36433026751);
  assert.equal(evidence.implementation.testedCheckoutCommit,'8270c4f8ddf0c1286df1f283c206559b7efa62b0');
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.browserProductPath,'PASS');
  assert.equal(evidence.implementation.unitTests,472);
  assert.equal(evidence.implementation.unitPassed,472);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,57);
  assert.equal(evidence.implementation.contractIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,285);
  assert.equal(evidence.implementation.contractUnexplainedFailures,0);
  assert.equal(evidence.implementation.browserIterations,2);
  assert.equal(evidence.implementation.fullProductPathPasses,2);
  assert.equal(evidence.implementation.browserUnexplainedFailures,0);

  const court=evidence.dedicatedReleaseCourt;
  assert.equal(court.artifactId,10974148519);
  assert.equal(court.artifactDigest,'sha256:c59ef55ea62ce16c1d95674c2f6e8d12bd7078c65048724eca3ce6c900c11719');
  assert.equal(court.status,'PASS');
  assert.equal(court.nodeVersion,'v24.21.0');
  assert.equal(court.exactNodeOracle,true);
  assert.equal(court.browser,'Google Chrome 153.0.8010.52');
  assert.equal(court.iterations,2);
  assert.equal(court.passedIterations,2);
  assert.equal(court.frozenRealRepositories,13);
  assert.equal(court.frozenExecutablePackageGraphs,2);
  assert.equal(court.publishedTarballsVerified,9);
});

test('P4 resolver corpus layout and provenance guarantees remain explicit',()=>{
  assert.equal(evidence.nodeOracle.exactVersion,'v24.21.0');
  assert.equal(evidence.nodeOracle.skipped,0);
  assert.equal(evidence.nodeOracle.failed,0);
  assert.ok(evidence.nodeOracle.selectedSurfaces.some(value=>/exports/.test(value)));
  assert.ok(evidence.nodeOracle.selectedSurfaces.some(value=>/imports/.test(value)));
  assert.ok(evidence.nodeOracle.selectedSurfaces.some(value=>/symlink/.test(value)));

  assert.deepEqual(evidence.realRepositoryGraphs.map(item=>item.graphNodes),[219,8]);
  assert.notEqual(
    evidence.realRepositoryGraphs[0].layoutFingerprint,
    evidence.realRepositoryGraphs[1].layoutFingerprint
  );
  assert.equal(evidence.layoutIdentity.authority,'package-lock-physical-locations');
  assert.deepEqual(
    evidence.layoutIdentity.observableKinds,
    ['top-level','hoisted-transitive','nested','linked','shallow']
  );
  assert.equal(evidence.layoutIdentity.hoistedAndNestedFingerprintsDiffer,true);
  assert.equal(evidence.layoutIdentity.linkedSemanticsObservable,true);
  assert.equal(evidence.ecosystemProvenance.repositoryCases,13);
  assert.equal(evidence.ecosystemProvenance.publishedTarballsVerified,9);

  for(const key of [
    'onlineRepositoryVerification',
    'sourceCommitPins',
    'lockfileBlobPins',
    'licenseBlobPins',
    'npmTarballUrlPins',
    'npmSha512Pins',
    'npmSha1Pins',
    'packageLayoutIdentityObservable',
    'nodeResolverDifferentialPreserved'
  ]) assert.equal(evidence.dedicatedReleaseCourt[key],true,key);
});

test('P4 ecosystem wave promotes exactly P4-01 P4-02 P4-03 and P4-06',()=>{
  const rows=ledger.overrides.filter(item=>item.evidence==='p4-ecosystem-layout');
  assert.deepEqual(rows.map(item=>item.id).sort(),[...closed].sort());
  for(const row of rows){
    assert.equal(row.domain,'P4');
    assert.equal(row.state,'EVIDENCE');
    assert.equal(row.promotion,'PASS-BROWSER');
    assert.equal(row.closure_met,true);
  }

  assert.equal(ledger.overrides.length,204);
  assert.equal(ledger.overrides.filter(item=>item.closure_met===true).length,172);
  assert.equal(ledger.overrides.filter(item=>item.domain==='P4'&&item.closure_met===true).length,11);

  for(const id of evidence.preservedOpenGates){
    const row=ledger.overrides.find(item=>item.id===id);
    assert.notEqual(row?.evidence,'p4-ecosystem-layout',id+' was incorrectly attributed to wave 3');
    assert.notEqual(row?.closure_met,true,id+' was incorrectly closed by wave 3');
  }
  assert.equal(evidence.p4DomainClosed,false);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P4 ecosystem evidence is registered and retained by monotonic critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p4-ecosystem-layout');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/node24-resolver-differential.test.js',
    'tests/p4-layout-identity.test.js',
    'tests/p4-ecosystem-layout-corpus.test.js',
    'tests/p4-ecosystem-layout-source-audit.test.js',
    'tests/p4-ecosystem-layout-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=58);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
