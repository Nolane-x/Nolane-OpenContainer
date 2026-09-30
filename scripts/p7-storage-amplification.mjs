import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const output=resolve(process.argv[2]??'.artifacts/p7-storage-amplification/browser-receipt.json');

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
function parse(stdout){
  const marker='browser acceptance PASS ';
  const index=stdout.lastIndexOf(marker);
  if(index<0)throw new Error('P7 storage browser receipt marker missing');
  return JSON.parse(stdout.slice(index+marker.length).trim());
}
function summarize(values){
  const xs=values.map(Number).filter(Number.isFinite);
  return {
    samples:xs.length,
    minimum:Math.min(...xs),
    maximum:Math.max(...xs),
    mean:Math.round(xs.reduce((a,b)=>a+b,0)/xs.length*1e6)/1e6
  };
}

const browser=browserVersion();
if(browser!=='Google Chrome 153.0.8010.52'){
  throw new Error('P7 storage amplification court requires exact Chrome 153.0.8010.52; observed '+browser);
}

const runs=[];
for(let iteration=1;iteration<=2;iteration++){
  const result=await run(process.execPath,['scripts/browser-acceptance.mjs'],{
    env:{
      ...process.env,
      OPENCONTAINER_BROWSER_PAGE:'/p7-storage-amplification.html',
      OPENCONTAINER_BROWSER_PORT:String(4230+iteration),
      OPENCONTAINER_BROWSER_ACCEPTANCE_TIMEOUT_MS:'120000'
    },
    timeout:150000
  });
  const receipt=parse(result.stdout);
  if(receipt.status!=='PASS')throw new Error('P7 storage amplification page did not pass');
  if(receipt.temporaryTransactions?.cleanupReturnedToStable!==true)throw new Error('P7 transient storage did not return to stable');
  if(receipt.packages?.logicalArtifactBytes!==3826518)throw new Error('P7 package fixture drifted');
  if(receipt.packages?.storedBytes<receipt.packages.logicalArtifactBytes)throw new Error('P7 package persisted bytes are invalid');
  if(receipt.derivedCaches?.rebuildable!==true)throw new Error('P7 derived cache lost rebuildable classification');
  if(receipt.aggregate?.transientBytesExcludedFromSteadyState!==true)throw new Error('P7 steady-state accounting included transient bytes');
  runs.push({iteration,...receipt});
}

const receipt={
  schema:'opencontainer.p7-storage-amplification-browser.v1.0',
  status:'PASS',
  source:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json',
  sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
  minimumClosure:'PASS-INTEGRATION + declared-profile evidence',
  declaredProfile:'desktop-chrome153-ubuntu2404-x64-ci',
  browser,
  sourceGates:['P7-11'],
  iterations:runs.length,
  passedIterations:runs.length,
  runs,
  aggregates:{
    sourceLogicalBytes:summarize(runs.map(r=>r.source.logicalBytes)),
    checkpointStoredBytes:summarize(runs.map(r=>r.checkpoints.storedBytes)),
    transientStorageBytes:summarize(runs.map(r=>r.temporaryTransactions.transientStorageBytes)),
    packageStoredBytes:summarize(runs.map(r=>r.packages.storedBytes)),
    derivedStoredBytes:summarize(runs.map(r=>r.derivedCaches.storedBytes)),
    persistentStoredBytes:summarize(runs.map(r=>r.aggregate.persistentStoredBytes)),
    totalAmplification:summarize(runs.map(r=>r.aggregate.amplification))
  },
  boundaries:{
    filesystemAllocationOverheadClaimed:false,
    weakDeviceFloorClaimed:false,
    eightHourPlateauClaimed:false,
    regressionBudgetClaimed:false,
    crossBrowserClaimed:false,
    productionClosed:false
  }
};

await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
console.log('P7 STORAGE AMPLIFICATION PASS '+JSON.stringify({
  gate:'P7-11',
  browser,
  iterations:receipt.iterations,
  amplification:receipt.aggregates.totalAmplification
}));
