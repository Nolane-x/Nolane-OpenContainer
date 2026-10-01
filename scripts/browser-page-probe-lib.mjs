import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const browserCandidates=process.platform==='win32'
  ? ['chrome.exe','msedge.exe']
  : ['google-chrome-stable','google-chrome','chromium','chromium-browser'];

export function findBrowser(){
  for(const command of browserCandidates){
    const result=spawnSync(command,['--version'],{encoding:'utf8'});
    if(result.status===0)return {command,version:String(result.stdout||result.stderr).trim()};
  }
  throw new Error('No supported Chrome/Chromium binary found');
}
const delay=ms=>new Promise(resolveDelay=>setTimeout(resolveDelay,ms));

async function waitDevTools(child,profile,timeoutMs=30000){
  let stderr='';
  const onData=chunk=>{stderr+=String(chunk);};
  child.stderr.on('data',onData);
  const deadline=Date.now()+timeoutMs;
  try{
    while(Date.now()<deadline){
      try{
        const active=await readFile(join(profile,'DevToolsActivePort'),'utf8');
        const [portLine,pathLine]=active.trim().split(/\r?\n/);
        const port=Number(portLine);
        if(Number.isInteger(port)&&port>0&&pathLine?.startsWith('/devtools/browser/')){
          return {port,browserWebSocket:'ws://127.0.0.1:'+port+pathLine,stderr:()=>stderr};
        }
      }catch{}
      if(child.exitCode!==null)throw new Error('Chrome exited before DevTools ready: '+child.exitCode+'\n'+stderr);
      await delay(100);
    }
    throw new Error('Chrome DevTools timeout\n'+stderr);
  }finally{child.stderr.off('data',onData);}
}
async function waitPageTarget(port,expectedUrl,timeoutMs=15000){
  const deadline=Date.now()+timeoutMs;
  let last=[];
  while(Date.now()<deadline){
    try{
      const response=await fetch('http://127.0.0.1:'+port+'/json/list',{cache:'no-store'});
      if(response.ok){
        last=await response.json();
        const exact=last.find(x=>x.type==='page'&&x.url===expectedUrl);
        const samePath=last.find(x=>x.type==='page'&&x.url.includes(new URL(expectedUrl).pathname));
        const target=exact??samePath;
        if(target?.webSocketDebuggerUrl)return target;
      }
    }catch{}
    await delay(50);
  }
  throw new Error('Browser page target not found: '+JSON.stringify(last));
}
function connect(url){
  return new Promise((resolveConnect,reject)=>{
    const socket=new WebSocket(url);
    const pending=new Map();
    let nextId=0;
    socket.addEventListener('open',()=>resolveConnect({
      async command(method,params={}){
        const id=++nextId;
        const response=new Promise((resolveResponse,rejectResponse)=>pending.set(id,{resolveResponse,rejectResponse,method}));
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
      if(message.error)waiter.rejectResponse(new Error(waiter.method+': '+message.error.message));
      else waiter.resolveResponse(message.result);
    });
    socket.addEventListener('error',()=>reject(new Error('Chrome DevTools WebSocket failed')));
    socket.addEventListener('close',()=>{
      for(const waiter of pending.values())waiter.rejectResponse(new Error('Chrome DevTools WebSocket closed'));
      pending.clear();
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

export async function probeBrowserPage(url,{
  profilePath=null,
  timeoutMs=90000,
  waitExpression="document.body?.dataset?.status==='pass'||document.body?.dataset?.status==='fail'"
}={}){
  const parsed=new URL(url);
  if(!['http:','https:'].includes(parsed.protocol))throw new Error('browser page probe requires http(s)');
  const browser=findBrowser();
  const ownedProfile=profilePath===null;
  const profile=profilePath??await mkdtemp(join(tmpdir(),'opencontainer-page-probe-'));
  const child=spawn(browser.command,[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--no-first-run','--no-default-browser-check','--user-data-dir='+profile,
    '--remote-debugging-port=0',parsed.href
  ],{stdio:['ignore','ignore','pipe']});
  let cdp=null;
  try{
    const devtools=await waitDevTools(child,profile);
    const target=await waitPageTarget(devtools.port,parsed.href);
    cdp=await connect(target.webSocketDebuggerUrl);
    await cdp.command('Runtime.enable');
    const deadline=Date.now()+timeoutMs;
    let snapshot=null;
    while(Date.now()<deadline){
      const evaluated=await cdp.command('Runtime.evaluate',{
        expression:`(() => ({
          ready: globalThis.__openContainerUi?.ready?.() ?? null,
          crossOriginIsolated: globalThis.crossOriginIsolated === true,
          serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
          storageAvailable: Boolean(navigator.storage?.getDirectory),
          locksAvailable: Boolean(navigator.locks?.request),
          status: document.body?.dataset?.status ?? null,
          stage: document.body?.dataset?.stage ?? null,
          resultText: document.getElementById('result')?.textContent ?? null,
          waitDone: Boolean(${waitExpression})
        }))()`,
        returnByValue:true,
        awaitPromise:true
      });
      snapshot=evaluated.result?.value??null;
      if(snapshot?.waitDone)break;
      await delay(100);
    }
    if(!snapshot?.waitDone)throw new Error('browser page probe timeout: '+JSON.stringify(snapshot));
    let result=null;
    if(snapshot.resultText){
      try{result=JSON.parse(snapshot.resultText);}catch{result=snapshot.resultText;}
    }
    return Object.freeze({
      schema:'opencontainer.browser-page-probe.v1.0',
      browser,
      url:parsed.href,
      snapshot,
      result
    });
  }finally{
    try{cdp?.close();}catch{}
    await terminate(child);
    if(ownedProfile)await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  }
}
