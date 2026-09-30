import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const output=resolve(process.argv[2]??'.artifacts/p7-wave4/browser-receipt.json');
function browserVersion(){
  for(const command of ['google-chrome-stable','google-chrome','chromium','chromium-browser']){
    const result=spawnSync(command,['--version'],{encoding:'utf8'});
    if(result.status===0)return String(result.stdout||result.stderr).trim();
  }
  return null;
}
function runChild(command,args,{env=process.env,timeout=180000}={}){
  return new Promise((resolveRun,reject)=>{
    const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}reject(new Error(command+' timed out\n'+stderr.slice(-8000)));},timeout);
    child.stdout.on('data',chunk=>{stdout+=String(chunk);process.stdout.write(chunk);});
    child.stderr.on('data',chunk=>{stderr+=String(chunk);process.stderr.write(chunk);});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('exit',code=>{clearTimeout(timer);if(code!==0)reject(new Error(command+' exited '+code+'\n'+stderr.slice(-12000)));else resolveRun({stdout,stderr});});
  });
}
function parseReceipt(stdout){
  const marker='browser acceptance PASS ';
  const index=stdout.lastIndexOf(marker);
  if(index<0)throw new Error('P7 wave4 browser receipt marker missing');
  return JSON.parse(stdout.slice(index+marker.length).trim());
}
function summary(values){
  const xs=values.map(Number).filter(Number.isFinite);
  if(!xs.length)return null;
  return {samples:xs.length,minimum:Math.min(...xs),maximum:Math.max(...xs),mean:xs.reduce((a,b)=>a+b,0)/xs.length};
}
const browser=browserVersion();
if(browser!=='Google Chrome 153.0.8010.52')throw new Error('P7 wave4 requires exact Chrome 153.0.8010.52; observed '+browser);
const runs=[];
for(let iteration=1;iteration<=2;iteration++){
  const result=await runChild(process.execPath,['scripts/browser-acceptance.mjs'],{
    env:{...process.env,OPENCONTAINER_BROWSER_PAGE:'/p7-resource-wave4.html',OPENCONTAINER_BROWSER_PORT:String(4230+iteration),OPENCONTAINER_BROWSER_ACCEPTANCE_TIMEOUT_MS:'120000'},
    timeout:150000
  });
  const receipt=parseReceipt(result.stdout);
  if(receipt.status!=='PASS')throw new Error('P7 wave4 page failed');
  for(const owner of ['ui','core:process','preview','toolchain','ai-consumer']){
    if(!(receipt.coexistence?.simultaneousOwners??[]).includes(owner))throw new Error('P7-06 missing owner '+owner);
  }
  if(!Object.values(receipt.coexistence?.finalUsage??{}).every(v=>v===0))throw new Error('P7-06 final governor usage leaked');
  if(!(receipt.storage?.totals?.steadyAmplification>0))throw new Error('P7-11 steady amplification missing');
  if(!(receipt.storage?.tempTransactions?.transientBytes>0)||receipt.storage?.tempTransactions?.reclaimed!==true)throw new Error('P7-11 temp transaction evidence incomplete');
  runs.push({iteration,...receipt});
}
const receipt={
  schema:'opencontainer.p7-wave4-browser.v1.0',status:'PASS',
  source:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json',
  sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
  minimumClosure:'PASS-INTEGRATION + declared-profile evidence',
  declaredProfile:'desktop-chrome153-ubuntu2404-x64-ci',browser,
  iterations:runs.length,passedIterations:runs.length,sourceGates:['P7-06','P7-11'],runs,
  aggregates:{
    steadyAmplification:summary(runs.map(r=>r.storage.totals.steadyAmplification)),
    transientPeakAmplification:summary(runs.map(r=>r.storage.totals.transientPeakAmplification)),
    tempTransactionBytes:summary(runs.map(r=>r.storage.tempTransactions.transientBytes)),
    packagePhysicalBytes:summary(runs.map(r=>r.storage.packages.physicalPersistentBytes)),
    sourceSnapshotPhysicalBytes:summary(runs.map(r=>r.storage.source.snapshotPhysicalBytes))
  },
  boundaries:{
    p7_01_referenceDeviceCampaign:false,p7_09_eightHourPlateau:false,p7_10_systemSleepResume:false,
    p7_12_weakDeviceRegressionBudget:false,filesystemAllocationMetadataClaimed:false,
    crossBrowserClaimed:false,productionClosed:false
  }
};
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
console.log('P7 WAVE4 COURT PASS '+JSON.stringify({browser,iterations:runs.length,gates:receipt.sourceGates}));
