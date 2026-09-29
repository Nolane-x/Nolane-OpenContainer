import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerRpcAuthority } from '../packages/process/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

class MockWorkerTransport {
  sent = [];
  listeners = new Set();

  postMessage(message) {
    this.sent.push(message);
  }

  addEventListener(type, listener) {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === 'message') this.listeners.delete(listener);
  }

  emit(message) {
    for (const listener of this.listeners) listener({ data: message });
  }
}

async function expectCode(promise, code) {
  try {
    await promise;
    assert.fail('expected error ' + code);
  } catch (error) {
    assert.equal(error.code, code);
  }
}

test('worker RPC stamps requests with session and epoch', async () => {
  const transport = new MockWorkerTransport();
  const authority = new WorkerRpcAuthority({ transport });
  const pending = authority.request('eval', { source: '1+1' });

  assert.equal(transport.sent.length, 1);
  const request = transport.sent[0];
  assert.equal(request.type, 'request');
  assert.equal(request.session, authority.identity.session);
  assert.equal(request.epoch, authority.identity.epoch);

  transport.emit({
    v: 1,
    type: 'response',
    session: request.session,
    epoch: request.epoch,
    id: request.id,
    ok: true,
    value: 2
  });

  assert.equal(await pending, 2);
  assert.equal(authority.pendingCount, 0);
});

test('stale worker responses cannot satisfy a current request', async () => {
  const transport = new MockWorkerTransport();
  const authority = new WorkerRpcAuthority({ transport });
  const firstIdentity = authority.identity;
  authority.restart(transport);

  const pending = authority.request('ping', {});
  const current = transport.sent.at(-1);

  const accepted = authority.receive({
    v: 1,
    type: 'response',
    session: firstIdentity.session,
    epoch: firstIdentity.epoch,
    id: current.id,
    ok: true,
    value: 'stale'
  });

  assert.equal(accepted, false);
  assert.equal(authority.pendingCount, 1);

  authority.receive({
    v: 1,
    type: 'response',
    session: current.session,
    epoch: current.epoch,
    id: current.id,
    ok: true,
    value: 'fresh'
  });

  assert.equal(await pending, 'fresh');
});

test('restart rejects in-flight requests and advances epoch', async () => {
  const first = new MockWorkerTransport();
  const second = new MockWorkerTransport();
  const authority = new WorkerRpcAuthority({ transport: first });

  const oldEpoch = authority.identity.epoch;
  const pending = authority.request('slow', {});
  authority.restart(second);

  await expectCode(pending, ErrorCodes.WORKER_STALE);
  assert.equal(authority.identity.epoch, oldEpoch + 1);
  assert.equal(authority.pendingCount, 0);
});

test('worker pending requests are bounded', async () => {
  const transport = new MockWorkerTransport();
  const authority = new WorkerRpcAuthority({ transport, maxPending: 1 });
  const pending = authority.request('one', {});

  assert.throws(
    () => authority.request('two', {}),
    (error) => error.code === ErrorCodes.RESOURCE_EXHAUSTED
  );

  authority.close();
  await expectCode(pending, ErrorCodes.WORKER_CLOSED);
});

test('worker close is idempotent and refuses new work', () => {
  const authority = new WorkerRpcAuthority({ transport: new MockWorkerTransport() });
  assert.equal(authority.close(), true);
  assert.equal(authority.close(), false);
  assert.throws(
    () => authority.request('ping', {}),
    (error) => error.code === ErrorCodes.WORKER_CLOSED
  );
});


test('worker RPC timeout fails closed and clears pending request', async () => {
  const transport = new MockWorkerTransport();
  const authority = new WorkerRpcAuthority({ transport, requestTimeoutMs: 10 });
  const pending = authority.request('never-answers', {});
  await expectCode(pending, ErrorCodes.WORKER_TIMEOUT);
  assert.equal(authority.pendingCount, 0);
});

test('worker response before timeout cancels the deadline', async () => {
  const transport = new MockWorkerTransport();
  const authority = new WorkerRpcAuthority({ transport, requestTimeoutMs: 100 });
  const pending = authority.request('fast', {});
  const request = transport.sent.at(-1);
  transport.emit({
    v: 1,
    type: 'response',
    session: request.session,
    epoch: request.epoch,
    id: request.id,
    ok: true,
    value: 'ok'
  });
  assert.equal(await pending, 'ok');
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(authority.pendingCount, 0);
});


class CrashTransport {
  sent=[];
  listeners=new Map();
  postMessage(message){this.sent.push(message);}
  addEventListener(type,listener){
    if(!this.listeners.has(type))this.listeners.set(type,new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
  emit(type,payload={}){
    for(const listener of this.listeners.get(type)??[])listener(payload);
  }
}

test('worker transport error rejects pending requests and releases resource leases',async()=>{
  const resources={
    active:0,
    reserve(){
      this.active++;
      let released=false;
      return {release:()=>{if(released)return false;released=true;this.active--;return true;}};
    }
  };
  const transport=new CrashTransport();
  const authority=new WorkerRpcAuthority({transport,resources});
  const a=authority.request('a',{});
  const b=authority.request('b',{});
  assert.equal(authority.pendingCount,2);
  assert.equal(resources.active,2);

  transport.emit('error',{message:'worker-crashed',filename:'guest.mjs',lineno:9,colno:3});
  await expectCode(a,ErrorCodes.GUEST_WORKER_FAILED);
  await expectCode(b,ErrorCodes.GUEST_WORKER_FAILED);
  assert.equal(authority.pendingCount,0);
  assert.equal(resources.active,0);
  assert.throws(
    ()=>authority.request('after-crash',{}),
    error=>error.code===ErrorCodes.INVALID_STATE
  );

  const replacement=new CrashTransport();
  const next=authority.restart(replacement);
  assert.equal(next.epoch,2);
  const pending=authority.request('fresh',{});
  const req=replacement.sent.at(-1);
  replacement.emit('message',{data:{
    v:1,type:'response',session:req.session,epoch:req.epoch,id:req.id,ok:true,value:'ok'
  }});
  assert.equal(await pending,'ok');
  authority.close();
});

test('worker messageerror fails session closed idempotently',async()=>{
  const transport=new CrashTransport();
  const authority=new WorkerRpcAuthority({transport});
  const pending=authority.request('a',{});
  transport.emit('messageerror',{data:null});
  await expectCode(pending,ErrorCodes.GUEST_WORKER_FAILED);
  assert.equal(authority.pendingCount,0);
  transport.emit('messageerror',{data:null});
  assert.throws(()=>authority.request('stale',{}),error=>error.code===ErrorCodes.INVALID_STATE);
});
