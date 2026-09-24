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
}

const publication={
  session:'test-session',
  async response(){ return new Response('export default 1'); }
};

test('browser ESM bridge does not depend on navigator.serviceWorker.ready',async()=>{
  const worker=new FakeWorker();
  const registration=new FakeRegistration(worker);
  const container=new FakeContainer(registration);
  const bridge=new BrowserEsmServiceWorkerBridge({publication,serviceWorkerContainer:container,timeoutMs:100});

  queueMicrotask(()=>{
    registration.activate();
    container.claim(worker);
  });

  const receipt=await bridge.start();
  assert.equal(receipt.session,'test-session');
  assert.equal(receipt.controllerURL,worker.scriptURL);
  bridge.close();
});

test('browser ESM bridge fails closed when registration never activates',async()=>{
  const worker=new FakeWorker();
  const registration=new FakeRegistration(worker);
  const container=new FakeContainer(registration);
  const bridge=new BrowserEsmServiceWorkerBridge({publication,serviceWorkerContainer:container,timeoutMs:10});

  await assert.rejects(
    ()=>bridge.start(),
    error=>error.code===ErrorCodes.ESM_EDGE_UNAVAILABLE && /activate/.test(error.message)
  );
  bridge.close();
});
