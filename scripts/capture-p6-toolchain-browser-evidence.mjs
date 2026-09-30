import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const outPath=resolve(process.argv[2]??'.artifacts/p6-toolchain-vite/browser-receipt.json');

function run(command,args,{timeout=180000}={}){
  return new Promise((resolveRun,reject)=>{
    const child=spawn(command,args,{env:process.env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{
      try{child.kill('SIGKILL');}catch{}
      reject(new Error(command+' timed out\n'+stderr.slice(-8000)));
    },timeout);
    child.stdout.on('data',chunk=>{stdout+=String(chunk);process.stdout.write(chunk);});
    child.stderr.on('data',chunk=>{stderr+=String(chunk);process.stderr.write(chunk);});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('exit',code=>{
      clearTimeout(timer);
      if(code!==0)reject(new Error(command+' exited '+code+'\n'+stderr.slice(-12000)));
      else resolveRun({stdout,stderr});
    });
  });
}

function chromeVersion(){
  for(const cmd of ['google-chrome-stable','google-chrome','chromium','chromium-browser']){
    const r=spawnSync(cmd,['--version'],{encoding:'utf8'});
    if(r.status===0)return (r.stdout||r.stderr).trim();
  }
  return null;
}

function parseAcceptance(stdout){
  const marker='browser acceptance PASS ';
  const index=stdout.lastIndexOf(marker);
  if(index<0)throw new Error('browser acceptance PASS marker missing');
  const raw=stdout.slice(index+marker.length).trim();
  try{return JSON.parse(raw);}catch(error){
    throw new Error('failed to parse browser acceptance receipt: '+error.message+'\n'+raw.slice(0,4000));
  }
}

function stageMap(acceptance){
  if(!Array.isArray(acceptance?.stages))throw new Error('browser acceptance stages missing');
  return new Map(acceptance.stages.map(item=>[item.name,item]));
}

function required(map,name){
  const value=map.get(name);
  if(!value)throw new Error('required browser stage missing: '+name);
  return value;
}

await run(process.execPath,[
  '--test',
  'tests/lightningcss-artifact.test.js',
  'tests/lightningcss-js-glue.test.js',
  'tests/rolldown-browser-artifact.test.js',
  'tests/rolldown-browser-execution.test.js',
  'tests/vite-c1-oracle.test.js',
  'tests/p6-toolchain-authority.test.js'
],{timeout:180000});

const browserRun=await run(process.execPath,['scripts/browser-acceptance.mjs'],{timeout:180000});
const acceptance=parseAcceptance(browserRun.stdout);
const stages=stageMap(acceptance);

const authority=required(stages,'p6-runtime-authority-pass');
if(authority.exactToolchainStatus!=='EXACT_PROFILE')throw new Error('exact toolchain profile did not pass');
if(authority.budgetFailureCode!=='OC_RESOURCE_EXHAUSTED')throw new Error('global ToolchainAuthority budget did not fail closed');
if(authority.versionSkewCode!=='OC_TOOLCHAIN_SKEW')throw new Error('version skew did not fail closed');
if(authority.digestMismatchCode!=='OC_DIGEST_MISMATCH')throw new Error('artifact substitution did not fail closed');
if(authority.unsupportedVersionCode!=='OC_TOOLCHAIN_UNSUPPORTED')throw new Error('unsupported version did not fail closed');
if(authority.genericWasiExpansionCode!=='OC_TOOLCHAIN_UNSUPPORTED')throw new Error('generic WASI expansion was implicitly admitted');
if(authority.sharedMemoryGrowCount<2||authority.sharedMemoryViewGeneration<2)throw new Error('shared-memory growth/rebind evidence incomplete');
if(authority.compiledModuleCompiles!==1||authority.compiledModuleWorkerClones!==2)throw new Error('compiled-module worker reuse evidence incomplete');

const lightning=required(stages,'lightningcss-direct-probe-pass');
const rolldown=required(stages,'rolldown-wasi-worker-preflight-pass');
const viteModule=required(stages,'vite-module-execution-pass');
const c1=required(stages,'vite-c1-build-pass');
const c2=required(stages,'vite-c2-hmr-pass');
const c2Http=required(stages,'vite-c2-http-pass');
const c2Preview=required(stages,'vite-c2-preview-edge-pass');
const c2Restart=required(stages,'vite-c2-restart-pass');
const c2Rehydrate=required(stages,'vite-c2-preview-rehydration-pass');
const c2DepOpt=required(stages,'vite-c2-dep-opt-pass');
const measurement=required(stages,'p6-toolchain-measurement-pass');
const realisticProject=required(stages,'p7-realistic-vite-project-profile');

if(viteModule.version!=='8.3.0'||viteModule.workerCrossOriginIsolated!==true)throw new Error('Vite browser module profile mismatch');
if(c1.failureAtomicity!==true||c1.packageGraphGenerationStable!==true||c1.packageLayoutIdentityStable!==true||c1.mapVersion!==3||c1.failureDiagnosticPath!==true)throw new Error('Vite C1 failure/source-map/package-state evidence incomplete');
if(!Array.isArray(c1.mapSources)||!c1.mapSources.some(x=>String(x).includes('src/main.ts')))throw new Error('Vite C1 source map lost TypeScript source');
if(c2.safeFailure!==true||c2.recovered!==true)throw new Error('Vite C2 HMR failure/recovery evidence incomplete');
if(measurement.compiledModuleCacheEvidence?.compiles!==1||measurement.compiledModuleCacheEvidence?.workerClones!==2)throw new Error('P6 cache measurement drifted');
if(!Array.isArray(measurement.heapSamples)||measurement.heapSamples.length<4)throw new Error('P6 heap-series measurement incomplete');
if(measurement.plateauThresholdClaimed!==false)throw new Error('P6 measurement must not manufacture a plateau threshold');

const receipt={
  schema:'opencontainer.p6-toolchain-vite-browser.v1.0',
  status:'PASS',
  source:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json',
  sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
  minimumClosure:'PASS-INTEGRATION + declared-profile evidence',
  declaredProfile:'desktop-chrome153-ubuntu2404-x64-ci',
  nodeVersion:process.version,
  browser:chromeVersion(),
  sourceGates:[
    'P6-01','P6-02','P6-03','P6-04','P6-05','P6-06',
    'P6-07','P6-08','P6-09',
    'P6-11','P6-12','P6-13','P6-14','P6-15','P6-16'
  ],
  intentionallyOpenGates:[{
    id:'P6-10',
    reason:'The frozen compatibility corpus contains vitest-monorepo only as an explicit pnpm/monorepo unsupported boundary; this court does not claim a real promoted Vitest execution.'
  }],
  localDifferential:{
    lightningCssRetainedArtifact:true,
    lightningCssNodeVsBrowserGlue:true,
    rolldownOfficialArtifactConcordance:true,
    rolldownDeterministicCodeSplitExecution:true,
    viteC1ExactNativeOracle:true,
    authorityUnitCourt:true
  },
  browser:{
    crossOriginIsolated:true,
    authority,
    lightningCss:lightning,
    rolldownWasi:rolldown,
    viteModule,
    c1,
    c2,
    c2Http,
    c2Preview,
    c2Restart,
    c2Rehydrate,
    c2DepOpt,
    measurement,
    realisticProject
  },
  boundaries:{
    genericWasiLinuxExpansionPromoted:false,
    vitestPromoted:false,
    crossBrowserClaimed:false,
    performanceThresholdClaimed:false,
    productionClosed:false
  }
};

await mkdir(dirname(outPath),{recursive:true});
await writeFile(outPath,JSON.stringify(receipt,null,2)+'\n');
console.log('P6 TOOLCHAIN/VITE BROWSER COURT PASS');
console.log(JSON.stringify({
  sourceGates:receipt.sourceGates.length,
  intentionallyOpen:receipt.intentionallyOpenGates.map(x=>x.id),
  browser:receipt.browser.browser,
  coldModuleStartMs:measurement.coldModuleStartMs,
  warmModuleStartMs:measurement.warmModuleStartMs,
  heapSamples:measurement.heapSamples,
  realisticProject
},null,2));
