import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');

function sha256(text){
  return createHash('sha256').update(text).digest('hex');
}

function gitHead(){
  const result=spawnSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'});
  if(result.status!==0)throw new Error('git rev-parse HEAD failed: '+(result.stderr??''));
  return result.stdout.trim();
}

function activeException(policy,output,scope){
  const today=Date.now();
  for(const item of policy.knownFlakeExceptions??[]){
    if(item.scope!==scope)continue;
    if(typeof item.issue!=='string'||!item.issue.trim())continue;
    if(typeof item.expires!=='string'||!item.expires.trim())continue;
    if(typeof item.signature!=='string'||!item.signature)continue;
    const expires=Date.parse(item.expires+'T23:59:59Z');
    if(!Number.isFinite(expires)||expires<today)continue;
    if(output.includes(item.signature))return item;
  }
  return null;
}

function tail(text,maxLines=50){
  const lines=String(text).split(/\r?\n/);
  return lines.slice(Math.max(0,lines.length-maxLines)).join('\n').slice(-10000);
}

const policy=JSON.parse(await readFile(join(repoRoot,'release/CRITICAL-FLAKE-POLICY.v0.1.json'),'utf8'));
const config=policy.browser;
if(policy.schema!=='opencontainer.critical-flake-policy.v0.1')throw new Error('critical flake policy schema drifted');
if(!Number.isInteger(config.iterations)||config.iterations<config.minimumIterations)throw new Error('critical browser iteration count is below frozen minimum');
if(!Array.isArray(config.command)||config.command.length<2)throw new Error('critical browser command is invalid');

const outputDir=join(repoRoot,'.artifacts','critical-flake');
await mkdir(outputDir,{recursive:true});

const sourceCommit=gitHead();
const runs=[];
let unexplainedFailures=0;
let explainedFailures=0;

for(let iteration=1;iteration<=config.iterations;iteration++){
  const [command,...args]=config.command;
  const executable=command==='node'?process.execPath:command;
  const started=Date.now();
  const result=spawnSync(executable,args,{
    cwd:repoRoot,
    encoding:'utf8',
    env:{...process.env,OPENCONTAINER_BROWSER_FLAKE_ITERATION:String(iteration)}
  });
  const durationMs=Date.now()-started;
  const output=(result.stdout??'')+(result.stderr??'');
  const outputSha256=sha256(output);
  let classification='PASS';
  let exception=null;
  if(result.status!==0){
    exception=activeException(policy,output,'browser');
    if(exception){
      classification='EXPLAINED-FAILURE';
      explainedFailures++;
    }else{
      classification='UNEXPLAINED-FAILURE';
      unexplainedFailures++;
    }
  }
  runs.push(Object.freeze({
    iteration,
    exitCode:result.status??1,
    durationMs,
    classification,
    outputSha256,
    exceptionId:exception?.id??null,
    browserAcceptancePass:output.includes('browser acceptance PASS'),
    distributionBrowserPass:output.includes('distribution browser PASS'),
    failureTail:result.status===0?null:tail(output)
  }));
  if(result.status===0){
    process.stdout.write('[critical-browser-flake] iteration '+iteration+' PASS in '+durationMs+'ms\n');
  }
}

const receipt=Object.freeze({
  schema:'opencontainer.critical-flake-browser.v0.1',
  sourceCommit,
  scope:'browser',
  profile:config.profile,
  iterations:config.iterations,
  passedIterations:runs.filter((item)=>item.exitCode===0).length,
  failedIterations:runs.filter((item)=>item.exitCode!==0).length,
  explainedFailures,
  unexplainedFailures,
  knownExceptionCount:(policy.knownFlakeExceptions??[]).filter((item)=>item.scope==='browser').length,
  fullProductPathPasses:runs.filter((item)=>item.browserAcceptancePass&&item.distributionBrowserPass).length,
  status:unexplainedFailures===0&&runs.every((item)=>item.browserAcceptancePass&&item.distributionBrowserPass)?'PASS':'FAIL',
  runs:Object.freeze(runs)
});

await writeFile(join(outputDir,'browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(receipt.status!=='PASS')process.exitCode=1;
