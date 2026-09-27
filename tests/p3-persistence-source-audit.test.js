import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('P3 canonical publication does not rely on rename or move atomicity',()=>{
  const result=spawnSync(process.execPath,['scripts/audit-p3-persistence-source.mjs'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const receipt=JSON.parse(readFileSync('.artifacts/p3-persistence/source-audit.json','utf8'));
  assert.equal(receipt.schema,'opencontainer.p3-publication-source-audit.v1.0');
  assert.equal(receipt.status,'PASS');
  assert.equal(receipt.renameMoveDependency,false);
  assert.equal(receipt.workspacePayloadBeforeManifest,true);
  assert.equal(receipt.releasePayloadBeforeManifest,true);
  assert.deepEqual(receipt.violations,[]);
});
