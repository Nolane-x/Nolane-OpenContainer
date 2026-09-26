import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const publicRoot = join(here, 'public');
const port = Number(process.env.PORT || 4173);
const lexerPath = fileURLToPath(import.meta.resolve('es-module-lexer/minimal/js'));

const publicAliases = new Map([
  ['/', join(publicRoot, 'index.html')],
  ['/index.html', join(publicRoot, 'index.html')],
  ['/browser-acceptance.html', join(publicRoot, 'browser-acceptance.html')],
  ['/browser-acceptance.js', join(publicRoot, 'browser-acceptance.js')],
  ['/opencontainer-sw.js', join(publicRoot, 'opencontainer-sw.js')],
  ['/opencontainer-guest-worker.mjs', join(publicRoot, 'opencontainer-guest-worker.mjs')],
  ['/__deps__/es-module-lexer-minimal.js', lexerPath],
  ['/toolchain/vendor/lightningcss-wasm-1.33.0.tgz', join(repoRoot, 'toolchain/vendor/lightningcss-wasm-1.33.0.tgz')],
  ['/toolchain/vendor/rolldown-browser-1.2.9.tgz', join(repoRoot, 'toolchain/vendor/rolldown-browser-1.2.9.tgz')],
  ['/package-lock.json', join(repoRoot, 'package-lock.json')]
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
