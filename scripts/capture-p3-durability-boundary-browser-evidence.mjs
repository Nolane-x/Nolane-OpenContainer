import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const browser=JSON.parse(await readFile(resolve('.artifacts/critical-flake/browser-receipt.json'),'utf8'));
const errors=[];
const expectedSteps=['truncate','write','truncate-final','flush','close'];

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
  const stage=acceptance.stages.find(item=>item.name==='p3-durability-boundary-pass')??null;
  if(!stage){
    errors.push('P3 durability stage missing for iteration '+run.iteration);
    continue;
  }

  for(const label of ['first','second']){
    const row=stage[label]??{};
    if(row.explicitFlush!==true)errors.push(label+' checkpoint did not report explicitFlush');
    if(row.browserSyncAccessHandle!==true)errors.push(label+' checkpoint did not use browser SyncAccessHandle');
    for(const part of ['payload','manifest']){
      const write=row[part]??{};
      if(write.writer!=='sync-access-handle')errors.push(label+' '+part+' writer drifted');
      if(write.mode!=='readwrite')errors.push(label+' '+part+' sync handle mode drifted');
      if(write.explicitFlush!==true||write.flushCompleted!==true||write.closeCompleted!==true){
        errors.push(label+' '+part+' flush/close receipt incomplete');
      }
      if(write.boundary!=='flush-returned-before-close')errors.push(label+' '+part+' boundary drifted');
      if(JSON.stringify(write.steps)!==JSON.stringify(expectedSteps))errors.push(label+' '+part+' step order drifted');
      if(!(Number(write.bytes)>0)&&part==='payload')errors.push(label+' payload byte count invalid');
      if(Number(write.written)!==Number(write.bytes))errors.push(label+' '+part+' short write');
    }
  }

  if(stage.reopen?.sequence!==stage.second?.sequence)errors.push('fresh reopen canonical sequence drifted');
  if(stage.reopen?.generation!==stage.second?.generation)errors.push('fresh reopen generation drifted');
  if(stage.reopen?.value!=='flush-two')errors.push('fresh reopen value drifted');
  if(Number(stage.reopen?.bulkBytes)!==96*1024)errors.push('fresh reopen bulk bytes drifted');
  if(typeof stage.exactBoundary!=='string'||!stage.exactBoundary.includes('flush() returned'))errors.push('exact browser-visible durability boundary missing');
  const notClaimed=stage.notClaimed??[];
  if(!Array.isArray(notClaimed)||!notClaimed.some(item=>String(item).includes('power-loss durability'))){
    errors.push('power-loss non-claim missing');
  }
  if(!notClaimed.some(item=>String(item).includes('hardware cache persistence'))){
    errors.push('hardware-cache non-claim missing');
  }

  runs.push(Object.freeze({
    iteration:run.iteration,
    outputSha256:run.outputSha256,
    first:stage.first,
    second:stage.second,
    reopen:stage.reopen,
    exactBoundary:stage.exactBoundary,
    notClaimed:Object.freeze([...notClaimed])
  }));
}

const receipt=Object.freeze({
  schema:'opencontainer.p3-opfs-durability-boundary-browser.v1.0',
  status:errors.length?'FAIL':'PASS',
  testedCheckoutCommit:browser.sourceCommit,
  profile:browser.profile,
  iterations:browser.iterations,
  fullProductPathPasses:browser.fullProductPathPasses,
  unexplainedFailures:browser.unexplainedFailures,
  exactClaim:'canonical payload and manifest writes complete SyncAccessHandle.flush(), then close(), and a fresh authority reopens/verifies the same canonical bytes',
  explicitNonClaims:Object.freeze([
    'no claim of power-loss durability stronger than the browser SyncAccessHandle flush contract',
    'no claim about hardware/filesystem cache persistence not exposed by the Web API'
  ]),
  runs:Object.freeze(runs),
  errors:Object.freeze(errors),
  productionClosed:false
});

await mkdir(resolve('.artifacts/p3-durability-boundary'),{recursive:true});
await writeFile(resolve('.artifacts/p3-durability-boundary/browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(errors.length)process.exitCode=1;
