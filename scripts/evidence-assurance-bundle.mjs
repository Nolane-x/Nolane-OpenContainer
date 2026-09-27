import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpus, totalmem, platform as osPlatform, release as osRelease } from 'node:os';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evidenceLevelCounts,
  sha256,
  validateAssurancePolicy,
  validateEvidenceRegistry,
  validateNegativeResults
} from './evidence-assurance-policy.mjs';

export const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');

export async function readJson(path){
  return JSON.parse(await readFile(resolve(repoRoot,path),'utf8'));
}

export function gitHead(){
  const result=spawnSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'});
  if(result.status!==0)throw new Error('git rev-parse HEAD failed: '+(result.stderr??''));
  return result.stdout.trim();
}

export function gitBlob(path){
  const result=spawnSync('git',['hash-object',path],{cwd:repoRoot,encoding:'utf8'});
  if(result.status!==0)throw new Error('git hash-object '+path+' failed: '+(result.stderr??''));
  return result.stdout.trim();
}

export function npmVersion(){
  const command=process.platform==='win32'?'npm.cmd':'npm';
  const result=spawnSync(command,['--version'],{cwd:repoRoot,encoding:'utf8'});
  if(result.status!==0)throw new Error('npm --version failed: '+(result.stderr??''));
  return result.stdout.trim();
}

export function baseEnvironment(scope){
  return {
    schema:'opencontainer.evidence-environment.v1.0',
    scope,
    sourceCommit:gitHead(),
    node:process.version,
    npm:npmVersion(),
    platform:process.platform,
    arch:process.arch,
    os:{platform:osPlatform(),release:osRelease()},
    cpu:{logicalCount:cpus().length,model:cpus()[0]?.model??null},
    totalMemoryBytes:totalmem(),
    ci:{
      githubActions:process.env.GITHUB_ACTIONS==='true',
      runId:process.env.GITHUB_RUN_ID??null,
      runAttempt:process.env.GITHUB_RUN_ATTEMPT??null,
      runnerOs:process.env.RUNNER_OS??null,
      runnerArch:process.env.RUNNER_ARCH??null
    }
  };
}

async function corpusLockReceipt(){
  const expected=await readJson('release/EVIDENCE-CORPUS-LOCK.v1.0.json');
  const corpusBytes=await readFile(resolve(repoRoot,expected.corpusPath));
  const corpus=JSON.parse(corpusBytes.toString('utf8'));
  const actualGitBlobSha=gitBlob(expected.corpusPath);
  if(actualGitBlobSha!==expected.gitBlobSha)throw new Error('compatibility corpus changed without a new evidence corpus lock');
  if(corpus.schema!==expected.corpusSchema||corpus.frozenAt!==expected.corpusFrozenAt||corpus.cases?.length!==expected.caseCount){
    throw new Error('compatibility corpus metadata/count drifted from evidence corpus lock');
  }
  return {
    ...expected,
    actualGitBlobSha,
    sha256:createHash('sha256').update(corpusBytes).digest('hex'),
    verified:true
  };
}

async function copyLogs(outputDir,logSources){
  const logDir=join(outputDir,'logs');
  await mkdir(logDir,{recursive:true});
  const entries=[];
  for(const source of logSources){
    const absolute=resolve(repoRoot,source);
    const bytes=await readFile(absolute);
    const name=basename(source);
    const target=join(logDir,name);
    await writeFile(target,bytes);
    entries.push({path:'logs/'+name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  return entries;
}

async function listFiles(root,current=root){
  const rows=[];
  for(const entry of await readdir(current,{withFileTypes:true})){
    const path=join(current,entry.name);
    if(entry.isDirectory())rows.push(...await listFiles(root,path));
    else rows.push(relative(root,path).replaceAll('\\','/'));
  }
  return rows.sort();
}

export async function buildEvidenceBundle({
  scope,
  environment,
  rawResults,
  summary,
  failureCases,
  logSources,
  outputDir=join(repoRoot,'.artifacts','evidence-assurance',scope)
}){
  const [policy,registry,ledger,negativeResults]=await Promise.all([
    readJson('release/EVIDENCE-ASSURANCE-POLICY.v1.0.json'),
    readJson('release/EVIDENCE-REGISTRY.v1.0.json'),
    readJson('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json'),
    readJson('release/EVIDENCE-NEGATIVE-RESULTS.v1.0.json')
  ]);
  const policyErrors=validateAssurancePolicy(policy);
  const registryErrors=validateEvidenceRegistry({policy,registry,ledger});
  const negativeErrors=validateNegativeResults({policy,negativeResults});
  if(policyErrors.length||registryErrors.length||negativeErrors.length){
    throw new Error('P18 assurance policy/registry invalid: '+JSON.stringify({policyErrors,registryErrors,negativeErrors}));
  }

  await rm(outputDir,{recursive:true,force:true});
  await mkdir(outputDir,{recursive:true});
  const logs=await copyLogs(outputDir,logSources);
  const corpusLock=await corpusLockReceipt();
  const normalizedSummary={
    ...summary,
    schema:'opencontainer.evidence-summary.v1.0',
    scope,
    sourceCommit:gitHead(),
    ledger:{
      reconciled:ledger.overrides.length,
      closed:ledger.overrides.filter(item=>item.closure_met===true).length,
      partial:ledger.overrides.filter(item=>item.state==='PARTIAL').length,
      productionClosed:ledger.production_closed===true
    },
    evidenceLevelCounts:evidenceLevelCounts({registry,ledger}),
    corpusCaseCount:corpusLock.caseCount,
    negativeResultCount:negativeResults.results.length
  };
  const logsIndex={
    schema:'opencontainer.evidence-logs.v1.0',
    scope,
    sourceCommit:gitHead(),
    entries:logs
  };
  const files={
    'environment.json':environment,
    'raw-results.json':rawResults,
    'summary.json':normalizedSummary,
    'logs.json':logsIndex,
    'failure-cases.json':failureCases,
    'corpus-lock.json':corpusLock,
    'negative-results.json':negativeResults
  };
  for(const [name,value] of Object.entries(files)){
    await writeFile(join(outputDir,name),JSON.stringify(value,null,2)+'\n');
  }

  const manifestFiles=[];
  for(const name of await listFiles(outputDir)){
    if(name==='manifest.json')continue;
    const bytes=await readFile(join(outputDir,name));
    manifestFiles.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const required=policy.decisiveBundle.requiredFiles;
  for(const name of required){
    if(!manifestFiles.some(item=>item.path===name))throw new Error('decisive evidence bundle missing '+name);
  }
  const manifest={
    schema:'opencontainer.evidence-assurance-bundle.v1.0',
    scope,
    sourceCommit:gitHead(),
    digest:'sha256',
    requiredFiles:required,
    fileCount:manifestFiles.length,
    files:manifestFiles,
    productionClosed:ledger.production_closed===true
  };
  await writeFile(join(outputDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

export async function verifyEvidenceBundle(scope,{outputDir=join(repoRoot,'.artifacts','evidence-assurance',scope)}={}){
  const [policy,registry,ledger,negativeResults,manifest,environment,rawResults,summary,logs,failureCases,corpusLock]=await Promise.all([
    readJson('release/EVIDENCE-ASSURANCE-POLICY.v1.0.json'),
    readJson('release/EVIDENCE-REGISTRY.v1.0.json'),
    readJson('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json'),
    readJson('release/EVIDENCE-NEGATIVE-RESULTS.v1.0.json'),
    JSON.parse(await readFile(join(outputDir,'manifest.json'),'utf8')),
    JSON.parse(await readFile(join(outputDir,'environment.json'),'utf8')),
    JSON.parse(await readFile(join(outputDir,'raw-results.json'),'utf8')),
    JSON.parse(await readFile(join(outputDir,'summary.json'),'utf8')),
    JSON.parse(await readFile(join(outputDir,'logs.json'),'utf8')),
    JSON.parse(await readFile(join(outputDir,'failure-cases.json'),'utf8')),
    JSON.parse(await readFile(join(outputDir,'corpus-lock.json'),'utf8'))
  ]);
  const errors=[
    ...validateAssurancePolicy(policy),
    ...validateEvidenceRegistry({policy,registry,ledger}),
    ...validateNegativeResults({policy,negativeResults})
  ];
  if(manifest.schema!=='opencontainer.evidence-assurance-bundle.v1.0')errors.push('invalid assurance bundle manifest schema');
  if(manifest.scope!==scope)errors.push('assurance bundle scope mismatch');
  if(manifest.sourceCommit!==gitHead())errors.push('assurance bundle source commit does not match checkout');
  if(manifest.digest!=='sha256')errors.push('assurance bundle digest is not sha256');
  for(const required of policy.decisiveBundle.requiredFiles){
    if(!manifest.files?.some(item=>item.path===required))errors.push('manifest missing required file '+required);
  }
  for(const item of manifest.files??[]){
    const bytes=await readFile(join(outputDir,item.path));
    const actual=createHash('sha256').update(bytes).digest('hex');
    if(actual!==item.sha256)errors.push('digest mismatch for '+item.path);
    if(bytes.length!==item.bytes)errors.push('byte count mismatch for '+item.path);
  }
  if(environment.schema!=='opencontainer.evidence-environment.v1.0'||environment.sourceCommit!==gitHead())errors.push('environment receipt is not commit-bound');
  for(const threat of policy.benchmarkValidityThreats){
    if(!(threat in (environment.validityThreats??{})))errors.push('environment receipt missing validity threat '+threat);
  }
  if(summary.schema!=='opencontainer.evidence-summary.v1.0'||summary.sourceCommit!==gitHead())errors.push('summary is not commit-bound');
  if(summary.ledger?.reconciled!==ledger.overrides.length)errors.push('summary ledger reconciled count was hand-drifted');
  if(summary.ledger?.closed!==ledger.overrides.filter(item=>item.closure_met===true).length)errors.push('summary ledger closed count was hand-drifted');
  if(summary.ledger?.partial!==ledger.overrides.filter(item=>item.state==='PARTIAL').length)errors.push('summary ledger partial count was hand-drifted');
  if(summary.negativeResultCount!==negativeResults.results.length)errors.push('summary negative-result count drifted');
  if(corpusLock.actualGitBlobSha!==gitBlob(corpusLock.corpusPath)||corpusLock.verified!==true)errors.push('corpus lock is not verified against checkout bytes');
  if(logs.schema!=='opencontainer.evidence-logs.v1.0'||!Array.isArray(logs.entries)||logs.entries.length===0)errors.push('decisive experiment logs are missing');
  for(const item of logs.entries??[]){
    const bytes=await readFile(join(outputDir,item.path));
    if(sha256(bytes)!==item.sha256)errors.push('log digest mismatch '+item.path);
  }
  for(const item of failureCases?.currentFailures??[]){
    if(item.excluded===true&&!policy.exclusionReasonCodes.includes(item.reasonCode))errors.push('failure excluded without predefined harness reason code');
    if(item.excluded===true&&!String(item.reasonCode).startsWith('HARNESS_'))errors.push('non-harness failure was excluded');
  }
  if(rawResults?.sourceCommit!==gitHead())errors.push('raw-results source commit mismatch');
  return {ok:errors.length===0,errors,manifest,summary};
}
