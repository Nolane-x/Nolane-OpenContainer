import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server=readFileSync('apps/playground/server.mjs','utf8');
const page=readFileSync('apps/playground/public/p7-resource-profile.js','utf8');
const worker=readFileSync('apps/playground/public/p7-transfer-worker.mjs','utf8');
const runner=readFileSync('scripts/p7-declared-profile.mjs','utf8');
const browserAcceptance=readFileSync('apps/playground/public/browser-acceptance.js','utf8');
const p6=readFileSync('scripts/capture-p6-toolchain-browser-evidence.mjs','utf8');
const policy=JSON.parse(readFileSync('release/RESOURCE-MEASUREMENT-POLICY.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));

test('P7 declared-profile court measures P7-02/03/04 without manufacturing weak-device closure',()=>{
  for(const route of ['/p7-resource-profile.html','/p7-resource-profile.js','/p7-transfer-worker.mjs']){
    assert.ok(server.includes(route),route+' server route missing');
  }
  for(const marker of [
    'moduleImportParseCompileEvaluateMs',
    'moduleResourceBytes',
    'firstCommandMs',
    'packageGraphLoadMs',
    'vfsWriteMs',
    'workerSpawnReadyMs',
    'sustainedTransferMs',
    'transferMiBPerSecond',
    'finalGovernorUsage'
  ])assert.ok(page.includes(marker),marker);
  assert.ok(worker.includes("request.method!=='roundtrip'"));
  assert.ok(runner.includes("sourceGates:['P7-02','P7-03','P7-04']"));
  assert.ok(runner.includes("exact Chrome 153.0.8010.52"));
  assert.ok(runner.includes('p7_09_eightHourPlateau:false'));
  assert.ok(runner.includes('p7_12_weakDeviceRegressionBudget:false'));
});

test('P7 Vite profile is made materially larger and retained by the P6 browser receipt',()=>{
  assert.ok(browserAcceptance.includes('p7RealisticModuleCount=128'));
  assert.ok(browserAcceptance.includes("stage('p7-realistic-vite-project-profile'"));
  assert.ok(p6.includes("required(stages,'p7-realistic-vite-project-profile')"));
  assert.ok(p6.includes('realisticProject'));
});

test('P7 wave3 implementation does not pre-close gates before exact-head promotion evidence exists',()=>{
  for(const id of ['P7-02','P7-03','P7-04','P7-05']){
    const row=ledger.overrides.find((item)=>item.id===id);
    assert.ok(!row||row.closure_met!==true,id+' was closed before retained wave3 evidence');
  }
  assert.equal(policy.gateAuthority['P7-01'].machineClosable,false);
  assert.equal(policy.gateAuthority['P7-09'].machineClosable,false);
  assert.equal(policy.gateAuthority['P7-12'].machineClosable,false);
  assert.equal(ledger.production_closed,false);
});
