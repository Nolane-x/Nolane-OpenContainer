import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadP9FailureMatrix } from './p9-failure-matrix.mjs';
import { projectFailureScenario, assertFailureProjection } from '../packages/ui-contract/src/index.js';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const result=await loadP9FailureMatrix();
if(!result.ok)throw new Error('P9 failure matrix invalid: '+result.errors.join('; '));
const map=JSON.parse(await readFile(resolve(repoRoot,'release/P9-FAILURE-COURT-MAP.v1.0.json'),'utf8'));

const missingCourts=[];
const missingRefs=[];
const projections=[];
const courtCounts={};
const externalCounts={};
for(const scenario of result.scenarios){
  const binding=map.courts?.[scenario.evidenceCourt];
  if(!binding){missingCourts.push(scenario.evidenceCourt);continue;}
  for(const ref of binding.refs??[])if(!existsSync(resolve(repoRoot,ref)))missingRefs.push(ref);
  const projection=projectFailureScenario(scenario,{courtBinding:binding});
  assertFailureProjection(projection);
  projections.push(projection);
  courtCounts[scenario.evidenceCourt]=(courtCounts[scenario.evidenceCourt]??0)+1;
  for(const gate of binding.externalAcceptance??[])externalCounts[gate]=(externalCounts[gate]??0)+1;
}
if(missingCourts.length)throw new Error('P9 unmapped evidence courts: '+[...new Set(missingCourts)].sort().join(', '));
if(missingRefs.length)throw new Error('P9 missing court evidence refs: '+[...new Set(missingRefs)].sort().join(', '));
if(projections.length!==280)throw new Error('P9 projection count drift: '+projections.length);

const projectionDigest=createHash('sha256').update(JSON.stringify(projections)).digest('hex');
const receipt={
  schema:'opencontainer.p9-failure-scenario-court.v1.0',
  status:'PASS',
  sourceGate:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P9-03',
  source:{
    path:'docs/research/OPENCONTAINER-UX-STATE-FAILURE-MATRIX-v0.4-20260923.md',
    sha256:result.digest,
    scenarios:result.counts.total,
    uniqueQualifiedKeys:result.counts.uniqueQualifiedKeys,
    rawIdUnique:result.counts.rawIdUnique,
    duplicatedRawIds:result.counts.duplicatedRawIds,
    courtClasses:result.counts.courtClasses,
    rounds:result.counts.rounds
  },
  execution:{
    componentProjections:projections.length,
    projectionDigestSha256:projectionDigest,
    mappedCourtClasses:Object.keys(courtCounts).length,
    courtCounts,
    externalAcceptanceCounts:externalCounts,
    allEvidenceRefsExist:true
  },
  boundaries:{
    manualScreenReaderClaimed:false,
    humanComprehensionClaimed:false,
    weakDeviceLongSessionClaimed:false,
    crossBrowserClaimed:false,
    productionClosed:false
  },
  productionClosed:false
};
const output=resolve(repoRoot,'.artifacts/p9-failure-scenarios/receipt.json');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
console.log('P9 FAILURE SCENARIO COURT PASS '+JSON.stringify({
  scenarios:receipt.source.scenarios,
  courts:receipt.source.courtClasses,
  projectionDigest:receipt.execution.projectionDigestSha256,
  externalAcceptanceCounts:receipt.execution.externalAcceptanceCounts
}));
