import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewAuthority, BrowserPreviewServiceWorkerBridge } from '../packages/preview/src/index.js';
import { sanitizePreviewRequestHeaders } from '../packages/preview/src/browser-service-worker.js';
import { SERVICE_WORKER_COMPATIBILITY_ID } from '../packages/protocol/src/service-worker-compatibility.js';

class FakeWorker {
  constructor(){
    this.state='activated';
    this.scriptURL='https://example.test/opencontainer-sw.js';
  }
  postMessage(data,ports=[]){
    const port=ports[0];
    if(!port)return;
    if(data?.type==='opencontainer:sw-compatibility-query'){
      queueMicrotask(()=>port.postMessage({ok:true,compatibilityId:SERVICE_WORKER_COMPATIBILITY_ID}));
      return;
    }
    if(data?.type==='opencontainer:sw-claim'){
      queueMicrotask(()=>port.postMessage({ok:true,action:'claim',compatibilityId:SERVICE_WORKER_COMPATIBILITY_ID}));
    }
  }
}

class FakeServiceWorkerContainer {
  constructor() {
    this.controller = new FakeWorker();
    this.listeners = new Map();
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); }
  async register() {
    return {
      scope: 'https://example.test/',
      active: this.controller,
      waiting: null,
      installing: null,
      addEventListener() {},
      removeEventListener() {}
    };
  }
  emitMessage(data, port) {
    this.listeners.get('message')?.({ data, ports: [port] });
  }
}

test('browser preview bridge encodes authority proof and dispatches through current route', async () => {
  const preview = new PreviewAuthority();
  const route = preview.publish({
    port: 5173,
    owner: 'dev-1',
    identity:{workspace:'workspace-a',session:'session-a',version:'version-a'},
    handler: (request) => new Response('ok:' + request.url, { headers: { 'x-demo': 'yes' } })
  });
  const container = new FakeServiceWorkerContainer();
  const bridge = new BrowserPreviewServiceWorkerBridge({
    preview,
    serviceWorkerContainer: container,
    baseURL: 'https://example.test'
  });
  const startReceipt = await bridge.start();
  assert.equal(startReceipt.serviceWorkerCompatibilityId,SERVICE_WORKER_COMPATIBILITY_ID);
  assert.equal(startReceipt.serviceWorkerActivation,'existing-compatible');

  const url = new URL(bridge.url(route, '/src/main.ts?x=1'));
  assert.equal(url.pathname, '/__opencontainer__/preview/5173/src/main.ts');
  assert.equal(url.searchParams.get('__oc_owner'), 'dev-1');
  assert.equal(url.searchParams.get('__oc_epoch'), String(route.epoch));
  assert.equal(url.searchParams.get('__oc_workspace'),'workspace-a');
  assert.equal(url.searchParams.get('__oc_session'),'session-a');
  assert.equal(url.searchParams.get('__oc_version'),'version-a');

  let posted = null;
  container.emitMessage({
    type: 'opencontainer:preview-fetch',
    port: 5173,
    owner: route.owner,
    epoch: route.epoch,
    identity:route.identity,
    url: '/src/main.ts?x=1',
    method: 'GET',
    headers: {},
    body: null
  }, { postMessage(value) { posted = value; } });

  for (let index = 0; index < 10 && !posted; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(posted?.ok, true);
  assert.equal(posted?.status, 200);
  assert.equal(posted?.headers?.['x-demo'], 'yes');
  assert.equal(new TextDecoder().decode(posted.body), 'ok:/src/main.ts?x=1');
  assert.equal(bridge.close(), true);
  assert.equal(bridge.close(), false);
});

test('browser preview bridge rejects stale owner and epoch proof', async () => {
  const preview = new PreviewAuthority();
  const oldRoute = preview.publish({ port: 5173, owner: 'old', handler: () => new Response('old') });
  preview.publish({ port: 5173, owner: 'new', handler: () => new Response('new') });
  const container = new FakeServiceWorkerContainer();
  const bridge = new BrowserPreviewServiceWorkerBridge({
    preview,
    serviceWorkerContainer: container,
    baseURL: 'https://example.test'
  });
  await bridge.start();

  let posted = null;
  container.emitMessage({
    type: 'opencontainer:preview-fetch',
    port: 5173,
    owner: oldRoute.owner,
    epoch: oldRoute.epoch,
    url: '/',
    method: 'GET',
    headers: {},
    body: null
  }, { postMessage(value) { posted = value; } });

  for (let index = 0; index < 10 && !posted; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(posted?.ok, false);
  assert.equal(posted?.code, 'OC_PREVIEW_STALE');
  bridge.close();
});


test('preview edge strips host credentials before dispatch to untrusted preview', async () => {
  assert.deepEqual(sanitizePreviewRequestHeaders({
    Authorization:'Bearer secret',
    Cookie:'session=secret',
    'X-API-Key':'secret',
    'X-Auth-Token':'secret',
    Range:'bytes=0-3',
    'X-Demo':'safe'
  }),{
    range:'bytes=0-3',
    'x-demo':'safe'
  });

  let observedHeaders=null;
  const preview=new PreviewAuthority();
  const route=preview.publish({
    port:5174,
    owner:'credential-strip',
    handler:(request)=>{
      observedHeaders=request.headers;
      return new Response('ok');
    }
  });
  const container=new FakeServiceWorkerContainer();
  const bridge=new BrowserPreviewServiceWorkerBridge({
    preview,
    serviceWorkerContainer:container,
    baseURL:'https://example.test'
  });
  await bridge.start();

  let posted=null;
  container.emitMessage({
    type:'opencontainer:preview-fetch',
    port:5174,
    owner:route.owner,
    epoch:route.epoch,
    url:'/',
    method:'GET',
    headers:{
      authorization:'Bearer host-secret',
      cookie:'sid=host-secret',
      'x-api-key':'host-secret',
      range:'bytes=0-3',
      'x-demo':'safe'
    },
    body:null
  },{postMessage(value){posted=value;}});

  for(let index=0;index<10&&!posted;index++)await new Promise((resolve)=>setTimeout(resolve,0));
  assert.equal(posted?.ok,true);
  assert.equal(observedHeaders.authorization,undefined);
  assert.equal(observedHeaders.cookie,undefined);
  assert.equal(observedHeaders['x-api-key'],undefined);
  assert.equal(observedHeaders.range,'bytes=0-3');
  assert.equal(observedHeaders['x-demo'],'safe');
  bridge.close();
});


test('preview authority rejects cross workspace session and version identity',async()=>{
  const preview=new PreviewAuthority();
  const route=preview.publish({
    port:5199,
    owner:'identity-owner',
    identity:{workspace:'workspace-a',session:'session-a',version:'version-a'},
    handler:()=>new Response('identity-ok')
  });
  assert.equal(await (await preview.dispatch(5199,{},route)).text(),'identity-ok');
  for(const [key,value] of [
    ['workspace','workspace-b'],
    ['session','session-b'],
    ['version','version-b']
  ]){
    const identity={...route.identity,[key]:value};
    await assert.rejects(
      Promise.resolve().then(()=>preview.dispatch(5199,{},{
        owner:route.owner,
        epoch:route.epoch,
        identity
      })),
      error=>error?.code==='OC_PREVIEW_STALE'&&error?.details?.key===key
    );
  }
});
