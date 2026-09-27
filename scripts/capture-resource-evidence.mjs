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

const receipt={
  schema:'opencontainer.p7-resource-measurement.v1.0',
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
