import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const browser=JSON.parse(await readFile(resolve('.artifacts/critical-flake/browser-receipt.json'),'utf8'));
const errors=[];
const expected={
  canonicalSource:{corruptionClass:'canonical-source',action:'fail-closed'},
  recoveryDraft:{corruptionClass:'recovery-draft',action:'discard-draft'},
  checkpoint:{corruptionClass:'checkpoint',action:'fallback-checkpoint'},
  packageCache:{corruptionClass:'package-cache',action:'discard-refetch'},
  derivedIndex:{corruptionClass:'derived-index',action:'discard-rebuild'}
};

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
  const matrix=acceptance.stages.find(item=>item.name==='p3-corruption-matrix-pass')??null;
  if(!matrix){
    errors.push('P3 corruption matrix stage missing for iteration '+run.iteration);
    continue;
  }
  if(matrix.classCount!==5)errors.push('P3 corruption matrix classCount != 5');
  if(matrix.distinctActions!==5)errors.push('P3 corruption matrix distinctActions != 5');
  const classes=matrix.classes??{};
  for(const [key,want] of Object.entries(expected)){
    const got=classes[key];
    if(!got)errors.push('P3 corruption class missing: '+key);
    else{
      if(got.corruptionClass!==want.corruptionClass)errors.push(key+' corruptionClass drifted');
      if(got.action!==want.action)errors.push(key+' recovery action drifted');
    }
  }
  if(classes.canonicalSource?.code!=='OC_IMPORT_INVALID'||classes.canonicalSource?.silentEmptyFallback!==false){
    errors.push('canonical source did not fail closed');
  }
  if(classes.recoveryDraft?.discarded!==true)errors.push('recovery draft was not discarded');
  if(!(classes.checkpoint?.recoveredSequence<classes.checkpoint?.corruptSequence))errors.push('checkpoint did not fall back');
  if(classes.packageCache?.corruptDetected!==true||classes.packageCache?.refetches!==1||classes.packageCache?.repaired!==true){
    errors.push('package cache did not reject/refetch/repair exactly once');
  }
  if(classes.derivedIndex?.corruptDetected!==true||classes.derivedIndex?.rebuilt!==true||classes.derivedIndex?.reopenedVerified!==true){
    errors.push('derived index did not discard/rebuild/reopen');
  }
  runs.push(Object.freeze({
    iteration:run.iteration,
    outputSha256:run.outputSha256,
    classCount:matrix.classCount,
    distinctActions:matrix.distinctActions,
    classes
  }));
}

const receipt=Object.freeze({
  schema:'opencontainer.p3-corruption-classification-browser.v1.0',
  status:errors.length?'FAIL':'PASS',
  testedCheckoutCommit:browser.sourceCommit,
  profile:browser.profile,
  iterations:browser.iterations,
  fullProductPathPasses:browser.fullProductPathPasses,
  unexplainedFailures:browser.unexplainedFailures,
  expected,
  runs:Object.freeze(runs),
  errors:Object.freeze(errors),
  productionClosed:false
});

await mkdir(resolve('.artifacts/p3-corruption'),{recursive:true});
await writeFile(resolve('.artifacts/p3-corruption/browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(errors.length)process.exitCode=1;
