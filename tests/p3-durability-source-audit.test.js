import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync('packages/vfs/src/opfs-sync-writer-worker.js','utf8');
const authority=readFileSync('packages/vfs/src/opfs-authority.js','utf8');
const browser=readFileSync('apps/playground/public/browser-acceptance.js','utf8');

test('P3 explicit flush worker uses SyncAccessHandle readwrite and flushes before close',()=>{
  assert.match(worker,/createSyncAccessHandle\(\{mode:'readwrite'\}\)/);
  const truncate=worker.indexOf("access.truncate(0)");
  const write=worker.indexOf("access.write(bytes,{at:0})");
  const flush=worker.indexOf("access.flush()");
  const close=worker.indexOf("access.close()");
  assert.ok(truncate>=0&&write>truncate&&flush>write&&close>flush,{truncate,write,flush,close});
  assert.match(worker,/flushCompleted:true/);
  assert.match(worker,/closeCompleted:true/);
});

test('P3 canonical checkpoint path selects explicit browser flush and retains a machine receipt',()=>{
  assert.match(authority,/browserOpfsSyncWriterAvailable\(\)/);
  assert.match(authority,/writeOpfsTextWithExplicitFlush\(handle, content\)/);
  assert.match(authority,/writer:'sync-access-handle'/);
  assert.match(authority,/boundary:'flush-returned-before-close'/);
  assert.match(authority,/canonicalSwitchAfterPayloadFlush/);
  assert.match(authority,/browserSyncAccessHandle/);
  assert.match(authority,/lastDurabilityBoundary/);
});

test('P3 browser court documents the exact guaranteed boundary without overclaiming power-loss durability',()=>{
  assert.match(browser,/p3-durability-boundary-pass/);
  assert.match(browser,/SyncAccessHandle\.flush\(\) returned, then handle\.close\(\) completed, then a fresh authority reopened/);
  assert.match(browser,/power-loss durability beyond the browser SyncAccessHandle flush contract/);
  assert.match(browser,/hardware cache persistence guarantees not exposed by the Web API/);
});
