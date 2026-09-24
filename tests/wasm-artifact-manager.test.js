import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { WasmArtifactManager, RolldownWasi129Profile, FrozenToolchains } from '../packages/toolchain/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

const EMPTY_WASM = Uint8Array.from([0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00]);
const EMPTY_SHA = createHash('sha256').update(EMPTY_WASM).digest('hex');
const EMPTY_PROFILE = Object.freeze({
  id:'empty-wasm',
  byteLength:EMPTY_WASM.byteLength,
  sha256:EMPTY_SHA,
  imports:0,
  exports:0,
  importNamespaces:{}
});

test('WASM manager verifies digest and compiled module shape',async()=>{
  const manager=new WasmArtifactManager({profiles:[EMPTY_PROFILE]});
  const receipt=await manager.compile(EMPTY_WASM,'empty-wasm');
  assert.equal(receipt.status,'VERIFIED_COMPILED');
  assert.equal(receipt.sha256,EMPTY_SHA);
  assert.equal(receipt.imports,0);
  assert.equal(receipt.exports,0);
  assert.ok(receipt.module instanceof WebAssembly.Module);
});

test('WASM manager rejects byte mutation before compile',async()=>{
  const manager=new WasmArtifactManager({profiles:[EMPTY_PROFILE]});
  const changed=new Uint8Array(EMPTY_WASM);
  changed[7]=1;
  await assert.rejects(()=>manager.compile(changed,'empty-wasm'),e=>e.code===ErrorCodes.DIGEST_MISMATCH);
});

test('WASM manager deduplicates concurrent compilation by verified digest',async()=>{
  let count=0;
  const manager=new WasmArtifactManager({
    profiles:[EMPTY_PROFILE],
    compiler:async(bytes)=>{count++;await Promise.resolve();return WebAssembly.compile(bytes);}
  });
  const [a,b,c]=await Promise.all([
    manager.compile(EMPTY_WASM,'empty-wasm'),
    manager.compile(EMPTY_WASM,'empty-wasm'),
    manager.compile(EMPTY_WASM,'empty-wasm')
  ]);
  assert.equal(count,1);
  assert.equal(a,b);
  assert.equal(b,c);
  assert.equal(manager.cached('empty-wasm'),a);
});

test('frozen Rolldown toolchain identity and executable profile cannot silently skew',()=>{
  assert.equal(RolldownWasi129Profile.version,'1.2.9');
  assert.equal(RolldownWasi129Profile.sha256,FrozenToolchains.vite830.rolldownWasmSha256);
  assert.equal(RolldownWasi129Profile.byteLength,10845151);
  assert.deepEqual(RolldownWasi129Profile.importNamespaces,{env:93,emnapi:1,napi:2,wasi_snapshot_preview1:21,wasi:1});
});
