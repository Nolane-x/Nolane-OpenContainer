import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const publicRoot = join(here, 'public');
const port = Number(process.env.PORT || 4173);
const lexerPath = fileURLToPath(import.meta.resolve('es-module-lexer/minimal/js'));
const sourcePackageLockPath = existsSync(join(repoRoot, 'package-lock.json'))
  ? join(repoRoot, 'package-lock.json')
  : join(repoRoot, 'metadata/source-package-lock.json');

let p5LastPackageAuthorizationPresent = false;

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
  ['/browser-acceptance.html', join(publicRoot, 'browser-acceptance.html')],
  ['/browser-acceptance.js', join(publicRoot, 'browser-acceptance.js')],
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

const server = createServer(async (request, response) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Cache-Control', 'no-store');

  try {
    const url = new URL(request.url, 'http://127.0.0.1');

    if (url.pathname.startsWith('/__p5__/')) {
      const cors = () => {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Expose-Headers', 'X-P5-Court, Content-Range');
        response.setHeader('Access-Control-Allow-Private-Network', 'true');
        response.setHeader('X-P5-Court', 'network-preview-v2');
      };

      if (request.method === 'OPTIONS') {
        cors();
        response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization,X-API-Key,Range,Content-Type');
        response.statusCode = 204;
        response.end();
        return;
      }

      if (url.pathname === '/__p5__/cors-allowed') {
        cors();
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ok:true,mode:'cors-allowed'}));
        return;
      }
      if (url.pathname === '/__p5__/cors-denied') {
        response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ok:true,mode:'cors-denied'}));
        return;
      }
      if (url.pathname === '/__p5__/compressed') {
        cors();
        const decoded = Buffer.from('x'.repeat(8192));
        const compressed = gzipSync(decoded);
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.setHeader('Content-Encoding', 'gzip');
        response.setHeader('Content-Length', String(compressed.byteLength));
        response.end(compressed);
        return;
      }
      if (url.pathname === '/__p5__/slow-stream') {
        cors();
        response.setHeader('Content-Type', 'application/octet-stream');
        response.writeHead(200);
        let count = 0;
        const timer = setInterval(() => {
          if (response.destroyed) {
            clearInterval(timer);
            return;
          }
          response.write(Buffer.alloc(256, count++ % 255));
          if (count >= 100) {
            clearInterval(timer);
            response.end();
          }
        }, 25);
        request.on('close', () => clearInterval(timer));
        return;
      }
      if (url.pathname === '/__p5__/secret') {
        cors();
        const authorized = request.headers.authorization === 'Bearer p5-browser-secret';
        response.statusCode = authorized ? 200 : 401;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({authorized}));
        return;
      }
      if (url.pathname === '/__p5__/provider-fail') {
        cors();
        response.statusCode = 401;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ok:false,code:'invalid_api_key'}));
        return;
      }
      if (url.pathname === '/__p5__/package-observation') {
        cors();
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({authorizationPresent:p5LastPackageAuthorizationPresent}));
        return;
      }

      response.statusCode = 404;
      response.end('P5 court route not found');
      return;
    }

    if (url.pathname === '/toolchain/vendor/lightningcss-wasm-1.33.0.tgz') {
      p5LastPackageAuthorizationPresent = typeof request.headers.authorization === 'string';
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

server.listen(port, '127.0.0.1', () => {
  console.log('OpenContainer playground: http://127.0.0.1:' + port);
});
