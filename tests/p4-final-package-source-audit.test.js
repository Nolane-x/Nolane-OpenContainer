import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const graph=readFileSync('packages/package-env/src/index.js','utf8');
const install=readFileSync('packages/package-env/src/frozen-install.js','utf8');
const artifact=readFileSync('packages/package-env/src/artifact-authority.js','utf8');
const fuzzCorpus=JSON.parse(readFileSync('compat/p4/PARSER-FUZZ-CORPUS.v1.0.json','utf8'));
const browserCourt=readFileSync('apps/playground/public/p4-final-package.js','utf8');
const page=readFileSync('apps/playground/public/p4-final-package.html','utf8');
const runner=readFileSync('scripts/p4-final-package.mjs','utf8');
const workflow=readFileSync('.github/workflows/ci.yml','utf8');
const boundary=readFileSync('docs/compatibility/P4-FINAL-PACKAGE-CLOSURE.md','utf8');

test('P4-07 retained fuzz corpus and typed parser failures remain production-bound',()=>{
  assert.equal(fuzzCorpus.schema,'opencontainer.p4-parser-fuzz-corpus.v1.0');
  assert.deepEqual(fuzzCorpus.targets.map(item=>item.id),['tar','gzip','manifest','lockfile']);
  assert.equal(fuzzCorpus.minimizedFailureInputs.length,8);
  assert.match(fuzzCorpus.retentionRule,/may only be removed/);
  assert.match(artifact,/Invalid or truncated gzip stream/);
  assert.match(install,/package\.json must be a JSON object/);
  assert.match(boundary,/never leak raw parser exceptions/);
});

test('P4-13 lifecycle scripts require an exact separate capability with no ambient secret handles',()=>{
  assert.match(install,/export class PackageScriptCapability/);
  assert.match(graph,/createPackageScriptCapability\(options=\{\}\)/);
  assert.match(install,/scriptGrantKey\(\{location,event,command\}\)/);
  assert.match(install,/lifecycleScripts === 'authorize'|lifecycleScripts==='authorize'/);
  assert.match(install,/Package lifecycle script lacks an exact capability grant/);
  assert.match(install,/env:Object\.freeze\(\{\}\)/);
  assert.match(install,/secretHandles:Object\.freeze\(\[\]\)/);
  assert.match(install,/networkSecretHandles:Object\.freeze\(\[\]\)/);
  assert.match(install,/Package installation does not accept network secret handles/);
  assert.match(boundary,/not host-shell authority/);
});

test('P4-15 package layout watcher is dedicated and does not claim generic fs.watch parity',()=>{
  assert.match(graph,/watchPackageLayout\(listener/);
  assert.match(graph,/reason=this\.#nodeModules===null\?'install':'reinstall'/);
  assert.match(graph,/unmountCatalog\(/);
  assert.match(graph,/graph-invalidated/);
  assert.match(browserCourt,/readdir\('\/workspace\/node_modules'\)/);
  assert.match(browserCourt,/realpath\('\/workspace\/node_modules\/ws\/index\.cjs'\)/);
  assert.match(boundary,/does \*\*not\*\* claim generic Node `fs\.watch`/);
});

test('P4-16 measurement court uses real tarballs and frozen realistic dependency trees',()=>{
  assert.match(runner,/published\.length===9/);
  assert.match(runner,/verifySri\(bytes,meta\.integrity\)/);
  assert.match(runner,/inspectTarArchive\(bytes,\{requiredPrefix:'package\/'\}\)/);
  assert.match(runner,/vite-react-tiny\.package-lock\.json/);
  assert.match(runner,/chokidar\.package-lock\.json/);
  assert.match(runner,/measureGraph\\(viteLockText,219\\)/);
  assert.match(runner,/measureGraph\\(chokidarLockText,8\\)/);
  assert.match(runner,/path:'raw-package-lock-text-to-graph'/);
  assert.match(runner,/thresholdClaimed:false/);
  assert.match(browserCourt,/measureGraph\(vite,219\)/);
  assert.match(browserCourt,/measureGraph\(chokidar,8\)/);
  assert.match(boundary,/not universal performance guarantees/);
});

test('final P4 browser court is retained in CI and covers exactly the four remaining gates',()=>{
  assert.match(page,/type="importmap"/);
  assert.match(page,/"es-module-lexer\/minimal\/js"/);
  assert.match(browserCourt,/sourceGates:Object\.freeze\(\['P4-07','P4-13','P4-15','P4-16'\]\)/);
  assert.match(runner,/process\.version==='v24\.21\.0'/);
  assert.match(runner,/OPENCONTAINER_P4_FINAL_PACKAGE_ITERATIONS\|\|2/);
  assert.match(workflow,/p4-final-package:/);
  assert.match(workflow,/npm run p4:final-package:evidence/);
});
