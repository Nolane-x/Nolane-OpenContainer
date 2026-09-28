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
  const stage=acceptance.stages.find(item=>item.name==='p3-destructive-lifecycle-pass')??null;
  if(!stage){
    errors.push('P3 destructive lifecycle stage missing for iteration '+run.iteration);
    continue;
  }

  if(stage.deleteActionClass!=='D2')errors.push('recoverable delete action class drifted');
  if(stage.deleteRecoverable!==true||stage.deleteRecoverability!=='tombstone+checkpoint')errors.push('recoverable delete truth drifted');
  if(!(Number(stage.deleteRecoverySequence)>=1))errors.push('recoverable delete recovery sequence invalid');
  if(stage.lateMutationCode!=='OC_INVALID_STATE')errors.push('late local mutation was not fenced');
  if(stage.tombstoneBootCode!=='OC_INVALID_STATE'||stage.tombstoneBootRecoverable!==true)errors.push('tombstoned boot boundary drifted');
  if(stage.restoreState!=='active')errors.push('recoverable delete did not restore to active');

  if(stage.purgeActionClass!=='D4')errors.push('permanent purge action class drifted');
  if(stage.purgeRecoverable!==false||stage.purgeRecoverability!=='none')errors.push('permanent purge recoverability truth drifted');
  if(stage.duplicatePurgeIdempotent!==true)errors.push('permanent purge duplicate submit was not idempotent');
  if(stage.purgedBootCode!=='OC_INVALID_STATE'||stage.purgedBootRecoverable!==false)errors.push('purged boot boundary drifted');

  if(stage.ackLossCode!=='OC_INVALID_STATE'||stage.unknownOutcome!==true)errors.push('purge ack-loss did not expose unknown outcome');
  if(stage.reconciledState!=='purged'||stage.reconciledTerminal!==true)errors.push('purge unknown outcome did not reconcile terminal state');
  if(stage.reconciledWorkspaceExists!==false||stage.reconciledRecoverable!==false)errors.push('purge reconciliation falsely preserved recovery');

  runs.push(Object.freeze({
    iteration:run.iteration,
    outputSha256:run.outputSha256,
    deleteActionClass:stage.deleteActionClass,
    deleteRecoverable:stage.deleteRecoverable,
    deleteRecoverability:stage.deleteRecoverability,
    deleteRecoverySequence:stage.deleteRecoverySequence,
    lateMutationCode:stage.lateMutationCode,
    tombstoneBootCode:stage.tombstoneBootCode,
    tombstoneBootRecoverable:stage.tombstoneBootRecoverable,
    restoreState:stage.restoreState,
    purgeActionClass:stage.purgeActionClass,
    purgeRecoverable:stage.purgeRecoverable,
    purgeRecoverability:stage.purgeRecoverability,
    duplicatePurgeIdempotent:stage.duplicatePurgeIdempotent,
    purgedBootCode:stage.purgedBootCode,
    purgedBootRecoverable:stage.purgedBootRecoverable,
    ackLossCode:stage.ackLossCode,
    unknownOutcome:stage.unknownOutcome,
    reconciledState:stage.reconciledState,
    reconciledTerminal:stage.reconciledTerminal,
    reconciledWorkspaceExists:stage.reconciledWorkspaceExists,
    reconciledRecoverable:stage.reconciledRecoverable
  }));
}

const receipt=Object.freeze({
  schema:'opencontainer.p3-destructive-lifecycle-browser.v1.0',
  status:errors.length?'FAIL':'PASS',
  testedCheckoutCommit:browser.sourceCommit,
  profile:browser.profile,
  iterations:browser.iterations,
  fullProductPathPasses:browser.fullProductPathPasses,
  unexplainedFailures:browser.unexplainedFailures,
  invariants:Object.freeze({
    recoverableDeleteUsesD2:true,
    tombstoneNamesRecoveryPoint:true,
    lateLocalMutationFenced:true,
    tombstonedBootBlocked:true,
    restoreReactivatesWorkspace:true,
    permanentPurgeRequiresD4:true,
    permanentPurgeLeavesNoRecovery:true,
    duplicateSubmitIdempotent:true,
    ackLossRequiresReconciliation:true
  }),
  runs:Object.freeze(runs),
  errors:Object.freeze(errors),
  productionClosed:false
});

await mkdir(resolve('.artifacts/p3-destructive-lifecycle'),{recursive:true});
await writeFile(resolve('.artifacts/p3-destructive-lifecycle/browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(errors.length)process.exitCode=1;
