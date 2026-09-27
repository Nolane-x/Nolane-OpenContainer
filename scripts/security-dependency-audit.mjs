import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const outDir=resolve('.artifacts/security-review');
await mkdir(outDir,{recursive:true});
const npm=process.platform==='win32'?'npm.cmd':'npm';
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
if(git.status!==0)throw new Error('git rev-parse HEAD failed');
const sourceCommit=git.stdout.trim();
const command=['audit','--json','--audit-level=high'];
const run=spawnSync(npm,command,{encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,npm_config_fund:'false'}});
const raw=run.stdout||'{}';
await writeFile(resolve(outDir,'npm-audit-raw.json'),raw);
const rawSha256=createHash('sha256').update(raw).digest('hex');

let report;
try{report=JSON.parse(run.stdout||'{}');}
catch(error){
  const receipt={schema:'opencontainer.dependency-audit.v1.0',sourceCommit,status:'FAIL',reason:'npm audit did not emit valid JSON',exitCode:run.status??1,rawSha256,stderr:String(run.stderr??'').slice(-8000)};
  await writeFile(resolve(outDir,'dependency-audit-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.error(JSON.stringify(receipt,null,2));
  process.exit(1);
}
const counts=report?.metadata?.vulnerabilities??{};
const normalized={
  info:Number(counts.info??0),
  low:Number(counts.low??0),
  moderate:Number(counts.moderate??0),
  high:Number(counts.high??0),
  critical:Number(counts.critical??0),
  total:Number(counts.total??0)
};
const blocking=normalized.high+normalized.critical;
const hasMetadata=report?.metadata&&report.metadata.vulnerabilities;
const unavailable=!hasMetadata||report?.error;
const status=!unavailable&&blocking===0?'PASS':'FAIL';
const receipt={
  schema:'opencontainer.dependency-audit.v1.0',
  sourceCommit,
  status,
  command:'npm '+command.join(' '),
  includeDevBuildTooling:true,
  blockSeverities:['high','critical'],
  vulnerabilities:normalized,
  blockingFindings:blocking,
  auditExitCode:run.status??1,
  rawSha256,
  auditError:report?.error??null
};
await writeFile(resolve(outDir,'dependency-audit-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(status!=='PASS')process.exitCode=1;
