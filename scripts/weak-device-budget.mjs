import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LATENCY_METRICS=['viewSwitchP95Ms','aiModeSwitchP95Ms','saveCanonicalP95Ms','processRunP95Ms','cycleP95Ms'];
const MARGINS=Object.freeze({viewSwitchP95Ms:2,aiModeSwitchP95Ms:2,saveCanonicalP95Ms:20,processRunP95Ms:20,cycleP95Ms:25});
const MIB=1024*1024;

function assertReceipt(receipt,label,errors){
  if(!receipt||receipt.schema!=='opencontainer.weak-device-ui-run.v1.0')errors.push(label+' receipt schema invalid');
  else{
    if(receipt.status!=='PASS')errors.push(label+' receipt did not PASS');
    if(!receipt.productSourceFingerprint)errors.push(label+' productSourceFingerprint missing');
    if(!receipt.deviceId)errors.push(label+' deviceId missing');
    if(!receipt.workflowRunId)errors.push(label+' workflowRunId missing');
    if(receipt.closureEligible!==false)errors.push(label+' illegally self-promoted closure');
    if(receipt.browserSession?.status!=='PASS')errors.push(label+' browser session missing PASS');
  }
}
function metric(receipt,key){return Number(receipt?.browserSession?.aggregates?.[key]);}
function ceil(value){return Math.ceil(Number(value));}
function latencyBudget(receipts,key){return ceil(Math.max(...receipts.map(x=>metric(x,key)))*1.35+MARGINS[key]);}
function heapSlopeBudget(receipts){
  const maxSlope=Math.max(0,...receipts.map(x=>metric(x,'heapSlopeBytesPerHour')).filter(Number.isFinite));
  return ceil(Math.max(8*MIB,maxSlope*1.5+2*MIB));
}
function heapPeakBudget(receipts){
  const maxPeak=Math.max(...receipts.map(x=>metric(x,'heapPeakBytes')).filter(Number.isFinite));
  return ceil(maxPeak*1.25+16*MIB);
}
function checkMetricFinite(receipts,label,errors){
  for(const [i,r] of receipts.entries()){
    for(const key of [...LATENCY_METRICS,'heapSlopeBytesPerHour','heapPeakBytes']){
      if(!Number.isFinite(metric(r,key)))errors.push(label+'['+i+'] metric '+key+' missing/non-finite');
    }
  }
}
export function freezeBudget(receipts){
  const errors=[];
  if(!Array.isArray(receipts))return {status:'FAIL',errors:['receipts must be an array']};
  for(const [i,r] of receipts.entries())assertReceipt(r,'calibration['+i+']',errors);
  const fingerprints=[...new Set(receipts.map(x=>x?.productSourceFingerprint).filter(Boolean))];
  if(fingerprints.length!==1)errors.push('calibration receipts must share one product-source fingerprint');
  const runIds=receipts.map(x=>String(x?.workflowRunId??'')).filter(Boolean);
  if(new Set(runIds).size!==runIds.length)errors.push('calibration workflow runs must be unique');

  const byClass={4:receipts.filter(x=>x?.targetMemoryGiB===4&&x?.phase==='calibration'),8:receipts.filter(x=>x?.targetMemoryGiB===8&&x?.phase==='calibration')};
  for(const cls of [4,8]){
    if(byClass[cls].length<2)errors.push(cls+' GiB requires at least 2 calibration receipts');
    if(byClass[cls].some(x=>Number(x.durationMinutes)<30))errors.push(cls+' GiB calibration shorter than 30 minutes');
    checkMetricFinite(byClass[cls],cls+'GiB',errors);
  }
  if(errors.length)return {schema:'opencontainer.weak-device-budget.v1.0',status:'FAIL',errors,closureEligible:false,productionClosed:false};

  const budgets={};
  for(const cls of [4,8]){
    const rows=byClass[cls];
    budgets[cls+'GiB']={
      latency:Object.fromEntries(LATENCY_METRICS.map(key=>[key,latencyBudget(rows,key)])),
      heapSlopeBytesPerHour:heapSlopeBudget(rows),
      heapPeakBytes:heapPeakBudget(rows),
      calibrationRuns:rows.map(x=>({workflowRunId:String(x.workflowRunId),deviceId:x.deviceId,sourceCommit:x.sourceCommit??null}))
    };
  }
  return {
    schema:'opencontainer.weak-device-budget.v1.0',status:'FROZEN',
    productSourceFingerprint:fingerprints[0],
    formula:{latencyMultiplier:1.35,fixedMarginsMs:MARGINS,heapSlopeMultiplier:1.5,heapSlopeFixedMarginBytesPerHour:2*MIB,heapSlopeFloorBytesPerHour:8*MIB,heapPeakMultiplier:1.25,heapPeakFixedMarginBytes:16*MIB},
    budgets,
    calibrationDeviceIds:[...new Set(receipts.map(x=>x.deviceId))].sort(),
    calibrationWorkflowRunIds:runIds.sort(),
    candidateGates:['P7-12','P9-12','P14-14'],
    validationRequired:true,closureEligible:false,productionClosed:false,errors:[]
  };
}
function compareReceipt(receipt,budget,label,errors){
  for(const key of LATENCY_METRICS){
    const value=metric(receipt,key),limit=Number(budget.latency[key]);
    if(!Number.isFinite(value))errors.push(label+' '+key+' missing');
    else if(value>limit)errors.push(label+' '+key+' regression '+value+' > '+limit);
  }
  const slope=metric(receipt,'heapSlopeBytesPerHour');
  if(!Number.isFinite(slope))errors.push(label+' heapSlopeBytesPerHour missing');
  else if(slope>budget.heapSlopeBytesPerHour)errors.push(label+' heap slope regression '+slope+' > '+budget.heapSlopeBytesPerHour);
  const peak=metric(receipt,'heapPeakBytes');
  if(!Number.isFinite(peak))errors.push(label+' heapPeakBytes missing');
  else if(peak>budget.heapPeakBytes)errors.push(label+' heap peak regression '+peak+' > '+budget.heapPeakBytes);
}
export function validateBudgetEvidence({budget,validationReceipts,uiSoakReceipt}){
  const errors=[];
  if(budget?.schema!=='opencontainer.weak-device-budget.v1.0'||budget?.status!=='FROZEN')errors.push('budget is not frozen');
  const receipts=Array.isArray(validationReceipts)?validationReceipts:[];
  for(const [i,r] of receipts.entries())assertReceipt(r,'validation['+i+']',errors);
  assertReceipt(uiSoakReceipt,'ui-soak',errors);
  const calibrationDevices=new Set(budget?.calibrationDeviceIds??[]);
  for(const [i,r] of receipts.entries()){
    if(r.phase!=='validation')errors.push('validation['+i+'] phase must be validation');
    if(r.productSourceFingerprint!==budget.productSourceFingerprint)errors.push('validation['+i+'] product-source fingerprint drift');
    if(calibrationDevices.has(r.deviceId))errors.push('validation['+i+'] reuses calibration device '+r.deviceId);
  }
  for(const cls of [4,8]){
    const rows=receipts.filter(x=>x.targetMemoryGiB===cls);
    if(rows.length<1)errors.push(cls+' GiB requires at least one independent validation receipt');
    for(const [i,r] of rows.entries())compareReceipt(r,budget.budgets?.[cls+'GiB']??{},cls+'GiB validation['+i+']',errors);
  }
  if(uiSoakReceipt){
    if(uiSoakReceipt.phase!=='soak-ui')errors.push('UI soak phase must be soak-ui');
    if(uiSoakReceipt.productSourceFingerprint!==budget.productSourceFingerprint)errors.push('UI soak product-source fingerprint drift');
    if(calibrationDevices.has(uiSoakReceipt.deviceId))errors.push('UI soak reuses calibration device '+uiSoakReceipt.deviceId);
    if(Number(uiSoakReceipt.durationMinutes)<480||Number(uiSoakReceipt.browserSession?.durationObservedMs)<480*60*1000*0.99)errors.push('UI soak shorter than 8 hours');
    const cls=uiSoakReceipt.targetMemoryGiB;
    if(![4,8].includes(cls))errors.push('UI soak memory class invalid');
    else compareReceipt(uiSoakReceipt,budget.budgets?.[cls+'GiB']??{},'UI soak',errors);
  }
  return {
    schema:'opencontainer.weak-device-budget-validation.v1.0',
    status:errors.length?'FAIL':'PASS',
    productSourceFingerprint:budget?.productSourceFingerprint??null,
    candidateGateState:{
      'P7-12':errors.length?'BLOCKED_VALIDATION_FAILED':'READY_FOR_REVIEW',
      'P9-12':errors.length?'BLOCKED_VALIDATION_FAILED':'READY_FOR_REVIEW',
      'P14-14':errors.length?'BLOCKED_VALIDATION_FAILED':'READY_FOR_REVIEW'
    },
    closureEligible:false,
    reviewedReconciliationRequired:true,
    productionClosed:false,
    errors
  };
}

function parseArgs(argv){const out={};for(const item of argv){const m=String(item).match(/^--([^=]+)=(.*)$/);if(m)out[m[1]]=m[2];}return out;}
async function readJson(path){return JSON.parse(await readFile(resolve(path),'utf8'));}
async function main(){
  const [command,...rest]=process.argv.slice(2);
  const args=parseArgs(rest);
  if(command==='freeze'){
    const paths=String(args.receipts??'').split(',').filter(Boolean);
    const receipts=await Promise.all(paths.map(readJson));
    const result=freezeBudget(receipts);
    const output=resolve(args.output??'.artifacts/weak-device-budget/budget.json');
    await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
    console.log('WEAK DEVICE BUDGET FREEZE '+result.status+' '+JSON.stringify({fingerprint:result.productSourceFingerprint??null,closureEligible:false}));
    if(result.errors.length)process.exitCode=1;
    return;
  }
  if(command==='validate'){
    if(!args.budget)throw new Error('--budget required');
    const budget=await readJson(args.budget);
    const validationReceipts=await Promise.all(String(args.receipts??'').split(',').filter(Boolean).map(readJson));
    const uiSoakReceipt=args['ui-soak']?await readJson(args['ui-soak']):null;
    const result=validateBudgetEvidence({budget,validationReceipts,uiSoakReceipt});
    const output=resolve(args.output??'.artifacts/weak-device-budget/validation.json');
    await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
    console.log('WEAK DEVICE BUDGET VALIDATION '+result.status+' '+JSON.stringify({closureEligible:false}));
    if(result.errors.length)process.exitCode=1;
    return;
  }
  throw new Error('usage: weak-device-budget.mjs freeze|validate ...');
}
const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
