import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const required=[
  'packages/sdk/src/index.js','packages/kernel/src/index.js','packages/vfs/src/index.js','packages/process/src/index.js',
  'packages/package-env/src/index.js',
  'packages/package-env/src/resolver.js',
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
  'toolchain/artifacts/rolldown-wasi-1.2.9.json',
  'tests/runtime.test.js',
  'tests/resolver.test.js',
  'tests/node24-resolver-differential.test.js',
  'tests/commonjs-loader.test.js',
  'tests/frozen-install.test.js',
  'tests/node-core-builtins.test.js',
  'tests/runtime-builtins.test.js',
  'tests/package-command-bridge.test.js',
  'tests/wasm-artifact-manager.test.js','apps/playground/server.mjs'
];
for(const path of required)await access(resolve(path));
const root=JSON.parse(await readFile('package.json','utf8'));
if(root.engines?.node!=='24.21.0'||root.engines?.npm!=='11.19.0')throw new Error('Frozen Node/npm oracle changed');
const readme=await readFile('README.md','utf8');
if(!readme.includes('Not production-closed')&&!readme.includes('NOT production-closed'))throw new Error('README must retain production evidence boundary');
console.log('check: '+required.length+' required implementation artifacts present');
