import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const readJson=async path=>JSON.parse(await readFile(resolve(path),'utf8'));
const browser=await readJson('.artifacts/critical-flake/browser-receipt.json');
const errors=[];
const expectedQuotaPhases=[
  'after-0-bytes',
  'after-1-byte',
  'after-header',
  'mid-payload',
  'pre-commit',
  'post-payload-pre-manifest'
];

function parseAcceptance(log){
  const prefix='browser acceptance PASS ';
  const index=log.indexOf(prefix);
  if(index<0)return null;
  const start=index+prefix.length;
  const end=log.indexOf('\ndistribution browser PASS',start);
  const raw=(end>=0?log.slice(start,end):log.slice(start)).trim();
  try{return JSON.parse(raw);}
  catch{return null;}
}

if(browser.status!=='PASS')errors.push('critical browser receipt is not PASS');
if(browser.unexplainedFailures!==0)errors.push('critical browser receipt has unexplained failures');
if(browser.fullProductPathPasses!==browser.iterations)errors.push('not every browser iteration passed the full product path');

const iterations=[];
for(const run of browser.runs??[]){
  const log=await readFile(resolve('.artifacts/critical-flake',run.logFile),'utf8');
  const acceptance=parseAcceptance(log);
  if(!acceptance||!Array.isArray(acceptance.stages)){
    errors.push('browser acceptance receipt missing for iteration '+run.iteration);
    continue;
  }
  const writer=acceptance.stages.find(item=>item.name==='p3-writer-election-pass')??null;
  const quota=acceptance.stages.find(item=>item.name==='p3-quota-fault-matrix-pass')??null;
  if(!writer)errors.push('writer-epoch browser stage missing for iteration '+run.iteration);
  if(!quota)errors.push('quota-fault browser stage missing for iteration '+run.iteration);

  if(writer){
    if(writer.fulfilled!==1)errors.push('writer election did not admit exactly one publisher');
    if(writer.staleRejected!=='OC_STALE_GENERATION')errors.push('same-generation competitor was not rejected stale');
    if(writer.firstWriterEpoch!==1)errors.push('initial WriterEpoch was not 1');
    if(writer.successorWriterEpoch!==2)errors.push('successor WriterEpoch was not 2');
    if(writer.successorStorageGeneration!==2)errors.push('successor StorageGeneration was not 2');
    if(writer.staleWriterEpochCode!=='OC_STALE_GENERATION')errors.push('old WriterEpoch published after successor takeover');
    if(writer.crossContextLocking!==true)errors.push('writer court did not use cross-context Web Locks');
  }

  const quotaRows=Array.isArray(quota?.phases)?quota.phases:[];
  if(quotaRows.length!==expectedQuotaPhases.length)errors.push('quota phase count drifted');
  for(const phase of expectedQuotaPhases){
    const row=quotaRows.find(item=>item.phase===phase);
    if(!row)errors.push('quota phase missing: '+phase);
    else{
      if(row.quotaCode!=='OC_RESOURCE_EXHAUSTED')errors.push('quota phase did not fail resource-exhausted: '+phase);
      if(row.sequence!==1||row.generation!==1)errors.push('quota phase advanced canonical generation: '+phase);
    }
  }

  iterations.push(Object.freeze({
    iteration:run.iteration,
    outputSha256:run.outputSha256,
    writerEpoch:Object.freeze({
      first:writer?.firstWriterEpoch??null,
      successor:writer?.successorWriterEpoch??null,
      storageGeneration:writer?.successorStorageGeneration??null,
      staleCode:writer?.staleWriterEpochCode??null,
      crossContextLocking:writer?.crossContextLocking??null
    }),
    quota:Object.freeze({
      phases:Object.freeze(quotaRows.map(row=>Object.freeze({
        phase:row.phase,
        quotaCode:row.quotaCode,
        sequence:row.sequence,
        generation:row.generation,
        garbageRemoved:row.garbageRemoved
      })))
    })
  }));
}

const receipt=Object.freeze({
  schema:'opencontainer.p3-persistence-wave2-browser.v1.0',
  status:errors.length?'FAIL':'PASS',
  testedCheckoutCommit:browser.sourceCommit,
  profile:browser.profile,
  iterations:browser.iterations,
  fullProductPathPasses:browser.fullProductPathPasses,
  unexplainedFailures:browser.unexplainedFailures,
  writerEpochInvariant:Object.freeze({
    monotonic:true,
    storageGenerationAdvancesOnlyOnCommit:true,
    staleWriterPublicationRejected:true
  }),
  quotaFaultPhases:Object.freeze(expectedQuotaPhases),
  runs:Object.freeze(iterations),
  errors:Object.freeze(errors),
  productionClosed:false
});

await mkdir(resolve('.artifacts/p3-persistence'),{recursive:true});
await writeFile(
  resolve('.artifacts/p3-persistence/wave2-browser-receipt.json'),
  JSON.stringify(receipt,null,2)+'\n'
);
console.log(JSON.stringify(receipt,null,2));
if(errors.length)process.exitCode=1;
