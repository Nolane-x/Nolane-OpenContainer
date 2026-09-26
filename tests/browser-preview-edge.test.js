import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewAuthority, BrowserPreviewServiceWorkerBridge } from '../packages/preview/src/index.js';

class FakeServiceWorkerContainer {
  constructor() {
    this.controller = { scriptURL: 'https://example.test/opencontainer-sw.js' };
    this.listeners = new Map();
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); }
  async register() {
    return {
      scope: 'https://example.test/',
      active: { state: 'activated' },
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
    handler: (request) => new Response('ok:' + request.url, { headers: { 'x-demo': 'yes' } })
  });
  const container = new FakeServiceWorkerContainer();
  const bridge = new BrowserPreviewServiceWorkerBridge({
    preview,
    serviceWorkerContainer: container,
    baseURL: 'https://example.test'
  });
  await bridge.start();

  const url = new URL(bridge.url(route, '/src/main.ts?x=1'));
  assert.equal(url.pathname, '/__opencontainer__/preview/5173/src/main.ts');
  assert.equal(url.searchParams.get('__oc_owner'), 'dev-1');
  assert.equal(url.searchParams.get('__oc_epoch'), String(route.epoch));

  let posted = null;
  container.emitMessage({
    type: 'opencontainer:preview-fetch',
    port: 5173,
    owner: route.owner,
    epoch: route.epoch,
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
