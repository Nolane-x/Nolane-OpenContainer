import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P3-CORRUPTION-CLASSIFICATION-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const expectedClasses=[
  ['canonical-source','fail-closed'],
  ['recovery-draft','discard-draft'],
  ['checkpoint','fallback-checkpoint'],
  ['package-cache','discard-refetch'],
  ['derived-index','discard-rebuild']
];

test('P3 corruption closure binds exact implementation and dedicated browser evidence',()=>{
  assert.equal(evidence.schema,'opencontainer.p3-corruption-classification-evidence.v1.0');
  assert.equal(evidence.sourceGate,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P3-13');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.pullRequest,51);
  assert.equal(evidence.implementationHead,'edb93487724046443c73b98cad397ee43ec36f94');
  assert.equal(evidence.ci.runNumber,475);
  assert.equal(evidence.ci.runId,36324559812);
  assert.equal(evidence.ci.testedCheckoutCommit,'36ee07d1a92e1a6e9a6f1140fce0f1eb17f7e7c1');
  assert.equal(evidence.ci.contract,'PASS');
  assert.equal(evidence.ci.codeql,'PASS');
  assert.equal(evidence.ci.browserProductPath,'PASS');
  assert.equal(evidence.ci.unitTests,375);
  assert.equal(evidence.ci.unitPassed,375);
  assert.equal(evidence.ci.unitFailed,0);
  assert.equal(evidence.ci.criticalTestFileExecutions,170);
  assert.equal(evidence.ci.contractUnexplainedFailures,0);
  assert.equal(evidence.ci.fullProductPathPasses,2);
  assert.equal(evidence.ci.browserUnexplainedFailures,0);
  assert.equal(evidence.dedicatedBrowserVerification.artifactId,10933812358);
  assert.equal(evidence.dedicatedBrowserVerification.status,'PASS');
  assert.equal(evidence.dedicatedBrowserVerification.classCount,5);
  assert.equal(evidence.dedicatedBrowserVerification.distinctActions,5);
  assert.equal(evidence.productionClosed,false);
  assert.equal(ledger.production_closed,false);
});

test('P3-13 closure retains five distinct corruption classes and actions',()=>{
  assert.deepEqual(evidence.classes.map(item=>[item.corruptionClass,item.action]),expectedClasses);
  assert.equal(new Set(evidence.classes.map(item=>item.corruptionClass)).size,5);
  assert.equal(new Set(evidence.classes.map(item=>item.action)).size,5);
  const row=ledger.overrides.find(item=>item.id==='P3-13');
  assert.deepEqual(
    {state:row.state,promotion:row.promotion,evidence:row.evidence,closure_met:row.closure_met},
    {state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p3-corruption-classification',closure_met:true}
  );
});

test('P3 corruption closure changes only the intended production gate',()=>{
  assert.ok(ledger.overrides.length>=191);
  assert.ok(ledger.overrides.filter(item=>item.closure_met===true).length>=154);
  const p3=ledger.overrides.filter(item=>item.domain==='P3');
  assert.ok(p3.length>=14);
  assert.ok(p3.filter(item=>item.closure_met===true).length>=14);
  for(const id of evidence.preservedOpenGates.filter(id=>!['P3-14','P3-15','P3-20'].includes(id))){
    const row=ledger.overrides.find(item=>item.id===id);
    assert.ok(!row||row.closure_met!==true,id+' was silently promoted');
  }
  for(const id of ['P3-14','P3-15','P3-20']){
    const later=ledger.overrides.find(item=>item.id===id);
    assert.equal(later?.closure_met,true,id+' later closure missing');
    assert.notEqual(later?.evidence,'p3-corruption-classification',id+' later closure was misattributed to corruption wave');
  }
});

test('P3 corruption closure is typed browser evidence and is retained by critical campaign',()=>{
  const entry=registry.entries.find(item=>item.key==='p3-corruption-classification');
  assert.deepEqual(
    {kind:entry.kind,level:entry.level,status:entry.status},
    {kind:'EXECUTABLE',level:'BROWSER',status:'PASS'}
  );
  for(const file of [
    'tests/opfs-authority.test.js',
    'tests/opfs-package-content-store.test.js',
    'tests/p3-corruption-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=35);
  assert.equal(flake.contract.iterations,5);
});
