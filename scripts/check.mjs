import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const required=[
  'packages/sdk/src/index.js','packages/kernel/src/index.js','packages/vfs/src/index.js','packages/process/src/index.js',
  'packages/process/src/sync-rpc.js',
  'packages/package-env/src/index.js',
  'packages/package-env/src/resolver.js',
  'packages/package-env/src/native-esm-publication.js',
  'packages/package-env/src/commonjs-loader.js',
  'packages/package-env/src/frozen-install.js',
  'packages/package-env/src/command-bridge.js',
  'packages/package-env/src/builtins/path.js',
  'packages/package-env/src/builtins/events.js',
  'packages/package-env/src/builtins/registry.js',
  'packages/package-env/src/builtins/module.js',
  'packages/package-env/src/builtins/fs.js',
  'packages/package-env/src/builtins/process.js',
  'packages/package-env/src/builtins/url.js',
  'packages/package-env/src/builtins/buffer.js',
  'packages/package-env/src/virtual-node-modules.js','packages/network/src/index.js','packages/preview/src/index.js','packages/persistence/src/index.js',
  'packages/resources/src/index.js','packages/diagnostics/src/index.js','packages/protocol/src/index.js','packages/toolchain/src/index.js',
  'packages/toolchain/src/wasm-artifact-manager.js',
  'packages/toolchain/src/lightningcss-profile.js',
  'packages/toolchain/src/rolldown-browser-profile.js',
  'toolchain/artifacts/rolldown-wasi-1.2.9.json',
  'toolchain/artifacts/lightningcss-wasm-1.33.0.json',
  'toolchain/vendor/lightningcss-wasm-1.33.0.tgz',
  'toolchain/vendor/rolldown-browser-1.2.9.tgz',
  'toolchain/artifacts/rolldown-browser-1.2.9.json',
  'toolchain/artifacts/rolldown-runtime-deps-1.2.9.json',
  'toolchain/artifacts/vite-c1-runtime-8.3.0.json',
  'toolchain/artifacts/esm-lexer-3.0.2.json',
  'tests/runtime.test.js',
  'tests/resolver.test.js',
  'tests/node24-resolver-differential.test.js',
  'tests/commonjs-loader.test.js',
  'tests/frozen-install.test.js',
  'tests/node-core-builtins.test.js',
  'tests/runtime-builtins.test.js',
  'tests/package-command-bridge.test.js',
  'tests/wasm-artifact-manager.test.js',
  'tests/lightningcss-artifact.test.js',
  'tests/lightningcss-js-glue.test.js',
  'tests/rolldown-browser-artifact.test.js',
  'tests/rolldown-browser-execution.test.js',
  'tests/vite-c1-oracle.test.js',
  'tests/native-esm-publication.test.js',
  'tests/browser-esm-edge.test.js',
  'packages/process/src/browser-guest-worker.js','apps/playground/server.mjs'
];
for(const path of required)await access(resolve(path));
const root=JSON.parse(await readFile('package.json','utf8'));
if(root.engines?.node!=='24.21.0'||root.engines?.npm!=='11.19.0')throw new Error('Frozen Node/npm oracle changed');
const readme=await readFile('README.md','utf8');
if(!readme.includes('Not production-closed')&&!readme.includes('NOT production-closed'))throw new Error('README must retain production evidence boundary');
console.log('check: '+required.length+' required implementation artifacts present');
