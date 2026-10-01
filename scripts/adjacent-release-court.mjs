import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeBrowserPage } from './browser-page-probe-lib.mjs';

const PACKAGE='@nolane/opencontainer';
const npmCommand=process.platform==='win32'?'npm.cmd':'npm';

function run(command,args,options={}){
  const result=spawnSync(command,args,{encoding:'utf8',...options});
  if(result.status!==0)throw new Error(command+' '+args.join(' ')+' failed\n'+String(result.stdout??'')+'\n'+String(result.stderr??''));
  return String(result.stdout??'').trim();
}
function parseArgs(argv){const out={};for(const item of argv){const m=String(item).match(/^--([^=]+)=(.*)$/);if(m)out[m[1]]=m[2];}return out;}
export function validateAdjacentVersions({previousVersion,currentVersion,publishedVersions}){
  const errors=[];
  const semverLike=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  if(!semverLike.test(String(previousVersion??'')))errors.push('previous version invalid');
  if(!semverLike.test(String(currentVersion??'')))errors.push('current version invalid');
  if(previousVersion===currentVersion)errors.push('adjacent versions must differ');
  const list=Array.isArray(publishedVersions)?publishedVersions:[];
  const previousIndex=list.indexOf(previousVersion);
  const currentIndex=list.indexOf(currentVersion);
  if(previousIndex<0)errors.push('previous version is not published');
  if(currentIndex<0)errors.push('current version is not published');
  if(previousIndex>=0&&currentIndex>=0&&currentIndex!==previousIndex+1)errors.push('versions are not adjacent in npm publication history');
  return errors;
}
async function freePort(){
  const server=createServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const port=server.address().port;
  await new Promise((resolveClose,reject)=>server.close(error=>error?reject(error):resolveClose()));
  return port;
}
async function waitServer(child,timeoutMs=10000){
  let output='';
  return new Promise((resolveReady,reject)=>{
    const timer=setTimeout(()=>reject(new Error('installed release server timeout: '+output)),timeoutMs);
    child.stdout.on('data',chunk=>{
      output+=String(chunk);
      if(output.includes('OpenContainer playground:')){clearTimeout(timer);resolveReady();}
    });
    child.stderr.on('data',chunk=>{output+=String(chunk);});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{
      if(!output.includes('OpenContainer playground:')){clearTimeout(timer);reject(new Error('installed release server exited '+code+': '+output));}
    });
  });
}
async function terminate(child){
  if(!child||child.exitCode!==null)return;
  await new Promise(resolveTerminate=>{
    let done=false;
    const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolveTerminate();};
    const timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}finish();},3000);
    child.once('exit',finish);
    try{child.kill('SIGTERM');}catch{finish();}
  });
}
async function installVersion(version,prefix){
  const root=await mkdtemp(join(tmpdir(),prefix));
  await writeFile(join(root,'package.json'),JSON.stringify({name:prefix,private:true,type:'module'},null,2)+'\n');
  run(npmCommand,['install','--ignore-scripts','--package-lock=true','--no-audit','--no-fund',PACKAGE+'@'+version],{cwd:root});
  run(npmCommand,['audit','signatures'],{cwd:root});
  const packageRoot=join(root,'node_modules','@nolane','opencontainer');
  const manifest=JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8'));
  const profile=JSON.parse(await readFile(join(packageRoot,'docs','production','RELEASE-STORAGE-PROFILE.v1.0.json'),'utf8'));
  if(manifest.name!==PACKAGE||manifest.version!==version)throw new Error('installed package identity drift for '+version);
  if(profile.schema!=='opencontainer.release-storage-profile.v1.0')throw new Error('release storage profile schema drift for '+version);
  if(profile.runtimeVersion!==version)throw new Error('release storage profile runtime version drift for '+version);
  if(profile.adjacentEvidenceEligible!==true)throw new Error('release is not marked adjacent-evidence eligible: '+version);
  if(profile.destructiveStorageDowngrade!==false)throw new Error('release profile allows destructive downgrade: '+version);
  return {root,packageRoot,manifest,profile};
}
async function runPhase({packageRoot,port,profilePath,phase,campaign,marker,previousVersion,currentVersion}){
  const server=spawn(process.execPath,['apps/playground/server.mjs'],{
    cwd:packageRoot,
    env:{...process.env,PORT:String(port)},
    stdio:['ignore','pipe','pipe']
  });
  try{
    await waitServer(server);
    const query=new URLSearchParams({phase,campaign,marker,previousVersion,currentVersion});
    const url='http://127.0.0.1:'+port+'/adjacent-release-probe.html?'+query.toString();
    const browser=await probeBrowserPage(url,{profilePath,timeoutMs:90000});
    if(browser.result?.status!=='PASS')throw new Error('adjacent release phase '+phase+' failed: '+JSON.stringify(browser.result));
    return browser;
  }finally{await terminate(server);}
}
async function main(){
  const args=parseArgs(process.argv.slice(2));
  const previousVersion=args.previous;
  const currentVersion=args.current;
  const output=resolve(args.output??'.artifacts/adjacent-release/receipt.json');
  const publishedRaw=JSON.parse(run(npmCommand,['view',PACKAGE,'versions','--json']));
  const publishedVersions=Array.isArray(publishedRaw)?publishedRaw:[publishedRaw].filter(Boolean);
  const errors=validateAdjacentVersions({previousVersion,currentVersion,publishedVersions});
  if(errors.length)throw new Error('invalid adjacent release request: '+errors.join('; '));

  const previous=await installVersion(previousVersion,'opencontainer-adjacent-previous-');
  const current=await installVersion(currentVersion,'opencontainer-adjacent-current-');
  const profilePath=await mkdtemp(join(tmpdir(),'opencontainer-adjacent-browser-'));
  try{
    const previousStorage=Number(previous.profile.storageVersion);
    const currentStorage=Number(current.profile.storageVersion);
    if(!Number.isInteger(previousStorage)||!Number.isInteger(currentStorage))throw new Error('release storage versions must be integers');
    if(currentStorage<previousStorage||currentStorage>previousStorage+1)throw new Error('adjacent release storage transition must be same version or +1');
    if(currentStorage===previousStorage+1&&!current.profile.adjacentUpgradeFrom?.includes(previousStorage)){
      throw new Error('current release does not authorize migration from previous storage version');
    }

    const port=await freePort();
    const runId=process.env.GITHUB_RUN_ID??'local';
    const campaign='adjacent-'+String(runId)+'-'+createHash('sha256').update(previousVersion+'>'+currentVersion).digest('hex').slice(0,12);
    const marker='oc-adjacent-'+createHash('sha256').update(previousVersion+'|'+currentVersion+'|'+runId).digest('hex').slice(0,32);

    const seed=await runPhase({packageRoot:previous.packageRoot,port,profilePath,phase:'seed',campaign,marker,previousVersion,currentVersion});
    const upgrade=await runPhase({packageRoot:current.packageRoot,port,profilePath,phase:'upgrade',campaign,marker,previousVersion,currentVersion});
    const rollback=await runPhase({packageRoot:previous.packageRoot,port,profilePath,phase:'rollback',campaign,marker,previousVersion,currentVersion});
    const verifyCurrent=await runPhase({packageRoot:current.packageRoot,port,profilePath,phase:'verify-current',campaign,marker,previousVersion,currentVersion});

    if(seed.result.action!=='seeded')throw new Error('previous release did not seed canonical storage');
    if(!['reuse-compatible-storage','migrated'].includes(upgrade.result.action))throw new Error('current release did not reuse/migrate adjacent storage');
    if(!['rollback-compatible-read-write','rollback-read-only','rollback-refuse-open'].includes(rollback.result.action))throw new Error('previous release rollback did not preserve compatibility safely');
    if(verifyCurrent.result.action!=='verified-current-after-rollback')throw new Error('current release could not verify state after rollback attempt');

    const receipt={
      schema:'opencontainer.adjacent-published-release-court.v1.0',
      status:'PASS',
      sourceGate:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P14-04',
      sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
      workflowRunId:process.env.GITHUB_RUN_ID??null,
      package:PACKAGE,
      publication:{previousVersion,currentVersion,previousIndex:publishedVersions.indexOf(previousVersion),currentIndex:publishedVersions.indexOf(currentVersion),adjacent:true},
      storageProfiles:{previous:previous.profile,current:current.profile},
      sameOrigin:'http://127.0.0.1:'+port,
      sameBrowserProfile:true,
      phases:{
        seed:seed.result,
        upgrade:upgrade.result,
        rollback:rollback.result,
        verifyCurrent:verifyCurrent.result
      },
      npmSignatureAudit:{previous:true,current:true},
      candidateGateState:{'P14-04':'READY_FOR_REVIEW'},
      closureEligible:false,
      closureReason:'Passing actual adjacent published artifacts are reviewable evidence only; promotion must bind both public release identities and retained browser receipts.',
      productionClosed:false
    };
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
    console.log('ADJACENT PUBLISHED RELEASE PASS '+JSON.stringify({previousVersion,currentVersion,previousStorage,currentStorage,rollback:rollback.result.action,closureEligible:false}));
  }finally{
    await Promise.all([
      rm(previous.root,{recursive:true,force:true,maxRetries:8,retryDelay:100}),
      rm(current.root,{recursive:true,force:true,maxRetries:8,retryDelay:100}),
      rm(profilePath,{recursive:true,force:true,maxRetries:8,retryDelay:100})
    ]);
  }
}
const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
