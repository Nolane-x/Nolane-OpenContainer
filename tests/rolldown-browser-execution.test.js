import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';
import { inspectTarArchive } from '../packages/package-env/src/index.js';
import { verifyRetainedRolldownBrowserPackage } from '../packages/toolchain/src/index.js';

class BrowserWorkerAdapter {
  #worker;
  #listeners = new Map();
  onmessage = null;
  onerror = null;
  onmessageerror = null;

  constructor(target, options = {}) {
    const targetUrl = target instanceof URL ? target.href : String(target);
    const bootstrap = `
      import { parentPort, MessageChannel, MessagePort, BroadcastChannel } from 'node:worker_threads';
      globalThis.MessageChannel ??= MessageChannel;
      globalThis.MessagePort ??= MessagePort;
      globalThis.BroadcastChannel ??= BroadcastChannel;
      let handler = null;
      const pending = [];
      Object.defineProperty(globalThis, 'onmessage', {
        configurable: true,
        get() { return handler; },
        set(value) {
          handler = value;
          if (typeof handler === 'function') {
            for (const data of pending.splice(0)) handler({ data });
          }
        }
      });
      globalThis.postMessage = (value, transfer) => parentPort.postMessage(value, transfer);
      globalThis.close = () => process.exit(0);
      parentPort.on('message', (data) => {
        if (typeof handler === 'function') handler({ data });
        else pending.push(data);
      });
      await import(${JSON.stringify(targetUrl)});
    `;
    const url = new URL('data:text/javascript;base64,' + Buffer.from(bootstrap).toString('base64'));
    this.#worker = new NodeWorker(url, { type: options.type ?? 'module' });
    this.#worker.on('message', (data) => this.#dispatch('message', { data }));
    this.#worker.on('messageerror', (error) => this.#dispatch('messageerror', { data: error }));
    this.#worker.on('error', (error) => this.#dispatch('error', error));
  }

  postMessage(value, transfer) { return this.#worker.postMessage(value, transfer); }
  terminate() { return this.#worker.terminate(); }
  ref() { this.#worker.ref(); return this; }
  unref() { this.#worker.unref(); return this; }

  // emnapi selects its Node worker-manager path in this exact-Node oracle,
  // while Rolldown's browser loader itself uses EventTarget methods. Expose
  // both contracts over the same underlying worker.
  on(type, listener) { this.#worker.on(type, listener); return this; }
  once(type, listener) { this.#worker.once(type, listener); return this; }
  off(type, listener) { this.#worker.off(type, listener); return this; }
  removeListener(type, listener) { this.#worker.removeListener(type, listener); return this; }
  removeAllListeners(type) { this.#worker.removeAllListeners(type); return this; }

  addEventListener(type, listener) {
    const set = this.#listeners.get(type) ?? new Set();
    set.add(listener);
    this.#listeners.set(type, set);
  }

  removeEventListener(type, listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  #dispatch(type, event) {
    const property = type === 'message' ? this.onmessage : type === 'error' ? this.onerror : this.onmessageerror;
    property?.(event);
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

async function materializeRetainedPackage(root) {
  const tarball = new Uint8Array(await readFile(new URL('../toolchain/vendor/rolldown-browser-1.2.9.tgz', import.meta.url)));
  await verifyRetainedRolldownBrowserPackage(tarball);
  const archive = await inspectTarArchive(tarball, {
    requiredPrefix: 'package/',
    maxFiles: 5000,
    maxUnpackedBytes: 96 * 1024 * 1024
  });
  for (const entry of archive.entries) {
    if (entry.type !== 'file') continue;
    const target = join(root, entry.path.slice('package/'.length));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.data);
  }
}

function virtualPlugin() {
  const modules = new Map([
    ['virtual:entry.js', `
      import { value } from './dep.js';
      export const answer = value + 1;
      export async function lazy() {
        return (await import('./lazy.js')).lazy;
      }
    `],
    ['virtual:dep.js', 'export const value = 41;'],
    ['virtual:lazy.js', 'export const lazy = "loaded";']
  ]);

  return {
    name: 'opencontainer-virtual-fixture',
    resolveId(source, importer) {
      if (!importer && source === 'entry.js') return 'virtual:entry.js';
      if (source.startsWith('./') && importer?.startsWith('virtual:')) {
        const base = importer.slice('virtual:'.length);
        return 'virtual:' + posix.normalize(posix.join(posix.dirname(base), source));
      }
      if (modules.has(source)) return source;
      return null;
    },
    load(id) {
      return modules.get(id) ?? null;
    }
  };
}

async function runBuild(rolldown) {
  const bundle = await rolldown({
    input: 'entry.js',
    plugins: [virtualPlugin()]
  });
  try {
    const generated = await bundle.generate({
      format: 'esm',
      sourcemap: true,
      entryFileNames: '[name].js',
      chunkFileNames: 'chunks/[name]-[hash].js'
    });
    return generated.output
      .map((item) => ({
        type: item.type,
        fileName: item.fileName,
        code: item.type === 'chunk' ? item.code : undefined,
        map: item.type === 'chunk' ? item.map?.toString?.() ?? null : undefined,
        isEntry: item.type === 'chunk' ? item.isEntry : undefined,
        dynamicImports: item.type === 'chunk' ? [...item.dynamicImports] : undefined
      }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
  } finally {
    await bundle.close();
  }
}

test('exact retained Rolldown browser WASI binding executes a deterministic code-split bundle', { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-rolldown-browser-'));
  const previousFetch = globalThis.fetch;
  const previousWorker = globalThis.Worker;

  try {
    await materializeRetainedPackage(root);

    globalThis.Worker = BrowserWorkerAdapter;
    globalThis.fetch = async (input, init) => {
      const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
      if (url.protocol === 'file:' && url.pathname.endsWith('/rolldown-binding.wasm32-wasi.wasm')) {
        const bytes = await readFile(fileURLToPath(url));
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'application/wasm' }
        });
      }
      return previousFetch(input, init);
    };

    const entryUrl = pathToFileURL(join(root, 'dist/index.browser.mjs')).href + '?opencontainer=1';
    const api = await import(entryUrl);
    assert.equal(typeof api.rolldown, 'function');

    const first = await runBuild(api.rolldown);
    const second = await runBuild(api.rolldown);

    assert.deepEqual(second, first, 'two identical builds must be deterministic');
    const chunks = first.filter((item) => item.type === 'chunk');
    assert.ok(chunks.length >= 2, 'dynamic import should produce at least two chunks');
    const entry = chunks.find((item) => item.isEntry);
    assert.ok(entry);
    assert.match(entry.code, /42|value/);
    assert.ok(entry.map, 'entry source map must exist');
    assert.ok(entry.dynamicImports.length >= 1, 'entry must retain a dynamic import edge');

    const binding = await import(pathToFileURL(join(root, 'dist/rolldown-binding.wasi-browser.js')).href);
    assert.equal(binding.__napiBindingTarget, 'wasm32-wasi');
    const dispose = binding.default?.[Symbol.for('napi.rs.wasi.dispose')];
    if (typeof dispose === 'function') await dispose.call(binding.default);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = previousWorker;
    await rm(root, { recursive: true, force: true });
  }
});
