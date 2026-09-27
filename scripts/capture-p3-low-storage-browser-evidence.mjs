import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const browser=JSON.parse(await readFile(resolve('.artifacts/critical-flake/browser-receipt.json'),'utf8'));
const errors=[];
const expectedOrder=['temporary','derived-rebuildable','public-cache','checkpoint-garbage'];
const expectedProtected=['canonical-source','canonical-checkpoint'];

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
  const stage=acceptance.stages.find(item=>item.name==='p3-low-storage-cleanup-pass')??null;
  if(!stage){
    errors.push('P3 low-storage stage missing for iteration '+run.iteration);
    continue;
  }
  if(JSON.stringify(stage.order)!==JSON.stringify(expectedOrder))errors.push('low-storage reclaim order drifted');
  if(JSON.stringify(stage.protected)!==JSON.stringify(expectedProtected))errors.push('canonical protection order drifted');
  if(stage.targetSatisfied!==false)errors.push('impossible cleanup target was reported satisfied');
  if(stage.canonicalDeletionAttempted!==false)errors.push('canonical deletion was attempted');
  if(stage.canonicalSourceCalled!==false)errors.push('canonical source reclaimer was invoked');
  if(stage.canonicalCheckpointCalled!==false)errors.push('canonical checkpoint reclaimer was invoked');
  if(!(Number(stage.reclaimedBytes)>0))errors.push('cleanup reclaimed no bytes');
  if(!(Number(stage.currentSequence)>Number(stage.fallbackSequence)))errors.push('current/fallback checkpoint ordering invalid');
  if(stage.restoredValue!=='two')errors.push('canonical workspace state did not survive cleanup');
  if(stage.packageCacheRebuildable!==true)errors.push('package cache was not classified rebuildable');
  if(stage.derivedRebuildable!==true)errors.push('derived index was not classified rebuildable');

  runs.push(Object.freeze({
    iteration:run.iteration,
    outputSha256:run.outputSha256,
    order:Object.freeze([...stage.order]),
    protected:Object.freeze([...stage.protected]),
    reclaimedBytes:stage.reclaimedBytes,
    targetSatisfied:stage.targetSatisfied,
    canonicalDeletionAttempted:stage.canonicalDeletionAttempted,
    canonicalSourceCalled:stage.canonicalSourceCalled,
    canonicalCheckpointCalled:stage.canonicalCheckpointCalled,
    currentSequence:stage.currentSequence,
    fallbackSequence:stage.fallbackSequence,
    restoredValue:stage.restoredValue,
    packageCacheRebuildable:stage.packageCacheRebuildable,
    derivedRebuildable:stage.derivedRebuildable
  }));
}

const receipt=Object.freeze({
  schema:'opencontainer.p3-low-storage-cleanup-browser.v1.0',
  status:errors.length?'FAIL':'PASS',
  testedCheckoutCommit:browser.sourceCommit,
  profile:browser.profile,
  iterations:browser.iterations,
  fullProductPathPasses:browser.fullProductPathPasses,
  unexplainedFailures:browser.unexplainedFailures,
  expectedOrder:Object.freeze(expectedOrder),
  expectedProtected:Object.freeze(expectedProtected),
  runs:Object.freeze(runs),
  errors:Object.freeze(errors),
  productionClosed:false
});

await mkdir(resolve('.artifacts/p3-low-storage'),{recursive:true});
await writeFile(resolve('.artifacts/p3-low-storage/browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(errors.length)process.exitCode=1;
