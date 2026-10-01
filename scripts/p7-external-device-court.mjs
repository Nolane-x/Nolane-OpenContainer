import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { cpus, totalmem, hostname, platform, arch, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOAK_MIN_MINUTES=480;
export const MEMORY_CLASSES=Object.freeze({
  4:Object.freeze({minimumBytes:3221225472,maximumBytes:5368709120}),
  8:Object.freeze({minimumBytes:6442450944,maximumBytes:10737418240})
});
export const MODES=Object.freeze(['weak-device','soak','lifecycle']);

function readOptional(path){try{return readFileSync(path,'utf8').trim();}catch{return null;}}
function parseMemTotal(){
  const raw=readOptional('/proc/meminfo');
  const match=raw?.match(/^MemTotal:\s+(\d+)\s+kB$/m);
  return match?Number(match[1])*1024:totalmem();
}
function parseCgroupLimit(){
  for(const path of ['/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory/memory.limit_in_bytes']){
    const raw=readOptional(path);
    if(!raw||raw==='max')continue;
    const value=Number(raw);
    if(Number.isFinite(value)&&value>0&&value<2**60)return value;
  }
  return null;
}
export function classifyMemory(bytes){
  for(const [label,range] of Object.entries(MEMORY_CLASSES)){
    if(bytes>=range.minimumBytes&&bytes<=range.maximumBytes)return Number(label);
  }
  return null;
}
export function validateRequest({mode,targetMemoryGiB,durationMinutes,cpuContention,expectSuspend}){
  const errors=[];
  if(!MODES.includes(mode))errors.push('unsupported mode '+mode);
  if(![4,8].includes(targetMemoryGiB))errors.push('target memory must be 4 or 8 GiB');
  if(!Number.isFinite(durationMinutes)||durationMinutes<=0)errors.push('duration must be positive');
  if(mode==='soak'&&durationMinutes<SOAK_MIN_MINUTES)errors.push('soak evidence requires at least '+SOAK_MIN_MINUTES+' minutes');
  if(mode==='lifecycle'&&!expectSuspend)errors.push('lifecycle evidence requires a real suspend/resume event');
  if(mode==='lifecycle'&&!cpuContention)errors.push('lifecycle evidence requires host CPU contention');
  return errors;
}
function browserVersion(){
  for(const command of ['google-chrome-stable','google-chrome','chromium','chromium-browser']){
    const result=spawnSync(command,['--version'],{encoding:'utf8'});
    if(result.status===0)return {command,version:String(result.stdout||result.stderr).trim()};
  }
  return null;
}
function npmVersion(){
  const result=spawnSync('npm',['--version'],{encoding:'utf8'});
  return result.status===0?String(result.stdout).trim():null;
}
function parseArgs(argv){
  const args={};
  for(const entry of argv){
    const match=String(entry).match(/^--([^=]+)=(.*)$/);
    if(match)args[match[1]]=match[2];
  }
  return args;
}
function run(command,args,{env=process.env,timeoutMs}={}){
  return new Promise((resolveRun,reject)=>{
    const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{
      try{child.kill('SIGKILL');}catch{}
      reject(new Error(command+' timed out\n'+stderr.slice(-12000)));
    },timeoutMs);
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
function parseBrowserReceipt(stdout){
  const marker='browser acceptance PASS ';
  const index=stdout.lastIndexOf(marker);
  if(index<0)throw new Error('external-device browser receipt marker missing');
  return JSON.parse(stdout.slice(index+marker.length).trim());
}
function startCpuContention(){
  const count=Math.max(1,Math.min(Math.max(1,cpus().length-1),Math.ceil(cpus().length*0.75)));
  const children=[];
  for(let index=0;index<count;index++){
    children.push(spawn(process.execPath,['-e',"let x=0;for(;;){x=(x+Math.sqrt((x%100000)+1))%1000000}"],{stdio:'ignore'}));
  }
  return children;
}
async function stopChildren(children){
  for(const child of children){try{child.kill('SIGTERM');}catch{}}
  await new Promise(resolve=>setTimeout(resolve,250));
  for(const child of children){if(child.exitCode===null){try{child.kill('SIGKILL');}catch{}}}
}
export function evaluateEnvironment({physicalMemoryBytes,effectiveMemoryBytes,targetMemoryGiB,cgroupMemoryBytes,runnerEnvironment,nodeVersion,npmVersionValue,browserVersionValue,githubActions=false}){
  const errors=[];
  const observedClass=classifyMemory(effectiveMemoryBytes);
  if(observedClass!==targetMemoryGiB)errors.push('effective memory does not match requested '+targetMemoryGiB+' GiB reference class');
  const physicalClass=classifyMemory(physicalMemoryBytes);
  if(physicalClass!==targetMemoryGiB)errors.push('physical/VM memory does not match requested reference class');
  if(cgroupMemoryBytes&&physicalMemoryBytes>0&&(effectiveMemoryBytes/physicalMemoryBytes)<0.9){
    errors.push('synthetic cgroup/container down-cap cannot qualify as reference-device memory evidence');
  }
  if(githubActions&&runnerEnvironment!=='self-hosted')errors.push('GitHub Actions evidence must run on self-hosted runner');
  if(nodeVersion!=='v24.21.0')errors.push('Node version must be v24.21.0');
  if(npmVersionValue!=='11.19.0')errors.push('npm version must be 11.19.0');
  if(browserVersionValue!=='Google Chrome 153.0.8010.52')errors.push('browser must be frozen Google Chrome 153.0.8010.52');
  return {errors,observedClass,physicalClass};
}

async function main(){
  const args=parseArgs(process.argv.slice(2));
  const mode=args.mode??process.env.OPENCONTAINER_DEVICE_MODE??'weak-device';
  const targetMemoryGiB=Number(args['memory-gib']??process.env.OPENCONTAINER_REFERENCE_MEMORY_GIB??0);
  const defaultMinutes=mode==='soak'?SOAK_MIN_MINUTES:(mode==='lifecycle'?20:30);
  const durationMinutes=Number(args['duration-minutes']??process.env.OPENCONTAINER_DEVICE_DURATION_MINUTES??defaultMinutes);
  const sampleIntervalSeconds=Number(args['sample-interval-seconds']??process.env.OPENCONTAINER_DEVICE_SAMPLE_INTERVAL_SECONDS??60);
  const cpuContention=String(args['cpu-contention']??process.env.OPENCONTAINER_CPU_CONTENTION??'false')==='true';
  const expectSuspend=String(args['expect-suspend']??process.env.OPENCONTAINER_EXPECT_REAL_SUSPEND??String(mode==='lifecycle'))==='true';
  const deviceId=String(args['device-id']??process.env.OPENCONTAINER_REFERENCE_DEVICE_ID??'').trim();
  const output=resolve(args.output??process.env.OPENCONTAINER_DEVICE_OUTPUT??'.artifacts/p7-external-device/receipt.json');

  const requestErrors=validateRequest({mode,targetMemoryGiB,durationMinutes,cpuContention,expectSuspend});
  if(!deviceId)requestErrors.push('OPENCONTAINER_REFERENCE_DEVICE_ID/device-id is required');
  if(platform()!=='linux'||arch()!=='x64')requestErrors.push('current external-device harness requires Linux x64');

  const physicalMemoryBytes=parseMemTotal();
  const cgroupMemoryBytes=parseCgroupLimit();
  const effectiveMemoryBytes=cgroupMemoryBytes?Math.min(physicalMemoryBytes,cgroupMemoryBytes):physicalMemoryBytes;
  const browser=browserVersion();
  const npm=npmVersion();
  const environment=evaluateEnvironment({
    physicalMemoryBytes,effectiveMemoryBytes,targetMemoryGiB,cgroupMemoryBytes,
    runnerEnvironment:process.env.RUNNER_ENVIRONMENT??null,nodeVersion:process.version,
    npmVersionValue:npm,browserVersionValue:browser?.version??null,githubActions:process.env.GITHUB_ACTIONS==='true'
  });
  const preflightErrors=[...requestErrors,...environment.errors];

  const startedAt=new Date().toISOString();
  let browserReceipt=null,courtError=null,contention=[];
  if(!preflightErrors.length){
    try{
      if(cpuContention)contention=startCpuContention();
      const durationMs=Math.round(durationMinutes*60*1000);
      const timeoutMs=durationMs+15*60*1000;
      const page='/p7-external-device.html?'+new URLSearchParams({
        mode,durationMs:String(durationMs),sampleIntervalMs:String(Math.max(1000,Math.round(sampleIntervalSeconds*1000))),
        expectSuspend:expectSuspend?'1':'0',minimumSuspendGapMs:'15000'
      }).toString();
      const result=await run(process.execPath,['scripts/browser-acceptance.mjs'],{
        timeoutMs,
        env:{...process.env,OPENCONTAINER_BROWSER_PAGE:page,OPENCONTAINER_BROWSER_PORT:String(4300+(targetMemoryGiB||0)),OPENCONTAINER_BROWSER_ACCEPTANCE_TIMEOUT_MS:String(durationMs+10*60*1000)}
      });
      browserReceipt=parseBrowserReceipt(result.stdout);
    }catch(error){courtError=error?.message??String(error);}
    finally{await stopChildren(contention);}
  }

  const postErrors=[];
  if(courtError)postErrors.push(courtError);
  if(browserReceipt?.status&&browserReceipt.status!=='PASS')postErrors.push('browser session did not PASS');
  if(mode==='soak'&&browserReceipt&&browserReceipt.durationObservedMs<SOAK_MIN_MINUTES*60*1000*0.99)postErrors.push('observed soak duration is below the 8-hour requirement');
  if(mode==='lifecycle'&&browserReceipt&&(browserReceipt.suspendEvents?.length??0)<1)postErrors.push('lifecycle run did not retain a real suspend/resume discontinuity');

  const errors=[...preflightErrors,...postErrors];
  const receipt={
    schema:'opencontainer.p7-external-device-run.v1.0',status:errors.length?'FAIL':'PASS',
    sourceGate:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P7',sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
    startedAt,finishedAt:new Date().toISOString(),mode,deviceId,targetMemoryGiB,durationMinutes,sampleIntervalSeconds,cpuContention,expectSuspend,
    environment:{
      hostname:hostname(),platform:platform(),arch:arch(),osRelease:release(),logicalCpuCount:cpus().length,
      cpuModels:[...new Set(cpus().map(cpu=>cpu.model))],physicalMemoryBytes,cgroupMemoryBytes,effectiveMemoryBytes,
      physicalMemoryClassGiB:environment.physicalClass,effectiveMemoryClassGiB:environment.observedClass,
      runnerEnvironment:process.env.RUNNER_ENVIRONMENT??null,node:process.version,npm,browser:browser?.version??null
    },
    browserSession:browserReceipt,
    candidateGates:mode==='weak-device'?['P7-01','P7-12','P9-12','P14-14']:(mode==='soak'?['P7-09','P9-12']:['P7-10']),
    closureEligible:false,
    closureReason:'Per-device external receipts require retained cross-device aggregation, preregistered weak-device budgets plus independent validation where applicable, and reviewed ledger reconciliation. This run never self-promotes a gate.',
    boundaries:{syntheticMemoryCapAccepted:false,shortSoakAccepted:false,visibilityOnlyLifecycleAccepted:false,singleCalibrationClosesBudgetGate:false,p7ClosedByThisRun:false,p9_12ClosedByThisRun:false,p14_14ClosedByThisRun:false,productionClosed:false},
    errors
  };
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
  console.log('P7 EXTERNAL DEVICE COURT '+receipt.status+' '+JSON.stringify({mode,deviceId,memoryGiB:targetMemoryGiB,samples:browserReceipt?.sampleCount??0,suspendEvents:browserReceipt?.suspendEvents?.length??0,closureEligible:false}));
  if(errors.length){for(const error of errors)console.error('P7 external-device:',error);process.exitCode=1;}
}

const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
