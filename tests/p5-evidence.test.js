import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P5-NETWORK-PREVIEW-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));

test('P5 evidence matrix binds all 18 source gates to the declared browser court',()=>{
  assert.equal(evidence.schema,'opencontainer.p5-network-preview-evidence.v1.0');
  assert.equal(evidence.sourceGateSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.equal(evidence.minimumClosure,'PASS-INTEGRATION + declared-profile evidence');
  assert.equal(evidence.pullRequest,40);
  assert.equal(evidence.implementationHead,'fb9e45ac36f17a42c01b1769b37a968d1ed0944a');
  assert.equal(evidence.ci.runNumber,398);
  assert.equal(evidence.ci.contract,'PASS');
  assert.equal(evidence.ci.browserProductPath,'PASS');
  assert.equal(evidence.ci.fullProductPathPasses,2);
  assert.equal(evidence.ci.unexplainedFailures,0);
  assert.equal(evidence.evidenceProfile.id,'desktop-chrome153-ubuntu2404-x64-ci');
  assert.equal(evidence.evidenceProfile.browser,'Google Chrome 153.0.8010.52');
  assert.equal(evidence.serviceWorkerCompatibilityId,'opencontainer-sw-edge-v2:rpc1:snapshot1:opfs1:preview2');
  assert.equal(evidence.productionClosed,false);
  assert.deepEqual(evidence.gates.map(item=>item.id),Array.from({length:18},(_,i)=>'P5-'+String(i+1).padStart(2,'0')));
  assert.ok(evidence.gates.every(item=>item.state==='EVIDENCE'&&item.promotion==='PASS-BROWSER'&&item.closureMet===true&&item.evidence.length>20));
});

test('P5 ledger reconciliation cannot drift from the evidence matrix',()=>{
  const rows=ledger.overrides.filter(item=>item.domain==='P5');
  assert.equal(rows.length,18);
  assert.deepEqual(rows.map(item=>item.id),evidence.gates.map(item=>item.id));
  assert.ok(rows.every(item=>item.state==='EVIDENCE'&&item.promotion==='PASS-BROWSER'&&item.evidence==='p5-network-preview'&&item.closure_met===true));
  assert.equal(ledger.source.gate_count,304);
  assert.equal(ledger.production_closed,false);
});
