import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const port=Number(process.env.OPENCONTAINER_P9_PORT||4397);
const origin='http://127.0.0.1:'+port;
const artifactDir=resolve('.artifacts/p9-ui-rendered');
const receiptPath=resolve(process.argv[2]||join(artifactDir,'browser-receipt.json'));

function assert(condition,message,details={}){
  if(condition)return;
  const error=new Error(message);
  error.details=details;
  throw error;
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function findBrowser(){
  for(const command of ['google-chrome-stable','google-chrome','chromium','chromium-browser']){
    const result=spawnSync(command,['--version'],{encoding:'utf8'});
    if(result.status===0)return {command,version:String(result.stdout||result.stderr).trim()};
  }
  throw new Error('No Chrome/Chromium binary found for P9 rendered court');
}
async function waitForServer(child){
  return new Promise((resolveServer,reject)=>{
    const timer=setTimeout(()=>reject(new Error('P9 playground server did not start')),10000);
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
      reject(new Error('P9 playground server exited early '+code+'\n'+stderr));
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
        const parts=active.trim().split(/\r?\n/);
        const debugPort=Number(parts[0]);
        const path=parts[1];
        if(Number.isInteger(debugPort)&&debugPort>0&&path&&path.startsWith('/devtools/browser/')){
          return 'ws://127.0.0.1:'+debugPort+path;
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
async function newTarget(debugPort,url){
  const response=await fetch('http://127.0.0.1:'+debugPort+'/json/new?'+encodeURIComponent(url),{method:'PUT'});
  assert(response.ok,'Chrome failed to create P9 target',{status:response.status,url});
  const target=await response.json();
  assert(target&&target.id&&target.webSocketDebuggerUrl,'P9 target response incomplete',{target});
  return target;
}
async function closeTarget(debugPort,target){
  if(!target||!target.id)return;
  try{await fetch('http://127.0.0.1:'+debugPort+'/json/close/'+target.id);}catch{}
}
async function evaluate(cdp,expression){
  const response=await cdp.command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(response.exceptionDetails){
    throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text||'Runtime.evaluate failed');
  }
  return response.result&&response.result.value;
}
async function waitUntil(cdp,expression,{timeoutMs=15000,label='condition'}={}){
  const deadline=Date.now()+timeoutMs;
  let last=null;
  while(Date.now()<deadline){
    try{
      last=await evaluate(cdp,expression);
      if(last)return last;
    }catch(error){last={error:error.message};}
    await delay(75);
  }
  throw new Error('Timed out waiting for '+label+': '+JSON.stringify(last));
}
async function waitReady(cdp){
  const deadline=Date.now()+20000;
  let last=null;
  while(Date.now()<deadline){
    last=await evaluate(cdp,"({html:document.documentElement.dataset.opencontainerReady??null,app:document.querySelector('#app')?.dataset.ready??null,error:globalThis.__openContainerBootError??null,ui:typeof globalThis.__openContainerUi})");
    if(last?.app==='error'){
      const detail=last.error??{code:document?.querySelector?.('#app')?.dataset?.bootErrorCode??null};
      throw new Error('OpenContainer P9 shell boot failed: '+JSON.stringify(detail));
    }
    if(last?.html==='true'&&last?.app==='true'&&last?.ui==='object')break;
    await delay(75);
  }
  assert(last?.html==='true'&&last?.app==='true'&&last?.ui==='object','OpenContainer P9 shell did not become ready',{last});
  await evaluate(cdp,"import('/p9-ui-court.js').then(()=>true)");
  return waitUntil(cdp,"typeof globalThis.__p9RenderedCourt==='object'",{label:'P9 rendered helper'});
}
async function call(cdp,method,args=[]){
  return evaluate(cdp,'globalThis.__p9RenderedCourt['+JSON.stringify(method)+'](...'+JSON.stringify(args)+')');
}
async function uiCall(cdp,method,args=[]){
  return evaluate(cdp,'globalThis.__openContainerUi['+JSON.stringify(method)+'](...'+JSON.stringify(args)+')');
}
async function key(cdp,keyValue,{code=keyValue,modifiers=0}={}){
  const virtualKeys=Object.freeze({
    Enter:13,Tab:9,Escape:27,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,
    Home:36,End:35,Space:32
  });
  const windowsVirtualKeyCode=virtualKeys[keyValue]??0;
  const base={key:keyValue,code,modifiers};
  if(windowsVirtualKeyCode)base.windowsVirtualKeyCode=windowsVirtualKeyCode;
  await cdp.command('Input.dispatchKeyEvent',{type:'rawKeyDown',...base});
  if(keyValue==='Enter'||keyValue==='Space'){
    const text=keyValue==='Enter'?'\r':' ';
    await cdp.command('Input.dispatchKeyEvent',{
      type:'char',
      key:keyValue==='Space'?' ':keyValue,
      code,
      modifiers,
      windowsVirtualKeyCode,
      text,
      unmodifiedText:text
    });
  }
  await cdp.command('Input.dispatchKeyEvent',{type:'keyUp',...base});
}
async function screenshot(cdp,name){
  const result=await cdp.command('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
  const path=join(artifactDir,name+'.png');
  await writeFile(path,Buffer.from(result.data,'base64'));
  return path;
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
function axRows(tree){
  return (tree.nodes||[]).map(node=>({
    role:node.role&&node.role.value||'',
    name:node.name&&node.name.value||'',
    ignored:node.ignored===true
  }));
}

assert(process.version==='v24.21.0','P9 rendered court requires exact Node v24.21.0',{actual:process.version});
await mkdir(artifactDir,{recursive:true});
const browser=findBrowser();
const profile=await mkdtemp(join(tmpdir(),'opencontainer-p9-'));
const server=spawn(process.execPath,['apps/playground/server.mjs'],{
  env:{...process.env,PORT:String(port),OPENCONTAINER_P5_NETWORK_PORT:String(port+1)},
  stdio:['ignore','pipe','pipe']
});
let chrome=null;
let browserCdp=null;
let cdp=null;
let target=null;
let debugPort=null;

try{
  await waitForServer(server);
  chrome=spawn(browser.command,[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--no-first-run','--no-default-browser-check','--enable-automation',
    '--user-data-dir='+profile,'--remote-debugging-port=0','about:blank'
  ],{stdio:['ignore','ignore','pipe']});
  const browserWebSocket=await waitForDevTools(chrome,profile);
  debugPort=Number(new URL(browserWebSocket).port);
  assert(Number.isInteger(debugPort)&&debugPort>0,'P9 invalid Chrome debug port',{browserWebSocket});
  browserCdp=await connectCdp(browserWebSocket);
  const version=await browserCdp.command('Browser.getVersion');

  target=await newTarget(debugPort,origin+'/');
  cdp=await connectCdp(target.webSocketDebuggerUrl);
  await cdp.command('Runtime.enable');
  await cdp.command('Page.enable');
  await cdp.command('Accessibility.enable');
  await waitReady(cdp);

  const initial=await call(cdp,'initial');
  assert(initial.ready===true,'P9 UI helper reports not ready',{initial});
  assert(initial.isolated===true,'P9 root shell lost cross-origin isolation',{initial});
  assert(initial.activeView==='preview','P9 initial surface is not Preview',{initial});
  assert(initial.layout.visibleSurfaces.length===1&&initial.layout.visibleSurfaces[0]==='preview','P9 progressive disclosure shows multiple surfaces',{initial});
  assert(initial.receipt&&initial.receipt.status&&initial.receipt.status.state==='READY','P9 shell is not bound to READY runtime',{initial});
  assert(initial.layout.canvas.height>initial.layout.topbar.height+initial.layout.tabs.height,'P9 permanent chrome dominates the work canvas',{initial});
  assert(initial.layout.visibleButtons.length>=3,'P9 dominant canvas lost primary controls',{initial});

  const accessibility=axRows(await cdp.command('Accessibility.getFullAXTree'));
  for(const name of ['Preview','Inspect','AI','Save source','Run process','Remove source…']){
    assert(accessibility.some(row=>row.name===name&&!row.ignored),'P9 accessibility tree missing named control',{name});
  }
  assert(accessibility.filter(row=>row.role==='tab'&&!row.ignored).length===3,'P9 accessibility tree does not expose three tabs',{accessibility});

  // Keyboard-only surface navigation.
  await evaluate(cdp,"document.querySelector('[data-view=preview]').focus();true");
  await key(cdp,'ArrowRight',{code:'ArrowRight'});
  assert(await evaluate(cdp,"globalThis.__openContainerUi.activeView()==='inspect'&&document.activeElement?.dataset?.view==='inspect'"),'P9 ArrowRight did not move to Inspect');
  await key(cdp,'ArrowRight',{code:'ArrowRight'});
  assert(await evaluate(cdp,"globalThis.__openContainerUi.activeView()==='ai'&&document.activeElement?.dataset?.view==='ai'"),'P9 ArrowRight did not move to AI');

  // IME-safe Ctrl+Enter.
  const imeText='Xin chào từ bộ gõ';
  await call(cdp,'startComposition',[imeText]);
  const beforeIme=await evaluate(cdp,"globalThis.__openContainerUi.lifecycle().ai.lastReceipt");
  await key(cdp,'Enter',{code:'Enter',modifiers:2});
  const duringIme=await call(cdp,'status');
  assert((await evaluate(cdp,"document.querySelector('#ai-prompt').value"))===imeText,'P9 Ctrl+Enter fired during IME composition',{duringIme});
  assert(JSON.stringify(duringIme.lifecycle.ai.lastReceipt)===JSON.stringify(beforeIme),'P9 AI receipt changed during composition',{duringIme,beforeIme});
  await call(cdp,'endComposition',['đ']);
  await key(cdp,'Enter',{code:'Enter',modifiers:2});
  await waitUntil(cdp,"document.querySelector('#ai-prompt').value===''",{label:'IME-safe AI send'});
  const afterIme=await evaluate(cdp,"globalThis.__openContainerUi.lifecycle().ai.lastReceipt");
  assert(afterIme&&afterIme.sent===true,'P9 AI send did not fire after composition ended',{afterIme});

  // Approval survives mode switches; keyboard activation removes item with deterministic focus.
  await evaluate(cdp,"document.querySelector('[data-ai-mode=Build]').focus();true");
  await key(cdp,'Enter',{code:'Enter'});
  await evaluate(cdp,"document.querySelector('#create-approval').focus();true");
  await key(cdp,'Enter',{code:'Enter'});
  await waitUntil(cdp,"globalThis.__openContainerUi.pendingApprovals().length===1",{label:'P9 approval creation'});
  const approval=(await uiCall(cdp,'pendingApprovals'))[0];
  for(const mode of ['Discuss','Plan','Build']){
    const selector='[data-ai-mode="'+mode+'"]';
    await evaluate(cdp,'document.querySelector('+JSON.stringify(selector)+').focus();true');
    await key(cdp,'Enter',{code:'Enter'});
  }
  const approvalsAfterSwitch=await uiCall(cdp,'pendingApprovals');
  assert(approvalsAfterSwitch.length===1&&approvalsAfterSwitch[0].id===approval.id,'P9 approval disappeared or duplicated across mode switches',{approval,approvalsAfterSwitch});
  await evaluate(cdp,"document.querySelector('[data-apply-approval]').focus();true");
  await key(cdp,'Enter',{code:'Enter'});
  await waitUntil(cdp,"globalThis.__openContainerUi.pendingApprovals().length===0",{label:'P9 approval application'});
  const approvalStatus=await call(cdp,'status');
  assert(approvalStatus.activeId==='create-approval'||Boolean(await evaluate(cdp,"document.activeElement?.dataset?.applyApproval")),'P9 approval deletion lost deterministic focus',{approvalStatus});
  assert(/^Applied /.test(approvalStatus.authority),'P9 Applied status is not tied to authority completion',{approvalStatus});

  // Keyboard-only save.
  await uiCall(cdp,'setView',['preview']);
  const marker='p9-save-'+Date.now();
  await call(cdp,'setSource',['<!doctype html><h1>'+marker+'</h1>']);
  await evaluate(cdp,"document.querySelector('#save-source').focus();true");
  await key(cdp,'Enter',{code:'Enter'});
  await waitUntil(cdp,"document.querySelector('#save-state').textContent.includes('Saved')",{label:'P9 save'});
  const savedReceipt=await evaluate(cdp,"globalThis.__openContainerUi.receipt()");
  const savedSource=await call(cdp,'source');
  assert(savedSource.includes(marker),'P9 save did not reach canonical VFS',{savedSource});
  assert(Number(savedReceipt.status.generation)>0,'P9 save did not advance canonical generation',{savedReceipt});

  // Destructive dialog: keyboard trap, recovery and opener focus restoration.
  await evaluate(cdp,"document.querySelector('#open-destructive').focus();true");
  await key(cdp,'Enter',{code:'Enter'});
  await waitUntil(cdp,"document.querySelector('#destructive-dialog').open===true",{label:'P9 destructive dialog'});
  const dialogAx=axRows(await cdp.command('Accessibility.getFullAXTree'));
  assert(dialogAx.some(row=>row.role==='dialog'&&row.name==='Remove preview source?'&&!row.ignored),'P9 destructive dialog lacks accessible name',{dialogAx});
  for(let i=0;i<4;i++){
    await key(cdp,'Tab',{code:'Tab'});
    assert(await evaluate(cdp,"document.querySelector('#destructive-dialog').contains(document.activeElement)"),'P9 focus escaped destructive dialog',{iteration:i});
  }
  await evaluate(cdp,"document.querySelector('#confirm-destructive').focus();true");
  await key(cdp,'Enter',{code:'Enter'});
  await waitUntil(cdp,"!globalThis.__openContainerUi.runtime().fs.exists('index.html')&&document.querySelector('#save-state').textContent.includes('Removed')&&!document.querySelector('#recovery-panel').hidden",{label:'P9 authority-backed destructive removal'});
  const removedStatus=await call(cdp,'status');
  assert(removedStatus.recoveryHidden===false&&removedStatus.save.includes('Removed'),'P9 destructive action did not expose recovery',{removedStatus});
  assert(removedStatus.activeId==='open-destructive','P9 dialog did not restore opener focus',{removedStatus});
  await evaluate(cdp,"document.querySelector('#recover-process').focus();true");
  await key(cdp,'Enter',{code:'Enter'});
  await waitUntil(cdp,"globalThis.__openContainerUi.runtime().fs.exists('index.html')&&document.querySelector('#save-state').textContent.includes('Restored')&&document.querySelector('#recovery-panel').hidden",{label:'P9 authority-backed source restore'});
  const restoredStatus=await call(cdp,'status');
  const restoredSource=await call(cdp,'source');
  assert(restoredStatus.save.includes('Restored')&&restoredSource.includes(marker),'P9 source recovery did not restore canonical state',{restoredStatus,restoredSource});

  // Irreversible diagnostic flow.
  await uiCall(cdp,'setView',['inspect']);
  const irreversible=await call(cdp,'diagnosticsCopy');
  assert(/cannot be undone/i.test(irreversible.description),'P9 irreversible action copy is not truthful',{irreversible});
  assert(/button-secondary/.test(irreversible.buttonClass),'P9 irreversible action is not secondary',{irreversible});
  assert(/recovery point/i.test(irreversible.sourceRemoveDescription),'P9 recoverable destructive action does not describe recovery',{irreversible});
  await evaluate(cdp,"document.querySelector('#open-clear-diagnostics').focus();true");
  await key(cdp,'Enter',{code:'Enter'});
  await waitUntil(cdp,"document.querySelector('#diagnostics-dialog').open===true",{label:'P9 diagnostics dialog'});
  for(let i=0;i<3;i++){
    await key(cdp,'Tab',{code:'Tab'});
    assert(await evaluate(cdp,"document.querySelector('#diagnostics-dialog').contains(document.activeElement)"),'P9 focus escaped diagnostics dialog',{iteration:i});
  }
  await key(cdp,'Escape',{code:'Escape'});
  await waitUntil(cdp,"document.querySelector('#diagnostics-dialog').open===false",{label:'P9 diagnostics dialog close'});
  assert(await evaluate(cdp,"document.activeElement?.id==='open-clear-diagnostics'"),'P9 diagnostics dialog did not restore opener focus');

  // Process failure/recovery without total-session masquerade.
  const lifecycleBefore=await uiCall(cdp,'lifecycle');
  await uiCall(cdp,'simulateProcessFailure');
  await waitUntil(cdp,"globalThis.__openContainerUi.lifecycle().process.state==='failed'&&!document.querySelector('#recovery-panel').hidden",{label:'P9 process failure'});
  const lifecycleFailed=await uiCall(cdp,'lifecycle');
  assert(lifecycleFailed.project.state===lifecycleBefore.project.state,'P9 process failure masqueraded as project loss',{lifecycleBefore,lifecycleFailed});
  assert(lifecycleFailed.ai.state===lifecycleBefore.ai.state,'P9 process failure masqueraded as AI loss',{lifecycleBefore,lifecycleFailed});
  await evaluate(cdp,"document.querySelector('#recover-process').focus();true");
  await key(cdp,'Enter',{code:'Enter'});
  await waitUntil(cdp,"globalThis.__openContainerUi.lifecycle().process.state==='idle'&&document.querySelector('#recovery-panel').hidden",{label:'P9 process recovery'});

  // External linked-folder conflict and permission state visibility.
  const linked=await call(cdp,'linkedConflictCourt');
  assert(linked.conflict&&linked.conflict.ok===false&&linked.conflict.error&&linked.conflict.error.code==='OC_STALE_GENERATION','P9 linked-folder conflict was not blocked',{linked});
  assert(/external-change-detected/i.test(linked.conflictView.text),'P9 linked-folder conflict is not visible at write',{linked});
  assert(/compare/.test(linked.conflictView.text)&&/merge/.test(linked.conflictView.text),'P9 linked-folder recovery actions are not visible',{linked});
  assert(linked.denied&&linked.denied.ok===false,'P9 denied linked-folder write unexpectedly succeeded',{linked});
  assert(/denied/i.test(linked.deniedView.text),'P9 linked-folder permission denial is not visible',{linked});
  assert(/granted/i.test(linked.observed.state.permissionReadwrite),'P9 initial granted permission was not authority-backed',{linked});

  // History/reload cannot undo canonical source.
  await uiCall(cdp,'setView',['preview']);
  const sourceBeforeHistory=await call(cdp,'source');
  await evaluate(cdp,"document.querySelector('[data-view=inspect]').click();document.querySelector('[data-view=ai]').click();true");
  await waitUntil(cdp,"history.length>=3",{label:'P9 surface history'});
  await evaluate(cdp,"history.back();true");
  await waitUntil(cdp,"globalThis.__openContainerUi.activeView()==='inspect'",{label:'P9 back navigation'});
  assert((await call(cdp,'source'))===sourceBeforeHistory,'P9 back navigation undid canonical source');
  await evaluate(cdp,"history.forward();true");
  await waitUntil(cdp,"globalThis.__openContainerUi.activeView()==='ai'",{label:'P9 forward navigation'});
  assert((await call(cdp,'source'))===sourceBeforeHistory,'P9 forward navigation undid canonical source');
  await cdp.command('Page.reload',{ignoreCache:true});
  await waitReady(cdp);
  assert((await call(cdp,'source'))===sourceBeforeHistory,'P9 full reload undid canonical source');

  // Actual rendered viewport matrix.
  const matrices=[
    {name:'phone-320x568',width:320,height:568,mobile:true},
    {name:'phone-390x844',width:390,height:844,mobile:true},
    {name:'tablet-768x1024',width:768,height:1024,mobile:false},
    {name:'desktop-1280x800',width:1280,height:800,mobile:false},
    {name:'desktop-1920x1080',width:1920,height:1080,mobile:false}
  ];
  const viewports=[];
  for(const matrix of matrices){
    await cdp.command('Emulation.setDeviceMetricsOverride',{width:matrix.width,height:matrix.height,deviceScaleFactor:1,mobile:matrix.mobile});
    await delay(100);
    const rendered=await call(cdp,'layout');
    assert(rendered.scrollWidth<=rendered.innerWidth+2,'P9 viewport has document-level horizontal overflow',{matrix,rendered});
    assert(rendered.canvas.width>0&&rendered.canvas.height>0&&rendered.visibleButtons.length>=3,'P9 viewport lost usable canvas controls',{matrix,rendered});
    const image=await screenshot(cdp,matrix.name);
    viewports.push(Object.freeze({...matrix,...rendered,screenshot:image}));
  }

  await cdp.command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const stress=await call(cdp,'stressLocalization');
  assert(stress.scrollWidth<=stress.innerWidth+2,'P9 RTL/localization/text expansion caused document overflow',{stress});
  const stressImage=await screenshot(cdp,'rtl-localization-text-200');

  await cdp.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const reduced=await evaluate(cdp,"({matches:matchMedia('(prefers-reduced-motion: reduce)').matches,transition:getComputedStyle(document.querySelector('#authority-status')).transitionDuration})");
  assert(reduced.matches===true,'P9 reduced-motion emulation did not apply',{reduced});

  await cdp.command('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
  const forced=await evaluate(cdp,"({matches:matchMedia('(forced-colors: active)').matches,border:getComputedStyle(document.querySelector('button')).borderStyle})");
  assert(forced.matches===true&&forced.border!=='none','P9 forced-colors rendered controls lost boundary',{forced});
  const forcedImage=await screenshot(cdp,'forced-colors');

  await cdp.command('Emulation.setEmulatedMedia',{features:[]});
  await call(cdp,'resetLocalization');
  await cdp.command('Emulation.setPageScaleFactor',{pageScaleFactor:2});
  const zoom=await evaluate(cdp,"({scale:visualViewport?.scale||1,scrollWidth:document.documentElement.scrollWidth,innerWidth,canvas:document.querySelector('#workspace-canvas').getBoundingClientRect().toJSON()})");
  assert(Number.isFinite(zoom.scale)&&zoom.canvas.width>0&&zoom.canvas.height>0,'P9 zoom court lost rendered canvas',{zoom});
  const zoomImage=await screenshot(cdp,'zoom-200');
  await cdp.command('Emulation.setPageScaleFactor',{pageScaleFactor:1});

  const receipt=Object.freeze({
    schema:'opencontainer.p9-rendered-ui.v1.0',
    status:'PASS',
    source:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json',
    sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
    minimumClosure:'PASS-INTEGRATION + declared-profile evidence',
    declaredProfile:'github-actions-chrome-stable-ubuntu2404-x64',
    sourceGates:[
      'P9-01','P9-02','P9-04','P9-06','P9-07','P9-08','P9-09',
      'P9-10','P9-13','P9-14','P9-15','P9-16','P9-17','P9-18'
    ],
    intentionallyOpenGates:[
      {id:'P9-03',reason:'No retained 280+ registered failure-scenario registry exists; this court does not manufacture one.'},
      {id:'P9-05',reason:'Manual screen-reader acceptance remains required.'},
      {id:'P9-11',reason:'Human comprehension testing remains required.'},
      {id:'P9-12',reason:'Weak-device UI budget and long-session leak evidence remain required.'}
    ],
    browser:Object.freeze({
      binary:browser.version,
      product:version.product,
      exactVersionObserved:version.product,
      userAgent:version.userAgent,
      protocolVersion:version.protocolVersion,
      crossOriginIsolated:initial.isolated
    }),
    shell:Object.freeze({
      runtimeState:initial.receipt.status.state,
      initialView:initial.activeView,
      dominantCanvas:true,
      visibleSurfaceCount:initial.layout.visibleSurfaces.length
    }),
    accessibility:Object.freeze({
      namedControls:['Preview','Inspect','AI','Save source','Run process','Remove source…'],
      tabCount:accessibility.filter(row=>row.role==='tab'&&!row.ignored).length,
      keyboardPrimaryFlows:true,
      modalFocusTrap:true,
      openerFocusRestored:true,
      approvalDeletionFocusRule:true
    }),
    ime:Object.freeze({
      shortcut:'Ctrl+Enter',
      blockedDuringComposition:true,
      sentAfterComposition:true
    }),
    acknowledgements:Object.freeze({
      saveGeneration:savedReceipt.status.generation,
      approvalId:approval.id,
      approvalApplied:true,
      sourceRestored:true,
      linkedPermissionInitiallyGranted:true
    }),
    approvals:Object.freeze({
      survivedModes:['Discuss','Plan','Build'],
      countAfterModeSwitch:approvalsAfterSwitch.length,
      duplicated:false
    }),
    recovery:Object.freeze({
      sourceRecoveryWithoutDevTools:true,
      processRecoveryWithoutDevTools:true,
      projectLifecycleSeparated:true,
      aiLifecycleSeparated:true
    }),
    history:Object.freeze({
      sourceMarker:marker,
      canonicalMutationSurvivedBack:true,
      canonicalMutationSurvivedForward:true,
      canonicalMutationSurvivedReload:true
    }),
    irreversible:Object.freeze({
      diagnosticsClearSecondary:true,
      diagnosticsCannotBeUndoneCopy:true,
      sourceRemovalRecoveryTruthful:true
    }),
    externalLinkedFolder:Object.freeze({
      sameHeadNativeP3CourtRequired:true,
      conflictBlocked:true,
      conflictVisible:true,
      recoveryActionsVisible:true,
      permissionDenialVisible:true
    }),
    viewport:Object.freeze({
      matrices:Object.freeze(viewports),
      rtlLocalizationTextExpansion:Object.freeze({...stress,screenshot:stressImage}),
      reducedMotion:reduced,
      forcedColors:Object.freeze({...forced,screenshot:forcedImage}),
      zoom:Object.freeze({...zoom,screenshot:zoomImage})
    }),
    boundaries:Object.freeze({
      failureRegistry280Claimed:false,
      manualScreenReaderClaimed:false,
      humanComprehensionClaimed:false,
      weakDeviceLongSessionClaimed:false,
      productionClosed:false
    })
  });
  await mkdir(dirname(receiptPath),{recursive:true});
  await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');
  console.log('P9 RENDERED UI PASS '+JSON.stringify({
    gates:receipt.sourceGates.length,
    open:receipt.intentionallyOpenGates.map(item=>item.id),
    browser:receipt.browser.product,
    viewports:viewports.length
  }));
}finally{
  try{cdp&&cdp.close();}catch{}
  try{browserCdp&&browserCdp.close();}catch{}
  if(debugPort&&target)await closeTarget(debugPort,target);
  await terminateChild(chrome);
  await terminateChild(server);
  await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
