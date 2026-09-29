import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const authority=readFileSync('packages/toolchain/src/authority.js','utf8');
const browser=readFileSync('apps/playground/public/browser-acceptance.js','utf8');
const capture=readFileSync('scripts/capture-p6-toolchain-browser-evidence.mjs','utf8');

test('P6 source audit retains exact BCR identity and no silent substitution',()=>{
  for(const token of [
    'packageName',
    'toolVersion',
    'artifactDigest',
    'adapterSemanticProfile',
    'No exact BCR identity is registered; silent tool/binary substitution is forbidden'
  ]) assert.ok(authority.includes(token),token);
  assert.ok(authority.includes('OC_RESOURCE_EXHAUSTED')||authority.includes('ErrorCodes.RESOURCE_EXHAUSTED'));
  assert.ok(authority.includes('SharedWasmMemoryViews'));
  assert.ok(authority.includes('this.#memory.grow(pages)'));
});

test('P6 browser court exercises runtime mechanisms rather than source-only claims',()=>{
  for(const token of [
    "stage('p6-runtime-authority-pass'",
    "stage('p6-toolchain-measurement-pass'",
    "stage('vite-c1-build-pass'",
    "stage('vite-c2-hmr-pass'",
    'OC_TOOLCHAIN_SKEW',
    'OC_DIGEST_MISMATCH',
    'OC_TOOLCHAIN_UNSUPPORTED',
    'compiledModuleCompiles:1',
    'compiledModuleWorkerClones:p6ModuleReceipts.length',
    'sharedMemoryGrowCount:p6Growth.length',
    'failureDiagnosticPath:'
  ]) assert.ok(browser.includes(token),token);
});

test('P6 dedicated court keeps Vitest corpus gate open instead of overclaiming closure',()=>{
  for(const id of [
    'P6-01','P6-02','P6-03','P6-04','P6-05','P6-06',
    'P6-07','P6-08','P6-09',
    'P6-11','P6-12','P6-13','P6-14','P6-15','P6-16'
  ]) assert.ok(capture.includes("'"+id+"'"),id);
  const sourceGateBlock=capture.match(/sourceGates:\[([\s\S]*?)\],\n  intentionallyOpenGates:/)?.[1]??'';
  assert.ok(sourceGateBlock);
  assert.equal(sourceGateBlock.includes('P6-10'),false);
  assert.ok(capture.includes("id:'P6-10'"));
  assert.ok(capture.includes('does not claim a real promoted Vitest execution'));
  assert.ok(capture.includes('performanceThresholdClaimed:false'));
  assert.ok(capture.includes('genericWasiLinuxExpansionPromoted:false'));
});
