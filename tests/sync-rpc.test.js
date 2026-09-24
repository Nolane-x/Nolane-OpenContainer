import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSyncRpcMailbox,
  settleSyncRpcMailbox,
  waitSyncRpcMailbox,
  SyncRpcConstants
} from '../packages/process/src/sync-rpc.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

test('sync RPC mailbox settles and decodes success envelope',()=>{
  const shared=createSyncRpcMailbox(4096);
  assert.equal(settleSyncRpcMailbox(shared,{ok:true,value:{answer:42}}),true);
  assert.deepEqual(waitSyncRpcMailbox(shared,{timeoutMs:10}),{answer:42});
});

test('sync RPC mailbox transports structured error envelope',()=>{
  const shared=createSyncRpcMailbox(4096);
  const error=Object.assign(new Error('denied'),{code:ErrorCodes.NETWORK_DENIED,details:{x:1}});
  settleSyncRpcMailbox(shared,{ok:false,error});
  assert.throws(
    ()=>waitSyncRpcMailbox(shared,{timeoutMs:10}),
    e=>e.code===ErrorCodes.NETWORK_DENIED&&e.details.x===1
  );
});

test('sync RPC mailbox rejects oversized host response',()=>{
  const shared=createSyncRpcMailbox(512);
  settleSyncRpcMailbox(shared,{ok:true,value:'x'.repeat(4096)},{maxPayloadBytes:256});
  assert.throws(
    ()=>waitSyncRpcMailbox(shared,{timeoutMs:10}),
    e=>e.code===ErrorCodes.OUTPUT_LIMIT
  );
});

test('sync RPC mailbox uses bounded shared memory',()=>{
  const shared=createSyncRpcMailbox(2048);
  assert.equal(shared.byteLength,SyncRpcConstants.HEADER_BYTES+2048);
});
