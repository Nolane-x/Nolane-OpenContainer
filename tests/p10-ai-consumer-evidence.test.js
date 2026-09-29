import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P10-AI-CONSUMER-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const gates=Array.from({length:18},(_,i)=>'P10-'+String(i+1).padStart(2,'0'));

test('P10 evidence binds the exact 18-gate declared-profile court',()=>{
  assert.equal(evidence.schema,'opencontainer.p10-ai-consumer-evidence.v1.0');
  assert.equal(evidence.source,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.minimumClosure,'PASS-INTEGRATION + declared-profile evidence');
  assert.equal(evidence.pullRequest,67);
  assert.deepEqual(evidence.closedGates,gates);

  assert.equal(evidence.implementation.head,'41069da8f77e2ba6ad0c1ceab5f12d1711f84ea4');
  assert.equal(evidence.implementation.ciRunNumber,874);
  assert.equal(evidence.implementation.ciRunId,36565669530);
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.unitTests,571);
  assert.equal(evidence.implementation.unitPassed,571);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,87);
  assert.equal(evidence.implementation.criticalIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,435);
  assert.equal(evidence.implementation.criticalUnexplainedFailures,0);
  assert.equal(evidence.implementation.installedDistributionBrowserIterations,2);
  assert.equal(evidence.implementation.installedDistributionBrowserPassed,2);
  assert.equal(evidence.implementation.installedDistributionBrowserFailed,0);
  assert.equal(evidence.implementation.installedDistributionUnexplainedFailures,0);

  assert.equal(evidence.dedicatedBrowserCourt.artifactId,11031678345);
  assert.equal(evidence.dedicatedBrowserCourt.artifactDigest,'sha256:5372a9aaf563c4819bc8af6c95c1d26b459e2408d70c186da17f4aab71216a8c');
  assert.equal(evidence.dedicatedBrowserCourt.status,'PASS');
  assert.equal(evidence.dedicatedBrowserCourt.browser,'Google Chrome 153.0.8010.52');
  assert.equal(evidence.dedicatedBrowserCourt.iterations,2);
  assert.equal(evidence.dedicatedBrowserCourt.passedIterations,2);
  assert.deepEqual(evidence.dedicatedBrowserCourt.sourceGates,gates);
});

test('P10 evidence preserves optional-consumer, BYOK, context and authority boundaries',()=>{
  assert.equal(evidence.boundaries.optionalConsumerPackage,'@nolane/opencontainer-ai-consumer');
  assert.equal(evidence.boundaries.coreSurfaceCount,9);
  assert.equal(evidence.boundaries.coreRuntimeRequiresAi,false);
  assert.equal(evidence.boundaries.modelProviderAgnostic,true);
  assert.equal(evidence.boundaries.fakeProviderUsedOnlyForAuthoritySemantics,true);
  assert.equal(evidence.boundaries.providerQualityClaimed,false);
  assert.equal(evidence.boundaries.providerSpecificCoreApiAdded,false);
  assert.equal(evidence.boundaries.keyPersistenceClaimed,false);

  assert.equal(evidence.guarantees.byok.custody,'session-memory');
  assert.equal(evidence.guarantees.byok.supportPlaintext,false);
  assert.equal(evidence.guarantees.byok.workspacePlaintext,false);
  assert.equal(evidence.guarantees.byok.localStoragePlaintext,false);
  assert.equal(evidence.guarantees.byok.sessionStoragePlaintext,false);
  assert.equal(evidence.guarantees.byok.providerSwitchClearsCredentialAndContextScope,true);

  assert.equal(evidence.guarantees.context.explicitManifest,true);
  assert.equal(evidence.guarantees.context.sensitiveDefaultDeny,true);
  assert.deepEqual(evidence.guarantees.authority.modes,['Discuss','Plan','Build']);
  assert.equal(evidence.guarantees.authority.untrustedRepositoryWebToolDataGrantsAuthority,false);
  assert.equal(evidence.guarantees.authority.approvalRenderingExecutesUntrustedMarkup,false);
});

test('P10 evidence retains ChangeSet, child/provider, concurrency, cancellation and usage invariants',()=>{
  const change=evidence.guarantees.changeset;
  assert.equal(change.preconditioned,true);
  assert.equal(change.validated,true);
  assert.equal(change.singleCanonicalVfsTransaction,true);
  assert.equal(change.broadDestructiveRecoveryPoint,true);
  assert.equal(change.idempotencyIdentity,true);
  assert.equal(change.retryDoesNotReplayCommittedSideEffect,true);
  assert.equal(change.undo,'path-version-aware');
  assert.equal(change.staleUndoRefusesNewerUserEdits,true);

  assert.equal(evidence.guarantees.childAgents.epochBound,true);
  assert.equal(evidence.guarantees.childAgents.staleResultsCanonical,false);
  assert.equal(evidence.guarantees.provider.failureIndependentFromWorkspace,true);
  assert.equal(evidence.guarantees.provider.providerSwitchScopeIsolation,true);
  assert.equal(evidence.guarantees.concurrency.sharedResourceGovernor,true);
  assert.equal(evidence.guarantees.concurrency.leakedTasksAfterRelease,0);
  assert.equal(evidence.guarantees.cancellation.preTool,'OC_WORKER_STALE');
  assert.equal(evidence.guarantees.cancellation.inTool,'OC_WORKER_STALE');
  assert.equal(evidence.guarantees.cancellation.postCommitKeepsCommittedSideEffect,true);
  assert.equal(evidence.guarantees.cancellation.acknowledgementLostUsesIdempotentReceipt,true);
  assert.equal(evidence.guarantees.usageDisplay.hiddenWithoutAuthoritativeProviderMetadata,true);
  assert.equal(evidence.guarantees.usageDisplay.fabricatedEstimates,false);
});

test('P10 promotion closes exactly P10-01 through P10-18 and nothing implies production closure',()=>{
  const rows=ledger.overrides.filter(row=>row.domain==='P10');
  assert.equal(rows.length,18);
  assert.deepEqual(rows.map(row=>row.id).sort(),gates);
  for(const row of rows){
    assert.equal(row.state,'EVIDENCE');
    assert.equal(row.promotion,'PASS-BROWSER');
    assert.equal(row.evidence,'p10-ai-consumer');
    assert.equal(row.closure_met,true);
  }
  assert.ok(
    ledger.overrides.length>=249,
    'reconciliation ledger must not shrink below the P10 closure baseline'
  );
  assert.ok(
    ledger.overrides.filter(row=>row.closure_met===true).length>=239,
    'production closure count must not regress below the P10 closure baseline'
  );
  assert.equal(ledger.production_closed,false);
  assert.equal(evidence.productionClosed,false);

  const entry=registry.entries.find(item=>item.key==='p10-ai-consumer');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
});

test('P10 evidence and source courts are retained in the repeated critical campaign',()=>{
  for(const file of [
    'tests/p10-ai-consumer.test.js',
    'tests/p10-ai-consumer-source-audit.test.js',
    'tests/p10-ai-consumer-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=88);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
