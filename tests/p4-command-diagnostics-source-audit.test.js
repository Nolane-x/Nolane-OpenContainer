import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const graph=readFileSync('packages/package-env/src/index.js','utf8');
const bridge=readFileSync('packages/package-env/src/command-bridge.js','utf8');
const resolver=readFileSync('packages/package-env/src/resolver.js','utf8');
const loader=readFileSync('packages/package-env/src/commonjs-loader.js','utf8');
const diagnostics=readFileSync('packages/diagnostics/src/index.js','utf8');
const browserCourt=readFileSync('apps/playground/public/p4-command-diagnostics.js','utf8');
const page=readFileSync('apps/playground/public/p4-command-diagnostics.html','utf8');
const runner=readFileSync('scripts/p4-command-diagnostics.mjs','utf8');
const workflow=readFileSync('.github/workflows/ci.yml','utf8');

test('P4 command graph retains contextual candidates and fail-closed resolution',()=>{
  assert.match(graph,/const binCandidates=\{\}/);
  assert.match(graph,/resolveBin\(command,\{cwd='\/workspace'\}=\{\}\)/);
  assert.match(graph,/Package command is ambiguous in current graph context/);
  assert.match(graph,/candidateCount|candidates/);
  assert.match(bridge,/this\.#packages\.resolveBin\(command,\{cwd\}\)/);
  assert.match(bridge,/contextual:true/);
  assert.match(bridge,/candidateCount:candidates\.length/);
});

test('P4 native addon boundary rejects generic alias bypass and requires exact adapter mapping',()=>{
  assert.match(resolver,/nativeAddonAdapters/);
  assert.match(resolver,/Native addon adapter source must be an exact \.node path/);
  assert.match(resolver,/Native addons require an explicit exact-path browser adapter/);
  assert.match(resolver,/context\.nativeAddonAdapters/);
  assert.match(resolver,/nativeAddonAdapter = Object\.freeze/);
  assert.match(loader,/nativeAddonAdapters/);
  assert.match(loader,/nativeAddonAdapters: this\.#nativeAddonAdapters/);
});

test('P4 package diagnostics expose provenance and policy without raw source secrets',()=>{
  assert.match(diagnostics,/safePackageSource/);
  assert.match(diagnostics,/url\.username=''/);
  assert.match(diagnostics,/url\.password=''/);
  assert.match(diagnostics,/url\.search=''/);
  assert.match(diagnostics,/url\.hash=''/);
  assert.match(diagnostics,/policy:'deny-by-default'/);
  assert.match(diagnostics,/policy:'deny-unless-exact-adapter'/);
  assert.match(diagnostics,/hasInstallScript/);
  assert.match(diagnostics,/layout:graph\.layout/);
});

test('P4 command diagnostics browser court is retained in CI',()=>{
  assert.match(page,/type="importmap"/);
  assert.match(page,/"es-module-lexer\/minimal\/js"/);
  assert.match(browserCourt,/sourceGates:Object\.freeze\(\['P4-14','P4-17','P4-18'\]\)/);
  assert.match(browserCourt,/genericAliasFailure.*NATIVE_ADDON_UNSUPPORTED/s);
  assert.match(browserCourt,/same-scope \.bin ambiguity did not fail closed/);
  assert.match(runner,/process\.version==='v24\.21\.0'/);
  assert.match(runner,/iterations=Number\(process\.env\.OPENCONTAINER_P4_COMMAND_DIAGNOSTICS_ITERATIONS\|\|2\)/);
  assert.match(workflow,/p4-command-diagnostics:/);
  assert.match(workflow,/npm run p4:command-diagnostics:evidence/);
});
