import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FrozenToolchains,
  certifyToolchain,
  ToolchainAuthority,
  SharedWasmMemoryViews,
  createBcrEntryIdentity
} from '../packages/toolchain/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

const rolldownEntry=Object.freeze({
  packageName:'@rolldown/browser',
  toolVersion:'1.2.9',
  artifactDigest:'9accf3cdfe3d2287ad7d5f49cd2cfcddbc9c112abfcbc295863e401ef44b8576',
  adapterSemanticProfile:'rolldown-browser-wasi-v1'
});

const lightningEntry=Object.freeze({
  packageName:'lightningcss-wasm',
  toolVersion:'1.33.0',
  artifactDigest:'266866c1b0efd7ca5307fe312411e4f1895b997086fb76f392ec5b60aadf31c8',
  adapterSemanticProfile:'lightningcss-browser-default-v1'
});

test('P6 BCR identity requires package version digest and semantic profile',()=>{
  const identity=createBcrEntryIdentity(rolldownEntry);
  assert.equal(identity.packageName,'@rolldown/browser');
  assert.equal(identity.toolVersion,'1.2.9');
  assert.equal(identity.artifactDigest,rolldownEntry.artifactDigest);
  assert.equal(identity.adapterSemanticProfile,'rolldown-browser-wasi-v1');
  assert.throws(
    ()=>createBcrEntryIdentity({...rolldownEntry,artifactDigest:'nearest'}),
    error=>error.code===ErrorCodes.INVALID_ARGUMENT
  );
});

test('P6 ToolchainAuthority resolves exact identities and forbids silent substitution',()=>{
  const authority=new ToolchainAuthority({entries:[rolldownEntry,lightningEntry],maxWorkers:2});
  assert.equal(authority.entryCount,2);
  assert.equal(authority.resolve(rolldownEntry).toolVersion,'1.2.9');
  assert.throws(
    ()=>authority.resolve({...rolldownEntry,toolVersion:'1.2.8'}),
    error=>error.code===ErrorCodes.TOOLCHAIN_UNSUPPORTED
  );
  assert.throws(
    ()=>authority.resolve({...rolldownEntry,artifactDigest:lightningEntry.artifactDigest}),
    error=>error.code===ErrorCodes.TOOLCHAIN_UNSUPPORTED
  );
  assert.throws(
    ()=>authority.resolve({...rolldownEntry,adapterSemanticProfile:'generic-wasi-linux'}),
    error=>error.code===ErrorCodes.TOOLCHAIN_UNSUPPORTED
  );
});

test('P6 ToolchainAuthority enforces one global worker budget across agents',()=>{
  const authority=new ToolchainAuthority({entries:[rolldownEntry],maxWorkers:2});
  const a=authority.acquireWorker({agentId:'agent-a',entry:rolldownEntry});
  const b=authority.acquireWorker({agentId:'agent-b',entry:rolldownEntry});
  assert.deepEqual(authority.usage,{workers:2});
  assert.throws(
    ()=>authority.acquireWorker({agentId:'agent-c',entry:rolldownEntry}),
    error=>error.code===ErrorCodes.RESOURCE_EXHAUSTED&&error.details?.activeWorkers===2
  );
  assert.equal(a.release(),true);
  const c=authority.acquireWorker({agentId:'agent-c',entry:rolldownEntry});
  assert.equal(c.agentId,'agent-c');
  assert.equal(a.release(),false);
  b.release();
  c.release();
  assert.deepEqual(authority.usage,{workers:0});
});

test('P6 shared Wasm memory growth rebinds stale typed-array views',()=>{
  const memory=new WebAssembly.Memory({initial:1,maximum:4,shared:true});
  const authority=new SharedWasmMemoryViews(memory);
  const bytes=authority.bind('bytes',Uint8Array,0);
  const words=authority.bind('words',Uint32Array,0,8);
  bytes[0]=7;
  words[1]=0x10203040;
  const beforeBuffer=bytes.buffer;
  const beforeBytesLength=bytes.byteLength;

  const receipt=authority.grow(1);
  const nextBytes=authority.view('bytes');
  const nextWords=authority.view('words');

  assert.equal(receipt.previousPages,1);
  assert.equal(receipt.currentPages,2);
  assert.equal(receipt.rebound,true);
  assert.equal(authority.generation,1);
  assert.notEqual(nextBytes,bitsafe(bytes));
  assert.notEqual(nextBytes.buffer,beforeBuffer);
  assert.equal(bytes.byteLength,beforeBytesLength);
  assert.equal(nextBytes.byteLength,2*65536);
  assert.equal(nextBytes[0],7);
  assert.equal(nextWords[1],0x10203040);
});

function bitsafe(value){return value;}

test('P6 exact toolchain tuple rejects skew version and artifact substitution',()=>{
  const exact={...FrozenToolchains.vite830};
  assert.equal(certifyToolchain(exact).status,'EXACT_PROFILE');
  assert.throws(
    ()=>certifyToolchain({...exact,rolldownBinding:'1.2.8'}),
    error=>error.code===ErrorCodes.TOOLCHAIN_SKEW
  );
  assert.throws(
    ()=>certifyToolchain({...exact,lightningcssWasmSha256:'0'.repeat(64)}),
    error=>error.code===ErrorCodes.DIGEST_MISMATCH
  );
  assert.throws(
    ()=>certifyToolchain({...exact,consumerVersion:'8.2.0'}),
    error=>error.code===ErrorCodes.TOOLCHAIN_UNSUPPORTED
  );
});
