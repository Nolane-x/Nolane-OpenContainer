import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server=readFileSync('apps/playground/server.mjs','utf8');
const page=readFileSync('apps/playground/public/p7-storage-amplification.js','utf8');
const runner=readFileSync('scripts/p7-storage-amplification.mjs','utf8');
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));

test('P7-11 source court measures real product storage categories and transient cleanup',()=>{
  for(const route of ['/p7-storage-amplification.html','/p7-storage-amplification.js']){
    assert.ok(server.includes(route),route+' route missing');
  }
  for(const marker of [
    'OpfsCheckpointAuthority',
    'OpfsPackageContentStore',
    'OpfsDerivedIndexStore',
    "crashAt:'after-payload'",
    'persistedUsage',
    'inspectStorage',
    'directoryPayloadBytes',
    'cleanupReturnedToStable'
  ])assert.ok(page.includes(marker),marker);
  assert.ok(runner.includes("sourceGates:['P7-11']"));
  assert.ok(runner.includes('exact Chrome 153.0.8010.52'));
});

test('P7-11 implementation does not close the gate before retained browser evidence',()=>{
  const row=ledger.overrides.find(item=>item.id==='P7-11');
  assert.ok(!row||row.closure_met!==true,'P7-11 was closed before retained Wave 4 evidence');
  assert.equal(ledger.production_closed,false);
});
