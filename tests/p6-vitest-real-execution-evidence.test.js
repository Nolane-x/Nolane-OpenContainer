import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P6-VITEST-REAL-EXECUTION-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('P6-10 evidence binds exact frozen Vitest artifact and implementation CI',()=>{
  assert.equal(evidence.schema,'opencontainer.p6-vitest-real-execution-evidence.v1.0');
  assert.equal(evidence.gate,'P6-10');
  assert.equal(evidence.minimumClosure,'PASS-INTEGRATION + declared-profile evidence');
  assert.equal(evidence.pullRequest,68);
  assert.equal(evidence.implementation.head,'fbeadbdba914230edfbcc1ca0192631084065b07');
  assert.equal(evidence.implementation.ciRunNumber,896);
  assert.equal(evidence.implementation.ciRunId,36576004149);
  assert.equal(evidence.implementation.contract,'PASS');
  assert.equal(evidence.implementation.codeql,'PASS');
  assert.equal(evidence.implementation.unitTests,585);
  assert.equal(evidence.implementation.unitPassed,585);
  assert.equal(evidence.implementation.unitFailed,0);
  assert.equal(evidence.implementation.criticalTestFiles,90);
  assert.equal(evidence.implementation.criticalIterations,5);
  assert.equal(evidence.implementation.criticalTestFileExecutions,450);
  assert.equal(evidence.implementation.criticalUnexplainedFailures,0);
  assert.equal(evidence.implementation.companionP6ToolchainViteJob,'PASS');
  assert.equal(evidence.implementation.fullBrowserProductPath,'PASS');
});

test('P6-10 evidence proves real repeated Vitest execution and registry concordance',()=>{
  const court=evidence.dedicatedCourt;
  assert.equal(court.artifactId,11036952101);
  assert.equal(court.artifactDigest,'sha256:593565a62183990836985b1adbbbad486be17b5a54b7cf9b77384683e39cec14');
  assert.equal(court.status,'PASS');
  assert.equal(court.nodeVersion,'v24.21.0');
  assert.equal(court.npmVersion,'11.19.0');
  assert.equal(court.vitestVersion,'3.0.8');
  assert.equal(court.tarball,'https://registry.npmjs.org/vitest/-/vitest-3.0.8.tgz');
  assert.equal(court.integrity,'sha512-dfqAsNqRGUc8hB9OVR2P0w8PZPEckti2+5rdZip0WIz9WW0MnImJ8XiR61QhqLa92EQzKP2uPkzenKOAHyEIbA==');
  assert.equal(court.repeatedExecutions,2);
  assert.equal(court.testsPerExecution,3);
  assert.equal(court.totalTestsExecuted,6);
  assert.equal(court.totalTestsPassed,6);
  assert.equal(court.totalTestsFailed,0);
  assert.equal(court.fixtureLanguage,'TypeScript');
  assert.equal(evidence.declaredProfileRegression.workflowJob,'p6-toolchain-vite');
  assert.equal(evidence.declaredProfileRegression.sameExactHead,true);
  assert.equal(evidence.declaredProfileRegression.evidenceBinding,'workflow-needs');
  assert.equal(evidence.declaredProfileRegression.status,'PASS');
});

test('P6-10 closure keeps pnpm monorepo and browser-native claims outside scope',()=>{
  assert.equal(evidence.boundaries.vitestRootMonorepoPnpmSupportClaimed,false);
  assert.equal(evidence.boundaries.pnpmLockfileSupportClaimed,false);
  assert.equal(evidence.boundaries.monorepoWorkspaceInstallClaimed,false);
  assert.equal(evidence.boundaries.browserNativeVitestExecutionClaimed,false);
  assert.equal(evidence.boundaries.crossBrowserClaimed,false);
  assert.equal(evidence.boundaries.p6DomainClosed,true);
  assert.equal(evidence.boundaries.productionClosed,false);
});

test('P6-10 ledger promotion completes P6 16/16 without closing production globally',()=>{
  const row=ledger.overrides.find(item=>item.id==='P6-10');
  assert.deepEqual(row,{
    id:'P6-10',
    domain:'P6',
    state:'EVIDENCE',
    promotion:'PASS-INTEGRATION',
    evidence:'p6-vitest-real-execution',
    closure_met:true
  });
  assert.equal(ledger.overrides.length,250);
  assert.equal(ledger.overrides.filter(item=>item.closure_met===true).length,240);
  const p6=ledger.overrides.filter(item=>item.domain==='P6'&&item.closure_met===true);
  assert.equal(p6.length,16);
  assert.deepEqual(
    p6.map(item=>item.id).sort(),
    Array.from({length:16},(_,index)=>'P6-'+String(index+1).padStart(2,'0'))
  );
  assert.equal(ledger.production_closed,false);
});

test('P6-10 evidence is registered and retained in critical flake policy',()=>{
  const entry=registry.entries.find(item=>item.key==='p6-vitest-real-execution');
  assert.deepEqual(
    {kind:entry?.kind,level:entry?.level,status:entry?.status},
    {kind:'EXECUTABLE',level:'INTEGRATION',status:'PASS'}
  );
  for(const file of [
    'tests/p6-toolchain-vite-evidence.test.js',
    'tests/p6-vitest-real-execution-source-audit.test.js',
    'tests/p6-vitest-real-execution-evidence.test.js'
  ]) assert.ok(flake.contract.testFiles.includes(file),file);
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=90);
  assert.equal(flake.contract.iterations,5);
  assert.equal(flake.browser.iterations,2);
});
