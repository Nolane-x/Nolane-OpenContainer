import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const port=Number(process.env.OPENCONTAINER_P10_PORT||4390);
const origin='http://127.0.0.1:'+port;
const iterations=Number(process.env.OPENCONTAINER_P10_ITERATIONS||2);
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
  throw new Error('No supported Chrome/Chromium binary found for P10 AI consumer court');
}
function waitForServer(child){
  return new Promise((resolvePromise,reject)=>{
    const timer=setTimeout(()=>reject(new Error('P10 playground server did not start')),8000);
    let stderr='';
    child.stderr.on('data',chunk=>{stderr+=String(chunk);});
    child.stdout.on('data',chunk=>{
      const output=String(chunk);process.stdout.write(output);
      if(output.includes('OpenContainer playground:')){clearTimeout(timer);resolvePromise();}
    });
    child.once('exit',code=>{
      clearTimeout(timer);
      reject(new Error('P10 playground server exited early with code '+code+'\n'+stderr));
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
  assert(response.ok,'Chrome failed to create P10 target',{status:response.status,url});
  const target=await response.json();
  assert(target?.id&&target?.webSocketDebuggerUrl,'Chrome P10 target response incomplete',{target});
  return target;
}
async function closeTarget(debugPort,target){
  if(!target?.id)return;
  try{await fetch('http://127.0.0.1:'+debugPort+'/json/close/'+target.id);}catch{}
}
async function evaluate(cdp,expression){
  const response=await cdp.command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(response.exceptionDetails){
    throw new Error('P10 Runtime.evaluate exception: '+(response.exceptionDetails.exception?.description??response.exceptionDetails.text??'unknown'));
  }
  return response.result?.value;
}
async function waitForCourt(cdp,timeoutMs=15000){
  const deadline=Date.now()+timeoutMs;let last=null;
  while(Date.now()<deadline){
    try{
      last=await evaluate(cdp,`({
        ready:document.body?.dataset?.ready??null,
        court:typeof globalThis.__p10AiCourt,
        isolated:globalThis.crossOriginIsolated
      })`);
      if(last?.ready==='true'&&last?.court==='object')return last;
    }catch{}
    await delay(75);
  }
  throw new Error('P10 AI court did not become ready: '+JSON.stringify(last));
}

assert(process.version==='v24.21.0','P10 court requires exact Node v24.21.0',{actual:process.version});

const contract=spawnSync(process.execPath,[
  '--test',
  'tests/p10-ai-consumer.test.js'
],{
  cwd:resolve('.'),
  encoding:'utf8',
  env:{...process.env}
});
process.stdout.write(contract.stdout??'');
process.stderr.write(contract.stderr??'');
assert(contract.status===0,'P10 AI consumer Node contract court failed',{status:contract.status});

const browser=findBrowser();
const profile=await mkdtemp(join(tmpdir(),'opencontainer-p10-ai-'));
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
  assert(Number.isInteger(debugPort)&&debugPort>0,'Invalid P10 Chrome debug port',{browserWebSocket});

  for(let iteration=1;iteration<=iterations;iteration++){
    const target=await newTarget(debugPort,origin+'/p10-ai-consumer.html?iteration='+iteration);
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
      assert(ready.isolated===true,'P10 court lost cross-origin isolation',{iteration,ready});
      const result=await evaluate(cdp,'globalThis.__p10AiCourt.run()');
      assert(result?.status==='PASS','P10 browser court did not pass',{iteration,result});
      const gates=Array.from({length:18},(_,index)=>'P10-'+String(index+1).padStart(2,'0'));
      assert(JSON.stringify(result.sourceGates)===JSON.stringify(gates),'P10 gate set drifted',{iteration,result});
      assert(result.provider?.keyCustody==='session-memory','P10 BYOK custody drifted',{iteration,result});
      assert(result.provider?.supportPlaintext===false&&result.provider?.workspacePlaintext===false,'P10 BYOK leaked into retained surfaces',{iteration,result});
      assert(result.context?.excluded?.length===2&&result.context?.explicitOverride===true,'P10 context egress policy failed',{iteration,result});
      assert(result.authority?.untrustedDataGrantedAuthority===false,'P10 prompt injection gained authority',{iteration,result});
      assert(result.authority?.rendered?.scripts===0&&result.authority?.rendered?.eventHandlers===false,'P10 approval rendering executed injection',{iteration,result});
      assert(result.changeSet?.normal?.committed===true&&result.changeSet?.normal?.acknowledged===true,'P10 ChangeSet publish/ack failed',{iteration,result});
      assert(result.changeSet?.idempotentReplay===true&&result.changeSet?.idempotentGenerationStable===true,'P10 idempotency evidence failed',{iteration,result});
      assert(result.changeSet?.undoType==='path-version-aware'&&result.changeSet?.staleUndoRejected===true,'P10 Undo contract failed',{iteration,result});
      assert(result.changeSet?.cancellation?.preTool==='OC_WORKER_STALE'&&result.changeSet?.cancellation?.inTool==='OC_WORKER_STALE','P10 pre/in-tool cancellation failed',{iteration,result});
      assert(result.changeSet?.cancellation?.postCommit?.committed===true&&result.changeSet?.cancellation?.postCommit?.acknowledged===false,'P10 post-commit cancellation semantics failed',{iteration,result});
      assert(result.changeSet?.cancellation?.ackLost?.idempotentReplay===true,'P10 acknowledgement-loss replay guard failed',{iteration,result});
      assert(result.childAgents?.staleAccepted===false&&result.childAgents?.reviewEvidence===1,'P10 stale child result became canonical',{iteration,result});
      assert(result.concurrency?.overBudgetCode==='OC_RESOURCE_EXHAUSTED'&&result.concurrency?.pressureBlockedCode==='OC_RESOURCE_EXHAUSTED','P10 shared concurrency authority failed',{iteration,result});
      assert(result.cost?.hiddenWithoutAuthority===true&&result.cost?.visibleWithAuthority===true,'P10 cost metadata authority failed',{iteration,result});
      assert(result.boundaries?.coreSurfaceCountUnchanged===9&&result.boundaries?.providerQualityClaimed===false,'P10 optional-consumer boundary drifted',{iteration,result});
      assert(diagnostics.exceptions.length===0,'P10 browser court emitted unexpected exceptions',{iteration,diagnostics});
      runs.push(Object.freeze({iteration,...result}));
      console.log('[p10-ai-consumer] iteration '+iteration+' PASS '+JSON.stringify(result));
    }finally{
      try{cdp.close();}catch{}
      await closeTarget(debugPort,target);
    }
  }

  const receipt=Object.freeze({
    schema:'opencontainer.p10-ai-consumer-evidence.v1.0',
    status:'PASS',
    source:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json',
    sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
    minimumClosure:'PASS-INTEGRATION + declared-profile evidence',
    sourceGates:Object.freeze(Array.from({length:18},(_,index)=>'P10-'+String(index+1).padStart(2,'0'))),
    nodeVersion:process.version,
    browser:browser.version,
    profile:'declared Chrome / Ubuntu x64 CI profile',
    iterations,
    passedIterations:runs.length,
    coreSurfaceCount:9,
    optionalConsumerPackage:'@nolane/opencontainer-ai-consumer',
    providerAgnostic:true,
    byokSessionMemoryOnly:true,
    contextManifest:true,
    sensitiveContextDefaultDeny:true,
    untrustedDataNoAuthority:true,
    discussPlanBuildDistinct:true,
    changeSetPreconditionValidatePublishAck:true,
    destructiveRecoveryPoint:true,
    idempotentSideEffects:true,
    staleChildEvidenceOnly:true,
    pathVersionAwareUndo:true,
    providerFailureIndependent:true,
    providerSwitchScopeReset:true,
    sharedConcurrencyAuthority:true,
    promptInjectionCourt:true,
    cancellationPhaseCourt:true,
    authoritativeUsageOnly:true,
    runs:Object.freeze(runs),
    boundaries:Object.freeze({
      providerQualityClaimed:false,
      providerSpecificCoreApiAdded:false,
      keyPersistenceClaimed:false,
      productionClosed:false
    })
  });
  await mkdir(resolve('.artifacts/p10-ai-consumer'),{recursive:true});
  await writeFile(resolve('.artifacts/p10-ai-consumer/browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log('P10 AI CONSUMER PASS '+JSON.stringify({gates:18,iterations:runs.length,browser:browser.version}));
}finally{
  await terminateChild(chrome);
  await terminateChild(server);
  await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
