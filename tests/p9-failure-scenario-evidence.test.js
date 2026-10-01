import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const evidence=JSON.parse(readFileSync('release/P9-FAILURE-SCENARIO-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));
const map=JSON.parse(readFileSync('release/P9-FAILURE-COURT-MAP.v1.0.json','utf8'));

test('P9-03 promotion binds exact SHA-locked corpus and same-head implementation evidence',()=>{
  assert.equal(evidence.schema,'opencontainer.p9-failure-scenario-evidence.v1.0');
  assert.equal(evidence.pullRequest,77);
  assert.equal(evidence.implementation.head,'17b7135eb405dbab7da94c2ca7491e57bac88c8a');
  assert.equal(evidence.implementation.pullRequestContextSha,'0462458631837973def9e822cab17fff5ecf6408');
  assert.equal(evidence.implementation.ciRunNumber,1011);
  assert.equal(evidence.implementation.contractTests,648);
  assert.equal(evidence.implementation.contractPassed,648);
  assert.equal(evidence.implementation.contractFailed,0);
  assert.equal(evidence.implementation.criticalTestFileExecutions,530);
  assert.equal(evidence.implementation.criticalUnexplainedFailures,0);
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.fullBrowserProductPath,'PASS');
  assert.equal(evidence.implementation.p9RenderedSameHead,'PASS');
  assert.equal(evidence.source.matrixSha256,'7f329e45b704465947488532658abdde90d699fc4ed33fc96e86bb603769ede5');
  assert.equal(evidence.source.scenarios,280);
  assert.equal(evidence.source.uniqueQualifiedKeys,280);
  assert.equal(evidence.source.courtClasses,55);
});

test('P9-03 retained court executes 280 projections and is chained behind same-head rendered evidence',()=>{
  assert.equal(evidence.dedicatedCourt.status,'PASS');
  assert.equal(evidence.dedicatedCourt.artifactId,11142839511);
  assert.equal(evidence.dedicatedCourt.artifactDigest,'sha256:9f541d0257347987de6a1ed45586e660800fcb0e2ee43984c9cb50fa1ef6e5d6');
  assert.equal(evidence.dedicatedCourt.scenarios,280);
  assert.equal(evidence.dedicatedCourt.courtClasses,55);
  assert.equal(evidence.dedicatedCourt.projectionDigestSha256,'269ee15268274b609b7e224a21a9e181f7cb447ee06d418ddda8820d61ff2bb4');
  assert.deepEqual(evidence.dedicatedCourt.externalAcceptanceCounts,{'P9-12':9,'P9-05':2});
  assert.equal(evidence.sameHeadRenderedCourt.status,'PASS');
  assert.equal(evidence.sameHeadRenderedCourt.artifactId,11143465722);
  const workflow=readFileSync('.github/workflows/ci.yml','utf8');
  assert.match(workflow,/p9-failure-scenarios:\n    needs: \[contract, codeql, p9-ui-rendered\]/);
});

test('P9-03 promotion is executable and all mapped retained court refs still exist',()=>{
  const output=execFileSync(process.execPath,['scripts/p9-failure-scenario-court.mjs'],{encoding:'utf8'});
  assert.match(output,/P9 FAILURE SCENARIO COURT PASS/);
  for(const [court,binding] of Object.entries(map.courts)){
    assert.ok(binding.refs.length>0,court);
    for(const ref of binding.refs)assert.ok(existsSync(ref),court+' missing '+ref);
  }
});

test('P9-03 closes alone while human and weak-device P9 obligations stay open',()=>{
  const row=ledger.overrides.find(x=>x.id==='P9-03');
  assert.deepEqual(
    {domain:row.domain,state:row.state,promotion:row.promotion,evidence:row.evidence,closure_met:row.closure_met},
    {domain:'P9',state:'EVIDENCE',promotion:'PASS-INTEGRATION',evidence:'p9-failure-scenarios',closure_met:true}
  );
  for(const id of ['P9-05','P9-11','P9-12']){
    const current=ledger.overrides.find(x=>x.id===id);
    assert.ok(!current||current.closure_met!==true,id+' must remain open');
  }
  assert.equal(ledger.overrides.filter(x=>x.domain==='P9'&&x.closure_met===true).length,15);
  assert.ok(ledger.overrides.length>=274,'later gate promotions may legitimately extend reconciliation rows');
  assert.ok(ledger.overrides.filter(x=>x.closure_met===true).length>=265,'later gate promotions may legitimately increase global closure');
  assert.equal(ledger.production_closed,false);
  for(const value of Object.values(evidence.boundaries))assert.equal(value,false);
});

test('P9-03 evidence is registered and repeated by the critical campaign',()=>{
  const entry=registry.entries.find(x=>x.key==='p9-failure-scenarios');
  assert.deepEqual({kind:entry.kind,level:entry.level,status:entry.status},{kind:'EXECUTABLE',level:'INTEGRATION',status:'PASS'});
  assert.ok(flake.contract.testFiles.includes('tests/p9-failure-scenario-corpus.test.js'));
  assert.ok(flake.contract.testFiles.includes('tests/p9-failure-scenario-evidence.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=107,'later critical courts may legitimately extend the campaign');
  assert.equal(flake.contract.iterations,5);
});
