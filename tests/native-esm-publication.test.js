import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

async function createRuntime() {
  const runtime = await OpenContainer.boot();
  runtime.mount({
    'package.json': JSON.stringify({
      name: 'app',
      type: 'module',
      imports: { '#internal': './src/internal.mjs' },
      exports: { './self': './src/self.mjs' }
    }),
    'src/internal.mjs': 'export const internal = 4',
    'src/self.mjs': 'export const self = 5'
  });
  runtime.packages.mountCatalog({
    packages: [{
      location: 'node_modules/dep',
      packageJson: {
        name: 'dep',
        type: 'module',
        exports: { '.': './index.mjs', './feature': './feature.mjs' }
      },
      files: {
        'index.mjs': 'export const dep = 6',
        'feature.mjs': 'export const feature = 7'
      }
    }]
  });
  return runtime;
}

async function materializeGraph(graph) {
  const written = new Set();
  for (const module of graph.modules) {
    const url = new URL(module.url);
    if (url.protocol !== 'file:') throw new Error('oracle graph must use file: publication URLs');
    const target = fileURLToPath(url);
    if (written.has(target)) continue;
    written.add(target);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, module.source);
  }
}

test('native ESM publication rewrites relative, bare, imports, self and dynamic-literal edges through NodeResolver', async () => {
  const runtime = await createRuntime();
  runtime.mount({
    'src/lazy.mjs': 'export const lazy = 8',
    'src/entry.mjs': `
      import { dep } from 'dep';
      import { feature } from 'dep/feature';
      import { internal } from '#internal';
      import { self } from 'app/self';
      export async function load() {
        return (await import('./lazy.mjs')).lazy + dep + feature + internal + self;
      }
    `
  });

  const authority = runtime.packages.createNativeEsmPublication({
    baseURL: 'https://example.invalid/modules/',
    session: 'rewrite'
  });
  const entryURL = authority.moduleURL('./entry.mjs', '/workspace/src/bootstrap.mjs');
  const served = await authority.serve(entryURL);

  assert.match(served.source, /https:\/\/example\.invalid\/modules\/rewrite\/fs\/workspace\/node_modules\/dep\/index\.mjs/);
  assert.match(served.source, /dep\/feature\.mjs/);
  assert.match(served.source, /workspace\/src\/internal\.mjs/);
  assert.match(served.source, /workspace\/src\/self\.mjs/);
  assert.match(served.source, /workspace\/src\/lazy\.mjs/);
  assert.equal(served.dependencies.length, 5);
});

test('native module engine preserves cycles, live bindings, top-level await and literal dynamic import', async () => {
  const runtime = await createRuntime();
  runtime.mount({
    'src/a.mjs': `
      import { getB } from './b.mjs';
      export let a = 1;
      export function setA(value) { a = value }
      export function total() { return a + getB() }
    `,
    'src/b.mjs': `
      import { a } from './a.mjs';
      export function getB() { return a + 1 }
    `,
    'src/lazy.mjs': `
      await Promise.resolve();
      export const lazy = 7;
    `,
    'src/entry.mjs': `
      import { setA, total } from './a.mjs';
      setA(5);
      const lazy = await import('./lazy.mjs');
      export const result = total() + lazy.lazy;
      export const meta = import.meta.url;
    `
  });

  const root = mkdtempSync(join(tmpdir(), 'oc-native-esm-'));
  try {
    const baseURL = pathToFileURL(root + '/').href;
    const authority = runtime.packages.createNativeEsmPublication({ baseURL, session: 'native' });
    const entryURL = authority.moduleURL('./entry.mjs', '/workspace/src/bootstrap.mjs');
    const graph = await authority.graph(entryURL);
    await materializeGraph(graph);

    const namespace = await import(entryURL.href + (entryURL.search ? '&' : '?') + 'oracle=1');
    assert.equal(namespace.result, 18);
    assert.match(namespace.meta, /workspace\/src\/entry\.mjs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ESM cache identity keeps query variants distinct while sharing one source file', async () => {
  const runtime = await createRuntime();
  runtime.mount({
    'src/value.mjs': 'export const identity = {}',
    'src/entry.mjs': `
      import { identity as a } from './value.mjs?variant=a';
      import { identity as b } from './value.mjs?variant=b';
      export const same = a === b;
    `
  });

  const root = mkdtempSync(join(tmpdir(), 'oc-native-esm-query-'));
  try {
    const authority = runtime.packages.createNativeEsmPublication({
      baseURL: pathToFileURL(root + '/').href,
      session: 'query'
    });
    const entryURL = authority.moduleURL('./entry.mjs', '/workspace/src/bootstrap.mjs');
    const graph = await authority.graph(entryURL);
    assert.equal(graph.modules.filter((module) => module.path === '/workspace/src/value.mjs').length, 2);
    await materializeGraph(graph);
    const namespace = await import(entryURL.href);
    assert.equal(namespace.same, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('publication cache is generation-keyed and never serves stale workspace source', async () => {
  const runtime = await createRuntime();
  runtime.mount({ 'src/entry.mjs': 'export const value = 1' });
  const authority = runtime.packages.createNativeEsmPublication({
    baseURL: 'https://example.invalid/modules/',
    session: 'generation'
  });
  const entryURL = authority.moduleURL('./entry.mjs', '/workspace/src/bootstrap.mjs');

  const first = await authority.serve(entryURL);
  runtime.fs.beginTransaction().writeFile('src/entry.mjs', 'export const value = 2').commit();
  const second = await authority.serve(entryURL);

  assert.notEqual(second.generation, first.generation);
  assert.match(first.source, /value = 1/);
  assert.match(second.source, /value = 2/);
});

test('nonliteral dynamic import is routed through explicit runtime helper', async () => {
  const runtime = await createRuntime();
  runtime.mount({
    'src/entry.mjs': `
      export async function load(name) {
        return import(name);
      }
    `,
    'src/lazy.mjs': 'export const value = 1'
  });

  const authority = runtime.packages.createNativeEsmPublication({
    baseURL: 'https://example.invalid/modules/',
    session: 'dynamic'
  });
  const entryURL = authority.moduleURL('./entry.mjs', '/workspace/src/bootstrap.mjs');
  const served = await authority.serve(entryURL);

  assert.doesNotMatch(served.source, /import\(name\)/);
  assert.match(served.source, /__opencontainer_dynamic_import__\(import\.meta\.url,name\)/);
  assert.equal(
    authority.resolveDynamic(entryURL, './lazy.mjs'),
    'https://example.invalid/modules/dynamic/fs/workspace/src/lazy.mjs'
  );
});

test('node builtin edges use synthetic publication modules without creating a new public runtime surface', async () => {
  const runtime = await createRuntime();
  runtime.mount({
    'src/entry.mjs': `
      import pathDefault, { sep } from 'node:path';
      export const value = pathDefault.sep + sep;
    `
  });

  const root = mkdtempSync(join(tmpdir(), 'oc-native-esm-builtin-'));
  try {
    const authority = runtime.packages.createNativeEsmPublication({
      baseURL: pathToFileURL(root + '/').href,
      session: 'builtin',
      builtinSource(specifier) {
        assert.equal(specifier, 'node:path');
        return `const value={sep:'/'};export default value;export const sep='/';`;
      }
    });
    const entryURL = authority.moduleURL('./entry.mjs', '/workspace/src/bootstrap.mjs');
    const graph = await authority.graph(entryURL);
    assert.ok(graph.modules.some((module) => module.kind === 'builtin'));
    await materializeGraph(graph);
    const namespace = await import(entryURL.href);
    assert.equal(namespace.value, '//');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('publication session containment rejects foreign URLs and source/defer phase imports fail closed', async () => {
  const runtime = await createRuntime();
  runtime.mount({ 'src/entry.mjs': 'export const value = 1' });
  const authority = runtime.packages.createNativeEsmPublication({
    baseURL: 'https://example.invalid/modules/',
    session: 'contained'
  });
  await assert.rejects(
    () => authority.serve('https://example.invalid/modules/other/fs/workspace/src/entry.mjs'),
    (error) => error.code === ErrorCodes.ESM_PUBLICATION_INVALID
  );
});


test('missing literal dynamic optional package is deferred to runtime helper', async () => {
  const runtime = await createRuntime();
  runtime.mount({
    'src/entry.mjs': `
      export async function optionalFeature() {
        return import('optional-peer-that-is-not-installed');
      }
    `
  });
  const authority = runtime.packages.createNativeEsmPublication({
    baseURL: 'https://example.invalid/modules/',
    session: 'optional-dynamic'
  });
  const entryURL = authority.moduleURL('./entry.mjs', '/workspace/src/bootstrap.mjs');
  const served = await authority.serve(entryURL);
  assert.match(served.source, /__opencontainer_dynamic_import__\(import\.meta\.url,'optional-peer-that-is-not-installed'\)/);
  assert.equal(served.dependencies.length, 0);
  assert.throws(
    () => authority.resolveDynamic(entryURL, 'optional-peer-that-is-not-installed'),
    (error) => error.code === ErrorCodes.MODULE_NOT_FOUND
  );
});
