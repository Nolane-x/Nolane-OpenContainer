import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserEsmServiceWorkerBridge } from '../packages/package-env/src/browser-esm-edge.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

class FakeWorker extends EventTarget {
  constructor(state='installing'){ super(); this.state=state; this.scriptURL='https://example.test/opencontainer-sw.js'; }
  setState(state){ this.state=state; this.dispatchEvent(new Event('statechange')); }
}

class FakeRegistration extends EventTarget {
  constructor(worker){ super(); this.scope='https://example.test/'; this.installing=worker; this.waiting=null; this.active=null; }
  activate(){
    this.installing.setState('activated');
    this.active=this.installing;
    this.installing=null;
  }
}

class FakeContainer extends EventTarget {
  constructor(registration){ super(); this.registration=registration; this.controller=null; this.ready=new Promise(()=>{}); }
  async register(){ return this.registration; }
  claim(worker){
    this.controller=worker;
    this.dispatchEvent(new Event('controllerchange'));
  }
  sendMessage(data, port) {
    const event = new Event('message');
    Object.defineProperty(event, 'data', { value: data });
    Object.defineProperty(event, 'ports', { value: [port] });
    this.dispatchEvent(event);
  }
}

function publication(session, body='export default 1') {
  return {
    session,
    async response(){ return new Response(body, { headers: { 'x-session': session } }); }
  };
}

async function activate(registration, container, worker) {
  queueMicrotask(()=>{
    registration.activate();
    container.claim(worker);
  });
}

test('browser ESM bridge does not depend on navigator.serviceWorker.ready',async()=>{
  const worker=new FakeWorker();
  const registration=new FakeRegistration(worker);
  const container=new FakeContainer(registration);
  const bridge=new BrowserEsmServiceWorkerBridge({publication:publication('test-session'),serviceWorkerContainer:container,timeoutMs:100});

  await activate(registration,container,worker);
  const receipt=await bridge.start();
  assert.equal(receipt.session,'test-session');
  assert.equal(receipt.controllerURL,worker.scriptURL);
  bridge.close();
});

test('browser ESM bridge fails closed when registration never activates',async()=>{
  const worker=new FakeWorker();
  const registration=new FakeRegistration(worker);
  const container=new FakeContainer(registration);
  const bridge=new BrowserEsmServiceWorkerBridge({publication:publication('test-session'),serviceWorkerContainer:container,timeoutMs:10});

  await assert.rejects(
    ()=>bridge.start(),
    error=>error.code===ErrorCodes.ESM_EDGE_UNAVAILABLE && /activate/.test(error.message)
  );
  bridge.close();
});

test('non-owner bridge stays silent so current publication owner wins shared port',async()=>{
  const worker=new FakeWorker('activated');
  const registration=new FakeRegistration(worker);
  registration.installing=null;
  registration.active=worker;
  const container=new FakeContainer(registration);
  container.controller=worker;

  const oldBridge=new BrowserEsmServiceWorkerBridge({
    publication:publication('old-session','export default "old"'),
    serviceWorkerContainer:container,
    timeoutMs:100
  });
  const currentBridge=new BrowserEsmServiceWorkerBridge({
    publication:publication('current-session','export default "current"'),
    serviceWorkerContainer:container,
    timeoutMs:100
  });
  await oldBridge.start();
  await currentBridge.start();

  const messages=[];
  const port={ postMessage(value){ messages.push(value); } };
  container.sendMessage({
    type:'opencontainer:esm-fetch',
    session:'current-session',
    url:'https://example.test/__opencontainer__/esm/current-session/fs/workspace/main.js'
  },port);

  await new Promise((resolve)=>setTimeout(resolve,0));
  assert.equal(messages.length,1);
  assert.equal(messages[0].ok,true);
  assert.match(messages[0].body,/current/);

  oldBridge.close();
  currentBridge.close();
});

test('unowned session produces no page-side response',async()=>{
  const worker=new FakeWorker('activated');
  const registration=new FakeRegistration(worker);
  registration.installing=null;
  registration.active=worker;
  const container=new FakeContainer(registration);
  container.controller=worker;
  const bridge=new BrowserEsmServiceWorkerBridge({
    publication:publication('owned-session'),
    serviceWorkerContainer:container,
    timeoutMs:100
  });
  await bridge.start();

  const messages=[];
  container.sendMessage({
    type:'opencontainer:esm-fetch',
    session:'stale-session',
    url:'https://example.test/__opencontainer__/esm/stale-session/fs/workspace/main.js'
  },{ postMessage(value){ messages.push(value); } });

  await new Promise((resolve)=>setTimeout(resolve,0));
  assert.deepEqual(messages,[]);
  bridge.close();
});


test('browser ESM bridge preserves WASM bytes without UTF-8 transcoding',async()=>{
  const worker=new FakeWorker('activated');
  const registration=new FakeRegistration(worker);
  registration.installing=null;
  registration.active=worker;
  const container=new FakeContainer(registration);
  container.controller=worker;
  const wasmBytes=Uint8Array.from([0x00,0x61,0x73,0x6d,0xff,0xfe,0x80,0x01]);
  const bridge=new BrowserEsmServiceWorkerBridge({
    publication:{
      session:'binary-session',
      async response(){
        return new Response(wasmBytes,{
          headers:{'content-type':'application/wasm'}
        });
      }
    },
    serviceWorkerContainer:container,
    timeoutMs:100
  });
  await bridge.start();

  const messages=[];
  container.sendMessage({
    type:'opencontainer:esm-fetch',
    session:'binary-session',
    url:'https://example.test/__opencontainer__/esm/binary-session/fs/workspace/module.wasm'
  },{postMessage(value){messages.push(value);}});

  await new Promise((resolve)=>setTimeout(resolve,0));
  assert.equal(messages.length,1);
  assert.equal(messages[0].ok,true);
  assert.ok(messages[0].body instanceof Uint8Array);
  assert.deepEqual([...messages[0].body],[...wasmBytes]);
  bridge.close();
});
