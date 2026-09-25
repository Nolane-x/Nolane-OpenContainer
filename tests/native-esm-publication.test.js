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


test('synthetic builtin modules rewrite nested node builtin imports into the publication graph', async () => {
  const runtime = await createRuntime();
  runtime.mount({
    'src/entry.mjs': `
      import pathValue from 'node:path';
      export const value = pathValue.kind;
    `
  });

  const authority = runtime.packages.createNativeEsmPublication({
    baseURL: 'https://example.invalid/modules/',
    session: 'nested-builtins',
    builtinSource(specifier) {
      if (specifier === 'node:path') {
        return `import EventEmitter from 'node:events'; export default {kind: typeof EventEmitter === 'function' ? 'ok' : 'bad'};`;
      }
      if (specifier === 'node:events') {
        return `export default class EventEmitter {}`;
      }
      throw new Error('unexpected builtin '+specifier);
    }
  });

  const entryURL = authority.moduleURL('./entry.mjs', '/workspace/src/bootstrap.mjs');
  const graph = await authority.graph(entryURL);
  const pathModule = graph.modules.find((module) => module.specifier === 'node:path');
  const eventsModule = graph.modules.find((module) => module.specifier === 'node:events');
  assert.ok(pathModule);
  assert.ok(eventsModule);
  assert.equal(pathModule.dependencies.length, 1);
  assert.equal(pathModule.dependencies[0].specifier, 'node:events');
  assert.match(pathModule.source, /nested-builtins\/builtin\/node%3Aevents\.mjs/);
});


test('native ESM publication bridges static CommonJS default exports and nested require edges', async () => {
  const runtime = await createRuntime();
  runtime.packages.mountCatalog({
    packages: [{
      location: 'node_modules/cjs-dep',
      packageJson: { name: 'cjs-dep', type: 'commonjs', main: './index.js' },
      files: {
        'index.js': "const inner=require('./inner.js'); module.exports={value:inner.value+1};",
        'inner.js': 'exports.value=41;'
      }
    }]
  });
  runtime.mount({
    'src/cjs-entry.mjs': "import dep from 'cjs-dep'; export const result=dep.value;"
  });

  const root = mkdtempSync(join(tmpdir(), 'oc-native-cjs-'));
  try {
    const authority = runtime.packages.createNativeEsmPublication({
      baseURL: pathToFileURL(root + '/').href,
      session: 'cjs-interop'
    });
    const entryURL = authority.moduleURL('./cjs-entry.mjs', '/workspace/src/bootstrap.mjs');
    const graph = await authority.graph(entryURL);
    const cjs = graph.modules.find((module) => module.path?.endsWith('/cjs-dep/index.js'));
    assert.equal(cjs?.format, 'commonjs');
    assert.match(cjs.source, /export default __opencontainer_cjs_exports/);
    assert.ok(cjs.dependencies.some((dependency) => dependency.specifier === './inner.js'));
    await materializeGraph(graph);
    const namespace = await import(entryURL.href + '?oracle=' + Date.now());
    assert.equal(namespace.result, 42);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('static CommonJS require can consume a prelinked ESM namespace in the browser publication bridge', async () => {
  const runtime = await createRuntime();
  runtime.packages.mountCatalog({
    packages: [
      {
        location: 'node_modules/esm-runtime',
        packageJson: { name: 'esm-runtime', type: 'module', exports: { '.': './index.js' } },
        files: { 'index.js': 'export const answer=41; export default {answer};' }
      },
      {
        location: 'node_modules/cjs-consumer',
        packageJson: { name: 'cjs-consumer', type: 'commonjs', main: './index.js' },
        files: { 'index.js': "const runtime=require('esm-runtime'); module.exports={value:runtime.answer+1};" }
      }
    ]
  });
  runtime.mount({
    'src/cjs-esm-entry.mjs': "import consumer from 'cjs-consumer'; export const result=consumer.value;"
  });

  const root = mkdtempSync(join(tmpdir(), 'oc-native-cjs-require-esm-'));
  try {
    const authority = runtime.packages.createNativeEsmPublication({
      baseURL: pathToFileURL(root + '/').href,
      session: 'cjs-require-esm'
    });
    const entryURL = authority.moduleURL('./cjs-esm-entry.mjs', '/workspace/src/bootstrap.mjs');
    const graph = await authority.graph(entryURL);
    const cjs = graph.modules.find((module) => module.path?.endsWith('/cjs-consumer/index.js'));
    assert.ok(cjs);
    assert.ok(cjs.dependencies.some((dependency) => dependency.specifier === 'esm-runtime' && dependency.format === 'module'));
    assert.doesNotMatch(cjs.source, /OC_REQUIRE_ESM_UNSUPPORTED/);
    await materializeGraph(graph);
    const namespace = await import(entryURL.href + '?oracle=' + Date.now());
    assert.equal(namespace.result, 42);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('static CommonJS cycles use an initialized export cell instead of ESM TDZ markers', async () => {
  const runtime = await createRuntime();
  runtime.packages.mountCatalog({
    packages: [{
      location: 'node_modules/cjs-cycle',
      packageJson: { name: 'cjs-cycle', type: 'commonjs', main: './a.js' },
      files: {
        'a.js': "const b=require('./b.js'); exports.result=()=>b.value+1;",
        'b.js': "const a=require('./a.js'); exports.value=41; exports.peerType=()=>typeof a;"
      }
    }]
  });
  runtime.mount({
    'src/cjs-cycle-entry.mjs': "import cycle from 'cjs-cycle'; export const result=cycle.result();"
  });

  const root = mkdtempSync(join(tmpdir(), 'oc-native-cjs-cycle-'));
  try {
    const authority = runtime.packages.createNativeEsmPublication({
      baseURL: pathToFileURL(root + '/').href,
      session: 'cjs-cycle'
    });
    const entryURL = authority.moduleURL('./cjs-cycle-entry.mjs', '/workspace/src/bootstrap.mjs');
    const graph = await authority.graph(entryURL);
    const modules = graph.modules.filter((module) => module.format === 'commonjs');
    assert.equal(modules.length, 2);
    assert.ok(modules.every((module) => module.source.includes('export function __opencontainer_cjs_cell()')));
    await materializeGraph(graph);
    const namespace = await import(entryURL.href + '?oracle=' + Date.now());
    assert.equal(namespace.result, 42);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('binary publication assets are default-deny and exact allowlisted WASM is served as raw bytes', async () => {
  const runtime = await createRuntime();
  const wasm = Uint8Array.from([0,97,115,109,1,0,0,0]);
  runtime.fs.beginTransaction().writeFile('src/probe.wasm', wasm).commit();

  const denied = runtime.packages.createNativeEsmPublication({
    baseURL: 'https://example.invalid/modules/',
    session: 'asset-denied'
  });
  const deniedURL = denied.moduleURL('./probe.wasm', '/workspace/src/entry.mjs');
  await assert.rejects(
    () => denied.response(deniedURL),
    (error) => error.code === ErrorCodes.ESM_PUBLICATION_INVALID
  );

  const allowed = runtime.packages.createNativeEsmPublication({
    baseURL: 'https://example.invalid/modules/',
    session: 'asset-allowed',
    assetAllow(path, asset) {
      return path === '/workspace/src/probe.wasm' && asset.kind === 'wasm';
    }
  });
  const allowedURL = allowed.moduleURL('./probe.wasm', '/workspace/src/entry.mjs');
  const response = await allowed.response(allowedURL);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/wasm');
  assert.equal(response.headers.get('content-length'), String(wasm.byteLength));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), wasm);
});


test('native ESM publication can append an explicit bootstrap epilogue without mutating source bytes', async () => {
  const runtime = await createRuntime();
  runtime.mount({
    'src/bootstrap-entry.mjs': [
      'let ready = false;',
      'async function init(){ ready = true; }',
      'export { ready };'
    ].join('\n')
  });

  const root = mkdtempSync(join(tmpdir(), 'oc-native-prelude-'));
  try {
    const authority = runtime.packages.createNativeEsmPublication({
      baseURL: pathToFileURL(root + '/').href,
      session: 'prelude',
      moduleEpilogue: (path) => path === '/workspace/src/bootstrap-entry.mjs' ? 'await init();' : ''
    });
    const entryURL = authority.moduleURL('./bootstrap-entry.mjs', '/workspace/src/entry.mjs');
    const served = await authority.serve(entryURL);
    assert.match(served.source, /await init\(\);$/);
    assert.equal(runtime.fs.readFile('/workspace/src/bootstrap-entry.mjs').startsWith('await init();'), false);
    await materializeGraph(await authority.graph(entryURL));
    const namespace = await import(entryURL.href + '?oracle=' + Date.now());
    assert.equal(namespace.ready, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('node-targeted publication can inject a lexical logical process without changing the host global', async () => {
  const runtime = await createRuntime();
  runtime.mount({
    'src/process-entry.mjs': `
      export const version = process.versions.node;
      export const mode = process.env.OPENCONTAINER_MODE;
      export const platform = process.platform;
      export const defined = typeof process !== 'undefined';
      export const isolated = process !== globalThis.process;
    `
  });

  const root = mkdtempSync(join(tmpdir(), 'oc-native-process-global-'));
  try {
    const authority = runtime.packages.createNativeEsmPublication({
      baseURL: pathToFileURL(root + '/').href,
      session: 'node-global',
      nodeGlobalAllow: (path) => path === '/workspace/src/process-entry.mjs',
      builtinSource(specifier) {
        if (specifier !== 'node:process') throw new Error('unexpected builtin '+specifier);
        return `const process={versions:Object.freeze({node:'24.21.0'}),env:Object.freeze({OPENCONTAINER_MODE:'production'}),platform:'linux'};export default process;export const versions=process.versions;export const env=process.env;export const platform=process.platform;`;
      }
    });
    const entryURL = authority.moduleURL('./process-entry.mjs', '/workspace/src/bootstrap.mjs');
    const graph = await authority.graph(entryURL);
    const entry = graph.modules.find((module) => module.path === '/workspace/src/process-entry.mjs');
    assert.ok(entry.dependencies.some((dependency) =>
      dependency.specifier === 'node:process' && dependency.injectedNodeGlobal === true
    ));
    await materializeGraph(graph);
    const namespace = await import(entryURL.href + '?oracle=' + Date.now());
    assert.equal(namespace.version, '24.21.0');
    assert.equal(namespace.mode, 'production');
    assert.equal(namespace.platform, 'linux');
    assert.equal(namespace.defined, true);
    assert.equal(namespace.isolated, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('node-global injection is not suppressed by a process$1 import binding', async () => {
  const runtime = await createRuntime();
  runtime.mount({
    'src/process-suffix-entry.mjs': [
"import process$1 from 'node:process';",
      "export const bareVersion = process.versions.node;",
      "export const importedVersion = process$1.versions.node;",
      "export const isolated = process !== globalThis.process;"
    ].join('\n')
  });

  const root = mkdtempSync(join(tmpdir(), 'oc-native-process-suffix-'));
  try {
    const authority = runtime.packages.createNativeEsmPublication({
      baseURL: pathToFileURL(root + '/').href,
      session: 'node-global-suffix',
      nodeGlobalAllow: (path) => path === '/workspace/src/process-suffix-entry.mjs',
      builtinSource(specifier) {
        if (specifier !== 'node:process') throw new Error('unexpected builtin '+specifier);
        return "const process={versions:Object.freeze({node:'24.21.0'})};export default process;export const versions=process.versions;";
      }
    });
    const entryURL = authority.moduleURL('./process-suffix-entry.mjs', '/workspace/src/bootstrap.mjs');
    const graph = await authority.graph(entryURL);
    const entry = graph.modules.find((module) => module.path === '/workspace/src/process-suffix-entry.mjs');
    assert.match(entry.source, /^import process from /);
    await materializeGraph(graph);
    const namespace = await import(entryURL.href + '?oracle=' + Date.now());
    assert.equal(namespace.bareVersion, '24.21.0');
    assert.equal(namespace.importedVersion, '24.21.0');
    assert.equal(namespace.isolated, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ESM createRequire literal package edges are prelinked without guest eval', async () => {
  const runtime = await createRuntime();
  runtime.packages.mountCatalog({
    packages: [{
      location: 'node_modules/prelinked-cjs',
      packageJson: { name: 'prelinked-cjs', type: 'commonjs', main: './index.js' },
      files: { 'index.js': 'module.exports={value:41};' }
    }]
  });
  runtime.mount({
    'src/prelinked-entry.mjs': `
      import { createRequire } from 'node:module';
      var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();
      const dep = __require('prelinked-cjs');
      export const result = dep.value + 1;
    `
  });

  const root = mkdtempSync(join(tmpdir(), 'oc-esm-create-require-'));
  try {
    const authority = runtime.packages.createNativeEsmPublication({
      baseURL: pathToFileURL(root + '/').href,
      session: 'esm-create-require',
      builtinSource(specifier) {
        if (specifier !== 'node:module') throw new Error('unexpected builtin '+specifier);
        return `
          function unwrap(ns){
            if(ns&&Object.prototype.hasOwnProperty.call(ns,'__opencontainer_cjs_cell')){
              const cell=ns.__opencontainer_cjs_cell;
              return Object.prototype.hasOwnProperty.call(cell,'current')?cell.current:cell;
            }
            if(ns&&Object.prototype.hasOwnProperty.call(ns,'__opencontainer_cjs_exports'))return ns.__opencontainer_cjs_exports;
            return ns?.default ?? ns;
          }
          export function createRequire(filename){
            const issuer=String(filename);
            return (specifier)=>{
              const value=String(specifier);
              const keys=[JSON.stringify([issuer,value])];
              try{
                const normalized=new URL(issuer);
                normalized.search='';normalized.hash='';
                keys.push(JSON.stringify([normalized.href,value]));
              }catch{}
              const registry=globalThis.__opencontainer_prelinked_require__;
              const key=keys.find((candidate)=>registry?.has(candidate));
              if(!key)throw new Error('missing prelink '+keys[0]);
              return unwrap(registry.get(key));
            };
          }
        `;
      }
    });
    const entryURL = authority.moduleURL('./prelinked-entry.mjs', '/workspace/src/bootstrap.mjs');
    const graph = await authority.graph(entryURL);
    const entry = graph.modules.find((module) => module.path === '/workspace/src/prelinked-entry.mjs');
    assert.ok(entry.dependencies.some((dependency) => dependency.specifier === 'prelinked-cjs' && dependency.prelinkedRequire === true));
    assert.match(entry.source, /__opencontainer_prelinked_require__/);
    assert.match(entry.source, /prelinked-cjs/);
    await materializeGraph(graph);
    const namespace = await import(entryURL.href + '?oracle=' + Date.now());
    assert.equal(namespace.result, 42);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
