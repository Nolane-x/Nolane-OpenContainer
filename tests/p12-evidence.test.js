import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const matrix=JSON.parse(readFileSync('release/P12-PRODUCT-SECURITY-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const policy=JSON.parse(readFileSync('release/SECURITY-REVIEW-POLICY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const closed=["P12-01","P12-02","P12-03","P12-04","P12-05","P12-06","P12-07","P12-08","P12-09","P12-10","P12-11","P12-12","P12-13","P12-14","P12-15","P12-16","P12-19"];
const manual=["P12-17","P12-18","P12-20"];

test('P12 matrix preserves 17 technical closures and three non-machine-closable gates',()=>{
  assert.equal(matrix.schema,'opencontainer.p12-product-security-evidence.v1.0');
  assert.equal(matrix.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(matrix.minimumClosure,'SECURITY-REVIEWED / RELEASE-VERIFIED');
  assert.equal(matrix.pullRequest,42);
  assert.equal(matrix.implementationHead,'4e05b3cf1ca27d6bb5f3e33fda69ebc6411d67af');
  assert.equal(matrix.ci.runNumber,409);
  assert.equal(matrix.ci.contract,'PASS');
  assert.equal(matrix.ci.staticAnalysis,'PASS');
  assert.equal(matrix.ci.browserProductPath,'PASS');
  assert.equal(matrix.ci.dependencyBlockingFindings,0);
  assert.equal(matrix.ci.codeqlFindingCount,0);
  assert.equal(matrix.ci.codeqlWaiverCount,0);
  assert.equal(matrix.ci.codeqlBlockingUnwaived,0);
  assert.equal(matrix.ci.regressionRegistryEntries,12);
  assert.equal(matrix.ci.regressionExecutableTestFiles,11);
  assert.equal(matrix.ci.fullProductPathPasses,2);
  assert.equal(matrix.ci.unexplainedFailures,0);
  assert.equal(matrix.asvs.version,'5.0.0');
  assert.equal(matrix.evidenceProfile.browser,'Google Chrome 153.0.8010.52');
  assert.equal(matrix.productionClosed,false);
  assert.deepEqual(matrix.gates.map(x=>x.id),Array.from({length:20},(_,i)=>'P12-'+String(i+1).padStart(2,'0')));
  assert.deepEqual(matrix.gates.filter(x=>x.closureMet).map(x=>x.id),closed);
  assert.deepEqual(matrix.gates.filter(x=>!x.closureMet).map(x=>x.id),manual);
});

test('P12 ledger and evidence registry cannot upgrade the manual-review gates',()=>{
  const rows=ledger.overrides.filter(x=>x.domain==='P12');
  assert.equal(rows.length,20);
  assert.deepEqual(rows.map(x=>x.id),matrix.gates.map(x=>x.id));
  for(const row of rows){
    assert.equal(row.evidence,'p12-product-security');
    assert.equal(row.promotion,'PASS-BROWSER');
    if(closed.includes(row.id)){
      assert.equal(row.state,'EVIDENCE',row.id);
      assert.equal(row.closure_met,true,row.id);
    }else{
      assert.ok(manual.includes(row.id),row.id);
      assert.equal(row.state,'PARTIAL',row.id);
      assert.equal(row.closure_met,false,row.id);
      assert.equal(policy.gateAuthority[row.id].machineClosable,false,row.id);
    }
  }
  const entry=registry.entries.find(x=>x.key==='p12-product-security');
  assert.deepEqual({kind:entry.kind,level:entry.level,status:entry.status},{kind:'EXECUTABLE',level:'BROWSER',status:'PASS'});
  assert.equal(ledger.overrides.length,168);
  assert.equal(ledger.overrides.filter(x=>x.closure_met===true).length,110);
  assert.equal(ledger.overrides.filter(x=>x.state==='PARTIAL').length,38);
  assert.equal(ledger.production_closed,false);
});

test('P12 closure evidence is inside the repeated critical contract campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/p12-evidence.test.js'));
  assert.equal(flake.contract.testFiles.length,19);
  assert.equal(flake.contract.minimumTestFiles,19);
  assert.equal(flake.contract.iterations,5);
});
