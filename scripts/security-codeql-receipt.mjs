import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const sarifRoot=resolve(process.argv[2]??'.artifacts/codeql');
const outDir=resolve('.artifacts/security-review');
await mkdir(outDir,{recursive:true});

async function filesUnder(dir){
  const out=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory())out.push(...await filesUnder(path));
    else if(entry.name.endsWith('.sarif'))out.push(path);
  }
  return out;
}
function level(score){
  if(score>=9)return 'critical';
  if(score>=7)return 'high';
  if(score>=4)return 'moderate';
  if(score>0)return 'low';
  return 'unknown';
}
function stableFindingId({ruleId,uri,line,message}){
  return createHash('sha256').update([ruleId,uri,line,message].join('|')).digest('hex');
}

const sarifFiles=(await filesUnder(sarifRoot)).sort();
if(sarifFiles.length===0)throw new Error('CodeQL produced no SARIF files');
const waiverDoc=JSON.parse(await readFile('release/SECURITY-STATIC-ANALYSIS-WAIVERS.v1.0.json','utf8'));
if(waiverDoc.schema!=='opencontainer.security-static-analysis-waivers.v1.0')throw new Error('invalid CodeQL waiver registry schema');
const waivers=waiverDoc.waivers??[];
for(const waiver of waivers){
  for(const key of ['findingId','rationale','approvedBy','reviewedAt','expires']){
    if(typeof waiver[key]!=='string'||!waiver[key])throw new Error('CodeQL waiver missing '+key);
  }
  if(Date.parse(waiver.expires+'T23:59:59Z')<Date.now())throw new Error('CodeQL waiver expired: '+waiver.findingId);
}
const waivedIds=new Set(waivers.map(x=>x.findingId));
const findings=[];
for(const file of sarifFiles){
  const doc=JSON.parse(await readFile(file,'utf8'));
  for(const run of doc.runs??[]){
    const ruleMap=new Map((run.tool?.driver?.rules??[]).map(rule=>[rule.id,rule]));
    for(const result of run.results??[]){
      const rule=ruleMap.get(result.ruleId)??{};
      const rawScore=rule.properties?.['security-severity']??rule.properties?.securitySeverity??0;
      const score=Number(rawScore)||0;
      const uri=result.locations?.[0]?.physicalLocation?.artifactLocation?.uri??null;
      const line=result.locations?.[0]?.physicalLocation?.region?.startLine??null;
      const message=String(result.message?.text??result.message?.markdown??'').slice(0,2000);
      const findingId=stableFindingId({ruleId:result.ruleId??'unknown',uri:uri??'',line:line??'',message});
      findings.push({
        findingId,
        ruleId:result.ruleId??null,
        securitySeverity:score,
        severity:level(score),
        sarifLevel:result.level??null,
        uri,
        line,
        message,
        waived:waivedIds.has(findingId)
      });
    }
  }
}
const unique=[...new Map(findings.map(x=>[x.findingId,x])).values()];
const counts={critical:0,high:0,moderate:0,low:0,unknown:0};
for(const finding of unique)counts[finding.severity]++;
const blocking=unique.filter(x=>['critical','high'].includes(x.severity)&&!x.waived);
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
if(git.status!==0)throw new Error('git rev-parse HEAD failed');
const receipt={
  schema:'opencontainer.codeql-receipt.v1.0',
  sourceCommit:git.stdout.trim(),
  engine:'GitHub CodeQL',
  actionCommit:'2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2',
  sarifFiles:sarifFiles.length,
  findingCount:unique.length,
  severityCounts:counts,
  waiverCount:waivers.length,
  blockingUnwaived:blocking.length,
  status:blocking.length===0?'PASS':'FAIL',
  findings:unique
};
await writeFile(resolve(outDir,'codeql-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({...receipt,findings:undefined},null,2));
if(blocking.length)process.exitCode=1;
