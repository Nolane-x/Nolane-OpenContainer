import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P13-OPENSSF-SCORECARD-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const policy=JSON.parse(readFileSync('release/SUPPLY-CHAIN-REVIEW-POLICY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));
const negative=JSON.parse(readFileSync('release/EVIDENCE-NEGATIVE-RESULTS.v1.0.json','utf8'));

test('P13-18 binds retained official OpenSSF Scorecard output and exact implementation CI',()=>{
  assert.equal(evidence.schema,'opencontainer.p13-openssf-scorecard-evidence.v1.0');
  assert.equal(evidence.pullRequest,73);
  assert.equal(evidence.implementationHead,'9811c0f6423aa3a1a4aff21711b5116e95c75dd7');
  assert.equal(evidence.scorecardRun.runNumber,2);
  assert.equal(evidence.scorecardRun.runId,36708239438);
  assert.equal(evidence.scorecardRun.action.release,'v2.4.4');
  assert.equal(evidence.scorecardRun.action.commit,'2d1146689b8cda280b9bc96326124645441f03bc');
  assert.equal(evidence.scorecardRun.scorecard.version,'v5.5.0');
  assert.equal(evidence.scorecardRun.scorecard.aggregateScore,6.9);
  assert.equal(evidence.scorecardRun.scorecard.checkCount,11);
  assert.equal(evidence.scorecardRun.rawSha256,'6db20bee3c94f5d377ca49b3265e804c9382c9fffaa4df4a0f426d94997515a7');
  assert.equal(evidence.scorecardRun.artifact.id,11093017366);
  assert.equal(evidence.scorecardRun.artifact.digest,'sha256:a09995085ce8d2fcb1dbc8b4a2c959bd23b688f507a5a0e20b2103e54e7e0b57');
  assert.equal(evidence.regressionCi.runNumber,969);
  assert.equal(evidence.regressionCi.contractTests,625);
  assert.equal(evidence.regressionCi.criticalTestFileExecutions,500);
  assert.equal(evidence.regressionCi.criticalUnexplainedFailures,0);
  assert.equal(evidence.regressionCi.codeql,'PASS');
  assert.equal(evidence.regressionCi.fullInstalledDistributionBrowserPath,'PASS');
});

test('P13-18 preserves actual hygiene findings without manufacturing a score threshold',()=>{
  assert.equal(evidence.interpretation.minimumScoreThresholdClaimed,false);
  assert.equal(evidence.interpretation.lowScoresPreserved,true);
  const scores=Object.fromEntries(evidence.scorecardRun.checks.map(x=>[x.name,x.score]));
  assert.equal(scores.License,0);
  assert.equal(scores['Dependency-Update-Tool'],0);
  assert.equal(scores.Packaging,-1);
  assert.equal(scores.Fuzzing,0);
  assert.equal(scores['Token-Permissions'],10);
  assert.equal(scores['Pinned-Dependencies'],10);
  assert.equal(scores.Vulnerabilities,10);
  assert.equal(evidence.boundaries.releaseProofClaimed,false);
  assert.equal(evidence.boundaries.signingClaimed,false);
  assert.equal(evidence.boundaries.branchProtectionClaimed,false);
  assert.equal(evidence.boundaries.legalClosureClaimed,false);
});

test('P13-18 is the only newly promoted P13 gate and external trust blockers remain open',()=>{
  const row=ledger.overrides.find(x=>x.id==='P13-18');
  assert.deepEqual(
    {domain:row.domain,state:row.state,promotion:row.promotion,evidence:row.evidence,closure_met:row.closure_met},
    {domain:'P13',state:'EVIDENCE',promotion:'RELEASE-VERIFIED',evidence:'p13-openssf-scorecard',closure_met:true}
  );
  assert.equal(policy.gateAuthority['P13-18'].machineClosable,true);
  assert.equal(policy.gateAuthority['P13-18'].state,'CLOSED_BY_OPENSSF');
  for(const id of ['P13-03','P13-04','P13-07','P13-09','P13-10','P13-16','P13-17']){
    const open=ledger.overrides.find(x=>x.id===id);
    assert.ok(!open||open.closure_met!==true,id+' must remain open');
  }
  assert.ok(ledger.overrides.filter(x=>x.domain==='P13'&&x.closure_met===true).length>=12,'later P13 promotions may legitimately increase closure');
  assert.equal(ledger.overrides.length,272);
  assert.ok(ledger.overrides.filter(x=>x.closure_met===true).length>=262,'later gate promotions may legitimately increase global closure');
  assert.equal(ledger.production_closed,false);
});

test('P13-18 registry negative history and critical campaign stay fail-closed',()=>{
  const entry=registry.entries.find(x=>x.key==='p13-openssf-scorecard');
  assert.deepEqual({kind:entry.kind,level:entry.level,status:entry.status},{kind:'EXECUTABLE',level:'RELEASE-VERIFIED',status:'PASS'});
  for(const id of ['NEG-005','NEG-006']){
    const row=negative.results.find(x=>x.id===id);
    assert.equal(row?.classification,'HARNESS_INVALID');
    assert.equal(row?.exclusionReasonCode,'HARNESS_TOOLING_BUG');
  }
  assert.ok(flake.contract.testFiles.includes('tests/p13-openssf-scorecard-source-audit.test.js'));
  assert.ok(flake.contract.testFiles.includes('tests/p13-openssf-scorecard-evidence.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=101);
  assert.equal(flake.contract.iterations,5);
});
