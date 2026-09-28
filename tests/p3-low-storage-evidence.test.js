import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P3-LOW-STORAGE-CLEANUP-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const order=['temporary','derived-rebuildable','public-cache','checkpoint-garbage'];
const protectedTiers=['canonical-source','canonical-checkpoint'];
const open=['P3-07','P3-09','P3-15','P3-17','P3-18','P3-20'];

test('P3 low-storage closure binds exact implementation and dedicated browser evidence',()=>{
  assert.equal(evidence.schema,'opencontainer.p3-low-storage-cleanup-evidence.v1.0');
  assert.equal(evidence.sourceGate,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P3-14');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.pullRequest,52);
  assert.equal(evidence.implementationHead,'3debec759ac83f5fd5582a211659bb1be623de68');
  assert.equal(evidence.ci.runNumber,491);
  assert.equal(evidence.ci.runId,36328754038);
  assert.equal(evidence.ci.testedCheckoutCommit,'55a15f97f7ba7e5b31f508f865c1d659aa397fab');
  assert.equal(evidence.ci.contract,'PASS');
  assert.equal(evidence.ci.codeql,'PASS');
  assert.equal(evidence.ci.browserProductPath,'PASS');
  assert.equal(evidence.ci.unitTests,383);
  assert.equal(evidence.ci.unitPassed,383);
  assert.equal(evidence.ci.unitFailed,0);
  assert.equal(evidence.ci.criticalTestFileExecutions,175);
  assert.equal(evidence.ci.contractUnexplainedFailures,0);
  assert.equal(evidence.ci.fullProductPathPasses,2);
  assert.equal(evidence.ci.browserUnexplainedFailures,0);
  assert.equal(evidence.dedicatedBrowserVerification.artifactId,10935380632);
  assert.equal(evidence.dedicatedBrowserVerification.status,'PASS');
  assert.deepEqual(evidence.dedicatedBrowserVerification.expectedOrder,order);
  assert.deepEqual(evidence.dedicatedBrowserVerification.protected,protectedTiers);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P3-14 closes only low-storage cleanup while retaining canonical protection',()=>{
  const row=ledger.overrides.find(item=>item.id==='P3-14');
  assert.deepEqual(
    {state:row.state,promotion:row.promotion,evidence:row.evidence,closure_met:row.closure_met},
    {state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p3-low-storage-cleanup',closure_met:true}
  );
  assert.deepEqual(evidence.preservedOpenGates,open);
  assert.ok(evidence.invariants.some(item=>item.includes('targetSatisfied=false')));
  assert.ok(evidence.invariants.some(item=>item.includes('Current and fallback checkpoint roots survive')));
});

test('P3 low-storage closure updates no unrelated reconciliation rows',()=>{
  assert.ok(ledger.overrides.length>=191);
  assert.ok(ledger.overrides.filter(item=>item.closure_met===true).length>=155);
  const p3=ledger.overrides.filter(item=>item.domain==='P3');
  assert.ok(p3.length>=14);
  assert.ok(p3.filter(item=>item.closure_met===true).length>=14);
  for(const id of open.filter(id=>!['P3-07','P3-09','P3-15','P3-17','P3-18','P3-20'].includes(id))){
    const row=ledger.overrides.find(item=>item.id===id);
    assert.ok(!row||row.closure_met!==true,id+' was silently promoted');
  }
  const laterDurability=ledger.overrides.find(item=>item.id==='P3-07');
  assert.equal(laterDurability?.closure_met,true,'P3-07 later closure missing');
  assert.equal(laterDurability?.evidence,'p3-opfs-durability-boundary','P3-07 later closure evidence drifted');
  assert.notEqual(laterDurability?.evidence,'p3-low-storage-cleanup','P3-07 later closure was misattributed to low-storage wave');
  const laterFreeze=ledger.overrides.find(item=>item.id==='P3-09');
  assert.equal(laterFreeze?.closure_met,true,'P3-09 later closure missing');
  assert.equal(laterFreeze?.evidence,'p3-freeze-writer-failover','P3-09 later closure evidence drifted');
  const later=ledger.overrides.find(item=>item.id==='P3-15');
  assert.equal(later?.closure_met,true,'P3-15 later closure missing');
  assert.notEqual(later?.evidence,'p3-low-storage-cleanup','P3-15 later closure was misattributed to low-storage wave');
  const laterExternal=ledger.overrides.find(item=>item.id==='P3-17');
  assert.equal(laterExternal?.closure_met,true,'P3-17 later closure missing');
  assert.notEqual(laterExternal?.evidence,'p3-low-storage-cleanup','P3-17 later closure was misattributed to low-storage wave');
  const laterNative=ledger.overrides.find(item=>item.id==='P3-18');
  assert.equal(laterNative?.closure_met,true,'P3-18 later native closure missing');
  assert.equal(laterNative?.evidence,'p3-native-external-permission','P3-18 later closure evidence drifted');
  assert.notEqual(laterNative?.evidence,'p3-low-storage-cleanup','P3-18 later closure was misattributed to low-storage wave');
  const laterDelete=ledger.overrides.find(item=>item.id==='P3-20');
  assert.equal(laterDelete?.closure_met,true,'P3-20 later closure missing');
  assert.notEqual(laterDelete?.evidence,'p3-low-storage-cleanup','P3-20 later closure was misattributed to low-storage wave');
});

test('P3 low-storage closure is typed browser evidence retained by critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p3-low-storage-cleanup');
  assert.deepEqual(
    {kind:entry.kind,level:entry.level,status:entry.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/opfs-authority.test.js',
    'tests/opfs-package-content-store.test.js',
    'tests/storage-cleanup.test.js',
    'tests/p3-low-storage-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=37);
  assert.equal(flake.contract.iterations,5);
});
