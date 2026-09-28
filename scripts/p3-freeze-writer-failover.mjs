import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port=Number(process.env.OPENCONTAINER_P3_FREEZE_PORT||4289);
const iterations=Number(process.env.OPENCONTAINER_P3_FREEZE_ITERATIONS||2);
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

function findBrowser(){
  for(const command of candidates){
    const result=spawnSync(command,['--version'],{encoding:'utf8'});
    if(result.status===0)return {command,version:(result.stdout||result.stderr).trim()};
  }
  throw new Error('No supported Chromium/Chrome binary found for P3 freeze writer failover court');
}

function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

function waitForServer(child){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Playground server did not start')),5000);
    let stderr='';
    child.stderr.on('data',chunk=>{stderr+=String(chunk);});
    child.stdout.on('data',chunk=>{
      const text=String(chunk);
      process.stdout.write(text);
      if(text.includes('OpenContainer playground:')){
        clearTimeout(timer);
        resolve();
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
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(webSocketUrl);
    const pending=new Map();
    let nextId=0;
    socket.addEventListener('open',()=>resolve({
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
  await new Promise(resolve=>{
    let settled=false;
    const finish=()=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      resolve();
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
        hasCourt:typeof globalThis.__p3WriterCourt==='object',
        crossOriginIsolated:globalThis.crossOriginIsolated
      })`);
      if(last?.ready==='true'&&last?.hasCourt===true)return last;
    }catch{}
    await delay(50);
  }
  throw new Error('P3 writer court did not become ready: '+JSON.stringify(last));
}

function js(value){return JSON.stringify(value);}

async function courtCall(cdp,method,...args){
  return evaluate(
    cdp,
    `globalThis.__p3WriterCourt[${js(method)}](...${js(args)})`
  );
}

const browser=findBrowser();
const profile=await mkdtemp(join(tmpdir(),'opencontainer-p3-freeze-'));
const server=spawn(process.execPath,['apps/playground/server.mjs'],{
  env:{...process.env,PORT:String(port),OPENCONTAINER_P5_NETWORK_PORT:String(port+1)},
  stdio:['ignore','pipe','pipe']
});
let chrome=null;
const runReceipts=[];

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
  assert(Number.isInteger(debugPort)&&debugPort>0,'Invalid DevTools debug port',{browserWebSocket:devtools.browserWebSocket});
  const courtUrl='http://127.0.0.1:'+port+'/p3-freeze-writer-failover.html';

  for(let iteration=1;iteration<=iterations;iteration++){
    const directoryName='opencontainer-p3-freeze-writer-'+Date.now()+'-'+iteration+'-'+Math.random().toString(16).slice(2);
    const targetA=await newTarget(debugPort,courtUrl+'?role=A&iteration='+iteration);
    const targetB=await newTarget(debugPort,courtUrl+'?role=B&iteration='+iteration);
    const cdpA=await connectCdp(targetA.webSocketDebuggerUrl);
    const cdpB=await connectCdp(targetB.webSocketDebuggerUrl);

    try{
      for(const cdp of [cdpA,cdpB]){
        await cdp.command('Runtime.enable');
        await cdp.command('Page.enable');
        const ready=await waitForCourt(cdp);
        assert(ready.crossOriginIsolated===true,'P3 writer court lost cross-origin isolation',{iteration,ready});
      }

      const openA=await courtCall(cdpA,'open',directoryName);
      assert(openA.restoredGeneration===null,'Writer A unexpectedly restored prior state',{iteration,openA});
      const seeded=await courtCall(cdpA,'seed','A0');
      assert(seeded.receipt?.writerEpoch===1,'Writer A did not claim initial epoch 1',{iteration,seeded});
      assert(seeded.receipt?.sequence===1,'Writer A did not publish initial sequence 1',{iteration,seeded});

      const openB=await courtCall(cdpB,'open',directoryName);
      assert(openB.restoredGeneration===seeded.receipt.generation,'Writer B did not restore A canonical generation',{iteration,openB,seeded});

      await cdpA.command('Page.setWebLifecycleState',{state:'frozen'});
      await delay(150);

      const publishedB=await courtCall(cdpB,'mutateAndPublish','B1');
      assert(publishedB.ok===true,'Writer B failed publication while A was frozen',{iteration,publishedB});
      assert(publishedB.receipt?.writerEpoch===2,'Writer B did not claim successor epoch 2',{iteration,publishedB});
      assert(publishedB.receipt?.sequence===2,'Writer B did not advance canonical sequence',{iteration,publishedB});

      await cdpA.command('Page.setWebLifecycleState',{state:'active'});
      await delay(150);

      const afterResume=await courtCall(cdpA,'state');
      assert(afterResume.lifecycle?.freezeEvents>=1,'Writer A did not observe a real freeze lifecycle event',{iteration,afterResume});
      assert(afterResume.lifecycle?.resumeEvents>=1,'Writer A did not observe a real resume lifecycle event',{iteration,afterResume});

      const mutatedA=await courtCall(cdpA,'mutate','A-stale');
      assert(mutatedA.localValue==='A-stale','Writer A did not retain its local stale edit after resume',{iteration,mutatedA});

      const staleA=await courtCall(cdpA,'publish');
      assert(staleA.ok===false,'Resumed stale writer A unexpectedly published',{iteration,staleA});
      assert(staleA.error?.code==='OC_STALE_GENERATION','Resumed writer A did not fail stale-generation fencing',{iteration,staleA});
      assert(
        staleA.error?.details?.expectedWriterEpoch===1&&staleA.error?.details?.currentWriterEpoch===2,
        'Resumed writer A stale-epoch receipt drifted',
        {iteration,staleA}
      );
      assert(staleA.writerState?.writerEpoch===1,'Writer A local epoch identity changed silently',{iteration,staleA});
      assert(staleA.writerState?.manifestWriterEpoch===2,'Writer A did not re-handshake canonical manifest epoch after resume',{iteration,staleA});

      const canonical=await courtCall(cdpB,'readCanonical');
      assert(canonical.value==='B1','Stale resumed writer overwrote successor canonical state',{iteration,canonical});
      assert(canonical.current?.writerEpoch===2,'Canonical manifest lost successor writer epoch',{iteration,canonical});
      assert(canonical.current?.sequence===2,'Canonical sequence changed after rejected stale publication',{iteration,canonical});

      const receipt=Object.freeze({
        iteration,
        directoryName,
        browser:browser.version,
        crossOriginIsolated:true,
        initial:Object.freeze({
          sequence:seeded.receipt.sequence,
          generation:seeded.receipt.generation,
          writerEpoch:seeded.receipt.writerEpoch
        }),
        freeze:Object.freeze({
          command:'Page.setWebLifecycleState',
          state:'frozen',
          freezeEvents:afterResume.lifecycle.freezeEvents,
          resumeEvents:afterResume.lifecycle.resumeEvents,
          visibilityChanges:afterResume.lifecycle.visibilityChanges
        }),
        successor:Object.freeze({
          sequence:publishedB.receipt.sequence,
          generation:publishedB.receipt.generation,
          writerEpoch:publishedB.receipt.writerEpoch,
          value:'B1'
        }),
        resumedStaleWriter:Object.freeze({
          localValue:staleA.localValue,
          code:staleA.error.code,
          expectedWriterEpoch:staleA.error.details.expectedWriterEpoch,
          currentWriterEpoch:staleA.error.details.currentWriterEpoch,
          localWriterEpoch:staleA.writerState.writerEpoch,
          observedManifestWriterEpoch:staleA.writerState.manifestWriterEpoch
        }),
        canonicalAfterReject:Object.freeze({
          value:canonical.value,
          sequence:canonical.current.sequence,
          generation:canonical.current.generation,
          writerEpoch:canonical.current.writerEpoch
        }),
        status:'PASS'
      });
      runReceipts.push(receipt);
      console.log('[p3-freeze-writer] iteration '+iteration+' PASS '+JSON.stringify(receipt));
      await courtCall(cdpB,'cleanup');
    }finally{
      try{cdpA.close();}catch{}
      try{cdpB.close();}catch{}
      await closeTarget(debugPort,targetA);
      await closeTarget(debugPort,targetB);
    }
  }

  const receipt=Object.freeze({
    schema:'opencontainer.p3-freeze-writer-failover.v1.0',
    status:'PASS',
    browser:browser.version,
    profile:'declared Chrome / Ubuntu x64 CI profile',
    iterations,
    passedIterations:runReceipts.length,
    realMultiTab:true,
    realPageLifecycleFreeze:true,
    writerEpochTakeover:true,
    staleResumePublicationRejected:true,
    canonicalPreserved:true,
    runs:Object.freeze(runReceipts)
  });
  console.log('P3 FREEZE WRITER FAILOVER PASS '+JSON.stringify(receipt));
}finally{
  await terminateChild(chrome);
  await terminateChild(server);
  await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
