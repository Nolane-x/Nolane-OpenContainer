import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('P7 retained-resource audit globally fail-closes unbounded source-map retention',()=>{
  const result=spawnSync(process.execPath,['scripts/audit-resource-retention.mjs'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const receipt=JSON.parse(readFileSync('.artifacts/resource-retention/contract-receipt.json','utf8'));
  assert.equal(receipt.schema,'opencontainer.p7-resource-retention-audit.v1.0');
  assert.equal(receipt.status,'PASS');
  assert.equal(receipt.sourceMapRetainedBudgetDefaultBytes,0);
  assert.deepEqual(receipt.violations,[]);
  assert.ok(receipt.auditedFileCount>20);
  assert.ok(receipt.sourceMapReferences.some(item=>item.path==='packages/resources/src/index.js'));
  assert.ok(receipt.sourceMapReferences.some(item=>item.path==='apps/playground/public/browser-acceptance.js'));
});
