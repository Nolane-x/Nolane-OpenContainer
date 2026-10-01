import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem, hostname, platform, arch, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateEnvironment } from './p7-external-device-court.mjs';
import { computeProductSourceFingerprint } from './product-source-fingerprint.mjs';
import { computeWeakDeviceProtocolFingerprint } from './weak-device-protocol-fingerprint.mjs';

const PHASES=Object.freeze(['calibration','validation','soak-ui']);
const CALIBRATION_MIN_MINUTES=30;
const SOAK_MIN_MINUTES=480;

function parseArgs(argv){const out={};for(const item of argv){const m=String(item).match(/^--([^=]+)=(.*)$/);if(m)out[m[1]]=m[2];}return out;}
function browserVersion(){for(const command of ['google-chrome-stable','google-chrome','chromium','chromium-browser']){const r=spawnSync(command,['--version'],{encoding:'utf8'});if(r.status===0)return {command,version:String(r.stdout||r.stderr).trim()};}return null;}
function npmVersion(){const r=spawnSync('npm',['--version'],{encoding:'utf8'});return r.status===0?String(r.stdout).trim():null;}
function run(command,args,{env=process.env,timeoutMs}={}){return new Promise((resolveRun,reject)=>{const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}reject(new Error(command+' timed out\n'+stderr.slice(-12000)));},timeoutMs);child.stdout.on('data',x=>{stdout+=String(x);process.stdout.write(x);});child.stderr.on('data',x=>{stderr+=String(x);process.stderr.write(x);});child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',code=>{clearTimeout(timer);if(code!==0)reject(new Error(command+' exited '+code+'\n'+stderr.slice(-12000)));else resolveRun({stdout,stderr});});});}
function parseBrowserReceipt(stdout){const marker='browser acceptance PASS ';const i=stdout.lastIndexOf(marker);if(i<0)throw new Error('weak-device UI browser receipt marker missing');return JSON.parse(stdout.slice(i+marker.length).trim());}

export function validateUiRequest({phase,targetMemoryGiB,durationMinutes}){
  const errors=[];
  if(!PHASES.includes(phase))errors.push('unsupported UI phase '+phase);
  if(![4,8].includes(targetMemoryGiB))errors.push('target memory must be 4 or 8 GiB');
  if(!Number.isFinite(durationMinutes)||durationMinutes<=0)errors.push('duration must be positive');
  if((phase==='calibration'||phase==='validation')&&durationMinutes<CALIBRATION_MIN_MINUTES)errors.push('calibration/validation requires at least 30 minutes');
  if(phase==='soak-ui'&&durationMinutes<SOAK_MIN_MINUTES)errors.push('UI soak requires at least 480 minutes');
  return errors;
}

async function main(){
  const args=parseArgs(process.argv.slice(2));
  const phase=args.phase??process.env.OPENCONTAINER_UI_PHASE??'calibration';
  const targetMemoryGiB=Number(args['memory-gib']??process.env.OPENCONTAINER_REFERENCE_MEMORY_GIB??0);
  const durationMinutes=Number(args['duration-minutes']??process.env.OPENCONTAINER_UI_DURATION_MINUTES??(phase==='soak-ui'?480:30));
  const sampleIntervalSeconds=Number(args['sample-interval-seconds']??process.env.OPENCONTAINER_UI_SAMPLE_INTERVAL_SECONDS??30);
  const deviceId=String(args['device-id']??process.env.OPENCONTAINER_REFERENCE_DEVICE_ID??'').trim();
  const output=resolve(args.output??process.env.OPENCONTAINER_UI_OUTPUT??'.artifacts/weak-device-ui/receipt.json');

  const errors=validateUiRequest({phase,targetMemoryGiB,durationMinutes});
  if(!deviceId)errors.push('device-id is required');
  if(platform()!=='linux'||arch()!=='x64')errors.push('weak-device UI court requires Linux x64');

  const physicalMemoryBytes=totalmem();
  const browser=browserVersion();
  const npm=npmVersion();
  const envCheck=evaluateEnvironment({
    physicalMemoryBytes,effectiveMemoryBytes:physicalMemoryBytes,targetMemoryGiB,cgroupMemoryBytes:null,
    runnerEnvironment:process.env.RUNNER_ENVIRONMENT??null,nodeVersion:process.version,npmVersionValue:npm,
    browserVersionValue:browser?.version??null,githubActions:process.env.GITHUB_ACTIONS==='true'
  });
  errors.push(...envCheck.errors);
  const fingerprint=computeProductSourceFingerprint();
  const protocolFingerprint=computeWeakDeviceProtocolFingerprint();

  let browserSession=null,courtError=null;
  if(!errors.length){
    try{
      const durationMs=Math.round(durationMinutes*60*1000);
      const page='/weak-device-ui-sampler.html?'+new URLSearchParams({
        phase,durationMs:String(durationMs),sampleIntervalMs:String(Math.max(5000,Math.round(sampleIntervalSeconds*1000)))
      }).toString();
      const result=await run(process.execPath,['scripts/browser-acceptance.mjs'],{
        timeoutMs:durationMs+15*60*1000,
        env:{...process.env,OPENCONTAINER_BROWSER_PAGE:page,OPENCONTAINER_BROWSER_PORT:String(4500+targetMemoryGiB),OPENCONTAINER_BROWSER_ACCEPTANCE_TIMEOUT_MS:String(durationMs+10*60*1000)}
      });
      browserSession=parseBrowserReceipt(result.stdout);
    }catch(error){courtError=error?.message??String(error);}
  }
  if(courtError)errors.push(courtError);
  if(browserSession?.status&&browserSession.status!=='PASS')errors.push('UI browser session did not PASS');
  if(phase==='soak-ui'&&browserSession&&browserSession.durationObservedMs<SOAK_MIN_MINUTES*60*1000*0.99)errors.push('observed UI soak shorter than 8 hours');

  const receipt={
    schema:'opencontainer.weak-device-ui-run.v1.0',status:errors.length?'FAIL':'PASS',
    sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
    sourceCommit:process.env.GITHUB_SHA??null,workflowRunId:process.env.GITHUB_RUN_ID??null,
    productSourceFingerprint:fingerprint.sha256,productSourceFileCount:fingerprint.fileCount,measurementProtocolFingerprint:protocolFingerprint.sha256,
    phase,deviceId,targetMemoryGiB,durationMinutes,sampleIntervalSeconds,
    environment:{hostname:hostname(),platform:platform(),arch:arch(),osRelease:release(),logicalCpuCount:cpus().length,physicalMemoryBytes,node:process.version,npm,browser:browser?.version??null},
    browserSession,
    closureEligible:false,
    candidateGates:['P7-12','P9-12','P14-14'],
    boundaries:{budgetFrozen:false,budgetValidated:false,p7_12ClosedByThisRun:false,p9_12ClosedByThisRun:false,p14_14ClosedByThisRun:false,productionClosed:false},
    errors
  };
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
  console.log('WEAK DEVICE UI COURT '+receipt.status+' '+JSON.stringify({phase,deviceId,targetMemoryGiB,fingerprint:fingerprint.sha256,measurementProtocolFingerprint:protocolFingerprint.sha256,samples:browserSession?.sampleCount??0,closureEligible:false}));
  if(errors.length){for(const error of errors)console.error('weak-device-ui:',error);process.exitCode=1;}
}

const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
