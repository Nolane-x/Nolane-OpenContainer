import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P7-RESOURCE-WAVE3-EVIDENCE.v1.0.json','utf8'));
const policy=JSON.parse(readFileSync('release/RESOURCE-MEASUREMENT-POLICY.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const closed=['P7-02','P7-03','P7-04','P7-05'];
const currentOpen=['P7-01','P7-09','P7-10','P7-12'];
const laterWave4=['P7-06','P7-11'];

test('P7 wave3 binds exact CI and retained browser artifacts',()=>{
  assert.equal(evidence.schema,'opencontainer.p7-resource-wave3-evidence.v1.0');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.pullRequest,70);
  assert.equal(evidence.implementationHead,'7101bae81a258e6a60c4ebb1642f8085aa11a63b');
  assert.equal(evidence.ci.runNumber,937);
  assert.equal(evidence.ci.runId,36680064608);
  assert.equal(evidence.ci.testedCheckoutCommit,'93e6e1c81149f630a8541c784048e2f377fc10eb');
  assert.equal(evidence.ci.contractTests,604);
  assert.equal(evidence.ci.contractPassed,604);
  assert.equal(evidence.ci.contractFailed,0);
  assert.equal(evidence.ci.criticalTestFiles,93);
  assert.equal(evidence.ci.criticalTestFileExecutions,465);
  assert.equal(evidence.ci.criticalUnexplainedFailures,0);
  assert.equal(evidence.ci.codeql,'PASS');
  assert.equal(evidence.ci.fullBrowserProductPath,'PASS');
  assert.equal(evidence.ci.fullBrowserProductPathPasses,2);
  assert.equal(evidence.artifacts.declaredProfile.id,11080919293);
  assert.equal(evidence.artifacts.declaredProfile.digest,'sha256:43d9619cd8a57450aa35cae62a443459dc5383bbcba3f496f15c07c5a5952730');
  assert.equal(evidence.artifacts.p6ToolchainVite.id,11081561859);
  assert.equal(evidence.artifacts.p6ToolchainVite.digest,'sha256:44287de98406350585c2145acd015e73c7b35838f767f6266f26b6946ecf9c9e');
  assert.equal(evidence.artifacts.resourceMeasurement.id,11081543001);
  assert.equal(evidence.artifacts.criticalBrowserFlake.id,11082055401);
});

test('P7-02/03/04/05 evidence covers their declared-profile obligations',()=>{
  assert.deepEqual(evidence.closedGates,closed);
  assert.equal(evidence.evidenceProfile.browser,'Google Chrome 153.0.8010.52');
  assert.equal(evidence.evidenceProfile.iterations,2);
  assert.deepEqual(evidence.p7_02.moduleResourceCount,[49,49]);
  assert.ok(evidence.p7_02.moduleResourceBytes.every(x=>x>500000));
  assert.ok(evidence.p7_02.moduleImportParseCompileEvaluateMs.every(x=>x>0));
  assert.equal(evidence.p7_02.isolatedV8ParseCompileClaimed,false);

  assert.ok(evidence.p7_03.warmOpenMs.every(x=>x>0));
  assert.ok(evidence.p7_03.firstCommandMs.every(x=>x>0));
  assert.ok(evidence.p7_03.packageGraphLoadMs.every(x=>x>0));
  assert.deepEqual(evidence.p7_03.packageGraphLocations,[63,63]);
  assert.equal(evidence.p7_03.vfs.files,128);
  assert.equal(evidence.p7_03.vfs.bytesReadPerIteration,524288);

  assert.equal(evidence.p7_04.concurrency,4);
  assert.equal(evidence.p7_04.requestsPerIteration,64);
  assert.equal(evidence.p7_04.transferredBytesPerIteration,16*1024*1024);
  assert.ok(evidence.p7_04.sustainedTransferMs.every(x=>x>0));
  assert.equal(evidence.p7_04.finalGovernorUsageZero,true);

  assert.equal(evidence.p7_05.realisticProject.generatedTsModules,128);
  assert.equal(evidence.p7_05.realisticProject.totalTsModules,130);
  assert.ok(evidence.p7_05.realisticProject.sourceBytes>=evidence.p7_05.realisticProject.minimumFixtureSourceBytes);
  assert.deepEqual(evidence.p7_05.fullProductPath.viteBuildMs,[1752,1620]);
  assert.deepEqual(evidence.p7_05.fullProductPath.viteDevToHmrMs,[752,786]);
  assert.equal(evidence.p7_05.dedicatedToolchain.heapSamples.length,4);
  assert.equal(evidence.p7_05.performanceThresholdClaimed,false);
  assert.equal(evidence.p7_05.memoryPlateauClaimed,false);
});

test('P7 wave3 promotion closes exactly four additional P7 gates',()=>{
  for(const id of closed){
    const row=ledger.overrides.find(item=>item.id===id);
    assert.ok(row,id+' ledger row missing');
    assert.deepEqual(
      {domain:row.domain,state:row.state,promotion:row.promotion,evidence:row.evidence,closure_met:row.closure_met},
      {domain:'P7',state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p7-resource-wave3',closure_met:true}
    );
    assert.equal(policy.gateAuthority[id].machineClosable,true,id);
    assert.equal(policy.gateAuthority[id].state,'CLOSED_BY_WAVE3',id);
    assert.equal(policy.gateAuthority[id].evidence,'p7-resource-wave3',id);
  }
  const p7Closed=ledger.overrides.filter(item=>item.domain==='P7'&&item.closure_met===true);
  assert.ok(p7Closed.length>=8);
  for(const id of currentOpen){
    const row=ledger.overrides.find(item=>item.id===id);
    assert.ok(!row||row.closure_met!==true,id+' must remain open');
  }
  for(const id of laterWave4){
    const row=ledger.overrides.find(item=>item.id===id);
    if(row?.closure_met===true)assert.equal(row.evidence,'p7-resource-wave4',id+' later promotion must bind Wave 4 evidence');
  }
  assert.ok(ledger.overrides.length>=268);
  assert.ok(ledger.overrides.filter(item=>item.closure_met===true).length>=258);
  assert.equal(ledger.production_closed,false);
});

test('P7 wave3 registry and boundaries fail closed',()=>{
  const entry=registry.entries.find(item=>item.key==='p7-resource-wave3');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  assert.equal(policy.gateAuthority['P7-01'].machineClosable,false);
  assert.equal(policy.gateAuthority['P7-09'].machineClosable,false);
  assert.equal(policy.gateAuthority['P7-12'].machineClosable,false);
  assert.deepEqual(policy.stageMeasurements.promotedByWave3,closed);
  assert.deepEqual(policy.stageMeasurements.evidenceOnlyFor,[]);
  for(const value of Object.values(evidence.boundaries))assert.equal(value,false);
});

test('P7 wave3 promotion evidence is repeated by the critical campaign',()=>{
  for(const file of ['tests/p7-wave3-source-audit.test.js','tests/p7-wave3-evidence.test.js']){
    assert.ok(flake.contract.testFiles.includes(file),file);
  }
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=94);
  assert.equal(flake.contract.iterations,5);
});
