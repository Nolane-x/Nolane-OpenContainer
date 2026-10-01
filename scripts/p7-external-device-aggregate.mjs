import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOAK_MIN_MS=480*60*1000;
const SOURCE_SHA='b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146';

function issue(errors,message){errors.push(message);}
function validateCommon(receipt,label,errors){
  if(!receipt||typeof receipt!=='object')return issue(errors,label+' receipt missing');
  if(receipt.schema!=='opencontainer.p7-external-device-run.v1.0')issue(errors,label+' schema drift');
  if(receipt.status!=='PASS')issue(errors,label+' did not PASS');
  if(receipt.sourceGateSha256!==SOURCE_SHA)issue(errors,label+' source gate hash drift');
  if(!receipt.sourceCommit)issue(errors,label+' source commit missing');
  if(receipt.closureEligible!==false)issue(errors,label+' illegally self-promoted closure');
  if(receipt.boundaries?.productionClosed!==false)issue(errors,label+' production boundary drift');
  if(receipt.browserSession?.status!=='PASS')issue(errors,label+' persistent browser session missing PASS');
}
export function aggregateCandidate({four,eight,soak,lifecycle}){
  const errors=[];
  validateCommon(four,'4 GiB',errors);
  validateCommon(eight,'8 GiB',errors);
  validateCommon(soak,'soak',errors);
  validateCommon(lifecycle,'lifecycle',errors);

  if(four?.mode!=='weak-device'||four?.targetMemoryGiB!==4)issue(errors,'4 GiB receipt must be weak-device mode on 4 GiB class');
  if(eight?.mode!=='weak-device'||eight?.targetMemoryGiB!==8)issue(errors,'8 GiB receipt must be weak-device mode on 8 GiB class');
  if(four?.deviceId&&eight?.deviceId&&four.deviceId===eight.deviceId)issue(errors,'4 GiB and 8 GiB reference receipts must use distinct device identities');

  if(soak?.mode!=='soak')issue(errors,'soak receipt mode drift');
  if(Number(soak?.durationMinutes)<480)issue(errors,'soak request shorter than 480 minutes');
  if(Number(soak?.browserSession?.durationObservedMs)<SOAK_MIN_MS*0.99)issue(errors,'observed persistent-browser soak shorter than 8-hour requirement');

  if(lifecycle?.mode!=='lifecycle')issue(errors,'lifecycle receipt mode drift');
  if(lifecycle?.cpuContention!==true)issue(errors,'lifecycle receipt lacks host CPU contention');
  if(lifecycle?.expectSuspend!==true)issue(errors,'lifecycle receipt did not require real suspend/resume');
  if((lifecycle?.browserSession?.suspendEvents?.length??0)<1)issue(errors,'lifecycle receipt lacks retained suspend/resume discontinuity');

  const receipts=[four,eight,soak,lifecycle].filter(Boolean);
  const commits=[...new Set(receipts.map(x=>x.sourceCommit).filter(Boolean))];
  if(commits.length!==1)issue(errors,'external-device receipts are not bound to one exact source commit');

  const result={
    schema:'opencontainer.p7-external-device-aggregate.v1.0',
    status:errors.length?'FAIL':'PASS',
    sourceGate:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P7',
    sourceGateSha256:SOURCE_SHA,
    sourceCommit:commits.length===1?commits[0]:null,
    inputs:{
      fourGiB:{deviceId:four?.deviceId??null,workflowRunId:four?.workflowRunId??null,samples:four?.browserSession?.sampleCount??0},
      eightGiB:{deviceId:eight?.deviceId??null,workflowRunId:eight?.workflowRunId??null,samples:eight?.browserSession?.sampleCount??0},
      soak:{deviceId:soak?.deviceId??null,workflowRunId:soak?.workflowRunId??null,durationObservedMs:soak?.browserSession?.durationObservedMs??0},
      lifecycle:{deviceId:lifecycle?.deviceId??null,workflowRunId:lifecycle?.workflowRunId??null,suspendEvents:lifecycle?.browserSession?.suspendEvents?.length??0}
    },
    candidateGateState:{
      'P7-01':errors.length?'BLOCKED_INVALID_EXTERNAL_EVIDENCE':'READY_FOR_REVIEW',
      'P7-09':errors.length?'BLOCKED_INVALID_EXTERNAL_EVIDENCE':'READY_FOR_REVIEW',
      'P7-10':errors.length?'BLOCKED_INVALID_EXTERNAL_EVIDENCE':'READY_FOR_REVIEW',
      'P7-12':'BLOCKED_BUDGET_FREEZE_AND_INDEPENDENT_VALIDATION',
      'P9-12':'BLOCKED_WEAK_DEVICE_UI_BUDGET_VALIDATION',
      'P14-14':'BLOCKED_WEAK_DEVICE_PERFORMANCE_BUDGET_VALIDATION'
    },
    readyForBudgetFreeze:errors.length===0,
    closureEligible:false,
    closureReason:'Aggregate external receipts may support reviewed promotion only after weak-device budgets are preregistered and independently validated where required. Aggregation never mutates the production ledger.',
    preservedOpenGates:['P7-01','P7-09','P7-10','P7-12','P9-12','P14-14'],
    productionClosed:false,
    errors
  };
  return result;
}

function parseArgs(argv){
  const out={};
  for(const item of argv){
    const match=String(item).match(/^--([^=]+)=(.*)$/);
    if(match)out[match[1]]=match[2];
  }
  return out;
}
async function readJson(path){return JSON.parse(await readFile(resolve(path),'utf8'));}
async function main(){
  const args=parseArgs(process.argv.slice(2));
  for(const key of ['four','eight','soak','lifecycle'])if(!args[key])throw new Error('--'+key+' receipt path is required');
  const [four,eight,soak,lifecycle]=await Promise.all([readJson(args.four),readJson(args.eight),readJson(args.soak),readJson(args.lifecycle)]);
  const result=aggregateCandidate({four,eight,soak,lifecycle});
  const output=resolve(args.output??'.artifacts/p7-external-device/aggregate.json');
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log('P7 EXTERNAL DEVICE AGGREGATE '+result.status+' '+JSON.stringify({sourceCommit:result.sourceCommit,readyForBudgetFreeze:result.readyForBudgetFreeze,closureEligible:false}));
  if(result.errors.length){for(const error of result.errors)console.error('P7 external-device aggregate:',error);process.exitCode=1;}
}
const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
