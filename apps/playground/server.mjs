import { createServer } from 'node:http';
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
  : join(repoRoot, 'fixtures/source-package-lock.json');

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
  ['/docs/production/PRODUCTION-PROFILE.json', join(repoRoot, 'docs/production/PRODUCTION-PROFILE.json')]
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
