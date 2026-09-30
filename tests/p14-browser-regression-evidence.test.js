import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P14-BROWSER-REGRESSION-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const matrix=JSON.parse(readFileSync('release/RELEASE-COMPATIBILITY-MATRIX.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));
const negative=JSON.parse(readFileSync('release/EVIDENCE-NEGATIVE-RESULTS.v1.0.json','utf8'));

test('P14-13 evidence binds exact CI and both retained browser artifacts',()=>{
  assert.equal(evidence.schema,'opencontainer.p14-browser-regression-evidence.v1.0');
  assert.equal(evidence.sourceGate,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P14-13');
  assert.equal(evidence.pullRequest,72);
  assert.equal(evidence.implementationHead,'2f67306726e4d5ded6b60ee7d2483f502638e7b7');
  assert.equal(evidence.ci.runNumber,960);
  assert.equal(evidence.ci.runId,36703869292);
  assert.equal(evidence.ci.testedCheckoutCommit,'56e7478ae0da70582d0852d2247b678f9fc02a73');
  assert.equal(evidence.ci.contractTests,618);
  assert.equal(evidence.ci.contractPassed,618);
  assert.equal(evidence.ci.contractFailed,0);
  assert.equal(evidence.ci.criticalTestFiles,98);
  assert.equal(evidence.ci.criticalTestFileExecutions,490);
  assert.equal(evidence.ci.criticalUnexplainedFailures,0);
  assert.equal(evidence.ci.codeql,'PASS');
  assert.equal(evidence.ci.fullInstalledDistributionBrowserPath,'PASS');
  assert.equal(evidence.ci.p9RenderedRegression,'PASS');
  assert.equal(evidence.campaigns.frozenFloor.artifact.id,11090364706);
  assert.equal(evidence.campaigns.frozenFloor.artifact.digest,'sha256:b7bf15dc48ccb442c28dce9f24fb051f6e370dc83358037dc85b9ac3e4ce2dd0');
  assert.equal(evidence.campaigns.newestStable.artifact.id,11091009915);
  assert.equal(evidence.campaigns.newestStable.artifact.digest,'sha256:2b367b1bad16619ecf68c2274ecf84cc0ed7951dc3bf0f90ee7917c2ce8b706d');
});

test('P14-13 proves floor and newest Stable independently without widening support claims',()=>{
  assert.equal(evidence.campaigns.frozenFloor.browser,'Google Chrome 153.0.8010.52');
  assert.equal(evidence.campaigns.newestStable.browser,'Google Chrome 154.0.8037.92');
  assert.equal(evidence.campaigns.frozenFloor.fullProductPathPasses,2);
  assert.equal(evidence.campaigns.newestStable.fullProductPathPasses,2);
  assert.equal(evidence.aggregate.fullProductPathPasses,4);
  assert.equal(evidence.aggregate.unexplainedFailures,0);
  assert.equal(evidence.campaigns.newestStable.installReceiptRetained,true);
  assert.equal(evidence.campaigns.newestStable.manifestAndArchiveSha256Retained,true);
  assert.equal(evidence.boundaries.p11_13BrowserMinimumFrozen,false);
  assert.equal(evidence.boundaries.crossBrowserMatrixClaimed,false);
  assert.equal(evidence.boundaries.p14_04AdjacentReleaseCertification,false);
  assert.equal(evidence.boundaries.p14_12ProductionCdnTopology,false);
  assert.equal(evidence.boundaries.p14_14WeakDeviceBudget,false);
  assert.equal(evidence.boundaries.p1_14EveryRcMatrix,false);
});

test('P14-13 is promoted exactly while adjacent-release CDN and weak-device gates stay open',()=>{
  const row=ledger.overrides.find(x=>x.id==='P14-13');
  assert.deepEqual(
    {domain:row.domain,state:row.state,promotion:row.promotion,evidence:row.evidence,closure_met:row.closure_met},
    {domain:'P14',state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p14-browser-regression',closure_met:true}
  );
  for(const id of ['P14-04','P14-12','P14-14']){
    const open=ledger.overrides.find(x=>x.id===id);
    assert.ok(!open||open.closure_met!==true,id+' must remain open');
  }
  assert.equal(ledger.overrides.filter(x=>x.domain==='P14'&&x.closure_met===true).length,15);
  assert.ok(ledger.overrides.length>=271,'later gate promotions may legitimately extend reconciliation rows');
  assert.ok(ledger.overrides.filter(x=>x.closure_met===true).length>=261,'later gate promotions may legitimately increase global closure');
  assert.equal(ledger.production_closed,false);
});

test('registry matrix and negative-result history preserve P14-13 evidence boundaries',()=>{
  const entry=registry.entries.find(x=>x.key==='p14-browser-regression');
  assert.deepEqual({kind:entry.kind,level:entry.level,status:entry.status},{kind:'EXECUTABLE',level:'BROWSER',status:'PASS'});
  assert.equal(matrix.releaseRegressionEvidence.gate,'P14-13');
  assert.equal(matrix.releaseRegressionEvidence.status,'PASS-BROWSER');
  assert.equal(matrix.releaseRegressionEvidence.browserMinimumFrozen,false);
  assert.equal(matrix.releaseRegressionEvidence.crossBrowserClaimed,false);
  assert.ok(matrix.openBoundaries.some(x=>x.startsWith('P11-13')));
  assert.ok(matrix.openBoundaries.some(x=>x.includes('weak-device')));
  assert.ok(!matrix.openBoundaries.some(x=>x.startsWith('P14-13 remains open')));
  const neg=negative.results.find(x=>x.id==='NEG-004');
  assert.equal(neg?.classification,'HARNESS_INVALID');
  assert.equal(neg?.evidence,'CI #959 / PR #72');
  assert.equal(neg?.exclusionReasonCode,'HARNESS_TOOLING_BUG');
});

test('P14-13 promotion evidence joins the repeated critical contract campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/p14-browser-regression-source-audit.test.js'));
  assert.ok(flake.contract.testFiles.includes('tests/p14-browser-regression-evidence.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=99,'later evidence waves may legitimately extend the critical campaign');
  assert.equal(flake.contract.iterations,5);
});
