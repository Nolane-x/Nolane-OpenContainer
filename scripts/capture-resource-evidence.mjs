import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const readJson=async path=>JSON.parse(await readFile(resolve(path),'utf8'));
const [policy,profile,browserFlake,environment]=await Promise.all([
  readJson('release/RESOURCE-MEASUREMENT-POLICY.v1.0.json'),
  readJson('.artifacts/product-scope/browser-profile-receipt.json'),
  readJson('.artifacts/critical-flake/browser-receipt.json'),
  readJson('.artifacts/evidence-assurance/browser/environment.json')
]);

const errors=[];
if(profile.evidenceProfile!==policy.declaredEvidenceProfile)errors.push('declared evidence profile drift');
if(profile.device?.resourceFloorClaimed!==false)errors.push('resource floor must remain unclaimed');
if(browserFlake.status!=='PASS'||browserFlake.unexplainedFailures!==0)errors.push('browser flake receipt is not clean');
if(browserFlake.fullProductPathPasses!==browserFlake.iterations)errors.push('not every browser iteration passed full product path');
for(const field of policy.measurementMetadata.requiredDeviceFields){
  if(!(field in (profile.device??{})))errors.push('device metadata missing '+field);
}
for(const threat of policy.measurementMetadata.requiredValidityThreats){
  if(!(threat in (environment.validityThreats??{})))errors.push('validity metadata missing '+threat);
}
const durations=(browserFlake.runs??[]).map(item=>Number(item.durationMs)).filter(Number.isFinite);
if(durations.length!==browserFlake.iterations)errors.push('browser iteration durations incomplete');

function parseAcceptanceReceipt(log){
  const prefix='browser acceptance PASS ';
  const line=String(log).split(/\r?\n/).find(item=>item.startsWith(prefix));
  if(!line)return null;
  try{return JSON.parse(line.slice(prefix.length));}
  catch{return null;}
}

function delta(stageMap,start,end){
  const a=stageMap.get(start)?.at;
  const b=stageMap.get(end)?.at;
  return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,b-a):null;
}

function summarize(values){
  const filtered=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!filtered.length)return null;
  const middle=Math.floor(filtered.length/2);
  const median=filtered.length%2?filtered[middle]:Math.round((filtered[middle-1]+filtered[middle])/2);
  return Object.freeze({
    samples:filtered.length,
    minimumMs:filtered[0],
    maximumMs:filtered.at(-1),
    medianMs:median,
    meanMs:Math.round(filtered.reduce((a,b)=>a+b,0)/filtered.length)
  });
}

const stageRuns=[];
for(const run of browserFlake.runs??[]){
  const log=await readFile(resolve('.artifacts/critical-flake',run.logFile),'utf8');
  const acceptance=parseAcceptanceReceipt(log);
  if(!acceptance||!Array.isArray(acceptance.stages)){
    errors.push('browser acceptance stage receipt missing for iteration '+run.iteration);
    continue;
  }
  const stageMap=new Map(acceptance.stages.map(item=>[item.name,item]));
  const pressure=stageMap.get('p7-pressure-pass')??null;
  if(!pressure)errors.push('P7 pressure browser court missing for iteration '+run.iteration);
  else{
    if(pressure.staleCode!=='OC_WORKER_STALE')errors.push('P7 stale publication was not rejected');
    if(pressure.pausedCode!=='OC_RESOURCE_EXHAUSTED')errors.push('P7 background admission was not paused');
    if(pressure.resumed!==true||pressure.fresh!=='fresh')errors.push('P7 pressure resume did not admit fresh work');
  }
  const metrics={
    runtimeBootMs:delta(stageMap,'boot','runtime-ready'),
    authorityWorkerStartupMs:delta(stageMap,'bridge-a-starting','worker-a-started'),
    authorityWorkerExecutionMs:delta(stageMap,'worker-a-started','worker-a-executed'),
    packageInstallMs:delta(stageMap,'browser-package-install-start','browser-package-install-pass'),
    viteClosureInstallMs:delta(stageMap,'vite-closure-install-start','vite-closure-install-pass'),
    publicationGraphMs:delta(stageMap,'vite-publication-graph-start','vite-publication-graph-pass'),
    viteBuildMs:delta(stageMap,'vite-c1-build-start','vite-c1-build-pass'),
    viteDevToHmrMs:delta(stageMap,'vite-c2-dev-start','vite-c2-hmr-pass'),
    pressurePauseResumeMs:delta(stageMap,'p7-pressure-start','p7-pressure-pass')
  };
  for(const [name,value] of Object.entries(metrics)){
    if(!Number.isFinite(value))errors.push('stage measurement '+name+' missing for iteration '+run.iteration);
  }
  stageRuns.push(Object.freeze({iteration:run.iteration,...metrics}));
}

const stageAggregates={};
for(const name of [
  'runtimeBootMs',
  'authorityWorkerStartupMs',
  'authorityWorkerExecutionMs',
  'packageInstallMs',
  'viteClosureInstallMs',
  'publicationGraphMs',
  'viteBuildMs',
  'viteDevToHmrMs',
  'pressurePauseResumeMs'
]){
  stageAggregates[name]=summarize(stageRuns.map(run=>run[name]));
}

const receipt={
  schema:'opencontainer.p7-resource-measurement.v1.1',
  status:errors.length?'FAIL':'PASS',
  profileId:profile.evidenceProfile,
  browser:profile.browser,
  os:profile.os,
  device:profile.device,
  workerHint:{
    logicalCpuCount:profile.device?.logicalCpuCount??null,
    rule:policy.workerBudget.rule,
    hardCap:policy.workerBudget.hardCap,
    directHardwareMappingForbidden:true
  },
  measurements:{
    kind:'full-product-path-wall-clock',
    iterations:browserFlake.iterations,
    durationsMs:durations,
    minimumMs:durations.length?Math.min(...durations):null,
    maximumMs:durations.length?Math.max(...durations):null,
    meanMs:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):null,
    unexplainedFailures:browserFlake.unexplainedFailures
  },
  stageMeasurements:Object.freeze({
    runs:Object.freeze(stageRuns),
    aggregates:Object.freeze(stageAggregates)
  }),
  pressureCourt:Object.freeze({
    stalePublicationRejected:true,
    backgroundAdmissionPaused:true,
    freshWorkAfterResume:true
  }),
  validityThreats:environment.validityThreats,
  claims:policy.measurementMetadata.claims,
  boundedResources:policy.boundedResources,
  errors,
  productionClosed:false
};
await mkdir(resolve('.artifacts/resource-evidence'),{recursive:true});
await writeFile(resolve('.artifacts/resource-evidence/measurement-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(errors.length)process.exitCode=1;
