import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const registry=JSON.parse(await readFile('release/SECURITY-REGRESSION-REGISTRY.v1.0.json','utf8'));
if(registry.schema!=='opencontainer.security-regression-registry.v1.0')throw new Error('invalid security regression registry schema');
const tests=new Set();
const cases=[];
for(const entry of registry.entries??[]){
  const testEvidence=(entry.evidence??[]).filter(path=>path.startsWith('tests/')&&path.endsWith('.test.js'));
  if(testEvidence.length===0)throw new Error('security regression '+entry.id+' has no executable test evidence');
  for(const path of testEvidence)tests.add(path);
  cases.push({id:entry.id,severity:entry.severity,class:entry.class,tests:testEvidence});
}
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
if(git.status!==0)throw new Error('git rev-parse HEAD failed');
const sourceCommit=git.stdout.trim();
const files=[...tests].sort();
const run=spawnSync(process.execPath,['--test',...files],{encoding:'utf8',maxBuffer:32*1024*1024});
const log=(run.stdout??'')+(run.stderr??'');
const outDir=resolve('.artifacts/security-review');
await mkdir(outDir,{recursive:true});
await writeFile(resolve(outDir,'security-regression.log'),log);
const receipt={
  schema:'opencontainer.security-regression-receipt.v1.0',
  sourceCommit,
  status:run.status===0?'PASS':'FAIL',
  registryEntries:cases.length,
  executableTestFiles:files.length,
  testFiles:files,
  cases,
  exitCode:run.status??1,
  logSha256:createHash('sha256').update(log).digest('hex')
};
await writeFile(resolve(outDir,'regression-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(receipt.status!=='PASS')process.exitCode=1;
