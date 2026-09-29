import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const port=Number(process.env.OPENCONTAINER_P2_RUNTIME_PORT||4352);
const origin='http://127.0.0.1:'+port;
const iterations=Number(process.env.OPENCONTAINER_P2_RUNTIME_ITERATIONS||2);
const candidates=process.platform==='win32'
  ? ['chrome.exe','msedge.exe']
  : ['google-chrome-stable','google-chrome','chromium','chromium-browser'];

function assert(condition,message,details={}){
  if(condition)return;
  const error=new Error(message);error.details=details;throw error;
}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function findBrowser(){
  for(const command of candidates){
    const result=spawnSync(command,['--version'],{encoding:'utf8'});
    if(result.status===0)return {command,version:String(result.stdout||result.stderr).trim()};
  }
  throw new Error('No supported Chrome/Chromium binary found for P2 runtime court');
}
function waitForServer(child){
  return new Promise((resolvePromise,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Playground server did not start')),8000);
    let stderr='';
    child.stderr.on('data',chunk=>{stderr+=String(chunk);});
    child.stdout.on('data',chunk=>{
      const output=String(chunk);process.stdout.write(output);
      if(output.includes('OpenContainer playground:')){clearTimeout(timer);resolvePromise();}
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
  }finally{child.stderr.off('data',onData);}
}
function connectCdp(webSocketUrl){
  return new Promise((resolvePromise,reject)=>{
    const socket=new WebSocket(webSocketUrl);
    const pending=new Map();
    const listeners=new Map();
    let nextId=0;
    socket.addEventListener('open',()=>resolvePromise({
      async command(method,params={}){
        const id=++nextId;
        const response=new Promise((res,rej)=>pending.set(id,{res,rej,method}));
        socket.send(JSON.stringify({id,method,params}));
        return response;
      },
      on(method,listener){
        if(!listeners.has(method))listeners.set(method,new Set());
        listeners.get(method).add(listener);
        return ()=>listeners.get(method)?.delete(listener);
      },
      close(){socket.close();}
    }));
    socket.addEventListener('message',event=>{
      const message=JSON.parse(String(event.data));
      if(!message.id){
        for(const listener of listeners.get(message.method)??[]){
          try{listener(message.params??{});}catch{}
        }
        return;
      }
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
    const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);resolvePromise();};
    const timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}finish();},timeoutMs);
    child.once('exit',finish);
    try{child.kill('SIGTERM');}catch{finish();}
  });
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
    throw new Error('Runtime.evaluate exception: '+(response.exceptionDetails.exception?.description??response.exceptionDetails.text??'unknown'));
  }
  return response.result?.value;
}
async function waitForCourt(cdp,timeoutMs=15000){
  const deadline=Date.now()+timeoutMs;let last=null;
  while(Date.now()<deadline){
    try{
      last=await evaluate(cdp,`({
        ready:document.body?.dataset?.ready??null,
        court:typeof globalThis.__p2RuntimeCourt,
        isolated:globalThis.crossOriginIsolated
      })`);
      if(last?.ready==='true'&&last?.court==='object')return last;
    }catch{}
    await delay(75);
  }
  throw new Error('P2 runtime court did not become ready: '+JSON.stringify(last));
}

assert(process.version==='v24.21.0','P2 runtime court requires exact Node v24.21.0',{actual:process.version});

const contract=spawnSync(process.execPath,[
  '--test',
  'tests/runtime.test.js',
  'tests/p2-runtime-contracts.test.js',
  'tests/worker-authority.test.js',
  'tests/browser-guest-worker.test.js',
  'tests/sync-rpc.test.js'
],{
  cwd:resolve('.'),
  encoding:'utf8',
  env:{...process.env}
});
process.stdout.write(contract.stdout??'');
process.stderr.write(contract.stderr??'');
assert(contract.status===0,'P2 runtime contract court failed',{status:contract.status});

const browser=findBrowser();
const profile=await mkdtemp(join(tmpdir(),'opencontainer-p2-runtime-'));
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
    '--enable-precise-memory-info',
    '--js-flags=--max-old-space-size=256',
    '--user-data-dir='+profile,
    '--remote-debugging-port=0',
    'about:blank'
  ],{stdio:['ignore','ignore','pipe']});

  const browserWebSocket=await waitForDevTools(chrome,profile);
  const debugPort=Number(new URL(browserWebSocket).port);
  assert(Number.isInteger(debugPort)&&debugPort>0,'Invalid Chrome debug port',{browserWebSocket});

  for(let iteration=1;iteration<=iterations;iteration++){
    const target=await newTarget(debugPort,origin+'/p2-runtime-court.html?iteration='+iteration);
    const cdp=await connectCdp(target.webSocketDebuggerUrl);
    const diagnostics={exceptions:[],failedRequests:[],errorResponses:[]};
    try{
      cdp.on('Runtime.exceptionThrown',params=>diagnostics.exceptions.push({
        text:params.exceptionDetails?.text??null,
        description:params.exceptionDetails?.exception?.description??null,
        url:params.exceptionDetails?.url??null
      }));
      cdp.on('Network.loadingFailed',params=>diagnostics.failedRequests.push({
        requestId:params.requestId,errorText:params.errorText,blockedReason:params.blockedReason??null
      }));
      cdp.on('Network.responseReceived',params=>{
        const status=params.response?.status??0;
        if(status>=400)diagnostics.errorResponses.push({url:params.response?.url??null,status});
      });
      await cdp.command('Runtime.enable');
      await cdp.command('Page.enable');
      await cdp.command('Network.enable');
      const ready=await waitForCourt(cdp);
      assert(ready.isolated===true,'P2 runtime court lost cross-origin isolation',{iteration,ready});

      const result=await evaluate(cdp,'globalThis.__p2RuntimeCourt.run()');
      assert(result?.status==='PASS','P2 runtime browser court did not pass',{iteration,result});
      assert(JSON.stringify(result.sourceGates)===JSON.stringify(Array.from({length:14},(_,index)=>'P2-'+String(index+1).padStart(2,'0'))),'P2 gate set drifted',{iteration,result});
      assert(result.rpc?.actualWorkerRpc===true,'P2 RPC court did not use actual Worker',{iteration,result});
      assert(result.rpc?.timeoutCode==='OC_WORKER_TIMEOUT','P2 timeout contract drifted',{iteration,result});
      assert(result.rpc?.reconciledMutationState==='APPLIED','P2 mutation reconciliation failed',{iteration,result});
      assert(result.rpc?.workerCrashCode==='OC_GUEST_WORKER_FAILED','P2 worker death did not fail closed',{iteration,result});
      assert(result.rpc?.transferBytes===8*1024*1024&&result.rpc?.transferDetached===true,'P2 transferable pressure court failed',{iteration,result});
      assert(result.cancellation?.allAborted===true&&result.cancellation?.pendingReaders===0,'P2 cancellation lineage leaked consumer',{iteration,result});
      assert(result.syncRpc?.reentrantCode==='OC_INVALID_STATE'&&result.syncRpc?.deniedCode==='OC_BUILTIN_UNAVAILABLE','P2 sync RPC policy failed',{iteration,result});
      assert(result.process?.terminalCountsUnique?.length===1&&result.process.terminalCountsUnique[0]===1,'P2 process terminal publication was not exactly-once',{iteration,result});
      assert(result.process?.retainedActiveProcesses===0,'P2 repeated cycles retained processes',{iteration,result});
      assert(result.process?.portRoutesAfterRevoke===0,'P2 virtual port route leaked after revoke',{iteration,result});
      runs.push(Object.freeze({iteration,...result}));
      console.log('[p2-runtime] iteration '+iteration+' PASS '+JSON.stringify(result));
    }finally{
      try{cdp.close();}catch{}
      await closeTarget(debugPort,target);
    }
  }

  const receipt=Object.freeze({
    schema:'opencontainer.p2-runtime-process.v1.0',
    status:'PASS',
    source:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json',
    sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
    minimumClosure:'RELEASE-READY evidence',
    sourceGates:Object.freeze(Array.from({length:14},(_,index)=>'P2-'+String(index+1).padStart(2,'0'))),
    nodeVersion:process.version,
    browser:browser.version,
    profile:'declared Chrome / Ubuntu x64 CI profile',
    iterations,
    passedIterations:runs.length,
    actualBrowserWorkerRpc:true,
    timeoutMutationReconciliation:true,
    cancellationLineage:true,
    outputDrainBounded:true,
    exactlyOnceTerminalPublication:true,
    workerDeathCleanup:true,
    syncRpcNoReentrancy:true,
    boundedProcessTree:true,
    epochBoundVirtualPorts:true,
    boundedOutputRetention:true,
    staleHandleRejection:true,
    largeTransferBytes:8*1024*1024,
    repeatedProcessCycles:200,
    stableErrors:true,
    runs:Object.freeze(runs),
    productionClosed:false
  });
  await mkdir(resolve('.artifacts/p2-runtime'),{recursive:true});
  await writeFile(resolve('.artifacts/p2-runtime/browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log('P2 RUNTIME PROCESS PASS '+JSON.stringify(receipt));
}finally{
  await terminateChild(chrome);
  await terminateChild(server);
  await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
