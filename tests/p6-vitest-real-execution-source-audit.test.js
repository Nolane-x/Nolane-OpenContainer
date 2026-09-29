import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runner=readFileSync('scripts/p6-vitest-real-execution.mjs','utf8');
const fixture=readFileSync('compat/p6/vitest-smoke.test.ts','utf8');
const config=readFileSync('compat/p6/vitest.config.mjs','utf8');
const lock=JSON.parse(readFileSync('compat/p4/vite-react-tiny.package-lock.json','utf8'));

test('P6-10 source audit pins real Vitest 3.0.8 to the frozen lockfile artifact',()=>{
  const entry=lock.packages['node_modules/vitest'];
  assert.equal(entry.version,'3.0.8');
  assert.equal(entry.resolved,'https://registry.npmjs.org/vitest/-/vitest-3.0.8.tgz');
  assert.equal(entry.integrity,'sha512-dfqAsNqRGUc8hB9OVR2P0w8PZPEckti2+5rdZip0WIz9WW0MnImJ8XiR61QhqLa92EQzKP2uPkzenKOAHyEIbA==');
  assert.equal(entry.bin.vitest,'vitest.mjs');
  assert.ok(runner.includes("'view','vitest@3.0.8','dist.integrity','dist.tarball','--json'"));
  assert.ok(runner.includes("registry['dist.integrity']===frozen.integrity"));
  assert.ok(runner.includes("registry['dist.tarball']===frozen.resolved"));
});

test('P6-10 source audit requires real repeated Vitest TypeScript execution',()=>{
  assert.match(runner,/'exec','--yes','--package=vitest@3\.0\.8'/);
  assert.match(runner,/'vitest','run'/);
  assert.match(runner,/for\(let iteration=1;iteration<=2;iteration\+\+\)/);
  assert.match(runner,/totalAssertions===3/);
  assert.match(runner,/passed===3/);
  assert.match(runner,/failed===0/);
  assert.match(fixture,/type Point/);
  assert.match(fixture,/describe\('OpenContainer frozen Vitest compatibility fixture'/);
  assert.match(fixture,/async test execution/);
  assert.match(config,/globals:true/);
  assert.match(config,/environment:'node'/);
});

test('P6-10 evidence keeps unsupported pnpm monorepo boundary explicit',()=>{
  assert.match(runner,/vitestMonorepoPnpmPromoted:false/);
  assert.match(runner,/monorepoWorkspaceInstallPromoted:false/);
  assert.match(runner,/vitestRootMonorepoPnpmSupportClaimed:false/);
  assert.match(runner,/pnpmLockfileSupportClaimed:false/);
  assert.match(runner,/monorepoWorkspaceInstallClaimed:false/);
  assert.match(runner,/browserNativeVitestExecutionClaimed:false/);
  assert.match(runner,/productionClosed:false/);
});

test('P6-10 court is gated by the same-head declared-profile P6 Chrome job',()=>{
  const workflow=readFileSync('.github/workflows/ci.yml','utf8');
  assert.match(workflow,/p6-vitest-real-execution:\n    needs: \[contract, codeql, p6-toolchain-vite\]/);
  assert.doesNotMatch(runner,/capture-p6-toolchain-browser-evidence\.mjs/);
  assert.match(runner,/workflowJob:'p6-toolchain-vite'/);
  assert.match(runner,/sameExactHead:true/);
  assert.match(runner,/evidenceBinding:'workflow-needs'/);
});
