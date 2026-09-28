import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P3-NATIVE-EXTERNAL-PERMISSION-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('P3-18 closure binds exact native declared-profile evidence',()=>{
  assert.equal(evidence.schema,'opencontainer.p3-native-external-permission-evidence.v1.0');
  assert.equal(evidence.sourceGate,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P3-18');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.requirement,'Test external file permission revocation and external edit conflicts before privileged writes.');
  assert.equal(evidence.minimumClosure,'PASS-INTEGRATION + declared-profile evidence');
  assert.equal(evidence.pullRequest,58);

  assert.equal(evidence.implementation.head,'0c1a6334cbae8ea3ac4389db76713e20bbccfe96');
  assert.equal(evidence.implementation.ciRunNumber,616);
  assert.equal(evidence.implementation.ciRunId,36400618340);
  assert.equal(evidence.implementation.testedCheckoutCommit,'7dd1273022d5e7244efce1665dc3c22efb0d583b');
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.browserProductPath,'PASS');
  assert.equal(evidence.implementation.nativeExternalPermissionCourt,'PASS');
  assert.equal(evidence.implementation.unitTests,431);
  assert.equal(evidence.implementation.unitPassed,431);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,45);
  assert.equal(evidence.implementation.contractIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,225);
  assert.equal(evidence.implementation.contractUnexplainedFailures,0);

  assert.equal(evidence.dedicatedNativeVerification.artifactId,10959309888);
  assert.equal(evidence.dedicatedNativeVerification.status,'PASS');
  assert.equal(evidence.dedicatedNativeVerification.browser,'Google Chrome 153.0.8010.52');
  assert.equal(evidence.dedicatedNativeVerification.iterations,2);
  assert.equal(evidence.dedicatedNativeVerification.passedIterations,2);
  assert.equal(evidence.dedicatedNativeVerification.nativeShowDirectoryPicker,true);
  assert.equal(evidence.dedicatedNativeVerification.realSelectedFileSystemDirectoryHandle,true);
  assert.equal(evidence.dedicatedNativeVerification.nativePermissionRevocation,true);
  assert.equal(evidence.dedicatedNativeVerification.realExternalEditConflict,true);
  assert.equal(evidence.productionClosed,false);
});

test('P3-18 native receipt proves conflict-before-write and grant-to-denied revocation',()=>{
  assert.equal(evidence.externalConflict.conflictCode,'OC_STALE_GENERATION');
  assert.equal(evidence.externalConflict.conflictState,'external-change-detected');
  assert.equal(evidence.externalConflict.silentOverwritePrevented,true);
  assert.equal(evidence.externalConflict.permissionRechecked,true);
  assert.deepEqual(evidence.nativeRevocation.before,{read:'granted',readwrite:'granted'});
  assert.deepEqual(evidence.nativeRevocation.after,{read:'denied',readwrite:'denied'});
  assert.equal(evidence.nativeRevocation.blockedCode,'OC_INVALID_STATE');
  assert.equal(evidence.nativeRevocation.privilegedWriteBlocked,true);
  assert.equal(evidence.nativeRevocation.localCanonicalUnaffected,true);
});

test('P3-18 is the only gate promoted by native external permission evidence and closes P3 exactly',()=>{
  const rows=ledger.overrides.filter(item=>item.evidence==='p3-native-external-permission');
  assert.deepEqual(rows,[{
    id:'P3-18',
    domain:'P3',
    state:'EVIDENCE',
    promotion:'PASS-BROWSER',
    evidence:'p3-native-external-permission',
    closure_met:true
  }]);

  assert.ok(ledger.overrides.length>=197);
  assert.ok(ledger.overrides.filter(item=>item.closure_met===true).length>=161);
  const p3=ledger.overrides.filter(item=>item.domain==='P3');
  assert.equal(p3.length,20);
  assert.equal(p3.filter(item=>item.closure_met===true).length,20);
  assert.equal(evidence.p3DomainClosed,true);
  assert.deepEqual(evidence.preservedOpenGates,[]);
  assert.equal(ledger.production_closed,false);
});

test('P3-18 evidence is registered and retained in the repeated critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p3-native-external-permission');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/p3-native-external-permission-source-audit.test.js',
    'tests/p3-native-external-permission-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.ok(flake.contract.testFiles.length>=47);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
