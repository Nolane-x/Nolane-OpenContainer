import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('published SDK lifecycle example stays executable',()=>{
  const stdout=execFileSync(process.execPath,['examples/sdk-lifecycle.mjs'],{encoding:'utf8'}).trim();
  const receipt=JSON.parse(stdout);
  assert.deepEqual(receipt,{
    exitCode:0,
    stdout:'hello opencontainer',
    previewText:'preview-ok',
    restoredSource:'export const answer = 42;',
    importedSource:'export const answer = 42;',
    status:'READY'
  });
});
