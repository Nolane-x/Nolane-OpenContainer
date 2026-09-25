const MODULE_PREFIX = '/__opencontainer__/esm/';
const REQUEST_TIMEOUT_MS = 5000;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(MODULE_PREFIX)) return;
  event.respondWith(routeModule(event.request, url));
});

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
    const headers = new Headers(result.headers ?? {});
    headers.set('cache-control', 'no-store');
    headers.set('cross-origin-opener-policy', 'same-origin');
    headers.set('cross-origin-embedder-policy', 'require-corp');
    headers.set('cross-origin-resource-policy', 'same-origin');
    headers.set('x-opencontainer-edge', 'service-worker');
    return new Response(result.body ?? '', {
      status: result.status ?? 200,
      statusText: result.statusText ?? '',
      headers
    });
  } catch {
    return new Response('OpenContainer publication session is unavailable', {
      status: 504,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-resource-policy': 'same-origin'
      }
    });
  }
}

function requestFromClient(client, message) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error('OpenContainer authority timeout'));
    }, REQUEST_TIMEOUT_MS);

    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      const data = event.data;
      if (!data?.ok) {
        reject(new Error(data?.message ?? data?.code ?? 'Publication not owned'));
        return;
      }
      resolve(data);
    };

    client.postMessage(message, [channel.port2]);
  });
}
