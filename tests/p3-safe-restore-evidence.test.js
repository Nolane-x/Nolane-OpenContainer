import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P3-SAFE-CHECKPOINT-RESTORE-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const preserved=['P3-07','P3-09','P3-17','P3-18','P3-20'];

test('P3 safe restore closure binds exact implementation and dedicated browser evidence',()=>{
  assert.equal(evidence.schema,'opencontainer.p3-safe-checkpoint-restore-evidence.v1.0');
  assert.equal(evidence.sourceGate,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P3-15');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.pullRequest,53);

  assert.equal(evidence.implementation.head,'3c347dc131817c9f4f2ca67b5bed228f7b5d80f4');
  assert.equal(evidence.implementation.ciRunNumber,509);
  assert.equal(evidence.implementation.ciRunId,36357972359);
  assert.equal(evidence.implementation.testedCheckoutCommit,'22bc0a26b8bae25c8b677d739884503a44ea70e3');
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.browserProductPath,'PASS');
  assert.equal(evidence.implementation.unitTests,394);
  assert.equal(evidence.implementation.unitPassed,394);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,37);
  assert.equal(evidence.implementation.contractIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,185);
  assert.equal(evidence.implementation.contractUnexplainedFailures,0);
  assert.equal(evidence.implementation.fullProductPathPasses,2);
  assert.equal(evidence.implementation.browserUnexplainedFailures,0);

  assert.equal(evidence.dedicatedBrowserVerification.head,'5dd6939dc374e6e4fe3bcb32520c99b5ea3afd0e');
  assert.equal(evidence.dedicatedBrowserVerification.runNumber,512);
  assert.equal(evidence.dedicatedBrowserVerification.runId,36358161737);
  assert.equal(evidence.dedicatedBrowserVerification.testedCheckoutCommit,'58b7559a51221800dd9b37e51739e212dcf22a6e');
  assert.equal(evidence.dedicatedBrowserVerification.artifactId,10944841419);
  assert.equal(evidence.dedicatedBrowserVerification.status,'PASS');
  assert.equal(evidence.dedicatedBrowserVerification.iterations,2);
  assert.equal(evidence.dedicatedBrowserVerification.fullProductPathPasses,2);
  assert.equal(evidence.dedicatedBrowserVerification.unexplainedFailures,0);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P3-15 is newly reconciled only by safe-restore browser evidence',()=>{
  const row=ledger.overrides.find(item=>item.id==='P3-15');
  assert.deepEqual(
    {domain:row?.domain,state:row?.state,promotion:row?.promotion,evidence:row?.evidence,closure_met:row?.closure_met},
    {domain:'P3',state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p3-safe-checkpoint-restore',closure_met:true}
  );
  assert.ok(ledger.overrides.length>=192);
  assert.ok(ledger.overrides.filter(item=>item.closure_met===true).length>=156);
  const p3=ledger.overrides.filter(item=>item.domain==='P3');
  assert.ok(p3.length>=15);
  assert.ok(p3.filter(item=>item.closure_met===true).length>=15);
  for(const id of preserved.filter(id=>!['P3-07','P3-09','P3-17','P3-18','P3-20'].includes(id))){
    const open=ledger.overrides.find(item=>item.id===id);
    assert.ok(!open||open.closure_met!==true,id+' was silently promoted');
  }
  const laterDurability=ledger.overrides.find(item=>item.id==='P3-07');
  assert.equal(laterDurability?.closure_met,true,'P3-07 later closure missing');
  assert.equal(laterDurability?.evidence,'p3-opfs-durability-boundary','P3-07 later closure evidence drifted');
  assert.notEqual(laterDurability?.evidence,'p3-safe-checkpoint-restore','P3-07 later closure was misattributed to safe-restore wave');
  const laterFreeze=ledger.overrides.find(item=>item.id==='P3-09');
  assert.equal(laterFreeze?.closure_met,true,'P3-09 later closure missing');
  assert.equal(laterFreeze?.evidence,'p3-freeze-writer-failover','P3-09 later closure evidence drifted');
  const laterExternal=ledger.overrides.find(item=>item.id==='P3-17');
  assert.equal(laterExternal?.closure_met,true,'P3-17 later closure missing');
  assert.notEqual(laterExternal?.evidence,'p3-safe-checkpoint-restore','P3-17 later closure was misattributed to safe-restore wave');
  const laterNative=ledger.overrides.find(item=>item.id==='P3-18');
  assert.equal(laterNative?.closure_met,true,'P3-18 later native closure missing');
  assert.equal(laterNative?.evidence,'p3-native-external-permission','P3-18 later closure evidence drifted');
  assert.notEqual(laterNative?.evidence,'p3-safe-checkpoint-restore','P3-18 later closure was misattributed to safe-restore wave');
  const laterDelete=ledger.overrides.find(item=>item.id==='P3-20');
  assert.equal(laterDelete?.closure_met,true,'P3-20 later closure missing');
  assert.notEqual(laterDelete?.evidence,'p3-safe-checkpoint-restore','P3-20 later closure was misattributed to safe-restore wave');
});

test('P3 safe restore evidence encodes recovery-first and blind-overwrite prevention',()=>{
  const text=evidence.invariants.join('\n');
  for(const term of [
    'working VFS generation',
    'mutation lease',
    'recovery point',
    'new canonical generation',
    'OC_STALE_GENERATION',
    'OC_RESOURCE_EXHAUSTED',
    'retained fallback'
  ]) assert.ok(text.includes(term),term);
  assert.deepEqual(evidence.preservedOpenGates,preserved);
});

test('P3 safe restore is typed browser evidence retained by the critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p3-safe-checkpoint-restore');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/opfs-authority.test.js',
    'tests/sdk-workspace-persistence.test.js',
    'tests/p3-safe-restore-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=38);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
