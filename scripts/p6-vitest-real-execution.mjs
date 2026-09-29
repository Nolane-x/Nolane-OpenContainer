import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root=resolve('.');
const output=resolve(process.argv[2]??'.artifacts/p6-vitest-real-execution/evidence.json');
const lockPath=resolve('compat/p4/vite-react-tiny.package-lock.json');
const vitestResult=resolve('.artifacts/p6-vitest-real-execution/vitest-result.json');

function assert(condition,message,details={}){
  if(condition)return;
  const error=new Error(message);
  error.details=details;
  throw error;
}

function run(command,args,{timeout=180000,env={}}={}){
  const result=spawnSync(command,args,{
    cwd:root,
    env:{...process.env,...env},
    encoding:'utf8',
    timeout,
    maxBuffer:32*1024*1024
  });
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  if(result.error)throw result.error;
  assert(result.status===0,command+' failed',{args,status:result.status,stderr:result.stderr?.slice(-12000)});
  return result;
}

assert(process.version==='v24.21.0','P6-10 Vitest court requires exact Node v24.21.0',{actual:process.version});

const npmVersion=run('npm',['--version']).stdout.trim();
assert(npmVersion==='11.19.0','P6-10 Vitest court requires exact npm 11.19.0',{actual:npmVersion});

const lock=JSON.parse(await readFile(lockPath,'utf8'));
const frozen=lock.packages?.['node_modules/vitest'];
assert(frozen,'Frozen Vite lockfile does not contain Vitest');
assert(frozen.version==='3.0.8','Frozen Vitest version drifted',{version:frozen.version});
assert(
  frozen.resolved==='https://registry.npmjs.org/vitest/-/vitest-3.0.8.tgz',
  'Frozen Vitest tarball URL drifted',
  {resolved:frozen.resolved}
);
assert(
  frozen.integrity==='sha512-dfqAsNqRGUc8hB9OVR2P0w8PZPEckti2+5rdZip0WIz9WW0MnImJ8XiR61QhqLa92EQzKP2uPkzenKOAHyEIbA==',
  'Frozen Vitest SRI drifted',
  {integrity:frozen.integrity}
);
assert(frozen.bin?.vitest==='vitest.mjs','Frozen Vitest CLI entry drifted',{bin:frozen.bin});

const registryRaw=run('npm',[
  'view','vitest@3.0.8','dist.integrity','dist.tarball','--json'
],{timeout:60000}).stdout.trim();
const registry=JSON.parse(registryRaw);
assert(registry['dist.integrity']===frozen.integrity,'Registry Vitest SRI disagrees with frozen lockfile',{
  registry:registry['dist.integrity'],
  frozen:frozen.integrity
});
assert(registry['dist.tarball']===frozen.resolved,'Registry Vitest tarball disagrees with frozen lockfile',{
  registry:registry['dist.tarball'],
  frozen:frozen.resolved
});

const versionRun=run('npm',[
  'exec','--yes','--package=vitest@3.0.8','--','vitest','--version'
],{timeout:120000});
const versionText=(versionRun.stdout+'\n'+versionRun.stderr).trim();
assert(/vitest\/?\s*3\.0\.8|vitest\/3\.0\.8|vitest 3\.0\.8/i.test(versionText),'Real Vitest CLI version output did not prove 3.0.8',{versionText});

await mkdir(dirname(vitestResult),{recursive:true});
const executions=[];
for(let iteration=1;iteration<=2;iteration++){
  await rm(vitestResult,{force:true});
  const started=performance.now();
  run('npm',[
    'exec','--yes','--package=vitest@3.0.8','--',
    'vitest','run',
    '--config','compat/p6/vitest.config.mjs',
    '--globals',
    '--reporter=json',
    '--outputFile',vitestResult
  ],{
    timeout:180000,
    env:{
      OPENCONTAINER_P6_VITEST_ITERATION:String(iteration),
      CI:'true'
    }
  });
  const elapsedMs=performance.now()-started;
  const result=JSON.parse(await readFile(vitestResult,'utf8'));
  const assertions=(result.testResults??[]).flatMap(file=>file.assertionResults??[]);
  const passedAssertions=assertions.filter(item=>item.status==='passed').length;
  const failedAssertions=assertions.filter(item=>item.status==='failed').length;
  const totalAssertions=assertions.length||Number(result.numTotalTests??0);
  const passed=passedAssertions||Number(result.numPassedTests??0);
  const failed=failedAssertions||Number(result.numFailedTests??0);
  assert(result.success===true,'Real Vitest JSON reporter did not report success',{iteration,result});
  assert(totalAssertions===3,'Real Vitest fixture test count drifted',{iteration,totalAssertions,result});
  assert(passed===3,'Real Vitest fixture did not pass all tests',{iteration,passed,result});
  assert(failed===0,'Real Vitest fixture reported failures',{iteration,failed,result});
  executions.push(Object.freeze({
    iteration,
    elapsedMs,
    success:true,
    totalTests:totalAssertions,
    passedTests:passed,
    failedTests:failed,
    testFiles:(result.testResults??[]).map(file=>file.name??file.testFilePath??null).filter(Boolean)
  }));
}

const companionP6BrowserJob=Object.freeze({
  required:true,
  workflowJob:'p6-toolchain-vite',
  sameExactHead:true,
  evidenceBinding:'workflow-needs'
});

const receipt=Object.freeze({
  schema:'opencontainer.p6-vitest-real-execution.v1.0',
  status:'PASS',
  source:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json',
  sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
  gate:'P6-10',
  minimumClosure:'PASS-INTEGRATION + declared-profile evidence',
  nodeVersion:process.version,
  npmVersion,
  frozenFixture:Object.freeze({
    sourceLockfile:'compat/p4/vite-react-tiny.package-lock.json',
    package:'vitest',
    version:frozen.version,
    resolved:frozen.resolved,
    integrity:frozen.integrity,
    cli:frozen.bin.vitest,
    originalCorpusBoundary:Object.freeze({
      vitestMonorepoPnpmPromoted:false,
      monorepoWorkspaceInstallPromoted:false
    })
  }),
  registryConcordance:Object.freeze({
    tarball:registry['dist.tarball'],
    integrity:registry['dist.integrity'],
    exact:true
  }),
  realVitest:Object.freeze({
    versionOutput:versionText,
    fixture:'compat/p6/vitest-smoke.test.ts',
    config:'compat/p6/vitest.config.mjs',
    language:'TypeScript',
    executions:Object.freeze(executions),
    repeatedPasses:executions.length,
    totalTestsPerRun:3
  }),
  declaredProfileRegression:companionP6BrowserJob,
  boundaries:Object.freeze({
    vitestRootMonorepoPnpmSupportClaimed:false,
    pnpmLockfileSupportClaimed:false,
    monorepoWorkspaceInstallClaimed:false,
    browserNativeVitestExecutionClaimed:false,
    productionClosed:false
  })
});

await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
console.log('P6-10 REAL VITEST EXECUTION PASS '+JSON.stringify({
  version:frozen.version,
  runs:executions.length,
  testsPerRun:3,
  companionP6BrowserJob:receipt.declaredProfileRegression.workflowJob
}));
