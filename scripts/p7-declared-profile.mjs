import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const output=resolve(process.argv[2]??'.artifacts/p7-declared-profile/browser-receipt.json');

function browserVersion(){
  for(const command of ['google-chrome-stable','google-chrome','chromium','chromium-browser']){
    const result=spawnSync(command,['--version'],{encoding:'utf8'});
    if(result.status===0)return String(result.stdout||result.stderr).trim();
  }
  return null;
}

function run(command,args,{env=process.env,timeout=180000}={}){
  return new Promise((resolveRun,reject)=>{
    const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{
      try{child.kill('SIGKILL');}catch{}
      reject(new Error(command+' timed out\n'+stderr.slice(-8000)));
    },timeout);
    child.stdout.on('data',(chunk)=>{stdout+=String(chunk);process.stdout.write(chunk);});
    child.stderr.on('data',(chunk)=>{stderr+=String(chunk);process.stderr.write(chunk);});
    child.on('error',(error)=>{clearTimeout(timer);reject(error);});
    child.on('exit',(code)=>{
      clearTimeout(timer);
      if(code!==0)reject(new Error(command+' exited '+code+'\n'+stderr.slice(-12000)));
      else resolveRun({stdout,stderr});
    });
  });
}

function parseReceipt(stdout){
  const marker='browser acceptance PASS ';
  const index=stdout.lastIndexOf(marker);
  if(index<0)throw new Error('P7 browser receipt marker missing');
  return JSON.parse(stdout.slice(index+marker.length).trim());
}

function summary(values){
  const xs=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!xs.length)return null;
  return {
    samples:xs.length,
    minimum:xs[0],
    maximum:xs.at(-1),
    mean:Math.round((xs.reduce((a,b)=>a+b,0)/xs.length)*1000)/1000
  };
}

const exactBrowser=browserVersion();
if(exactBrowser!=='Google Chrome 153.0.8010.52'){
  throw new Error('P7 declared-profile court requires exact Chrome 153.0.8010.52; observed '+exactBrowser);
}

const runs=[];
for(let iteration=1;iteration<=2;iteration++){
  const result=await run(process.execPath,['scripts/browser-acceptance.mjs'],{
    env:{
      ...process.env,
      OPENCONTAINER_BROWSER_PAGE:'/p7-resource-profile.html',
      OPENCONTAINER_BROWSER_PORT:String(4210+iteration),
      OPENCONTAINER_BROWSER_ACCEPTANCE_TIMEOUT_MS:'90000'
    },
    timeout:120000
  });
  const receipt=parseReceipt(result.stdout);
  if(receipt.status!=='PASS')throw new Error('P7 declared-profile page did not pass');
  if(receipt.p7_02?.moduleResourceBytes<=0)throw new Error('P7-02 module bytes missing');
  if(receipt.p7_02?.moduleImportParseCompileEvaluateMs<=0)throw new Error('P7-02 module timing missing');
  if(receipt.p7_03?.packageGraphLocations<=0)throw new Error('P7-03 package graph measurement missing');
  if(receipt.p7_04?.concurrency!==4||receipt.p7_04?.requests!==64)throw new Error('P7-04 contention profile drifted');
  if(receipt.p7_04?.transferredBytes!==16*1024*1024)throw new Error('P7-04 transferred byte total drifted');
  if(!Object.values(receipt.p7_04?.finalGovernorUsage??{}).every((value)=>value===0)){
    throw new Error('P7-04 governor usage leaked');
  }
  runs.push({iteration,...receipt});
}

const receipt={
  schema:'opencontainer.p7-declared-profile-browser.v1.0',
  status:'PASS',
  source:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json',
  sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
  minimumClosure:'PASS-INTEGRATION + declared-profile evidence',
  declaredProfile:'desktop-chrome153-ubuntu2404-x64-ci',
  browser:exactBrowser,
  iterations:runs.length,
  passedIterations:runs.length,
  sourceGates:['P7-02','P7-03','P7-04'],
  runs,
  aggregates:{
    moduleResourceBytes:summary(runs.map((r)=>r.p7_02.moduleResourceBytes)),
    moduleImportParseCompileEvaluateMs:summary(runs.map((r)=>r.p7_02.moduleImportParseCompileEvaluateMs)),
    runtimeBootMs:summary(runs.map((r)=>r.p7_02.runtimeBootMs)),
    warmOpenMs:summary(runs.map((r)=>r.p7_03.warmOpenMs)),
    firstCommandMs:summary(runs.map((r)=>r.p7_03.firstCommandMs)),
    packageGraphLoadMs:summary(runs.map((r)=>r.p7_03.packageGraphLoadMs)),
    workerSpawnReadyMs:summary(runs.map((r)=>r.p7_04.workerSpawnReadyMs)),
    sustainedTransferMs:summary(runs.map((r)=>r.p7_04.sustainedTransferMs)),
    transferMiBPerSecond:summary(runs.map((r)=>r.p7_04.transferMiBPerSecond)),
    workerTeardownMs:summary(runs.map((r)=>r.p7_04.workerTeardownMs))
  },
  boundaries:{
    p7_01_referenceDeviceCampaign:false,
    p7_05_realisticViteEvidenceSeparate:true,
    p7_06_fullProductCoexistence:false,
    p7_09_eightHourPlateau:false,
    p7_10_sleepResumeCpuContention:false,
    p7_11_storageAmplification:false,
    p7_12_weakDeviceRegressionBudget:false,
    isolatedV8ParseCompileClaimed:false,
    crossBrowserClaimed:false,
    productionClosed:false
  }
};

await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
console.log('P7 DECLARED PROFILE COURT PASS '+JSON.stringify({
  gates:receipt.sourceGates,
  browser:receipt.browser,
  iterations:receipt.iterations,
  transferredMiB:runs[0].p7_04.transferredBytes/(1024*1024)
}));
