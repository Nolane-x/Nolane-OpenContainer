import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P3-EXTERNAL-SOURCE-MODES-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('P3 external source mode closure binds exact implementation and dedicated browser evidence',()=>{
  assert.equal(evidence.schema,'opencontainer.p3-external-source-modes-evidence.v1.0');
  assert.equal(evidence.sourceGate,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P3-17');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.pullRequest,55);
  assert.equal(evidence.implementation.head,'1f5a9f0ddfc814193658a9f36117a6f088d93ce8');
  assert.equal(evidence.implementation.ciRunNumber,547);
  assert.equal(evidence.implementation.ciRunId,36382768937);
  assert.equal(evidence.implementation.testedCheckoutCommit,'615e6c714ae0df00e1cd5ae84a204b055fa68869');
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.browserProductPath,'PASS');
  assert.equal(evidence.implementation.unitTests,415);
  assert.equal(evidence.implementation.unitPassed,415);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,40);
  assert.equal(evidence.implementation.contractIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,200);
  assert.equal(evidence.implementation.contractUnexplainedFailures,0);
  assert.equal(evidence.implementation.browserIterations,2);
  assert.equal(evidence.implementation.fullProductPathPasses,2);
  assert.equal(evidence.implementation.browserUnexplainedFailures,0);
  assert.equal(evidence.dedicatedBrowserVerification.artifactId,10953546693);
  assert.equal(evidence.dedicatedBrowserVerification.status,'PASS');
  assert.equal(evidence.dedicatedBrowserVerification.iterations,2);
  assert.equal(evidence.dedicatedBrowserVerification.fullProductPathPasses,2);
  assert.equal(evidence.dedicatedBrowserVerification.unexplainedFailures,0);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P3-17 closes only explicit external source mode semantics',()=>{
  const row=ledger.overrides.find(item=>item.id==='P3-17');
  assert.deepEqual(
    {domain:row?.domain,state:row?.state,promotion:row?.promotion,evidence:row?.evidence,closure_met:row?.closure_met},
    {domain:'P3',state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p3-external-source-modes',closure_met:true}
  );
  assert.equal(ledger.overrides.length,197);
  assert.equal(ledger.overrides.filter(item=>item.closure_met===true).length,161);
  const p3=ledger.overrides.filter(item=>item.domain==='P3');
  assert.equal(p3.length,20);
  assert.equal(p3.filter(item=>item.closure_met===true).length,20);
  const p307=ledger.overrides.find(item=>item.id==='P3-07');
  assert.equal(p307?.closure_met,true,'P3-07 later closure missing');
  assert.equal(p307?.evidence,'p3-opfs-durability-boundary','P3-07 later closure evidence drifted');
  assert.notEqual(p307?.evidence,'p3-external-source-modes','P3-07 later closure was misattributed to P3-17');
  const laterNative=ledger.overrides.find(item=>item.id==='P3-18');
  assert.equal(laterNative?.closure_met,true,'P3-18 later native closure missing');
  assert.equal(laterNative?.evidence,'p3-native-external-permission','P3-18 later closure evidence drifted');
  assert.notEqual(laterNative?.evidence,'p3-external-source-modes','P3-18 native closure was misattributed to P3-17');
  const laterFreeze=ledger.overrides.find(item=>item.id==='P3-09');
  assert.equal(laterFreeze?.closure_met,true,'P3-09 later closure missing');
  assert.equal(laterFreeze?.evidence,'p3-freeze-writer-failover','P3-09 later closure evidence drifted');
});

test('P3-18 native picker permission revocation remains explicitly open',()=>{
  assert.equal(evidence.p3_18Boundary.status,'OPEN');
  assert.equal(evidence.dedicatedBrowserVerification.nativePickerPermissionRevocationExercised,false);
  assert.ok(evidence.p3_18Boundary.reason.includes('Native showDirectoryPicker permission grant/revocation was not exercised'));
  assert.ok(evidence.p3_18Boundary.missingEvidence.includes('real user-selected FileSystemDirectoryHandle from showDirectoryPicker()'));
  assert.ok(evidence.p3_18Boundary.missingEvidence.includes('browser/user revocation of that native handle permission after selection'));
  assert.deepEqual(evidence.preservedOpenGates,['P3-07','P3-09','P3-18']);
});

test('P3 external source modes are typed browser evidence retained by critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p3-external-source-modes');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/external-source.test.js',
    'tests/p3-external-source-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=42);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
