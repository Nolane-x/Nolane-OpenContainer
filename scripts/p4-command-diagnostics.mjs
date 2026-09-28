import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const port=Number(process.env.OPENCONTAINER_P4_COMMAND_DIAGNOSTICS_PORT||4342);
const origin='http://127.0.0.1:'+port;
const iterations=Number(process.env.OPENCONTAINER_P4_COMMAND_DIAGNOSTICS_ITERATIONS||2);
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
  throw new Error('No supported Chrome/Chromium binary found for P4 command diagnostics court');
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
  const response=await fetch('http://127.0.0.1:'+debugPort+'/json/new?'+encodeURIComponent(url),{method:'PUT'});
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
        court:typeof globalThis.__p4CommandDiagnosticsCourt,
        isolated:globalThis.crossOriginIsolated
      })`);
      if(last?.ready==='true'&&last?.court==='object')return last;
    }catch{}
    await delay(75);
  }
  throw new Error('P4 command diagnostics court did not become ready: '+JSON.stringify(last));
}

assert(process.version==='v24.21.0','P4 command diagnostics court requires exact Node v24.21.0',{actual:process.version});

const contract=spawnSync(process.execPath,[
  '--test',
  'tests/package-command-bridge.test.js',
  'tests/resolver.test.js',
  'tests/production-diagnostics.test.js'
],{
  cwd:resolve('.'),
  encoding:'utf8',
  env:{...process.env}
});
process.stdout.write(contract.stdout??'');
process.stderr.write(contract.stderr??'');
assert(contract.status===0,'P4 command diagnostics contract court failed',{status:contract.status});

const browser=findBrowser();
const profile=await mkdtemp(join(tmpdir(),'opencontainer-p4-command-diagnostics-'));
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
    const target=await newTarget(debugPort,origin+'/p4-command-diagnostics.html?iteration='+iteration);
    const cdp=await connectCdp(target.webSocketDebuggerUrl);
    const diagnostics={exceptions:[],failedRequests:[],errorResponses:[]};
    try{
      cdp.on('Runtime.exceptionThrown',params=>{
        diagnostics.exceptions.push({
          text:params.exceptionDetails?.text??null,
          description:params.exceptionDetails?.exception?.description??null,
          url:params.exceptionDetails?.url??null
        });
      });
      cdp.on('Network.loadingFailed',params=>{
        diagnostics.failedRequests.push({
          requestId:params.requestId,
          errorText:params.errorText,
          blockedReason:params.blockedReason??null
        });
      });
      cdp.on('Network.responseReceived',params=>{
        const status=params.response?.status??0;
        if(status>=400)diagnostics.errorResponses.push({url:params.response?.url??null,status});
      });
      await cdp.command('Runtime.enable');
      await cdp.command('Page.enable');
      await cdp.command('Network.enable');
      let ready;
      try{ready=await waitForCourt(cdp);}
      catch(error){
        error.details={...(error.details??{}),iteration,diagnostics};
        console.error('P4 command diagnostics bootstrap '+JSON.stringify(diagnostics,null,2));
        throw error;
      }
      assert(ready.isolated===true,'P4 command diagnostics court lost cross-origin isolation',{iteration,ready});
      const result=await evaluate(cdp,'globalThis.__p4CommandDiagnosticsCourt.run()');
      assert(result?.status==='PASS','P4 command diagnostics browser court did not pass',{iteration,result});
      assert(JSON.stringify(result.sourceGates)===JSON.stringify(['P4-14','P4-17','P4-18']),'P4 Wave 4 gate set drifted',{iteration,result});
      assert(result.command?.lastWriterWins===false,'P4 .bin court observed last-writer-wins',{iteration,result});
      assert(result.command?.candidateCount===2,'P4 .bin candidate count drifted',{iteration,result});
      assert(result.ambiguity?.failClosed===true,'P4 .bin ambiguity did not fail closed',{iteration,result});
      assert(result.diagnostics?.leakedSecret===false,'P4 package diagnostics leaked source secret',{iteration,result});
      assert(result.diagnostics?.installScriptPolicy==='deny-by-default','P4 install-script diagnostics policy drifted',{iteration,result});
      assert(result.nativeAddon?.genericAliasFailureCode==='OC_NATIVE_ADDON_UNSUPPORTED','P4 generic alias bypassed native-addon boundary',{iteration,result});
      assert(result.nativeAddon?.explicit===true,'P4 explicit native-addon adapter receipt missing',{iteration,result});
      assert(result.nativeAddon?.hostNativeExecution===false,'P4 native-addon court reached host-native execution',{iteration,result});
      runs.push(Object.freeze({iteration,...result}));
      console.log('[p4-command-diagnostics] iteration '+iteration+' PASS '+JSON.stringify(result));
    }finally{
      try{cdp.close();}catch{}
      await closeTarget(debugPort,target);
    }
  }

  const receipt=Object.freeze({
    schema:'opencontainer.p4-command-diagnostics.v1.0',
    status:'PASS',
    sourceGates:Object.freeze(['P4-14','P4-17','P4-18']),
    nodeVersion:process.version,
    browser:browser.version,
    profile:'declared Chrome / Ubuntu x64 CI profile',
    iterations,
    passedIterations:runs.length,
    contextualBinResolution:true,
    sameScopeBinAmbiguityFailClosed:true,
    lastWriterWinsPrevented:true,
    privacySafePackageProvenance:true,
    installScriptMetadata:true,
    genericAliasNativeAddonBypassPrevented:true,
    exactNativeAddonAdapterOnly:true,
    hostNativeExecution:false,
    runs:Object.freeze(runs),
    productionClosed:false
  });
  await mkdir(resolve('.artifacts/p4-command-diagnostics'),{recursive:true});
  await writeFile(
    resolve('.artifacts/p4-command-diagnostics/browser-receipt.json'),
    JSON.stringify(receipt,null,2)+'\n'
  );
  console.log('P4 COMMAND DIAGNOSTICS PASS '+JSON.stringify(receipt));
}finally{
  await terminateChild(chrome);
  await terminateChild(server);
  await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
