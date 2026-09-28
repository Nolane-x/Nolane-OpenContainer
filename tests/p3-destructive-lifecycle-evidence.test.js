import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P3-DESTRUCTIVE-LIFECYCLE-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const preserved=['P3-07','P3-09','P3-17','P3-18'];

test('P3 destructive lifecycle closure binds exact implementation and dedicated browser evidence',()=>{
  assert.equal(evidence.schema,'opencontainer.p3-destructive-lifecycle-evidence.v1.0');
  assert.equal(evidence.sourceGate,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P3-20');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.pullRequest,54);

  assert.equal(evidence.implementation.head,'e89f16bf2a164ea812e2dd8793559816ad5d8757');
  assert.equal(evidence.implementation.ciRunNumber,529);
  assert.equal(evidence.implementation.ciRunId,36380578592);
  assert.equal(evidence.implementation.testedCheckoutCommit,'044b8f474973e9e9768b230e72e84e67c131b2ac');
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.browserProductPath,'PASS');
  assert.equal(evidence.implementation.unitTests,406);
  assert.equal(evidence.implementation.unitPassed,406);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,38);
  assert.equal(evidence.implementation.contractIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,190);
  assert.equal(evidence.implementation.contractUnexplainedFailures,0);
  assert.equal(evidence.implementation.browserIterations,2);
  assert.equal(evidence.implementation.fullProductPathPasses,2);
  assert.equal(evidence.implementation.browserUnexplainedFailures,0);

  assert.equal(evidence.dedicatedBrowserVerification.artifactId,10952810664);
  assert.equal(evidence.dedicatedBrowserVerification.schema,'opencontainer.p3-destructive-lifecycle-browser.v1.0');
  assert.equal(evidence.dedicatedBrowserVerification.status,'PASS');
  assert.equal(evidence.dedicatedBrowserVerification.iterations,2);
  assert.equal(evidence.dedicatedBrowserVerification.fullProductPathPasses,2);
  assert.equal(evidence.dedicatedBrowserVerification.unexplainedFailures,0);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P3-20 is newly reconciled only by destructive lifecycle browser evidence',()=>{
  const row=ledger.overrides.find(item=>item.id==='P3-20');
  assert.deepEqual(
    {domain:row?.domain,state:row?.state,promotion:row?.promotion,evidence:row?.evidence,closure_met:row?.closure_met},
    {domain:'P3',state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p3-destructive-lifecycle',closure_met:true}
  );
  assert.equal(ledger.overrides.length,193);
  assert.equal(ledger.overrides.filter(item=>item.closure_met===true).length,157);
  const p3=ledger.overrides.filter(item=>item.domain==='P3');
  assert.equal(p3.length,16);
  assert.equal(p3.filter(item=>item.closure_met===true).length,16);
  for(const id of preserved.filter(id=>id!=='P3-17')){
    const open=ledger.overrides.find(item=>item.id===id);
    assert.ok(!open||open.closure_met!==true,id+' was silently promoted');
  }
  const laterExternal=ledger.overrides.find(item=>item.id==='P3-17');
  assert.equal(laterExternal?.closure_met,true,'P3-17 later closure missing');
  assert.notEqual(laterExternal?.evidence,'p3-destructive-lifecycle','P3-17 later closure was misattributed to destructive-lifecycle wave');
});

test('P3 destructive lifecycle evidence preserves explicit recoverability truth',()=>{
  const text=evidence.invariants.join('\n');
  for(const term of [
    'D2 recoverable destructive',
    'current canonical checkpoint',
    'late local VFS mutations',
    'Tombstoned workspace boot',
    'SHA-256 integrity-bound',
    'D4 action',
    'recoverable=false',
    'Duplicate delete/purge',
    'acknowledgement loss'
  ]) assert.ok(text.includes(term),term);
  assert.deepEqual(evidence.preservedOpenGates,preserved);
});

test('P3 destructive lifecycle is typed browser evidence retained by the critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p3-destructive-lifecycle');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/opfs-authority.test.js',
    'tests/sdk-workspace-persistence.test.js',
    'tests/workspace-lifecycle.test.js',
    'tests/p3-destructive-lifecycle-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,40);
  assert.equal(flake.contract.minimumTestFiles,40);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
