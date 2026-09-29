import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server=readFileSync('apps/playground/server.mjs','utf8');
const court=readFileSync('apps/playground/public/p1-browser-substrate.js','utf8');
const runner=readFileSync('scripts/p1-browser-substrate.mjs','utf8');
const hosting=readFileSync('scripts/hosting-self-check-lib.mjs','utf8');

test('P1 baseline remains COOP/COEP first and DIP is optional only',()=>{
  assert.match(server,/Cross-Origin-Opener-Policy', 'same-origin'/);
  assert.match(server,/Cross-Origin-Embedder-Policy', 'require-corp'/);
  assert.match(server,/Document-Isolation-Policy','isolate-and-require-corp'/);
  assert.match(server,/p1-browser-dip-optional/);
  assert.match(runner,/documentIsolationPolicyRequired:false/);
  assert.match(runner,/baselineProbe\.headers\.documentIsolationPolicy===null/);
  assert.match(runner,/dipProbe\.headers\.documentIsolationPolicy==='isolate-and-require-corp'/);
});

test('P1 court retains lifecycle refresh writer storage and embedded policy probes',()=>{
  for(const token of [
    "Page.setWebLifecycleState",
    "Page.navigateToHistoryEntry",
    "Storage.clearDataForOrigin",
    "Browser.setPermission",
    "holdLock",
    "tryLock",
    "OC_STALE_GENERATION",
    "framePermissionsProbe",
    "SharedArrayBuffer",
    "Atomics"
  ]) assert.ok((runner+court).includes(token),token);
  assert.match(hosting,/cross-origin-opener-policy/);
  assert.match(hosting,/permissions-policy/);
  assert.match(hosting,/frame-ancestors 'none'/);
});

test('P1 promotion scope excludes gates that require external or field evidence',()=>{
  const gateBlock=runner.match(/sourceGates:\[([\s\S]*?)\],\n    intentionallyOpenGates:/)?.[1]??'';
  for(const id of [
    'P1-01','P1-02','P1-03','P1-04','P1-05','P1-06','P1-07',
    'P1-08','P1-09','P1-10','P1-11','P1-12','P1-16'
  ]) assert.ok(gateBlock.includes("'"+id+"'"),id);
  for(const id of ['P1-13','P1-14','P1-15']) assert.equal(gateBlock.includes(id),false,id);
  assert.ok(runner.includes("{id:'P1-13'"));
  assert.ok(runner.includes("{id:'P1-14'"));
  assert.ok(runner.includes("{id:'P1-15'"));
  assert.ok(runner.includes('realCdnProxyCampaignClaimed:false'));
  assert.ok(runner.includes('browserUpgradeMatrixClaimed:false'));
  assert.ok(runner.includes('fieldRegressionEvidenceClaimed:false'));
  assert.ok(runner.includes('productionClosed:false'));
});
