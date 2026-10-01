import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const METHOD_PATH=resolve('release/P7-WEAK-DEVICE-BUDGET-METHOD.v1.0.json');
const LATENCY_METRICS=['cycleP95Ms','warmBootP95Ms','commandP95Ms','vfsWrite64KiBP95Ms','vfsRead64KiBP95Ms','packageGraphP95Ms'];

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function parseArgs(argv){const out={};for(const item of argv){const m=String(item).match(/^--([^=]+)=(.*)$/);if(m)out[m[1]]=m[2];}return out;}
async function readWithDigest(path){const bytes=await readFile(resolve(path));return {value:JSON.parse(bytes.toString('utf8')),sha256:sha256(bytes)};}
function requireFinite(value,label,errors){if(!Number.isFinite(Number(value)))errors.push(label+' missing/non-finite');return Number(value);}
function validateCalibration(receipt,memoryGiB,method,label,errors){
  if(receipt?.schema!==method.calibration.receiptSchema)errors.push(label+' receipt schema drift');
  if(receipt?.status!==method.calibration.status)errors.push(label+' receipt did not PASS');
  if(receipt?.mode!==method.calibration.mode)errors.push(label+' must use weak-device mode');
  if(receipt?.targetMemoryGiB!==memoryGiB)errors.push(label+' memory class mismatch');
  if(Number(receipt?.durationMinutes)<method.calibration.minimumDurationMinutes)errors.push(label+' duration below calibration minimum');
  if(Number(receipt?.browserSession?.sampleCount)<method.calibration.minimumSamplesPerReceipt)errors.push(label+' sample count below calibration minimum');
  if(receipt?.closureEligible!==false)errors.push(label+' illegally self-promoted closure');
  if(!receipt?.sourceCommit)errors.push(label+' source commit missing');
  for(const metric of LATENCY_METRICS)requireFinite(receipt?.browserSession?.aggregates?.[metric],label+' '+metric,errors);
  requireFinite(receipt?.browserSession?.aggregates?.heapSlopeBytesPerHour,label+' heapSlopeBytesPerHour',errors);
}
export function deriveBudgetProposal({four,eight,method}){
  const errors=[];
  validateCalibration(four,4,method,'4 GiB',errors);
  validateCalibration(eight,8,method,'8 GiB',errors);
  if(four?.deviceId&&eight?.deviceId&&four.deviceId===eight.deviceId)errors.push('calibration device identities must be distinct');
  if(four?.sourceCommit&&eight?.sourceCommit&&four.sourceCommit!==eight.sourceCommit)errors.push('calibration receipts must share one exact source commit');
  const budgets={latencyMs:{}};
  for(const metric of LATENCY_METRICS){
    const a=Number(four?.browserSession?.aggregates?.[metric]);
    const b=Number(eight?.browserSession?.aggregates?.[metric]);
    budgets.latencyMs[metric]=Number.isFinite(a)&&Number.isFinite(b)?Math.ceil(Math.max(a,b)*method.derivation.latencyMultiplier):null;
  }
  const slope4=Number(four?.browserSession?.aggregates?.heapSlopeBytesPerHour);
  const slope8=Number(eight?.browserSession?.aggregates?.heapSlopeBytesPerHour);
  budgets.heapSlopeBytesPerHour=Number.isFinite(slope4)&&Number.isFinite(slope8)
    ?Math.ceil(Math.max(method.derivation.heapSlopeMinimumBytesPerHour,Math.max(0,slope4,slope8)*method.derivation.heapSlopeMultiplier))
    :null;
  return {
    schema:'opencontainer.p7-weak-device-budget-proposal.v1.0',
    state:method.derivation.proposalState,
    methodSchema:method.schema,
    formulaId:method.derivation.formulaId,
    calibrationSourceCommit:four?.sourceCommit===eight?.sourceCommit?four?.sourceCommit:null,
    calibration:{
      fourGiB:{deviceId:four?.deviceId??null,workflowRunId:four?.workflowRunId??null},
      eightGiB:{deviceId:eight?.deviceId??null,workflowRunId:eight?.workflowRunId??null}
    },
    budgets,
    concreteBudgetFileRequired:method.freeze.reviewedConcreteBudgetFile,
    validationAllowed:false,
    closureEligible:false,
    gateCandidates:['P7-12','P14-14'],
    excludedGate:'P9-12',
    productionClosed:false,
    errors
  };
}
async function main(){
  const args=parseArgs(process.argv.slice(2));
  if(!args.four||!args.eight)throw new Error('--four and --eight calibration receipt paths are required');
  const [methodRead,fourRead,eightRead]=await Promise.all([readWithDigest(METHOD_PATH),readWithDigest(args.four),readWithDigest(args.eight)]);
  const result=deriveBudgetProposal({four:fourRead.value,eight:eightRead.value,method:methodRead.value});
  result.methodSha256=methodRead.sha256;
  result.calibration.fourGiB.sha256=fourRead.sha256;
  result.calibration.eightGiB.sha256=eightRead.sha256;
  const output=resolve(args.output??'.artifacts/p7-external-device/budget-proposal.json');
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log('P7 WEAK DEVICE BUDGET PROPOSAL '+(result.errors.length?'FAIL':'PASS')+' '+JSON.stringify({formulaId:result.formulaId,calibrationSourceCommit:result.calibrationSourceCommit,validationAllowed:false,closureEligible:false}));
  if(result.errors.length){for(const error of result.errors)console.error('P7 budget proposal:',error);process.exitCode=1;}
}
const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
