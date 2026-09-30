import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P7-RESOURCE-WAVE4-EVIDENCE.v1.0.json','utf8'));
const policy=JSON.parse(readFileSync('release/RESOURCE-MEASUREMENT-POLICY.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('P7 wave4 binds exact implementation CI and retained browser artifacts',()=>{
  assert.equal(evidence.schema,'opencontainer.p7-resource-wave4-evidence.v1.0');
  assert.equal(evidence.pullRequest,71);
  assert.equal(evidence.implementationHead,'5f0c7ddbbc3671036804485d9ad1d140200d10ed');
  assert.equal(evidence.ci.runNumber,950);
  assert.equal(evidence.ci.runId,36690585684);
  assert.equal(evidence.ci.testedCheckoutCommit,'871ed0c1ffd1502f87646fc61e35344b0d141e0d');
  assert.equal(evidence.ci.contractTests,611);
  assert.equal(evidence.ci.contractPassed,611);
  assert.equal(evidence.ci.contractFailed,0);
  assert.equal(evidence.ci.criticalTestFiles,96);
  assert.equal(evidence.ci.criticalTestFileExecutions,480);
  assert.equal(evidence.ci.criticalUnexplainedFailures,0);
  assert.equal(evidence.ci.codeql,'PASS');
  assert.equal(evidence.ci.fullBrowserProductPath,'PASS');
  assert.equal(evidence.artifacts.wave4.id,11085189245);
  assert.equal(evidence.artifacts.wave4.digest,'sha256:64b2aaf99453b33391a7a153efa75c4befad5ecc9da3854bb55a6138ef09c7dc');
  assert.equal(evidence.evidenceProfile.browser,'Google Chrome 153.0.8010.52');
  assert.equal(evidence.evidenceProfile.iterations,2);
});

test('P7-06 proves five product lanes share one global governor',()=>{
  assert.deepEqual(evidence.closedGates,['P7-06','P7-11']);
  assert.equal(evidence.p7_06.globalGovernor,true);
  assert.deepEqual(evidence.p7_06.simultaneousOwners,['ui','core:process','preview','toolchain','ai-consumer']);
  assert.equal(evidence.p7_06.activeLeaseCountAtPeak,5);
  assert.equal(evidence.p7_06.pressureBlockedNewAiBackground,'OC_RESOURCE_EXHAUSTED');
  assert.equal(evidence.p7_06.previewResourceBound,true);
  assert.equal(evidence.p7_06.toolchainResourceBound,true);
  assert.equal(evidence.p7_06.finalGovernorUsageZero,true);
});

test('P7-11 retains exact storage amplification surfaces without threshold inflation',()=>{
  assert.deepEqual(evidence.p7_11.source.logicalFileBytes,[262144,262144]);
  assert.deepEqual(evidence.p7_11.packages.physicalPersistentBytes,[3826763,3826763]);
  assert.deepEqual(evidence.p7_11.checkpoints.metadataPhysicalBytes,[252,252]);
  assert.deepEqual(evidence.p7_11.tempTransactions.transientBytes,[397191,397191]);
  assert.equal(evidence.p7_11.tempTransactions.reclaimed,true);
  assert.deepEqual(evidence.p7_11.derivedCaches.physicalPersistentBytes,[4005,4005]);
  assert.deepEqual(evidence.p7_11.totals.steadyAmplification,[0.253688,0.253688]);
  assert.deepEqual(evidence.p7_11.totals.transientPeakAmplification,[0.277769,0.277769]);
  assert.equal(evidence.p7_11.thresholdClaimed,false);
  assert.match(evidence.p7_11.physicalScope,/filesystem allocation metadata excluded/);
});

test('P7 wave4 promotion closes exactly P7-06 and P7-11 while external blockers remain open',()=>{
  for(const id of ['P7-06','P7-11']){
    const row=ledger.overrides.find(x=>x.id===id);
    assert.deepEqual(
      {domain:row.domain,state:row.state,promotion:row.promotion,evidence:row.evidence,closure_met:row.closure_met},
      {domain:'P7',state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p7-resource-wave4',closure_met:true}
    );
    assert.equal(policy.gateAuthority[id].machineClosable,true);
    assert.equal(policy.gateAuthority[id].state,'CLOSED_BY_WAVE4');
    assert.equal(policy.gateAuthority[id].evidence,'p7-resource-wave4');
  }
  for(const id of ['P7-01','P7-09','P7-10','P7-12']){
    const row=ledger.overrides.find(x=>x.id===id);
    assert.ok(!row||row.closure_met!==true,id+' must remain open');
  }
  assert.equal(ledger.overrides.filter(x=>x.domain==='P7'&&x.closure_met===true).length,10);
  assert.ok(ledger.overrides.length>=270);
  assert.ok(ledger.overrides.filter(x=>x.closure_met===true).length>=260);
  assert.equal(ledger.production_closed,false);
});

test('P7 wave4 evidence is registered and repeated by critical campaign',()=>{
  const entry=registry.entries.find(x=>x.key==='p7-resource-wave4');
  assert.deepEqual({kind:entry.kind,level:entry.level,status:entry.status},{kind:'EXECUTABLE',level:'BROWSER',status:'PASS'});
  assert.deepEqual(policy.stageMeasurements.promotedByWave4,['P7-06','P7-11']);
  for(const value of Object.values(evidence.boundaries))assert.equal(value,false);
  assert.ok(flake.contract.testFiles.includes('tests/p7-wave4-evidence.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=97);
  assert.equal(flake.contract.iterations,5);
});
