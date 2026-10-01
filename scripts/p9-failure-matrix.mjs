import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const P9_FAILURE_MATRIX_PATH='docs/research/OPENCONTAINER-UX-STATE-FAILURE-MATRIX-v0.4-20260923.md';
export const P9_FAILURE_MATRIX_SHA256='7f329e45b704465947488532658abdde90d699fc4ed33fc96e86bb603769ede5';

const EXPECTED=Object.freeze({
  total:280,
  rawIdUnique:234,
  duplicatedRawIds:46,
  courtClasses:55,
  rounds:Object.freeze({base:100,round23:40,round24State:50,round24Completeness:40,round25:50})
});

function sha256(value){return createHash('sha256').update(value).digest('hex');}
function splitRow(line){
  if(!line.startsWith('|')||!line.endsWith('|'))return null;
  const cells=line.slice(1,-1).split('|').map(value=>value.trim());
  if(cells.length!==7)return null;
  if(cells[0]==='ID'||cells.every(value=>/^[-:]+$/.test(value)))return null;
  return cells;
}
function roundFor({section,id}){
  if(/^R25-\d+$/.test(id))return 'round25';
  if(section==='round24-completeness')return 'round24Completeness';
  if(section==='round24-state')return 'round24State';
  if(section==='round23')return 'round23';
  return 'base';
}
export function parseP9FailureMatrix(text){
  let section='base';
  const scenarios=[];
  for(const [index,line] of String(text).split(/\r?\n/).entries()){
    if(line.trim()==='## Round-23 extension rows')section='round23';
    else if(line.trim()==='# Round-24 state/failure extension')section='round24-state';
    else if(line.trim()==='## Round-24 additional completeness rows')section='round24-completeness';
    const cells=splitRow(line);
    if(!cells)continue;
    const [sourceId,subsystem,trigger,userVisibleState,canonicalGuarantee,primaryRecoveryAction,evidenceCourt]=cells;
    const round=roundFor({section,id:sourceId});
    const scenario=Object.freeze({
      key:round+':'+sourceId,
      round,
      sourceId,
      sourceLine:index+1,
      subsystem,
      trigger,
      userVisibleState,
      canonicalGuarantee,
      primaryRecoveryAction,
      evidenceCourt
    });
    scenarios.push(scenario);
  }
  return Object.freeze(scenarios);
}

export function validateP9FailureMatrix({text,sourceSha256=P9_FAILURE_MATRIX_SHA256}){
  const bytes=Buffer.from(String(text),'utf8');
  const digest=sha256(bytes);
  const scenarios=parseP9FailureMatrix(text);
  const errors=[];
  if(digest!==sourceSha256)errors.push('source SHA-256 drift: '+digest);
  if(scenarios.length!==EXPECTED.total)errors.push('scenario count drift: '+scenarios.length);
  const keys=new Set(scenarios.map(row=>row.key));
  if(keys.size!==scenarios.length)errors.push('qualified scenario key collision');
  const rawIds=scenarios.map(row=>row.sourceId);
  const rawCounts=new Map();
  for(const id of rawIds)rawCounts.set(id,(rawCounts.get(id)??0)+1);
  if(rawCounts.size!==EXPECTED.rawIdUnique)errors.push('raw-id unique count drift: '+rawCounts.size);
  const duplicateIds=[...rawCounts].filter(([,count])=>count>1);
  if(duplicateIds.length!==EXPECTED.duplicatedRawIds)errors.push('duplicated raw-id count drift: '+duplicateIds.length);
  const roundCounts=Object.fromEntries(Object.keys(EXPECTED.rounds).map(round=>[round,scenarios.filter(row=>row.round===round).length]));
  for(const [round,count] of Object.entries(EXPECTED.rounds))if(roundCounts[round]!==count)errors.push(round+' count drift: '+roundCounts[round]);
  const courts=new Set(scenarios.map(row=>row.evidenceCourt));
  if(courts.size!==EXPECTED.courtClasses)errors.push('court-class count drift: '+courts.size);
  for(const row of scenarios){
    for(const field of ['sourceId','subsystem','trigger','userVisibleState','canonicalGuarantee','primaryRecoveryAction','evidenceCourt']){
      if(!String(row[field]??'').trim())errors.push(row.key+' missing '+field);
    }
  }
  if(!String(text).includes('**Verified row target after Round 25: 280 executable failure scenarios.**'))errors.push('final Round-25 target marker missing');
  return Object.freeze({
    ok:errors.length===0,
    errors:Object.freeze(errors),
    digest,
    scenarios,
    counts:Object.freeze({
      total:scenarios.length,
      uniqueQualifiedKeys:keys.size,
      rawIdUnique:rawCounts.size,
      duplicatedRawIds:duplicateIds.length,
      courtClasses:courts.size,
      rounds:Object.freeze(roundCounts)
    }),
    courtClasses:Object.freeze([...courts].sort()),
    duplicatedRawIds:Object.freeze(duplicateIds.map(([id,count])=>Object.freeze({id,count})).sort((a,b)=>a.id.localeCompare(b.id)))
  });
}

export async function loadP9FailureMatrix(path=P9_FAILURE_MATRIX_PATH){
  const text=await readFile(resolve(path),'utf8');
  return validateP9FailureMatrix({text});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const result=await loadP9FailureMatrix(process.argv[2]??P9_FAILURE_MATRIX_PATH);
  if(!result.ok){
    console.error(JSON.stringify({ok:false,errors:result.errors},null,2));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok:true,
    digest:result.digest,
    counts:result.counts,
    courtClasses:result.courtClasses
  },null,2));
}
