import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P13-SUPPLY-CHAIN-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const policy=JSON.parse(readFileSync('release/SUPPLY-CHAIN-REVIEW-POLICY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const closed=['P13-01','P13-02','P13-05','P13-06','P13-08','P13-11','P13-12','P13-13','P13-14','P13-15','P13-19'];
const partial=['P13-04','P13-07','P13-20'];
const unreconciled=['P13-03','P13-09','P13-10','P13-16','P13-17'];

test('P13 evidence binds the supply-chain review to exact CI #424 release artifact',()=>{
  assert.equal(evidence.schema,'opencontainer.p13-supply-chain-evidence.v1.0');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.minimumClosure,'SECURITY-REVIEWED / RELEASE-VERIFIED');
  assert.equal(evidence.pullRequest,46);
  assert.equal(evidence.implementationHead,'57a20790c64619ede9a55fe7a76a8424bf62d311');
  assert.equal(evidence.ci.runNumber,424);
  assert.equal(evidence.ci.supplyChainReview,'PASS');
  assert.equal(evidence.ci.maturity,'SECURITY-REVIEWED');
  assert.equal(evidence.ci.criticalTestFileExecutions,130);
  assert.equal(evidence.ci.contractUnexplainedFailures,0);
  assert.equal(evidence.ci.fullProductPathPasses,2);
  assert.equal(evidence.ci.browserUnexplainedFailures,0);
  assert.equal(evidence.releaseArtifact.sameAsTestedDistribution,true);
  assert.equal(evidence.releaseArtifact.sbom,'SPDX-2.3');
  assert.equal(evidence.releaseArtifact.provenance,'https://slsa.dev/provenance/v1');
  assert.equal(evidence.releaseArtifact.reproducible,true);
  assert.equal(evidence.releaseArtifact.contentPolicyViolations,0);
  assert.equal(evidence.workflow.immutableActionRefs,true);
  assert.equal(evidence.workflow.leastPrivilege,true);
  assert.equal(evidence.inventory.optionalAdapterBundlesShipped,0);
  assert.equal(evidence.productionClosed,false);
});

test('P13 historical supply-chain evidence retains its 11 gates while later hygiene promotion is monotonic',()=>{
  const rows=ledger.overrides.filter(x=>x.domain==='P13');
  assert.ok(rows.length>=14);
  for(const id of closed)assert.ok(rows.some(x=>x.id===id&&x.closure_met===true),id);
  const later=rows.find(x=>x.id==='P13-18');
  if(later?.closure_met===true)assert.deepEqual(
    {state:later.state,promotion:later.promotion,evidence:later.evidence},
    {state:'EVIDENCE',promotion:'RELEASE-VERIFIED',evidence:'p13-openssf-scorecard'}
  );
  for(const id of closed){
    const row=rows.find(x=>x.id===id);
    assert.deepEqual(
      {state:row.state,promotion:row.promotion,evidence:row.evidence,closure_met:row.closure_met},
      {state:'EVIDENCE',promotion:'RELEASE-VERIFIED',evidence:'p13-supply-chain-review',closure_met:true}
    );
    assert.equal(policy.gateAuthority[id].machineClosable,true,id);
  }
  assert.deepEqual(rows.filter(x=>x.state==='PARTIAL').map(x=>x.id),partial);
  for(const id of unreconciled)assert.equal(rows.some(x=>x.id===id),false,id);
  assert.deepEqual(evidence.preservedOpenGates.map(x=>x.id),['P13-03','P13-04','P13-07','P13-09','P13-10','P13-16','P13-17','P13-18','P13-20']);
  const entry=registry.entries.find(x=>x.key==='p13-supply-chain-review');
  assert.deepEqual({kind:entry.kind,level:entry.level,status:entry.status},{kind:'EXECUTABLE',level:'RELEASE-VERIFIED',status:'PASS'});
  assert.ok(ledger.overrides.length>=184);
  assert.ok(ledger.overrides.filter(x=>x.closure_met===true).length>=137);
  assert.equal(ledger.production_closed,false);
});

test('P13 closure cannot erase publication tag signing OIDC hygiene or archive boundaries',()=>{
  for(const id of ['P13-03','P13-04','P13-07','P13-09','P13-10','P13-16','P13-17','P13-20']){
    assert.equal(policy.gateAuthority[id].machineClosable,false,id);
  }
  assert.equal(policy.gateAuthority['P13-18'].machineClosable,true);
  assert.equal(policy.gateAuthority['P13-18'].evidence,'p13-openssf-scorecard');
  assert.ok(evidence.boundaries.some(x=>x.includes('OIDC')));
  assert.ok(evidence.boundaries.some(x=>x.includes('externally published')));
  assert.ok(evidence.boundaries.some(x=>x.includes('release tag')));
  assert.ok(evidence.boundaries.some(x=>x.includes('signing')));
  assert.ok(evidence.boundaries.some(x=>x.includes('OpenSSF')));
  assert.ok(evidence.boundaries.some(x=>x.includes('long-term')));
});

test('P13 closure evidence is repeated in the critical contract campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/supply-chain-review.test.js'));
  assert.ok(flake.contract.testFiles.includes('tests/p13-supply-chain-evidence.test.js'));
  assert.ok(flake.contract.testFiles.length>=27);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.equal(flake.contract.iterations,5);
});
