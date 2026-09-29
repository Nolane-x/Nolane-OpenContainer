import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P6-TOOLCHAIN-VITE-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const closed=[
  'P6-01','P6-02','P6-03','P6-04','P6-05','P6-06',
  'P6-07','P6-08','P6-09',
  'P6-11','P6-12','P6-13','P6-14','P6-15','P6-16'
];

test('P6 evidence binds exact implementation CI and artifact receipt',()=>{
  assert.equal(evidence.schema,'opencontainer.p6-toolchain-vite-evidence.v1.0');
  assert.equal(evidence.source,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.minimumClosure,'PASS-INTEGRATION + declared-profile evidence');
  assert.equal(evidence.declaredProfile,'desktop-chrome153-ubuntu2404-x64-ci');
  assert.equal(evidence.pullRequest,64);
  assert.deepEqual(evidence.closedGates,closed);

  assert.equal(evidence.implementation.head,'eaf3386f9d4a39e837243feb71f63c8673b98ca0');
  assert.equal(evidence.implementation.ciRunNumber,814);
  assert.equal(evidence.implementation.ciRunId,36528103226);
  assert.equal(evidence.implementation.testedCheckoutCommit,'702e317899b7dc9e5f6e410fff1c19320283b980');
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.unitTests,515);
  assert.equal(evidence.implementation.unitPassed,515);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,74);
  assert.equal(evidence.implementation.criticalIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,370);
  assert.equal(evidence.implementation.criticalUnexplainedFailures,0);
  assert.equal(evidence.implementation.fullProductPathIterations,2);
  assert.equal(evidence.implementation.fullProductPathPassed,2);
  assert.equal(evidence.implementation.browserUnexplainedFailures,0);

  assert.equal(evidence.dedicatedCourt.artifactId,11015178902);
  assert.equal(evidence.dedicatedCourt.artifactDigest,'sha256:0f87f7b66acfec78eaf03fe7c541f298fd26bf9c001ef91b831d63ca301addad');
  assert.equal(evidence.dedicatedCourt.status,'PASS');
  assert.equal(evidence.dedicatedCourt.nodeVersion,'v24.21.0');
  assert.equal(evidence.dedicatedCourt.browser,'Google Chrome 153.0.8010.52');
  assert.equal(evidence.dedicatedCourt.localIntegrationTests,10);
  assert.equal(evidence.dedicatedCourt.localIntegrationPassed,10);
  assert.equal(evidence.dedicatedCourt.localIntegrationFailed,0);
});

test('P6 exact BCR shared-Wasm and global authority claims stay bounded',()=>{
  assert.deepEqual(
    evidence.artifactIdentity.exactTupleFields,
    ['packageName','toolVersion','artifactDigest','adapterSemanticProfile']
  );
  assert.equal(evidence.artifactIdentity.silentSubstitutionForbidden,true);
  assert.equal(evidence.browserAuthority.globalWorkerBudget,2);
  assert.equal(evidence.browserAuthority.overBudgetCode,'OC_RESOURCE_EXHAUSTED');
  assert.equal(evidence.browserAuthority.versionSkewCode,'OC_TOOLCHAIN_SKEW');
  assert.equal(evidence.browserAuthority.digestMismatchCode,'OC_DIGEST_MISMATCH');
  assert.equal(evidence.browserAuthority.unsupportedVersionCode,'OC_TOOLCHAIN_UNSUPPORTED');
  assert.equal(evidence.browserAuthority.genericWasiExpansionCode,'OC_TOOLCHAIN_UNSUPPORTED');
  assert.equal(evidence.browserAuthority.compiledModuleCompiles,1);
  assert.equal(evidence.browserAuthority.compiledModuleWorkerClones,2);
  assert.equal(evidence.browserAuthority.sharedMemoryGrowCount,2);
  assert.equal(evidence.browserAuthority.sharedMemoryViewGeneration,2);
  assert.equal(evidence.browserAuthority.sharedMemoryInitialBytes,65536);
  assert.equal(evidence.browserAuthority.sharedMemoryFinalBytes,196608);
});

test('P6 Vite C1 C2 failure atomicity diagnostics and measurements remain explicit',()=>{
  assert.equal(evidence.viteC1.version,'8.3.0');
  assert.equal(evidence.viteC1.failureAtomicity,true);
  assert.equal(evidence.viteC1.packageGraphGenerationStable,true);
  assert.equal(evidence.viteC1.packageLayoutIdentityStable,true);
  assert.equal(evidence.viteC1.sourceMapVersion,3);
  assert.ok(evidence.viteC1.sourceMapSources.some(value=>value.includes('src/main.ts')));
  assert.ok(evidence.viteC1.sourceMapSourcesContent>=1);
  assert.equal(evidence.viteC1.failureDiagnosticPath,true);
  assert.equal(evidence.viteC1.deterministicManifest,true);

  assert.equal(evidence.viteC2.safeFailure,true);
  assert.equal(evidence.viteC2.recovered,true);
  assert.equal(evidence.viteC2.virtualHttp,true);
  assert.equal(evidence.viteC2.restartEpoch,true);
  assert.equal(evidence.viteC2.staleRouteRejected,true);
  assert.equal(evidence.viteC2.previewRehydration,true);
  assert.equal(evidence.viteC2.dependencyOptimization.package,'nanoid');
  assert.equal(evidence.viteC2.dependencyOptimization.bytes,1168);

  assert.ok(evidence.measurements.coldModuleStartMs>0);
  assert.ok(evidence.measurements.warmModuleStartMs>0);
  assert.equal(evidence.measurements.compiledModuleCache.compiles,1);
  assert.equal(evidence.measurements.compiledModuleCache.workerClones,2);
  assert.equal(evidence.measurements.heapSamples.length,4);
  assert.equal(evidence.measurements.performanceThresholdClaimed,false);
  assert.equal(evidence.measurements.plateauThresholdClaimed,false);
});

test('P6 Wave #64 closes exactly fifteen historical gates without claiming P6-10',()=>{
  const rows=ledger.overrides.filter(item=>item.evidence==='p6-toolchain-vite');
  assert.deepEqual(rows.map(item=>item.id).sort(),[...closed].sort());
  for(const row of rows){
    assert.equal(row.domain,'P6');
    assert.equal(row.state,'EVIDENCE');
    assert.equal(row.promotion,'PASS-INTEGRATION');
    assert.equal(row.closure_met,true);
  }
  assert.ok(
    ledger.overrides.length>=216,
    'reconciliation ledger must not shrink below the P6 closure baseline'
  );
  assert.ok(
    ledger.overrides.filter(item=>item.closure_met===true).length>=194,
    'production closure count must not regress below the P6 closure baseline'
  );
  assert.ok(
    ledger.overrides.filter(item=>item.domain==='P6'&&item.closure_met===true).length>=15,
    'P6 closure count must not regress below the Wave #64 baseline'
  );
  const p610=ledger.overrides.find(item=>item.id==='P6-10');
  assert.notEqual(p610?.evidence,'p6-toolchain-vite','Wave #64 must never be retroactively credited with P6-10');
  assert.equal(evidence.intentionallyOpenGates.length,1);
  assert.equal(evidence.intentionallyOpenGates[0].id,'P6-10');
  assert.equal(evidence.boundaries.p6DomainClosed,false);
  assert.equal(evidence.boundaries.vitestPromoted,false);
  assert.equal(evidence.boundaries.genericWasiLinuxExpansionPromoted,false);
  assert.equal(evidence.boundaries.crossBrowserClaimed,false);
  assert.equal(evidence.boundaries.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P6 evidence is registered and retained by monotonic critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p6-toolchain-vite');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'INTEGRATION',status:'PASS'}
  );
  for(const file of [
    'tests/p6-toolchain-authority.test.js',
    'tests/p6-toolchain-vite-source-audit.test.js',
    'tests/p6-toolchain-vite-evidence.test.js',
    'tests/vite-c1-oracle.test.js',
    'tests/lightningcss-js-glue.test.js',
    'tests/rolldown-browser-execution.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=75);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
