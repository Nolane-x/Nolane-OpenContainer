import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P4-COMMAND-DIAGNOSTICS-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const closed=['P4-14','P4-17','P4-18'];

test('P4 command diagnostics evidence binds exact implementation and Chrome receipt',()=>{
  assert.equal(evidence.schema,'opencontainer.p4-command-diagnostics-evidence.v1.0');
  assert.equal(evidence.source,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.minimumClosure,'RELEASE-READY evidence');
  assert.equal(evidence.pullRequest,62);
  assert.deepEqual(evidence.closedGates.map(item=>item.id),closed);

  assert.equal(evidence.implementation.head,'dd199a16e921770789e8308cae15922bec89a384');
  assert.equal(evidence.implementation.ciRunNumber,729);
  assert.equal(evidence.implementation.ciRunId,36442120319);
  assert.equal(evidence.implementation.testedCheckoutCommit,'1e2bcf62c41cfa147d8a7ae66ecdd22ecd17d80c');
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.browserProductPath,'PASS');
  assert.equal(evidence.implementation.unitTests,485);
  assert.equal(evidence.implementation.unitPassed,485);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,62);
  assert.equal(evidence.implementation.contractIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,310);
  assert.equal(evidence.implementation.contractUnexplainedFailures,0);
  assert.equal(evidence.implementation.browserIterations,2);
  assert.equal(evidence.implementation.fullProductPathPasses,2);
  assert.equal(evidence.implementation.browserUnexplainedFailures,0);

  const court=evidence.dedicatedReleaseCourt;
  assert.equal(court.artifactId,10979651177);
  assert.equal(court.artifactDigest,'sha256:2b55ba36df2f0dbf2598c92b9011de9b516c07c9c781f4db6a1900a2731c6241');
  assert.equal(court.status,'PASS');
  assert.equal(court.nodeVersion,'v24.21.0');
  assert.equal(court.nodeContractTests,33);
  assert.equal(court.nodeContractPassed,33);
  assert.equal(court.nodeContractFailed,0);
  assert.equal(court.nodeContractSkipped,0);
  assert.equal(court.browser,'Google Chrome 153.0.8010.52');
  assert.equal(court.iterations,2);
  assert.equal(court.passedIterations,2);
});

test('P4 command resolution remains graph/context derived and fail closed',()=>{
  assert.equal(evidence.commandResolution.graphRetainsAllCandidates,true);
  assert.equal(evidence.commandResolution.invocationContextAuthority,'cwd/package-ancestry');
  assert.equal(evidence.commandResolution.rootCandidate,'node_modules/root-tool');
  assert.equal(evidence.commandResolution.nestedCandidate,'node_modules/a/node_modules/nested-tool');
  assert.equal(evidence.commandResolution.linkedWorkspaceContextContract,true);
  assert.equal(evidence.commandResolution.sameScopeAmbiguityCode,'OC_INVALID_PACKAGE_CONFIG');
  assert.equal(evidence.commandResolution.globalMutableOwnershipTable,false);
  assert.equal(evidence.dedicatedReleaseCourt.contextualBinResolution,true);
  assert.equal(evidence.dedicatedReleaseCourt.sameScopeBinAmbiguityFailClosed,true);
  assert.equal(evidence.dedicatedReleaseCourt.lastWriterWinsPrevented,true);
});

test('P4 package diagnostics retain provenance integrity script metadata without SCA claims',()=>{
  assert.equal(evidence.packageDiagnostics.analysisScope,'package-provenance-metadata-only');
  assert.equal(evidence.packageDiagnostics.scaAssessmentPerformed,false);
  assert.equal(evidence.packageDiagnostics.sourcePrivacy.usernameRemoved,true);
  assert.equal(evidence.packageDiagnostics.sourcePrivacy.passwordRemoved,true);
  assert.equal(evidence.packageDiagnostics.sourcePrivacy.queryRemoved,true);
  assert.equal(evidence.packageDiagnostics.sourcePrivacy.fragmentRemoved,true);
  assert.equal(evidence.packageDiagnostics.sourcePrivacy.fingerprintUsesSanitizedUrlOnly,true);
  assert.equal(evidence.packageDiagnostics.sourcePrivacy.rawWorkspaceOrOpaqueSourceFingerprint,false);
  assert.equal(evidence.packageDiagnostics.sourcePrivacy.browserLeakedSecret,false);
  assert.ok(evidence.packageDiagnostics.metadata.some(value=>/integrity/.test(value)));
  assert.ok(evidence.packageDiagnostics.metadata.some(value=>/install-script/.test(value)));
  assert.ok(evidence.packageDiagnostics.forbiddenClaims.some(value=>/SCA/.test(value)));
  assert.equal(evidence.dedicatedReleaseCourt.packageDiagnosticsMetadataOnly,true);
  assert.equal(evidence.dedicatedReleaseCourt.scaAssessmentPerformed,false);
  assert.equal(evidence.dedicatedReleaseCourt.installScriptMetadata,true);
});

test('P4 native addon boundary allows only exact explicit non-native adapters',()=>{
  assert.equal(evidence.nativeAddonBoundary.defaultCode,'OC_NATIVE_ADDON_UNSUPPORTED');
  assert.equal(evidence.nativeAddonBoundary.defaultHostNativeExecution,false);
  assert.equal(evidence.nativeAddonBoundary.genericPackageAliasAuthorizesFallback,false);
  assert.equal(evidence.nativeAddonBoundary.genericPathAliasAuthorizesFallback,false);
  assert.equal(evidence.nativeAddonBoundary.explicitRegistry,'nativeAddonAdapters');
  assert.equal(evidence.nativeAddonBoundary.sourceMustBeExactNodePath,true);
  assert.equal(evidence.nativeAddonBoundary.targetMustBeExistingNonNodeFile,true);
  assert.equal(evidence.nativeAddonBoundary.mappingInResolverCacheIdentity,true);
  assert.equal(evidence.nativeAddonBoundary.explicitReceipt,true);
  assert.equal(evidence.nativeAddonBoundary.hostNativeExecution,false);
  assert.equal(evidence.dedicatedReleaseCourt.genericAliasNativeAddonBypassPrevented,true);
  assert.equal(evidence.dedicatedReleaseCourt.exactNativeAddonAdapterOnly,true);
  assert.equal(evidence.dedicatedReleaseCourt.hostNativeExecution,false);
});

test('P4 Wave 4 promotes exactly P4-14 P4-17 and P4-18',()=>{
  const rows=ledger.overrides.filter(item=>item.evidence==='p4-command-diagnostics');
  assert.deepEqual(rows.map(item=>item.id).sort(),[...closed].sort());
  for(const row of rows){
    assert.equal(row.domain,'P4');
    assert.equal(row.state,'EVIDENCE');
    assert.equal(row.promotion,'PASS-BROWSER');
    assert.equal(row.closure_met,true);
  }
  assert.ok(
    ledger.overrides.length>=206,
    'reconciliation ledger must not shrink below the P4 Wave 4 baseline'
  );
  assert.ok(
    ledger.overrides.filter(item=>item.closure_met===true).length>=175,
    'production closure count must not regress below the P4 Wave 4 baseline'
  );
  assert.ok(
    ledger.overrides.filter(item=>item.domain==='P4'&&item.closure_met===true).length>=14,
    'P4 closure count must not regress below the Wave 4 baseline'
  );

  for(const id of evidence.preservedOpenGates){
    const row=ledger.overrides.find(item=>item.id===id);
    assert.notEqual(row?.evidence,'p4-command-diagnostics',id+' was incorrectly attributed to Wave 4');
  }
  assert.equal(evidence.p4DomainClosed,false);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P4 Wave 4 evidence is registered and retained by critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p4-command-diagnostics');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/package-command-bridge.test.js',
    'tests/resolver.test.js',
    'tests/production-diagnostics.test.js',
    'tests/p4-command-diagnostics-source-audit.test.js',
    'tests/p4-command-diagnostics-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=63);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
