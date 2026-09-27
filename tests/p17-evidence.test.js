import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const matrix=JSON.parse(readFileSync('release/P17-OPERATIONS-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));
const maintenance=readFileSync('.github/workflows/maintenance.yml','utf8');

test('P17 evidence matrix binds all 14 operations gates to CI #413',()=>{
  assert.equal(matrix.schema,'opencontainer.p17-operations-evidence.v1.0');
  assert.equal(matrix.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(matrix.minimumClosure,'Process exercised before 1.0 or public beta as applicable');
  assert.equal(matrix.pullRequest,43);
  assert.equal(matrix.implementationHead,'631ce3608424a901f74c67e83666f6d14bb87a73');
  assert.equal(matrix.ci.runNumber,413);
  assert.equal(matrix.ci.processGateCount,14);
  assert.equal(matrix.ci.incidentScenarios,4);
  assert.equal(matrix.ci.knownIssues,4);
  assert.equal(matrix.ci.regressionEntries,12);
  assert.equal(matrix.ci.localHealthRemoteRequests,0);
  assert.equal(matrix.ci.blockedRuntimeMutation,true);
  assert.equal(matrix.ci.criticalTestFileExecutions,100);
  assert.equal(matrix.ci.contractUnexplainedFailures,0);
  assert.equal(matrix.ci.fullProductPathPasses,2);
  assert.equal(matrix.ci.browserUnexplainedFailures,0);
  assert.deepEqual(matrix.ci.supportSchemas,['opencontainer.support-bundle.v0.1','opencontainer.support-bundle.v0.2']);
  assert.deepEqual(matrix.gates.map(x=>x.id),Array.from({length:14},(_,i)=>'P17-'+String(i+1).padStart(2,'0')));
  assert.ok(matrix.gates.every(x=>x.state==='EVIDENCE'&&x.promotion==='PASS-BROWSER'&&x.closureMet===true&&x.evidence.length>30));
  assert.equal(matrix.productionClosed,false);
});

test('P17 ledger and evidence registry stay closed without erasing external boundaries',()=>{
  const rows=ledger.overrides.filter(x=>x.domain==='P17');
  assert.equal(rows.length,14);
  assert.deepEqual(rows.map(x=>x.id),matrix.gates.map(x=>x.id));
  assert.ok(rows.every(x=>x.state==='EVIDENCE'&&x.promotion==='PASS-BROWSER'&&x.evidence==='p17-operations'&&x.closure_met===true));
  const entry=registry.entries.find(x=>x.key==='p17-operations');
  assert.deepEqual({kind:entry.kind,level:entry.level,status:entry.status},{kind:'EXECUTABLE',level:'BROWSER',status:'PASS'});
  assert.equal(ledger.overrides.length,182);
  assert.equal(ledger.overrides.filter(x=>x.closure_met===true).length,124);
  assert.equal(ledger.overrides.filter(x=>x.state==='PARTIAL').length,38);
  assert.equal(ledger.production_closed,false);
  assert.ok(matrix.boundaries.some(x=>x.includes('P12-17')));
  assert.ok(matrix.boundaries.some(x=>x.includes('no externally published npm/GitHub Release')));
});

test('P17 maintenance is recurring and P17 closure test is repeated in the critical campaign',()=>{
  assert.match(maintenance,/schedule:/);
  assert.match(maintenance,/cron:/);
  assert.match(maintenance,/npm run operations:drill/);
  assert.match(maintenance,/npm run critical:browser-flake/);
  assert.ok(flake.contract.testFiles.includes('tests/operations-maintenance.test.js'));
  assert.ok(flake.contract.testFiles.includes('tests/p17-evidence.test.js'));
  assert.ok(flake.contract.testFiles.length>=21);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.equal(flake.contract.iterations,5);
});
