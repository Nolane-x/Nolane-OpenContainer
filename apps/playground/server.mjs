import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const publicRoot = join(here, 'public');
const port = Number(process.env.PORT || 4173);
const networkFixturePort = Number(process.env.OPENCONTAINER_P5_NETWORK_PORT || (port + 1));
const lexerPath = fileURLToPath(import.meta.resolve('es-module-lexer/minimal/js'));
const sourcePackageLockPath = existsSync(join(repoRoot, 'package-lock.json'))
  ? join(repoRoot, 'package-lock.json')
  : join(repoRoot, 'metadata/source-package-lock.json');

const compatibilityUpstream = new Map([
  ['/__compat__/yoctocolors/index.js', {
    repository: 'sindresorhus/yoctocolors',
    commit: 'a85b98a90e5731914567d8c209e7ec45ac2d24e2',
    url: 'https://raw.githubusercontent.com/sindresorhus/yoctocolors/a85b98a90e5731914567d8c209e7ec45ac2d24e2/index.js'
  }],
  ['/__compat__/yoctocolors/base.js', {
    repository: 'sindresorhus/yoctocolors',
    commit: 'a85b98a90e5731914567d8c209e7ec45ac2d24e2',
    url: 'https://raw.githubusercontent.com/sindresorhus/yoctocolors/a85b98a90e5731914567d8c209e7ec45ac2d24e2/base.js'
  }],
  ['/__compat__/clsx/src/index.js', {
    repository: 'lukeed/clsx',
    commit: '925494cf31bcd97d3337aacd34e659e80cae7fe2',
    url: 'https://raw.githubusercontent.com/lukeed/clsx/925494cf31bcd97d3337aacd34e659e80cae7fe2/src/index.js'
  }]
]);

const publicAliases = new Map([
  ['/', join(publicRoot, 'index.html')],
  ['/index.html', join(publicRoot, 'index.html')],
  ['/index.js', join(publicRoot, 'index.js')],
  ['/browser-acceptance.html', join(publicRoot, 'browser-acceptance.html')],
  ['/browser-acceptance.js', join(publicRoot, 'browser-acceptance.js')],
  ['/p4-publication-atomicity.html', join(publicRoot, 'p4-publication-atomicity.html')],
  ['/p4-publication-atomicity.js', join(publicRoot, 'p4-publication-atomicity.js')],
  ['/p4-install-worker.js', join(publicRoot, 'p4-install-worker.js')],
  ['/p3-native-external-permission.html', join(publicRoot, 'p3-native-external-permission.html')],
  ['/p3-native-external-permission.js', join(publicRoot, 'p3-native-external-permission.js')],
  ['/p3-freeze-writer-failover.html', join(publicRoot, 'p3-freeze-writer-failover.html')],
  ['/p3-freeze-writer-failover.js', join(publicRoot, 'p3-freeze-writer-failover.js')],
  ['/opencontainer-sw.js', join(publicRoot, 'opencontainer-sw.js')],
  ['/opencontainer-guest-worker.mjs', join(publicRoot, 'opencontainer-guest-worker.mjs')],
  ['/opencontainer-toolchain-worker.mjs', join(publicRoot, 'opencontainer-toolchain-worker.mjs')],
  ['/__deps__/es-module-lexer-minimal.js', lexerPath],
  ['/toolchain/vendor/lightningcss-wasm-1.33.0.tgz', join(repoRoot, 'toolchain/vendor/lightningcss-wasm-1.33.0.tgz')],
  ['/toolchain/vendor/rolldown-browser-1.2.9.tgz', join(repoRoot, 'toolchain/vendor/rolldown-browser-1.2.9.tgz')],
  ['/package-lock.json', sourcePackageLockPath],
  ['/docs/production/PRODUCTION-PROFILE.json', join(repoRoot, 'docs/production/PRODUCTION-PROFILE.json')],
  ['/scripts/hosting-self-check-lib.mjs', join(repoRoot, 'scripts/hosting-self-check-lib.mjs')]
]);

function contentType(path) {
  const extension = extname(path);
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js' || extension === '.mjs') return 'text/javascript; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.wasm') return 'application/wasm';
  return 'application/octet-stream';
}

function safeRepoFile(pathname) {
  if (!pathname.startsWith('/packages/')) return null;
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const target = resolve(repoRoot, '.' + decoded);
  const prefix = repoRoot.endsWith(sep) ? repoRoot : repoRoot + sep;
  if (!target.startsWith(prefix)) return null;
  return target;
}


function applyP5Cors(response) {
  response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:' + port);
  response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,range');
  response.setHeader('Access-Control-Expose-Headers', 'x-p5-network,content-range');
  response.setHeader('Access-Control-Allow-Private-Network', 'true');
  response.setHeader('Vary', 'Origin');
}

const networkFixture = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:' + networkFixturePort);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  response.setHeader('X-P5-Network', 'fixture');

  if (request.method === 'OPTIONS') {
    applyP5Cors(response);
    response.statusCode = 204;
    response.end();
    return;
  }

  if (url.pathname === '/allowed' || url.pathname === '/lna') {
    applyP5Cors(response);
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end(url.pathname === '/lna' ? 'lna-allowed' : 'cors-allowed');
    return;
  }

  if (url.pathname === '/denied' || url.pathname === '/opaque') {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end(url.pathname === '/opaque' ? 'opaque-body' : 'cors-denied-body');
    return;
  }

  if (url.pathname === '/stream') {
    applyP5Cors(response);
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/octet-stream');
    response.write(new Uint8Array(1024).fill(65));
    setTimeout(() => response.write(new Uint8Array(1024).fill(66)), 10);
    setTimeout(() => response.end(new Uint8Array(1024).fill(67)), 20);
    return;
  }

  if (url.pathname === '/slow') {
    applyP5Cors(response);
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    setTimeout(() => {
      if (!response.writableEnded) response.end('slow-complete');
    }, 800);
    return;
  }

  if (url.pathname === '/provider-fail') {
    applyP5Cors(response);
    response.statusCode = 401;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ ok: false, code: 'PROVIDER_AUTH_FAILED' }));
    return;
  }

  if (url.pathname === '/secret-echo') {
    applyP5Cors(response);
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({
      authorizationPresent: typeof request.headers.authorization === 'string' && request.headers.authorization.length > 0,
      cookiePresent: typeof request.headers.cookie === 'string' && request.headers.cookie.length > 0
    }));
    return;
  }

  response.statusCode = 404;
  response.end('P5 network fixture: not found');
});

const server = createServer(async (request, response) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=(), hid=(), payment=()'
  );
  response.setHeader('Cache-Control', 'no-store');

  try {
    const url = new URL(request.url, 'http://127.0.0.1');

    if (url.pathname === '/__p5__/redirect-allowed') {
      response.statusCode = 302;
      response.setHeader('Location', '/__p5__/redirect-final');
      response.end();
      return;
    }
    if (url.pathname === '/__p5__/redirect-denied') {
      response.statusCode = 302;
      response.setHeader('Location', '/__p5__/outside-final');
      response.end();
      return;
    }
    if (url.pathname === '/__p5__/redirect-final') {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('redirect-final');
      return;
    }
    if (url.pathname === '/__p5__/outside-final') {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('outside-capability-should-not-be-fetched');
      return;
    }

    const upstream = compatibilityUpstream.get(url.pathname);
    if (upstream) {
      const upstreamResponse = await fetch(upstream.url, {
        headers: { 'User-Agent': 'OpenContainer-compatibility-corpus-v0.1' }
      });
      if (!upstreamResponse.ok) {
        response.statusCode = 502;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end('Pinned compatibility upstream returned HTTP ' + upstreamResponse.status);
        return;
      }
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.setHeader('X-OpenContainer-Compat-Repository', upstream.repository);
      response.setHeader('X-OpenContainer-Compat-Commit', upstream.commit);
      response.end(new Uint8Array(await upstreamResponse.arrayBuffer()));
      return;
    }

    const target = publicAliases.get(url.pathname) ?? safeRepoFile(url.pathname);
    if (!target) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'self'; img-src 'self' data:; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
      );
      response.setHeader('X-OpenContainer-Document-Profile', 'strict');
    }
    if (url.pathname === '/browser-acceptance.html') {
      response.setHeader('X-OpenContainer-Document-Profile', 'acceptance-harness');
    }
    if (url.pathname === '/p4-publication-atomicity.html') {
      response.setHeader('X-OpenContainer-Document-Profile', 'p4-publication-atomicity-court');
    }
    if (url.pathname === '/p3-native-external-permission.html') {
      response.setHeader('X-OpenContainer-Document-Profile', 'p3-native-external-permission-court');
    }
    if (url.pathname === '/p3-freeze-writer-failover.html') {
      response.setHeader('X-OpenContainer-Document-Profile', 'p3-freeze-writer-failover-court');
    }
    if (url.pathname === '/opencontainer-sw.js') response.setHeader('Service-Worker-Allowed', '/');
    if (url.pathname === '/opencontainer-guest-worker.mjs') {
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'; child-src 'self'"
      );
      response.setHeader('X-OpenContainer-Worker-Profile', 'strict');
    }
    if (url.pathname === '/opencontainer-toolchain-worker.mjs') {
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; connect-src 'self'; worker-src 'self'; child-src 'self'"
      );
      response.setHeader('X-OpenContainer-Worker-Profile', 'toolchain');
    }
    response.setHeader('Content-Type', contentType(target));
    response.end(await readFile(target));
  } catch (error) {
    response.statusCode = 500;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end(error?.stack ?? String(error));
  }
});

networkFixture.listen(networkFixturePort, '127.0.0.1', () => {
  console.log('OpenContainer P5 network fixture: http://127.0.0.1:' + networkFixturePort);
  server.listen(port, '127.0.0.1', () => {
    console.log('OpenContainer playground: http://127.0.0.1:' + port);
  });
});
