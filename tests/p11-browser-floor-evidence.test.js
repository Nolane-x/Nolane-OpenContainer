import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P11-BROWSER-FLOOR-EVIDENCE.v1.0.json','utf8'));
const matrix=JSON.parse(readFileSync('release/RELEASE-COMPATIBILITY-MATRIX.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('P11-13 floor is bound to exact dual-version full-product evidence',()=>{
  assert.equal(evidence.schema,'opencontainer.p11-browser-floor-evidence.v1.0');
  assert.equal(evidence.sourceGate,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P11-13');
  assert.equal(evidence.implementationHead,'343fe72b5021040d2f2fbd617499a413b3735c32');
  assert.equal(evidence.implementationCi.runNumber,995);
  assert.equal(evidence.implementationCi.contractTests,639);
  assert.equal(evidence.implementationCi.contractPassed,639);
  assert.equal(evidence.implementationCi.contractFailed,0);
  assert.equal(evidence.implementationCi.criticalTestFileExecutions,520);
  assert.equal(evidence.implementationCi.criticalUnexplainedFailures,0);
  assert.equal(evidence.underlyingMatrixEvidence.runNumber,960);
  assert.equal(evidence.underlyingMatrixEvidence.frozenFloor.fullProductPathPasses,2);
  assert.equal(evidence.underlyingMatrixEvidence.newestStable.fullProductPathPasses,2);
});

test('P11-13 freezes exactly one Chrome Ubuntu floor without widening support',()=>{
  assert.deepEqual(evidence.floor.validatedVersions,['153.0.8010.52','154.0.8037.92']);
  assert.equal(evidence.floor.minimumVersion,'153.0.8010.52');
  assert.equal(evidence.floor.os,'Ubuntu 24.04 x64');
  assert.equal(evidence.floor.profile,'desktop-chrome153-ubuntu2404-x64-ci');
  assert.equal(matrix.browserMinimumsFrozen,true);
  assert.equal(matrix.browserMinimumPolicy.scope,'declared-evidence-profile-only');
  assert.equal(matrix.browserMinimumPolicy.minimumVersion,'153.0.8010.52');
  assert.equal(matrix.browserMinimumPolicy.validatedThroughStable,'154.0.8037.92');
  for(const key of ['crossBrowserClaimed','otherOsClaimed','mobileClaimed','weakDeviceClaimed']){
    assert.equal(evidence.floor[key],false,key);
  }
  const supported=matrix.rows.filter(x=>x.status==='SUPPORTED-EVIDENCE-BACKED');
  assert.equal(supported.length,1);
  assert.equal(supported[0].id,'chrome-linux-declared');
  assert.equal(supported[0].browser.minimumVersionClaimed,true);
  for(const row of matrix.rows.filter(x=>x.id!=='chrome-linux-declared')){
    assert.equal(row.browser.minimumVersionClaimed,false,row.id);
    assert.ok(!row.status.startsWith('SUPPORTED'),row.id);
  }
});

test('P11-13 promotion closes only the browser-floor gate',()=>{
  const row=ledger.overrides.find(x=>x.id==='P11-13');
  assert.deepEqual(
    {domain:row.domain,state:row.state,promotion:row.promotion,evidence:row.evidence,closure_met:row.closure_met},
    {domain:'P11',state:'EVIDENCE',promotion:'PASS-BROWSER',evidence:'p11-browser-floor',closure_met:true}
  );
  const p1112=ledger.overrides.find(x=>x.id==='P11-12');
  assert.equal(p1112.state,'PARTIAL');
  assert.equal(p1112.closure_met,false);
  assert.equal(ledger.overrides.filter(x=>x.domain==='P11'&&x.closure_met===true).length,13);
  assert.ok(ledger.overrides.length>=273,'later gate promotions may legitimately extend reconciliation rows');
  assert.ok(ledger.overrides.filter(x=>x.closure_met===true).length>=264,'later gate promotions may legitimately increase global closure');
  assert.equal(ledger.production_closed,false);
});

test('P11-13 evidence is registered and repeated',()=>{
  const entry=registry.entries.find(x=>x.key==='p11-browser-floor');
  assert.deepEqual({kind:entry.kind,level:entry.level,status:entry.status},{kind:'EXECUTABLE',level:'BROWSER',status:'PASS'});
  assert.ok(flake.contract.testFiles.includes('tests/p11-browser-floor-source-audit.test.js'));
  assert.ok(flake.contract.testFiles.includes('tests/p11-browser-floor-evidence.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=105,'later evidence waves may legitimately extend the critical campaign');
  assert.equal(flake.contract.iterations,5);
});
