const MODULE_PREFIX = '/__opencontainer__/esm/';
const PREVIEW_PREFIX = '/__opencontainer__/preview/';
const REQUEST_TIMEOUT_MS = 5000;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(MODULE_PREFIX)) {
    event.respondWith(routeModule(event.request, url));
    return;
  }
  if (url.pathname.startsWith(PREVIEW_PREFIX)) {
    event.respondWith(routePreview(event.request, url));
  }
});

function edgeHeaders(input = {}) {
  const headers = new Headers(input);
  headers.set('cache-control', 'no-store');
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('cross-origin-embedder-policy', 'require-corp');
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('x-opencontainer-edge', 'service-worker');
  return headers;
}

async function routeModule(request, url) {
  const relative = url.pathname.slice(MODULE_PREFIX.length);
  const encodedSession = relative.split('/')[0];
  if (!encodedSession) return new Response('Missing OpenContainer publication session', { status: 400 });

  let session;
  try {
    session = decodeURIComponent(encodedSession);
  } catch {
    return new Response('Invalid OpenContainer publication session', { status: 400 });
  }

  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (!windows.length) return new Response('No OpenContainer authority client', { status: 503 });

  const attempts = windows.map((client) => requestFromClient(client, {
    type: 'opencontainer:esm-fetch',
    session,
    url: request.url
  }));

  try {
    const result = await Promise.any(attempts);
    return new Response(result.body ?? '', {
      status: result.status ?? 200,
      statusText: result.statusText ?? '',
      headers: edgeHeaders(result.headers)
    });
  } catch {
    return new Response('OpenContainer publication session is unavailable', {
      status: 504,
      headers: edgeHeaders({ 'content-type': 'text/plain; charset=utf-8' })
    });
  }
}

async function routePreview(request, url) {
  const relative = url.pathname.slice(PREVIEW_PREFIX.length);
  const slash = relative.indexOf('/');
  const portText = slash < 0 ? relative : relative.slice(0, slash);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return new Response('Invalid OpenContainer preview port', { status: 400, headers: edgeHeaders() });
  }

  const owner = url.searchParams.get('__oc_owner');
  const epochText = url.searchParams.get('__oc_epoch');
  const epoch = Number(epochText);
  if (!owner || !Number.isInteger(epoch)) {
    return new Response('Missing OpenContainer preview proof', { status: 400, headers: edgeHeaders() });
  }

  const guestPath = slash < 0 ? '/' : '/' + relative.slice(slash + 1);
  const guestParams = new URLSearchParams(url.searchParams);
  guestParams.delete('__oc_owner');
  guestParams.delete('__oc_epoch');
  const query = guestParams.toString();
  const guestURL = guestPath + (query ? '?' + query : '');

  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD'
    ? null
    : [...new Uint8Array(await request.arrayBuffer())];

  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (!windows.length) {
    return new Response('No OpenContainer preview authority client', { status: 503, headers: edgeHeaders() });
  }

  const attempts = windows.map((client) => requestFromClient(client, {
    type: 'opencontainer:preview-fetch',
    port,
    owner,
    epoch,
    url: guestURL,
    method,
    headers: Object.fromEntries(request.headers.entries()),
    body
  }));

  try {
    const result = await Promise.any(attempts);
    const headers = edgeHeaders(result.headers);
    headers.set('x-opencontainer-preview-port', String(port));
    headers.set('x-opencontainer-preview-owner', owner);
    headers.set('x-opencontainer-preview-epoch', String(epoch));
    return new Response(method === 'HEAD' ? null : result.body ?? null, {
      status: result.status ?? 200,
      statusText: result.statusText ?? '',
      headers
    });
  } catch (aggregate) {
    const errors = aggregate?.errors ?? [];
    const stale = errors.length > 0 && errors.every((error) => error?.code === 'OC_PREVIEW_STALE');
    return new Response(stale ? 'Stale OpenContainer preview receipt' : 'OpenContainer preview route is unavailable', {
      status: stale ? 409 : 504,
      headers: edgeHeaders({ 'content-type': 'text/plain; charset=utf-8' })
    });
  }
}

function requestFromClient(client, message) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(Object.assign(new Error('OpenContainer authority timeout'), { code: 'OC_EDGE_TIMEOUT' }));
    }, REQUEST_TIMEOUT_MS);

    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      const data = event.data;
      if (!data?.ok) {
        reject(Object.assign(new Error(data?.message ?? data?.code ?? 'Authority not owned'), {
          code: data?.code,
          details: data?.details
        }));
        return;
      }
      resolve(data);
    };

    client.postMessage(message, [channel.port2]);
  });
}
