import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const METHOD_PATH=resolve('release/P7-WEAK-DEVICE-BUDGET-METHOD.v1.0.json');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

function parseArgs(argv){const out={};for(const item of argv){const m=String(item).match(/^--([^=]+)=(.*)$/);if(m)out[m[1]]=m[2];}return out;}
async function readWithDigest(path){const bytes=await readFile(resolve(path));return {value:JSON.parse(bytes.toString('utf8')),sha256:sha256(bytes)};}
function ms(value){return Number(value);}
function dateMs(value){const parsed=Date.parse(String(value??''));return Number.isFinite(parsed)?parsed:null;}

export function validateAgainstFrozenBudgets({budget,four,eight,method,budgetSha256=null,fourSha256=null,eightSha256=null}){
  const errors=[];
  if(budget?.schema!==method.freeze.requiredSchema)errors.push('frozen budget schema drift');
  if(budget?.state!==method.freeze.requiredState)errors.push('budget state must be FROZEN');
  if(budget?.formulaId!==method.derivation.formulaId)errors.push('budget formula id drift');
  if(!budget?.frozenAtSourceCommit)errors.push('frozenAtSourceCommit missing');
  const frozenAt=dateMs(budget?.frozenAt);
  if(frozenAt===null)errors.push('frozenAt missing/invalid');
  if(!budget?.calibration?.fourGiB?.sha256||!budget?.calibration?.eightGiB?.sha256)errors.push('calibration digests missing from frozen budget');

  const checks=[['4 GiB',four,4,fourSha256],['8 GiB',eight,8,eightSha256]];
  for(const [label,receipt,memoryGiB,digest] of checks){
    if(receipt?.schema!==method.validation.receiptSchema)errors.push(label+' validation schema drift');
    if(receipt?.status!==method.validation.status)errors.push(label+' validation did not PASS');
    if(receipt?.mode!==method.validation.mode)errors.push(label+' validation must use weak-device mode');
    if(receipt?.targetMemoryGiB!==memoryGiB)errors.push(label+' validation memory class mismatch');
    if(Number(receipt?.durationMinutes)<method.validation.minimumDurationMinutes)errors.push(label+' validation duration below minimum');
    if(Number(receipt?.browserSession?.sampleCount)<method.validation.minimumSamplesPerReceipt)errors.push(label+' validation sample count below minimum');
    if(receipt?.closureEligible!==false)errors.push(label+' validation receipt illegally self-promoted closure');
    const started=dateMs(receipt?.startedAt);
    if(method.validation.validationMustStartAfterBudgetFrozenAt&&frozenAt!==null&&(started===null||started<=frozenAt))errors.push(label+' validation did not start after budget freeze');
    if(digest&&[budget?.calibration?.fourGiB?.sha256,budget?.calibration?.eightGiB?.sha256].includes(digest))errors.push(label+' validation receipt reuses calibration bytes');
    if(receipt?.workflowRunId&&[budget?.calibration?.fourGiB?.workflowRunId,budget?.calibration?.eightGiB?.workflowRunId].includes(receipt.workflowRunId))errors.push(label+' validation workflow run reuses calibration run');
  }

  if(four?.deviceId&&eight?.deviceId&&four.deviceId===eight.deviceId)errors.push('4 GiB and 8 GiB validation devices must be distinct');
  const metricResults={};
  for(const metric of method.metrics.latencyMs){
    const budgetValue=ms(budget?.budgets?.latencyMs?.[metric]);
    if(!Number.isFinite(budgetValue)||budgetValue<=0){errors.push('frozen latency budget missing '+metric);continue;}
    metricResults[metric]={budget:budgetValue};
    for(const [label,receipt] of [['4g',four],['8g',eight]]){
      const observed=ms(receipt?.browserSession?.aggregates?.[metric]);
      metricResults[metric][label]=observed;
      metricResults[metric][label+'Pass']=Number.isFinite(observed)&&observed<=budgetValue;
      if(!metricResults[metric][label+'Pass'])errors.push(label+' '+metric+' exceeds/misses frozen budget');
    }
  }
  const slopeBudget=Number(budget?.budgets?.heapSlopeBytesPerHour);
  if(!Number.isFinite(slopeBudget)||slopeBudget<0)errors.push('frozen heapSlopeBytesPerHour budget missing');
  const heapSlope={
    budget:slopeBudget,
    fourGiB:Number(four?.browserSession?.aggregates?.heapSlopeBytesPerHour),
    eightGiB:Number(eight?.browserSession?.aggregates?.heapSlopeBytesPerHour)
  };
  heapSlope.fourGiBPass=Number.isFinite(heapSlope.fourGiB)&&heapSlope.fourGiB<=slopeBudget;
  heapSlope.eightGiBPass=Number.isFinite(heapSlope.eightGiB)&&heapSlope.eightGiB<=slopeBudget;
  if(!heapSlope.fourGiBPass)errors.push('4g heap slope exceeds/misses frozen budget');
  if(!heapSlope.eightGiBPass)errors.push('8g heap slope exceeds/misses frozen budget');

  return {
    schema:'opencontainer.p7-weak-device-budget-validation.v1.0',
    status:errors.length?'FAIL':'PASS',
    methodSchema:method.schema,
    formulaId:method.derivation.formulaId,
    frozenBudget:{sha256:budgetSha256,frozenAt:budget?.frozenAt??null,frozenAtSourceCommit:budget?.frozenAtSourceCommit??null},
    validationReceipts:{
      fourGiB:{sha256:fourSha256,sourceCommit:four?.sourceCommit??null,workflowRunId:four?.workflowRunId??null,deviceId:four?.deviceId??null},
      eightGiB:{sha256:eightSha256,sourceCommit:eight?.sourceCommit??null,workflowRunId:eight?.workflowRunId??null,deviceId:eight?.deviceId??null}
    },
    metrics:metricResults,
    heapSlope,
    candidateGateState:{
      'P7-12':errors.length?'BLOCKED_VALIDATION_FAILED':'READY_FOR_REVIEW',
      'P14-14':errors.length?'BLOCKED_VALIDATION_FAILED':'READY_FOR_REVIEW',
      'P9-12':'BLOCKED_SEPARATE_RENDERED_UI_EVIDENCE'
    },
    closureEligible:false,
    closureReason:'Passing independent validation is necessary evidence for reviewed P7-12/P14-14 promotion but never mutates the production ledger. P9-12 requires a separate rendered-UI weak-device/long-session court.',
    productionClosed:false,
    errors
  };
}

async function main(){
  const args=parseArgs(process.argv.slice(2));
  if(!args.budget||!args.four||!args.eight)throw new Error('--budget, --four and --eight paths are required');
  const [methodRead,budgetRead,fourRead,eightRead]=await Promise.all([readWithDigest(METHOD_PATH),readWithDigest(args.budget),readWithDigest(args.four),readWithDigest(args.eight)]);
  const result=validateAgainstFrozenBudgets({
    budget:budgetRead.value,four:fourRead.value,eight:eightRead.value,method:methodRead.value,
    budgetSha256:budgetRead.sha256,fourSha256:fourRead.sha256,eightSha256:eightRead.sha256
  });
  const output=resolve(args.output??'.artifacts/p7-external-device/budget-validation.json');
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log('P7 WEAK DEVICE BUDGET VALIDATION '+result.status+' '+JSON.stringify({p7_12:result.candidateGateState['P7-12'],p14_14:result.candidateGateState['P14-14'],p9_12:result.candidateGateState['P9-12'],closureEligible:false}));
  if(result.errors.length){for(const error of result.errors)console.error('P7 budget validation:',error);process.exitCode=1;}
}
const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
