import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const browser=JSON.parse(await readFile(resolve('.artifacts/critical-flake/browser-receipt.json'),'utf8'));
const errors=[];

function parseAcceptance(log){
  const prefix='browser acceptance PASS ';
  const index=log.indexOf(prefix);
  if(index<0)return null;
  const start=index+prefix.length;
  const end=log.indexOf('\ndistribution browser PASS',start);
  const raw=(end>=0?log.slice(start,end):log.slice(start)).trim();
  try{return JSON.parse(raw);}catch{return null;}
}

if(browser.status!=='PASS')errors.push('critical browser receipt is not PASS');
if(browser.unexplainedFailures!==0)errors.push('critical browser receipt has unexplained failures');
if(browser.fullProductPathPasses!==browser.iterations)errors.push('not every browser iteration passed full product path');

const runs=[];
for(const run of browser.runs??[]){
  const log=await readFile(resolve('.artifacts/critical-flake',run.logFile),'utf8');
  const acceptance=parseAcceptance(log);
  if(!acceptance||!Array.isArray(acceptance.stages)){
    errors.push('browser acceptance receipt missing for iteration '+run.iteration);
    continue;
  }
  const stage=acceptance.stages.find(item=>item.name==='p3-safe-restore-pass')??null;
  if(!stage){
    errors.push('P3 safe restore stage missing for iteration '+run.iteration);
    continue;
  }

  if(stage.recoveryPointCreated!==true)errors.push('pre-restore recovery point was not created');
  if(stage.recoveryPointRetained!==true)errors.push('pre-restore recovery point did not survive as fallback');
  if(stage.restoredSequence!==stage.recoveryPointSequence+1)errors.push('restored generation was not published after recovery point');
  if(!(Number(stage.restoredGeneration)>0))errors.push('restored generation is invalid');
  if(stage.localConflictCode!=='OC_STALE_GENERATION')errors.push('local post-plan edit was not rejected stale');
  if(stage.crossConflictCode!=='OC_STALE_GENERATION'||stage.crossConflictProtected!==true){
    errors.push('cross-context newer work was not protected');
  }
  if(stage.quotaRestoreCode!=='OC_RESOURCE_EXHAUSTED')errors.push('quota-blocked restore did not fail resource-exhausted');
  if(stage.quotaRiskDeclared!==true)errors.push('quota-blocked restore did not declare missing safety point');
  if(stage.quotaBlindOverwritePrevented!==true)errors.push('quota-blocked restore did not preserve working state');
  if(stage.workingTreeLeaseReleased!==true)errors.push('restore mutation lease was not released');

  runs.push(Object.freeze({
    iteration:run.iteration,
    outputSha256:run.outputSha256,
    targetSequence:stage.targetSequence,
    priorCanonicalSequence:stage.priorCanonicalSequence,
    recoveryPointSequence:stage.recoveryPointSequence,
    restoredSequence:stage.restoredSequence,
    restoredGeneration:stage.restoredGeneration,
    recoveryPointCreated:stage.recoveryPointCreated,
    recoveryPointRetained:stage.recoveryPointRetained,
    localConflictCode:stage.localConflictCode,
    crossConflictCode:stage.crossConflictCode,
    crossConflictProtected:stage.crossConflictProtected,
    remoteSequence:stage.remoteSequence,
    quotaRestoreCode:stage.quotaRestoreCode,
    quotaRiskDeclared:stage.quotaRiskDeclared,
    quotaBlindOverwritePrevented:stage.quotaBlindOverwritePrevented,
    workingTreeLeaseReleased:stage.workingTreeLeaseReleased
  }));
}

const receipt=Object.freeze({
  schema:'opencontainer.p3-safe-checkpoint-restore-browser.v1.0',
  status:errors.length?'FAIL':'PASS',
  testedCheckoutCommit:browser.sourceCommit,
  profile:browser.profile,
  iterations:browser.iterations,
  fullProductPathPasses:browser.fullProductPathPasses,
  unexplainedFailures:browser.unexplainedFailures,
  invariants:Object.freeze({
    recoveryPointBeforeRollback:true,
    restorePublishesNewGeneration:true,
    localPostPlanConflictRejected:true,
    crossContextConflictRejected:true,
    quotaWithoutSafetyPointFailsClosed:true,
    mutationLeaseReleased:true
  }),
  runs:Object.freeze(runs),
  errors:Object.freeze(errors),
  productionClosed:false
});

await mkdir(resolve('.artifacts/p3-safe-restore'),{recursive:true});
await writeFile(resolve('.artifacts/p3-safe-restore/browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(errors.length)process.exitCode=1;
