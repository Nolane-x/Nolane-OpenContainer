import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const port=Number(process.env.OPENCONTAINER_P4_ATOMICITY_PORT||4331);
const iterations=Number(process.env.OPENCONTAINER_P4_ATOMICITY_ITERATIONS||2);
const origin='http://127.0.0.1:'+port;
const candidates=process.platform==='win32'
  ? ['chrome.exe','msedge.exe']
  : ['google-chrome-stable','google-chrome','chromium','chromium-browser'];

function assert(condition,message,details={}){
  if(!condition){
    const error=new Error(message);
    error.details=details;
    throw error;
  }
}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function findBrowser(){
  for(const command of candidates){
    const result=spawnSync(command,['--version'],{encoding:'utf8'});
    if(result.status===0)return {command,version:String(result.stdout||result.stderr).trim()};
  }
  throw new Error('No supported Chrome/Chromium binary found for P4 publication atomicity court');
}
function waitForServer(child){
  return new Promise((resolvePromise,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Playground server did not start')),7000);
    let stderr='';
    child.stderr.on('data',chunk=>{stderr+=String(chunk);});
    child.stdout.on('data',chunk=>{
      const output=String(chunk);
      process.stdout.write(output);
      if(output.includes('OpenContainer playground:')){
        clearTimeout(timer);
        resolvePromise();
      }
    });
    child.once('exit',code=>{
      clearTimeout(timer);
      reject(new Error('Playground server exited early with code '+code+'\n'+stderr));
    });
  });
}
async function waitForDevTools(child,profile,timeoutMs=30000){
  let stderr='';
  const onData=chunk=>{stderr+=String(chunk);};
  child.stderr.on('data',onData);
  const deadline=Date.now()+timeoutMs;
  try{
    while(Date.now()<deadline){
      const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if(match)return {browserWebSocket:match[1],stderr:()=>stderr};
      try{
        const active=await readFile(join(profile,'DevToolsActivePort'),'utf8');
        const [portLine,pathLine]=active.trim().split(/\r?\n/);
        const debugPort=Number(portLine);
        if(Number.isInteger(debugPort)&&debugPort>0&&pathLine?.startsWith('/devtools/browser/')){
          return {browserWebSocket:'ws://127.0.0.1:'+debugPort+pathLine,stderr:()=>stderr};
        }
      }catch{}
      if(child.exitCode!==null)throw new Error('Chrome exited before DevTools was ready: '+child.exitCode+'\n'+stderr);
      await delay(100);
    }
    throw new Error('Chrome DevTools endpoint did not appear within '+timeoutMs+'ms\n'+stderr);
  }finally{
    child.stderr.off('data',onData);
  }
}
function connectCdp(webSocketUrl){
  return new Promise((resolvePromise,reject)=>{
    const socket=new WebSocket(webSocketUrl);
    const pending=new Map();
    let nextId=0;
    socket.addEventListener('open',()=>resolvePromise({
      async command(method,params={}){
        const id=++nextId;
        const response=new Promise((res,rej)=>pending.set(id,{res,rej,method}));
        socket.send(JSON.stringify({id,method,params}));
        return response;
      },
      close(){socket.close();}
    }));
    socket.addEventListener('message',event=>{
      const message=JSON.parse(String(event.data));
      if(!message.id)return;
      const waiter=pending.get(message.id);
      if(!waiter)return;
      pending.delete(message.id);
      if(message.error)waiter.rej(new Error(waiter.method+': '+message.error.message));
      else waiter.res(message.result);
    });
    socket.addEventListener('error',()=>reject(new Error('CDP WebSocket failed: '+webSocketUrl)));
    socket.addEventListener('close',()=>{
      for(const waiter of pending.values())waiter.rej(new Error('CDP WebSocket closed'));
      pending.clear();
    });
  });
}
async function terminateChild(child,timeoutMs=3000){
  if(!child||child.exitCode!==null)return;
  await new Promise(resolvePromise=>{
    let settled=false;
    const finish=()=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      resolvePromise();
    };
    const timer=setTimeout(()=>{
      try{child.kill('SIGKILL');}catch{}
      finish();
    },timeoutMs);
    child.once('exit',finish);
    try{child.kill('SIGTERM');}catch{finish();}
  });
}
async function newTarget(debugPort,url){
  const response=await fetch(
    'http://127.0.0.1:'+debugPort+'/json/new?'+encodeURIComponent(url),
    {method:'PUT'}
  );
  assert(response.ok,'Chrome failed to create target',{status:response.status,url});
  const target=await response.json();
  assert(target?.id&&target?.webSocketDebuggerUrl,'Chrome target response is incomplete',{target});
  return target;
}
async function closeTarget(debugPort,target){
  if(!target?.id)return;
  try{await fetch('http://127.0.0.1:'+debugPort+'/json/close/'+target.id);}catch{}
}
async function evaluate(cdp,expression){
  const response=await cdp.command('Runtime.evaluate',{
    expression,
    awaitPromise:true,
    returnByValue:true
  });
  if(response.exceptionDetails){
    throw new Error(
      'Runtime.evaluate exception: '+
      (response.exceptionDetails.exception?.description??response.exceptionDetails.text??'unknown')
    );
  }
  return response.result?.value;
}
async function waitForCourt(cdp,timeoutMs=10000){
  const deadline=Date.now()+timeoutMs;
  let last=null;
  while(Date.now()<deadline){
    try{
      last=await evaluate(cdp,`({
        ready:document.body?.dataset?.ready??null,
        hasCourt:typeof globalThis.__p4AtomicityCourt==='object',
        isolated:globalThis.crossOriginIsolated,
        opfs:typeof navigator.storage?.getDirectory
      })`);
      if(last?.ready==='true'&&last?.hasCourt===true)return last;
    }catch{}
    await delay(75);
  }
  const probe=await evaluate(cdp,`(async()=>{try{
    const response=await fetch('/p4-publication-atomicity.js',{cache:'no-store'});
    const status=response.status;
    const contentType=response.headers.get('content-type');
    const prefix=(await response.text()).slice(0,160);
    try{
      await import('/p4-publication-atomicity.js?diagnostic='+Date.now());
      return {ok:true,status,contentType,prefix};
    }catch(error){
      return {ok:false,status,contentType,prefix,name:error?.name??'Error',message:error?.message??String(error),stack:error?.stack??null};
    }
  }catch(error){
    return {ok:false,name:error?.name??'Error',message:error?.message??String(error),stack:error?.stack??null};
  }})()`);
  throw new Error('P4 publication atomicity court did not become ready: '+JSON.stringify({last,probe}));
}
function js(value){return JSON.stringify(value);}
async function courtCall(cdp,method,...args){
  return evaluate(cdp,`globalThis.__p4AtomicityCourt[${js(method)}](...${js(args)})`);
}

const browser=findBrowser();
const profile=await mkdtemp(join(tmpdir(),'opencontainer-p4-atomicity-'));
const server=spawn(process.execPath,['apps/playground/server.mjs'],{
  env:{...process.env,PORT:String(port),OPENCONTAINER_P5_NETWORK_PORT:String(port+1)},
  stdio:['ignore','pipe','pipe']
});
let chrome=null;
let target=null;
let cdp=null;
const runs=[];

try{
  await waitForServer(server);
  chrome=spawn(browser.command,[
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir='+profile,
    '--remote-debugging-port=0',
    'about:blank'
  ],{stdio:['ignore','ignore','pipe']});

  const devtools=await waitForDevTools(chrome,profile);
  const debugPort=Number(new URL(devtools.browserWebSocket).port);
  assert(Number.isInteger(debugPort)&&debugPort>0,'Invalid Chrome debug port',{browserWebSocket:devtools.browserWebSocket});

  target=await newTarget(debugPort,origin+'/p4-publication-atomicity.html');
  cdp=await connectCdp(target.webSocketDebuggerUrl);
  await cdp.command('Runtime.enable');
  await cdp.command('Page.enable');
  const ready=await waitForCourt(cdp);
  assert(ready.isolated===true,'P4 atomicity court lost cross-origin isolation',{ready});
  assert(ready.opfs==='function','P4 atomicity court has no OPFS',{ready});

  for(let iteration=1;iteration<=iterations;iteration++){
    const suffix=Date.now()+'-'+iteration+'-'+Math.random().toString(16).slice(2);

    const cas=await courtCall(cdp,'cas');
    assert(cas.stale?.code==='OC_STALE_GENERATION','P4 graph CAS did not reject stale-base writer',{iteration,cas});
    assert(cas.finalPackage==='winner','P4 stale graph writer replaced winning graph',{iteration,cas});
    assert(cas.finalGeneration===cas.winnerGeneration,'P4 stale graph writer advanced generation',{iteration,cas});

    const persistentCasDirectory='opencontainer-p4-graph-cas-'+suffix;
    const persistentCas=await courtCall(cdp,'persistentCas',persistentCasDirectory);
    assert(persistentCas.fulfilledCount===1&&persistentCas.rejectedCount===1,'P4 real OPFS graph race did not produce exactly one winner',{iteration,persistentCas});
    assert(persistentCas.raceFailure?.code==='OC_STALE_GENERATION','P4 real OPFS/WebLock loser did not fail stale',{iteration,persistentCas});
    assert(persistentCas.winnerGeneration===1,'P4 persistent graph winner generation drifted',{iteration,persistentCas});
    assert(persistentCas.successorGeneration===2&&persistentCas.finalGeneration===2,'P4 persistent graph successor did not publish generation 2',{iteration,persistentCas});
    assert(persistentCas.crossContextLocking===true,'P4 persistent graph court did not use Web Locks',{iteration,persistentCas});
    assert(persistentCas.mountFailure?.code==='OC_STALE_GENERATION','P4 stale persistent graph installer mounted PackageFS',{iteration,persistentCas});
    assert(persistentCas.nodeModulesNull===true,'P4 stale persistent graph installer exposed node_modules',{iteration,persistentCas});

    const cancelDirectory='opencontainer-p4-cancel-'+suffix;
    const cancel=await courtCall(cdp,'cancel',cancelDirectory);
    assert(cancel.failure?.code==='OC_INVALID_STATE','P4 cancellation did not terminate install transaction',{iteration,cancel});
    assert(cancel.mountFailure?.code==='OC_INVALID_STATE','P4 cancelled transaction could publish PackageFS',{iteration,cancel});
    assert(cancel.nodeModulesAfterFailure===true,'P4 cancelled transaction exposed node_modules',{iteration,cancel});
    assert(cancel.afterFailure.filter(row=>row.usage?.exists===true).length===1,'P4 cancel did not retain exactly one immutable orphan cache object',{iteration,cancel});
    assert(cancel.retry.packageCount===2,'P4 cancel recovery did not publish complete package graph',{iteration,cancel});
    assert(cancel.retry.publicationPrecondition==='persistent-graph-generation-cas','P4 cancel recovery lost graph CAS publication',{iteration,cancel});

    const quotaDirectory='opencontainer-p4-quota-'+suffix;
    const quotaBefore=await cdp.command('Storage.getUsageAndQuota',{origin});
    assert(Number.isFinite(quotaBefore.usage)&&Number.isFinite(quotaBefore.quota),'Chrome quota telemetry unavailable',{iteration,quotaBefore});
    const forcedQuota=Math.ceil(quotaBefore.usage)+256*1024;
    await cdp.command('Storage.overrideQuotaForOrigin',{origin,quotaSize:forcedQuota});
    let quota;
    try{
      quota=await courtCall(cdp,'quotaAttempt',quotaDirectory);
    }finally{
      await cdp.command('Storage.overrideQuotaForOrigin',{origin,quotaSize:quotaBefore.quota});
    }
    assert(quota.failure!==null,'P4 real OPFS quota court unexpectedly completed install',{iteration,quota,quotaBefore,forcedQuota});
    const quotaRefusal=
      quota.failure?.name==='QuotaExceededError'||
      quota.failure?.code==='OC_RESOURCE_EXHAUSTED'||
      (
        quota.failure?.name==='AbortError'&&
        /Failed to write data to data pipe/i.test(String(quota.failure?.message??''))
      );
    assert(
      quotaRefusal,
      'P4 real OPFS quota court failed for a non-quota reason',
      {iteration,quota,quotaBefore,forcedQuota}
    );
    assert(quota.lastInstallFailed===true,'P4 quota failure did not arm failed-install publication barrier',{iteration,quota});
    assert(quota.mountFailure?.code==='OC_INVALID_STATE','P4 quota-failed install could publish PackageFS',{iteration,quota});
    assert(quota.nodeModulesNull===true,'P4 quota-failed install exposed node_modules',{iteration,quota});
    const quotaRecovery=await courtCall(cdp,'quotaRecover',quotaDirectory);
    assert(quotaRecovery.packageCount===1,'P4 quota recovery did not publish full single-package graph',{iteration,quotaRecovery});
    assert(quotaRecovery.publicationPrecondition==='persistent-graph-generation-cas','P4 quota recovery lost graph CAS publication',{iteration,quotaRecovery});

    const workerDirectory='opencontainer-p4-worker-death-'+suffix;
    const workerReady=await courtCall(cdp,'startWorker',workerDirectory);
    assert(workerReady.first?.contentId,'P4 worker did not persist first immutable content before death',{iteration,workerReady});
    assert(workerReady.secondFetchBlocked===true,'P4 worker was not terminated mid-transaction',{iteration,workerReady});
    const killed=await courtCall(cdp,'killWorker');
    assert(killed.terminated===true,'P4 installer worker termination did not occur',{iteration,killed});
    const workerDeath=await courtCall(cdp,'inspectWorkerDeath',workerDirectory);
    assert(workerDeath.beforeRecovery.nodeModulesNull===true,'P4 worker death exposed PackageFS before recovery',{iteration,workerDeath});
    assert(workerDeath.beforeRecovery.hydrate.filter(row=>row.hydrated===true).length===1,'P4 worker death did not leave exactly one verified immutable orphan',{iteration,workerDeath});
    assert(workerDeath.beforeRecovery.mountFailure?.code==='OC_PACKAGE_CONTENT_MISSING','P4 worker-death incomplete graph was not rejected before publication',{iteration,workerDeath});
    assert(workerDeath.recovery.packageCount===2,'P4 worker-death recovery did not publish complete graph',{iteration,workerDeath});
    assert(workerDeath.recovery.publicationPrecondition==='persistent-graph-generation-cas','P4 worker-death recovery lost graph CAS publication',{iteration,workerDeath});

    for(const directoryName of [persistentCasDirectory,cancelDirectory,quotaDirectory,workerDirectory]){
      await courtCall(cdp,'cleanup',directoryName);
    }

    const receipt=Object.freeze({
      iteration,
      browser:browser.version,
      cas:Object.freeze({
        sharedBase:cas.sharedBase,
        winnerGeneration:cas.winnerGeneration,
        staleCode:cas.stale.code,
        finalPackage:cas.finalPackage,
        lostUpdate:false
      }),
      persistentCas:Object.freeze({
        winnerGeneration:persistentCas.winnerGeneration,
        successorGeneration:persistentCas.successorGeneration,
        staleCode:persistentCas.raceFailure.code,
        staleMountCode:persistentCas.mountFailure.code,
        crossContextLocking:persistentCas.crossContextLocking,
        lostUpdate:false,
        halfPublished:false
      }),
      cancel:Object.freeze({
        failureCode:cancel.failure.code,
        mountCode:cancel.mountFailure.code,
        retainedImmutableObjects:cancel.afterFailure.filter(row=>row.usage?.exists===true).length,
        halfPublished:false,
        recoveryPackageCount:cancel.retry.packageCount
      }),
      quota:Object.freeze({
        usageBefore:quotaBefore.usage,
        quotaBefore:quotaBefore.quota,
        forcedQuota,
        failureName:quota.failure.name,
        failureCode:quota.failure.code,
        failureMessage:quota.failure.message,
        quotaRefusalAccepted:quotaRefusal,
        mountCode:quota.mountFailure.code,
        halfPublished:false,
        recoveryPackageCount:quotaRecovery.packageCount
      }),
      workerDeath:Object.freeze({
        terminated:true,
        firstContentId:workerReady.first.contentId,
        verifiedOrphans:workerDeath.beforeRecovery.hydrate.filter(row=>row.hydrated===true).length,
        mountCode:workerDeath.beforeRecovery.mountFailure.code,
        halfPublished:false,
        recoveryPackageCount:workerDeath.recovery.packageCount
      }),
      status:'PASS'
    });
    runs.push(receipt);
    console.log('[p4-publication-atomicity] iteration '+iteration+' PASS '+JSON.stringify(receipt));
  }

  const receipt=Object.freeze({
    schema:'opencontainer.p4-publication-atomicity.v1.0',
    status:'PASS',
    browser:browser.version,
    profile:'declared Chrome / Ubuntu x64 CI profile',
    iterations,
    passedIterations:runs.length,
    graphGenerationCas:true,
    persistentGraphGenerationCas:true,
    realOpfsGraphPublication:true,
    webLocksGraphPublication:true,
    stalePersistentPackageFsPublicationPrevented:true,
    concurrentLostUpdatePrevented:true,
    realOpfsQuotaFault:true,
    realInstallerWorkerDeath:true,
    cancellationBeforePublication:true,
    immutableOrphansAllowedButUnpublished:true,
    packageFsHalfPublicationObserved:false,
    runs:Object.freeze(runs),
    productionClosed:false
  });
  await mkdir(resolve('.artifacts/p4-publication-atomicity'),{recursive:true});
  await writeFile(
    resolve('.artifacts/p4-publication-atomicity/browser-receipt.json'),
    JSON.stringify(receipt,null,2)+'\n'
  );
  console.log('P4 PUBLICATION ATOMICITY PASS '+JSON.stringify(receipt));
}finally{
  try{cdp?.close();}catch{}
  if(target&&chrome){
    try{
      const active=await readFile(join(profile,'DevToolsActivePort'),'utf8');
      const debugPort=Number(active.trim().split(/\r?\n/)[0]);
      if(Number.isInteger(debugPort))await closeTarget(debugPort,target);
    }catch{}
  }
  await terminateChild(chrome);
  await terminateChild(server);
  await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
