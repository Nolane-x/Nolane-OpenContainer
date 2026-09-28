import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadCompatibilitySources, verifyCorpusOnline, gitBlobSha } from './compat-corpus.mjs';

const port=Number(process.env.OPENCONTAINER_P4_ECOSYSTEM_PORT||4341);
const origin='http://127.0.0.1:'+port;
const iterations=Number(process.env.OPENCONTAINER_P4_ECOSYSTEM_ITERATIONS||2);
const candidates=process.platform==='win32'
  ? ['chrome.exe','msedge.exe']
  : ['google-chrome-stable','google-chrome','chromium','chromium-browser'];

function assert(condition,message,details={}){
  if(condition)return;
  const error=new Error(message);
  error.details=details;
  throw error;
}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function findBrowser(){
  for(const command of candidates){
    const result=spawnSync(command,['--version'],{encoding:'utf8'});
    if(result.status===0)return {command,version:String(result.stdout||result.stderr).trim()};
  }
  throw new Error('No supported Chrome/Chromium binary found for P4 ecosystem layout court');
}
function waitForServer(child){
  return new Promise((resolvePromise,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Playground server did not start')),8000);
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
      if(match)return match[1];
      try{
        const active=await readFile(join(profile,'DevToolsActivePort'),'utf8');
        const [portLine,pathLine]=active.trim().split(/\r?\n/);
        const debugPort=Number(portLine);
        if(Number.isInteger(debugPort)&&debugPort>0&&pathLine?.startsWith('/devtools/browser/')){
          return 'ws://127.0.0.1:'+debugPort+pathLine;
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
async function waitForCourt(cdp,timeoutMs=15000){
  const deadline=Date.now()+timeoutMs;
  let last=null;
  while(Date.now()<deadline){
    try{
      last=await evaluate(cdp,`({
        ready:document.body?.dataset?.ready??null,
        court:typeof globalThis.__p4EcosystemLayoutCourt,
        isolated:globalThis.crossOriginIsolated
      })`);
      if(last?.ready==='true'&&last?.court==='object')return last;
    }catch{}
    await delay(75);
  }
  throw new Error('P4 ecosystem layout court did not become ready: '+JSON.stringify(last));
}

assert(process.version==='v24.21.0','P4-01 exact Node oracle requires Node v24.21.0',{actual:process.version});

const manifest=JSON.parse(await readFile(resolve('compat/p4/ECOSYSTEM-LAYOUT-CORPUS.v1.0.json'),'utf8'));
for(const fixture of manifest.fixtures){
  const bytes=await readFile(resolve(fixture.localPath));
  assert(gitBlobSha(bytes)===fixture.blobSha,'Frozen P4 lockfile fixture drifted',{id:fixture.id});
}

const oracle=spawnSync(process.execPath,[
  '--test',
  'tests/node24-resolver-differential.test.js',
  'tests/p4-layout-identity.test.js',
  'tests/p4-ecosystem-layout-corpus.test.js'
],{
  cwd:resolve('.'),
  encoding:'utf8',
  env:{...process.env}
});
process.stdout.write(oracle.stdout??'');
process.stderr.write(oracle.stderr??'');
assert(oracle.status===0,'P4 exact Node/layout contract court failed',{status:oracle.status});
assert(!/skipped\s+[1-9]/i.test(String(oracle.stdout??'')),'P4 exact Node oracle was skipped',{stdout:oracle.stdout});

const {corpus}=await loadCompatibilitySources();
const online=await verifyCorpusOnline(corpus);
assert(online.ok===true,'P4 ecosystem online verification failed',{
  failures:online.cases.filter(item=>!item.ok)
});
assert(online.cases.length===13,'P4 real-repository corpus count drifted',{count:online.cases.length});
const publishedTarballs=[];
for(const item of online.cases){
  const source=corpus.cases.find(entry=>entry.id===item.id);
  assert(source,'P4 online case missing source corpus entry',{id:item.id});
  const license=item.checks.find(check=>check.kind==='license');
  assert(license?.blobSha===source.license.blobSha,'P4 license provenance drifted',{id:item.id});
  const tarball=item.checks.find(check=>check.kind==='package-tarball');
  if(tarball?.status==='published'){
    publishedTarballs.push(Object.freeze({
      id:item.id,
      name:tarball.name,
      version:tarball.version,
      bytes:tarball.bytes,
      integrity:tarball.integrity,
      shasum:tarball.shasum,
      tarball:tarball.tarball,
      repository:item.repository,
      commit:item.commit,
      license:Object.freeze({
        spdx:source.license.spdx,
        blobSha:license.blobSha,
        path:source.license.path
      })
    }));
  }
}
assert(publishedTarballs.length===9,'P4 published tarball corpus count drifted',{count:publishedTarballs.length});

const browser=findBrowser();
const profile=await mkdtemp(join(tmpdir(),'opencontainer-p4-ecosystem-'));
const server=spawn(process.execPath,['apps/playground/server.mjs'],{
  env:{...process.env,PORT:String(port),OPENCONTAINER_P5_NETWORK_PORT:String(port+1)},
  stdio:['ignore','pipe','pipe']
});
let chrome=null;
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

  const browserWebSocket=await waitForDevTools(chrome,profile);
  const debugPort=Number(new URL(browserWebSocket).port);
  assert(Number.isInteger(debugPort)&&debugPort>0,'Invalid Chrome debug port',{browserWebSocket});

  for(let iteration=1;iteration<=iterations;iteration++){
    const target=await newTarget(debugPort,origin+'/p4-ecosystem-layout.html?iteration='+iteration);
    const cdp=await connectCdp(target.webSocketDebuggerUrl);
    try{
      await cdp.command('Runtime.enable');
      await cdp.command('Page.enable');
      const ready=await waitForCourt(cdp);
      assert(ready.isolated===true,'P4 ecosystem court lost cross-origin isolation',{iteration,ready});
      const result=await evaluate(cdp,'globalThis.__p4EcosystemLayoutCourt.run()');
      assert(result?.status==='PASS','P4 browser ecosystem layout court did not pass',{iteration,result});
      assert(JSON.stringify(result.sourceGates)===JSON.stringify(['P4-01','P4-02','P4-03','P4-06']),'P4 gate set drifted',{iteration,result});
      assert(result.realRepositoryGraphs?.viteReactTiny?.nodes===219,'Vite real graph node count drifted',{iteration,result});
      assert(result.realRepositoryGraphs?.chokidar?.nodes===8,'Chokidar real graph node count drifted',{iteration,result});
      assert(result.realRepositoryGraphs.viteReactTiny.fingerprint!==result.realRepositoryGraphs.chokidar.fingerprint,'Real repository graph layout identity collapsed',{iteration,result});
      assert(result.structuralLayouts?.hoisted?.hoistedTransitiveCount===1,'Hoisted layout not observable',{iteration,result});
      assert(result.structuralLayouts?.hoisted?.kinds?.includes('shallow'),'Shallow layout not observable',{iteration,result});
      assert(result.structuralLayouts?.nested?.nestedCount===1,'Nested layout not observable',{iteration,result});
      assert(result.structuralLayouts?.nested?.linkedCount===1,'Linked layout not observable',{iteration,result});
      runs.push(Object.freeze({iteration,...result}));
      console.log('[p4-ecosystem-layout] iteration '+iteration+' PASS '+JSON.stringify(result));
    }finally{
      try{cdp.close();}catch{}
      await closeTarget(debugPort,target);
    }
  }

  const receipt=Object.freeze({
    schema:'opencontainer.p4-ecosystem-layout.v1.0',
    status:'PASS',
    sourceGates:Object.freeze(['P4-01','P4-02','P4-03','P4-06']),
    nodeVersion:process.version,
    exactNodeOracle:true,
    browser:browser.version,
    profile:'declared Chrome / Ubuntu x64 CI profile',
    iterations,
    passedIterations:runs.length,
    frozenRealRepositories:online.cases.length,
    frozenExecutablePackageGraphs:manifest.fixtures.length,
    publishedTarballsVerified:publishedTarballs.length,
    onlineRepositoryVerification:true,
    sourceCommitPins:true,
    lockfileBlobPins:true,
    licenseBlobPins:true,
    npmTarballUrlPins:true,
    npmSha512Pins:true,
    npmSha1Pins:true,
    packageLayoutIdentityObservable:true,
    nodeResolverDifferentialPreserved:true,
    realRepositoryGraphs:Object.freeze(manifest.fixtures.map(item=>Object.freeze({...item}))),
    publishedTarballs:Object.freeze(publishedTarballs),
    runs:Object.freeze(runs),
    productionClosed:false
  });
  await mkdir(resolve('.artifacts/p4-ecosystem-layout'),{recursive:true});
  await writeFile(
    resolve('.artifacts/p4-ecosystem-layout/browser-receipt.json'),
    JSON.stringify(receipt,null,2)+'\n'
  );
  console.log('P4 ECOSYSTEM LAYOUT PASS '+JSON.stringify(receipt));
}finally{
  await terminateChild(chrome);
  await terminateChild(server);
  await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
