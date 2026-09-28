import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P4-ARTIFACT-BOUNDARY-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const closed=['P4-05','P4-08','P4-09','P4-10','P4-12'];

test('P4 artifact boundary evidence binds exact implementation and browser receipt',()=>{
  assert.equal(evidence.schema,'opencontainer.p4-artifact-boundary-evidence.v1.0');
  assert.equal(evidence.source,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.minimumClosure,'RELEASE-READY evidence');
  assert.equal(evidence.pullRequest,59);
  assert.deepEqual(evidence.closedGates.map(item=>item.id),closed);

  assert.equal(evidence.implementation.head,'0c9bbed9efd24d6c0700d744b05881515c6c6893');
  assert.equal(evidence.implementation.ciRunNumber,633);
  assert.equal(evidence.implementation.ciRunId,36411620252);
  assert.equal(evidence.implementation.testedCheckoutCommit,'92fed164f4e83414f42fbb052cf2d990e7fa5931');
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.browserProductPath,'PASS');
  assert.equal(evidence.implementation.unitTests,440);
  assert.equal(evidence.implementation.unitPassed,440);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,47);
  assert.equal(evidence.implementation.contractIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,235);
  assert.equal(evidence.implementation.contractUnexplainedFailures,0);
  assert.equal(evidence.implementation.fullProductPathPasses,2);
  assert.equal(evidence.implementation.browserUnexplainedFailures,0);

  assert.equal(evidence.dedicatedBrowserVerification.artifactId,10964252846);
  assert.equal(evidence.dedicatedBrowserVerification.status,'PASS');
  assert.equal(evidence.dedicatedBrowserVerification.iterations,2);
  assert.equal(evidence.dedicatedBrowserVerification.fullProductPathPasses,2);
  assert.equal(evidence.dedicatedBrowserVerification.unexplainedFailures,0);
  assert.equal(evidence.dedicatedBrowserVerification.frozenNpmCorpus.length,2);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P4 hostile and integrity evidence retains exact fail-closed semantics',()=>{
  for(const key of [
    'truncatedHeader','truncatedPayload','truncatedTrailer',
    'pathTraversal','absolutePath','dotSegment','symlink','hardlink',
    'paxExtension','gnuLongNameExtension'
  ]) assert.equal(evidence.hostileMatrix[key],'OC_ARCHIVE_UNSAFE',key);
  assert.equal(evidence.hostileMatrix.truncatedGzip,'TypeError');
  assert.equal(evidence.hostileMatrix.decompressionBudget,'OC_ARTIFACT_TOO_LARGE');
  assert.deepEqual(evidence.integrityMismatch,{
    code:'OC_ARTIFACT_INTEGRITY',
    graphGenerationPreserved:true,
    contentPublished:false,
    installAnywayPath:false
  });
});

test('P4 artifact boundary evidence promotes exactly its five source gates',()=>{
  const rows=ledger.overrides.filter(item=>item.evidence==='p4-artifact-boundary');
  assert.deepEqual(rows.map(item=>item.id).sort(),[...closed].sort());
  for(const row of rows){
    assert.equal(row.domain,'P4');
    assert.equal(row.state,'EVIDENCE');
    assert.equal(row.promotion,'PASS-BROWSER');
    assert.equal(row.closure_met,true);
  }

  const p4=ledger.overrides.filter(item=>item.domain==='P4');
  assert.ok(p4.filter(item=>item.closure_met===true).length>=5);
  assert.ok(ledger.overrides.length>=199);
  assert.ok(ledger.overrides.filter(item=>item.closure_met===true).length>=166);

  for(const id of evidence.preservedOpenGates){
    const row=ledger.overrides.find(item=>item.id===id);
    if(row?.closure_met===true){
      assert.notEqual(row.evidence,'p4-artifact-boundary',id+' later closure was misattributed to P4 wave1');
    }
  }
  assert.equal(evidence.p4DomainClosed,false);
});

test('P4 artifact boundary is registered and retained by repeated critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p4-artifact-boundary');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/p4-artifact-boundary-source-audit.test.js',
    'tests/p4-artifact-boundary-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=49);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
