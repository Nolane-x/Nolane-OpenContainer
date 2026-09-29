import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { checkHostingHeaders } from './hosting-self-check-lib.mjs';

const port=Number(process.env.OPENCONTAINER_P1_PORT||4381);
const origin='http://127.0.0.1:'+port;
const artifactPath=resolve(process.argv[2]??'.artifacts/p1-browser-substrate/browser-receipt.json');

function assert(condition,message,details={}){
  if(condition)return;
  const error=new Error(message);
  error.details=details;
  throw error;
}
const delay=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

function findBrowser(){
  for(const command of ['google-chrome-stable','google-chrome','chromium','chromium-browser']){
    const result=spawnSync(command,['--version'],{encoding:'utf8'});
    if(result.status===0)return {command,version:String(result.stdout||result.stderr).trim()};
  }
  throw new Error('No supported Chrome/Chromium binary found for P1 court');
}

function run(command,args,{timeout=240000}={}){
  return new Promise((resolveRun,reject)=>{
    const child=spawn(command,args,{env:process.env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{
      try{child.kill('SIGKILL');}catch{}
      reject(new Error(command+' timed out\n'+stderr.slice(-12000)));
    },timeout);
    child.stdout.on('data',chunk=>{stdout+=String(chunk);process.stdout.write(chunk);});
    child.stderr.on('data',chunk=>{stderr+=String(chunk);process.stderr.write(chunk);});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('exit',code=>{
      clearTimeout(timer);
      if(code!==0)reject(new Error(command+' exited '+code+'\n'+stderr.slice(-12000)));
      else resolveRun({stdout,stderr});
    });
  });
}

function parseAcceptance(stdout){
  const marker='browser acceptance PASS ';
  const index=stdout.lastIndexOf(marker);
  if(index<0)throw new Error('browser acceptance PASS marker missing');
  const raw=stdout.slice(index+marker.length).trim();
  return JSON.parse(raw);
}
function acceptanceStages(receipt){
  return new Map((receipt?.stages??[]).map(stage=>[stage.name,stage]));
}
function requiredStage(stages,name){
  const value=stages.get(name);
  assert(value,'required installed-distribution browser stage missing',{name});
  return value;
}

function connectCdp(webSocketUrl){
  return new Promise((resolveConnect,reject)=>{
    const socket=new WebSocket(webSocketUrl);
    const pending=new Map();
    let nextId=0;
    socket.addEventListener('open',()=>resolveConnect({
      async command(method,params={}){
        const id=++nextId;
        const response=new Promise((resolve,rejectCommand)=>pending.set(id,{resolve,reject:rejectCommand,method}));
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
      if(message.error)waiter.reject(new Error(waiter.method+': '+message.error.message));
      else waiter.resolve(message.result);
    });
    socket.addEventListener('error',()=>reject(new Error('CDP WebSocket failed: '+webSocketUrl)));
    socket.addEventListener('close',()=>{
      for(const waiter of pending.values())waiter.reject(new Error('CDP WebSocket closed'));
      pending.clear();
    });
  });
}

async function waitForServer(child){
  return new Promise((resolveServer,reject)=>{
    const timer=setTimeout(()=>reject(new Error('P1 playground server did not start')),10000);
    let stderr='';
    child.stderr.on('data',chunk=>{stderr+=String(chunk);});
    child.stdout.on('data',chunk=>{
      const output=String(chunk);
      process.stdout.write(output);
      if(output.includes('OpenContainer playground:')){
        clearTimeout(timer);
        resolveServer();
      }
    });
    child.once('exit',code=>{
      clearTimeout(timer);
      reject(new Error('P1 playground server exited early '+code+'\n'+stderr));
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
      if(match)return match[1];
      try{
        const active=await readFile(join(profile,'DevToolsActivePort'),'utf8');
        const [portLine,pathLine]=active.trim().split(/\r?\n/);
        const debugPort=Number(portLine);
        if(Number.isInteger(debugPort)&&debugPort>0&&pathLine?.startsWith('/devtools/browser/')){
          return 'ws://127.0.0.1:'+debugPort+pathLine;
        }
      }catch{}
      if(child.exitCode!==null)throw new Error('Chrome exited before DevTools ready: '+child.exitCode+'\n'+stderr);
      await delay(100);
    }
    throw new Error('Chrome DevTools endpoint timed out\n'+stderr);
  }finally{
    child.stderr.off('data',onData);
  }
}

async function newTarget(debugPort,url){
  const response=await fetch('http://127.0.0.1:'+debugPort+'/json/new?'+encodeURIComponent(url),{method:'PUT'});
  assert(response.ok,'Chrome failed to create target',{status:response.status,url});
  const target=await response.json();
  assert(target?.id&&target?.webSocketDebuggerUrl,'Chrome target response incomplete',{target});
  return target;
}
async function closeTarget(debugPort,target){
  if(!target?.id)return;
  try{await fetch('http://127.0.0.1:'+debugPort+'/json/close/'+target.id);}catch{}
}
async function evaluate(cdp,expression){
  const response=await cdp.command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(response.exceptionDetails){
    throw new Error(response.exceptionDetails.exception?.description??response.exceptionDetails.text??'Runtime.evaluate failed');
  }
  return response.result?.value;
}
async function prepareTarget(target){
  const cdp=await connectCdp(target.webSocketDebuggerUrl);
  await cdp.command('Runtime.enable');
  await cdp.command('Page.enable');
  return cdp;
}
async function waitReady(cdp,globalName='__p1BrowserCourt',timeoutMs=15000){
  const deadline=Date.now()+timeoutMs;
  let last=null;
  while(Date.now()<deadline){
    try{
      last=await evaluate(cdp,`({ready:document.body?.dataset?.ready??null,court:typeof globalThis[${JSON.stringify(globalName)}],url:location.href})`);
      if(last?.ready==='true'&&last?.court==='object')return last;
    }catch{}
    await delay(75);
  }
  throw new Error('P1 browser court did not become ready: '+JSON.stringify(last));
}
async function terminateChild(child,timeoutMs=3000){
  if(!child||child.exitCode!==null)return;
  await new Promise(resolveStop=>{
    let done=false;
    const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolveStop();};
    const timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}finish();},timeoutMs);
    child.once('exit',finish);
    try{child.kill('SIGTERM');}catch{finish();}
  });
}

assert(process.version==='v24.21.0','P1 court requires exact Node v24.21.0',{actual:process.version});

const productRun=await run(process.execPath,['scripts/browser-acceptance.mjs'],{timeout:300000});
const product=parseAcceptance(productRun.stdout);
const productStages=acceptanceStages(product);
const runtimeReady=requiredStage(productStages,'runtime-ready');
const guestCsp=requiredStage(productStages,'guest-csp-pass');
const guestIsolation=requiredStage(productStages,'guest-isolation-pass');
const opfs=requiredStage(productStages,'opfs-real-pass');
const preview=requiredStage(productStages,'p5-network-secrets-preview-pass');
const support=requiredStage(productStages,'p8-support-bundle-pass');
assert(runtimeReady.crossOriginIsolated===true,'installed product path lost crossOriginIsolated');
assert(guestCsp.profilesSeparated===true,'guest/toolchain CSP profiles are not separated');
assert(guestIsolation.workerCrossOriginIsolated===true,'guest worker lost browser isolation');
assert(preview.frameEventOrigin==='null','sandboxed preview retained trusted origin',{preview});
assert(preview.frameParentAccess!=='readable','sandboxed preview reached trusted parent',{preview});
assert(preview.frameStorageAccess!=='readable','sandboxed preview reached trusted storage',{preview});
assert(preview.previewHostCredentialHeaders===false,'preview received host credential headers',{preview});
assert(opfs.crossContextLocking===true&&opfs.stalePeerRejected===true,'installed path lost OPFS/Web Locks writer authority',{opfs});
assert(support.browserCrossOriginIsolated!==false,'support-bundle browser capability receipt regressed',{support});

const browser=findBrowser();
const profile=await mkdtemp(join(tmpdir(),'opencontainer-p1-'));
const server=spawn(process.execPath,['apps/playground/server.mjs'],{
  env:{...process.env,PORT:String(port),OPENCONTAINER_P5_NETWORK_PORT:String(port+1)},
  stdio:['ignore','pipe','pipe']
});
let chrome=null;
const targets=[];
try{
  await waitForServer(server);
  const hosting=await checkHostingHeaders(origin+'/');
  assert(hosting.ok===true,'P1 hosting self-check failed',{failures:hosting.failures});

  chrome=spawn(browser.command,[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--no-first-run','--no-default-browser-check','--enable-automation',
    '--user-data-dir='+profile,'--remote-debugging-port=0','about:blank'
  ],{stdio:['ignore','ignore','pipe']});
  const browserWebSocket=await waitForDevTools(chrome,profile);
  const debugPort=Number(new URL(browserWebSocket).port);
  assert(Number.isInteger(debugPort)&&debugPort>0,'invalid Chrome debug port',{browserWebSocket});
  const browserCdp=await connectCdp(browserWebSocket);
  const version=await browserCdp.command('Browser.getVersion');
  const commandLine=await browserCdp.command('Browser.getBrowserCommandLine');

  const baselineTarget=await newTarget(debugPort,origin+'/p1-browser-substrate.html');
  targets.push(baselineTarget);
  const baseline=await prepareTarget(baselineTarget);
  await waitReady(baseline);
  const baselineProbe=await evaluate(baseline,'globalThis.__p1BrowserCourt.probe()');
  assert(baselineProbe.secureContext===true,'P1 baseline is not a secure browser context');
  assert(baselineProbe.crossOriginIsolated===true,'P1 baseline COOP/COEP path did not isolate');
  assert(baselineProbe.sharedArrayBuffer===true&&baselineProbe.atomics===true,'P1 baseline lost SAB/Atomics');
  assert(baselineProbe.moduleWorker===true,'P1 module worker probe failed');
  assert(baselineProbe.headers.coop==='same-origin','P1 baseline COOP header drifted',{headers:baselineProbe.headers});
  assert(baselineProbe.headers.coep==='require-corp','P1 baseline COEP header drifted',{headers:baselineProbe.headers});
  assert(baselineProbe.headers.documentIsolationPolicy===null,'P1 baseline accidentally depends on DIP',{headers:baselineProbe.headers});
  const expectedDisabled=['camera','microphone','geolocation','display-capture','usb','serial','hid','payment'];
  for(const feature of expectedDisabled){
    assert(baselineProbe.headers.permissionsPolicy.includes(feature+'=()'),'P1 Permissions-Policy header lost denied feature',{feature,header:baselineProbe.headers.permissionsPolicy});
    assert(baselineProbe.embeddedPermissions.disabled[feature]===true,'P1 embedded frame unexpectedly received feature delegation',{feature,embedded:baselineProbe.embeddedPermissions});
  }

  const dipTarget=await newTarget(debugPort,origin+'/p1-dip.html');
  targets.push(dipTarget);
  const dip=await prepareTarget(dipTarget);
  await waitReady(dip);
  const dipProbe=await evaluate(dip,'globalThis.__p1BrowserCourt.probe()');
  assert(dipProbe.crossOriginIsolated===true,'optional P1 DIP profile lost isolation');
  assert(dipProbe.headers.documentIsolationPolicy==='isolate-and-require-corp','optional P1 DIP header missing',{headers:dipProbe.headers});
  assert(baselineProbe.crossOriginIsolated===true&&baselineProbe.headers.documentIsolationPolicy===null,'DIP became the sole P1 isolation path');

  await baseline.command('Page.setWebLifecycleState',{state:'frozen'});
  await delay(150);
  await baseline.command('Page.setWebLifecycleState',{state:'active'});
  await delay(150);
  const lifecycle=await evaluate(baseline,'globalThis.__p1BrowserCourt.lifecycle()');
  assert(lifecycle.freeze>=1&&lifecycle.resume>=1,'P1 freeze/resume lifecycle events were not observed',{lifecycle});

  const refreshDirectory='p1-refresh-'+Date.now();
  await evaluate(baseline,`globalThis.__p1BrowserCourt.storageSeed(${JSON.stringify(refreshDirectory)},'before-refresh')`);
  await baseline.command('Page.reload',{ignoreCache:true});
  await waitReady(baseline);
  const refreshRead=await evaluate(baseline,`globalThis.__p1BrowserCourt.storageRead(${JSON.stringify(refreshDirectory)})`);
  assert(refreshRead.exists===true&&refreshRead.value==='before-refresh','P1 full refresh reset durable OPFS state',{refreshRead});

  const bfTarget=await newTarget(debugPort,origin+'/p1-browser-substrate.html?bfcache=1');
  targets.push(bfTarget);
  const bf=await prepareTarget(bfTarget);
  await waitReady(bf);
  await bf.command('Page.navigate',{url:origin+'/p1-bfcache-away.html'});
  await delay(300);
  const history=await bf.command('Page.getNavigationHistory');
  const previous=[...history.entries].reverse().find(entry=>entry.url.includes('/p1-browser-substrate.html'));
  assert(previous,'P1 BFCache history entry missing',{history});
  await bf.command('Page.navigateToHistoryEntry',{entryId:previous.id});
  await waitReady(bf);
  await delay(150);
  const bfcache=await evaluate(bf,`({
    pagehide:sessionStorage.getItem('opencontainer:p1:last-pagehide-persisted'),
    pageshow:sessionStorage.getItem('opencontainer:p1:last-pageshow-persisted'),
    lifecycle:globalThis.__p1BrowserCourt.lifecycle()
  })`);
  assert(bfcache.pageshow==='true','P1 history restore did not use BFCache',{bfcache});

  const lockName='opencontainer-p1-writer-'+Date.now();
  const tabA=await newTarget(debugPort,origin+'/p1-browser-substrate.html?tab=a');
  const tabB=await newTarget(debugPort,origin+'/p1-browser-substrate.html?tab=b');
  targets.push(tabA,tabB);
  const cdpA=await prepareTarget(tabA),cdpB=await prepareTarget(tabB);
  await Promise.all([waitReady(cdpA),waitReady(cdpB)]);
  assert(await evaluate(cdpA,`globalThis.__p1BrowserCourt.holdLock(${JSON.stringify(lockName)})`)===true,'P1 tab A could not acquire writer Web Lock');
  assert(await evaluate(cdpB,`globalThis.__p1BrowserCourt.tryLock(${JSON.stringify(lockName)})`)===false,'P1 tab B became a simultaneous canonical writer');
  assert(await evaluate(cdpA,`globalThis.__p1BrowserCourt.releaseLock(${JSON.stringify(lockName)})`)===true,'P1 writer lock release failed');
  assert(await evaluate(cdpB,`globalThis.__p1BrowserCourt.tryLock(${JSON.stringify(lockName)})`)===true,'P1 writer failover could not acquire released lock');

  const writerDirectory='p1-writer-'+Date.now();
  const writerA=await newTarget(debugPort,origin+'/p3-freeze-writer-failover.html?a');
  const writerB=await newTarget(debugPort,origin+'/p3-freeze-writer-failover.html?b');
  targets.push(writerA,writerB);
  const writerCdpA=await prepareTarget(writerA),writerCdpB=await prepareTarget(writerB);
  await Promise.all([waitReady(writerCdpA,'__p3WriterCourt'),waitReady(writerCdpB,'__p3WriterCourt')]);
  await evaluate(writerCdpA,`globalThis.__p3WriterCourt.open(${JSON.stringify(writerDirectory)})`);
  await evaluate(writerCdpA,`globalThis.__p3WriterCourt.seed('A0')`);
  await evaluate(writerCdpB,`globalThis.__p3WriterCourt.open(${JSON.stringify(writerDirectory)})`);
  const publishA=await evaluate(writerCdpA,`globalThis.__p3WriterCourt.mutateAndPublish('A1')`);
  const staleB=await evaluate(writerCdpB,`globalThis.__p3WriterCourt.mutateAndPublish('B1')`);
  const canonical=await evaluate(writerCdpA,'globalThis.__p3WriterCourt.readCanonical()');
  assert(publishA.ok===true,'P1 canonical writer failed to publish',{publishA});
  assert(staleB.ok===false&&staleB.error?.code==='OC_STALE_GENERATION','P1 stale tab writer was not rejected',{staleB});
  assert(canonical.value==='A1','P1 stale writer changed canonical OPFS value',{canonical});

  const bestEffortDirectory='p1-best-effort-'+Date.now();
  const storageTarget=await newTarget(debugPort,origin+'/p1-browser-substrate.html?storage=best-effort');
  targets.push(storageTarget);
  const storageCdp=await prepareTarget(storageTarget);
  await waitReady(storageCdp);
  await evaluate(storageCdp,`globalThis.__p1BrowserCourt.storageSeed(${JSON.stringify(bestEffortDirectory)},'best-effort')`);
  assert((await evaluate(storageCdp,`globalThis.__p1BrowserCourt.storageRead(${JSON.stringify(bestEffortDirectory)})`)).exists===true,'P1 best-effort OPFS seed failed');
  await closeTarget(debugPort,storageTarget);
  const storageIndex=targets.indexOf(storageTarget);if(storageIndex>=0)targets.splice(storageIndex,1);
  storageCdp.close();
  await browserCdp.command('Storage.clearDataForOrigin',{origin,storageTypes:'all'});
  const reopenedTarget=await newTarget(debugPort,origin+'/p1-browser-substrate.html?storage=reopened');
  targets.push(reopenedTarget);
  const reopened=await prepareTarget(reopenedTarget);
  await waitReady(reopened);
  const evictedRead=await evaluate(reopened,`globalThis.__p1BrowserCourt.storageRead(${JSON.stringify(bestEffortDirectory)})`);
  assert(evictedRead.exists===false,'P1 best-effort eviction did not reopen as missing state',{evictedRead});

  let persistenceOverride='setPermission';
  try{
    await browserCdp.command('Browser.setPermission',{
      permission:{name:'persistent-storage'},
      setting:'granted',
      origin
    });
  }catch(error){
    persistenceOverride='grantPermissions';
    await browserCdp.command('Browser.grantPermissions',{permissions:['durableStorage'],origin});
  }
  const persistentPolicy=await evaluate(reopened,'globalThis.__p1BrowserCourt.storagePolicy()');
  assert(persistentPolicy.after.persisted===true,'P1 persistent storage class was not granted in declared Chrome profile',{persistentPolicy,persistenceOverride});
  const persistentDirectory='p1-persistent-'+Date.now();
  await evaluate(reopened,`globalThis.__p1BrowserCourt.storageSeed(${JSON.stringify(persistentDirectory)},'persistent')`);
  await closeTarget(debugPort,reopenedTarget);
  const reopenIndex=targets.indexOf(reopenedTarget);if(reopenIndex>=0)targets.splice(reopenIndex,1);
  reopened.close();
  const persistedTarget=await newTarget(debugPort,origin+'/p1-browser-substrate.html?storage=persistent-reopen');
  targets.push(persistedTarget);
  const persisted=await prepareTarget(persistedTarget);
  await waitReady(persisted);
  const persistedRead=await evaluate(persisted,`globalThis.__p1BrowserCourt.storageRead(${JSON.stringify(persistentDirectory)})`);
  assert(persistedRead.exists===true&&persistedRead.value==='persistent','P1 persistent storage did not survive reopen',{persistedRead});
  await evaluate(persisted,`globalThis.__p1BrowserCourt.storageRemove(${JSON.stringify(persistentDirectory)})`);

  const receipt={
    schema:'opencontainer.p1-browser-substrate.v1.0',
    status:'PASS',
    source:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json',
    sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
    minimumClosure:'PASS-INTEGRATION + declared-profile evidence',
    declaredProfile:'desktop-chrome153-ubuntu2404-x64-ci',
    sourceGates:[
      'P1-01','P1-02','P1-03','P1-04','P1-05','P1-06','P1-07',
      'P1-08','P1-09','P1-10','P1-11','P1-12','P1-16'
    ],
    intentionallyOpenGates:[
      {id:'P1-13',reason:'No real public CDN/reverse-proxy campaign is retained by this CI court.'},
      {id:'P1-14',reason:'This court proves one declared Chrome release profile, not the frozen-floor plus newest-stable RC matrix.'},
      {id:'P1-15',reason:'No field browser-regression incident evidence exists; internal emergency modeling is not field evidence.'}
    ],
    cleanBrowser:{
      browser:browser.version,
      product:version.product,
      userAgent:version.userAgent,
      protocolVersion:version.protocolVersion,
      managedNavigationPolicyObserved:false,
      commandLine:commandLine.arguments??[]
    },
    baseline:baselineProbe,
    optionalDocumentIsolation:dipProbe,
    lifecycle:{freezeResume:lifecycle,bfcache},
    refreshRecovery:{directory:refreshDirectory,read:refreshRead,unloadSaveDependency:false},
    writerAuthority:{
      webLocks:{secondWriterRejected:true,failoverAcquired:true},
      opfs:{canonicalPublish:publishA,stalePublish:staleB,canonical}
    },
    storage:{
      bestEffort:{seeded:true,clearedByBrowserStorageEviction:true,reopen:evictedRead},
      persistent:{permissionOverride:persistenceOverride,policy:persistentPolicy,reopen:persistedRead}
    },
    hostingSelfCheck:hosting,
    installedProductEvidence:{
      runtimeReady,
      guestCsp,
      guestIsolation,
      opfs,
      preview,
      support
    },
    boundaries:{
      documentIsolationPolicyRequired:false,
      realCdnProxyCampaignClaimed:false,
      browserUpgradeMatrixClaimed:false,
      fieldRegressionEvidenceClaimed:false,
      crossBrowserClaimed:false,
      productionClosed:false
    }
  };

  await mkdir(dirname(artifactPath),{recursive:true});
  await writeFile(artifactPath,JSON.stringify(receipt,null,2)+'\n');
  console.log('P1 BROWSER SUBSTRATE PASS '+JSON.stringify({
    gates:receipt.sourceGates.length,
    intentionallyOpen:receipt.intentionallyOpenGates.map(item=>item.id),
    browser:receipt.cleanBrowser.browser,
    bfcache:receipt.lifecycle.bfcache.pageshow,
    persistence:receipt.storage.persistent.policy.after.persisted
  }));
  browserCdp.close();
}finally{
  for(const target of targets.splice(0)){
    try{await closeTarget(Number(new URL((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0])||0),target);}catch{}
  }
  await terminateChild(chrome);
  await terminateChild(server);
  await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
