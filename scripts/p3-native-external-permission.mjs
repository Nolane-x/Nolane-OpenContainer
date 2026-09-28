import { spawn, spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const port=Number(process.env.OPENCONTAINER_P3_NATIVE_PICKER_PORT||4319);
const iterations=Number(process.env.OPENCONTAINER_P3_NATIVE_PICKER_ITERATIONS||2);
const origin='http://127.0.0.1:'+port;
const pageUrl=origin+'/p3-native-external-permission.html';
const artifactDir=resolve('.artifacts/p3-native-external-permission');
await mkdir(artifactDir,{recursive:true});
const browserCandidates=process.platform==='win32'
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

function findCommand(candidates,args=['--version']){
  for(const command of candidates){
    const result=spawnSync(command,args,{encoding:'utf8'});
    if(result.status===0)return {command,version:String(result.stdout||result.stderr).trim()};
  }
  return null;
}

function findBrowser(){
  const found=findCommand(browserCandidates);
  if(!found)throw new Error('No supported Chrome/Chromium binary found');
  return found;
}

function requireXdotool(){
  const result=spawnSync('xdotool',['version'],{encoding:'utf8'});
  if(result.status!==0)throw new Error('xdotool is required for the native picker court');
  return String(result.stdout||result.stderr).trim();
}

function waitForServer(child){
  return new Promise((resolvePromise,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Playground server did not start')),7000);
    let stderr='';
    child.stderr.on('data',chunk=>{stderr+=String(chunk);});
    child.stdout.on('data',chunk=>{
      const text=String(chunk);
      process.stdout.write(text);
      if(text.includes('OpenContainer playground:')){
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

async function evaluate(cdp,expression,{userGesture=false}={}){
  const response=await cdp.command('Runtime.evaluate',{
    expression,
    awaitPromise:true,
    returnByValue:true,
    userGesture
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
        hasCourt:typeof globalThis.__p3NativePermissionCourt==='object',
        picker:typeof globalThis.showDirectoryPicker,
        secure:globalThis.isSecureContext
      })`);
      if(last?.ready==='true'&&last?.hasCourt===true)return last;
    }catch{}
    await delay(75);
  }
  throw new Error('P3 native permission court did not become ready: '+JSON.stringify(last));
}

function xdotool(args,{allowFailure=false}={}){
  const result=spawnSync('xdotool',args,{encoding:'utf8'});
  if(result.status!==0&&!allowFailure){
    throw new Error('xdotool '+args.join(' ')+' failed: '+String(result.stderr||result.stdout));
  }
  return String(result.stdout||'').trim();
}

function visibleWindows(){
  const output=xdotool(['search','--onlyvisible','--name','.*'],{allowFailure:true});
  return new Set(output.split(/\s+/).filter(Boolean));
}

function windowName(id){
  return xdotool(['getwindowname',String(id)],{allowFailure:true});
}

function dumpWindows(label){
  const current=[...visibleWindows()].map(id=>({id,name:windowName(id)}));
  let active=null;
  try{
    const id=xdotool(['getactivewindow'],{allowFailure:true});
    active=id?{id,name:windowName(id)}:null;
  }catch{}
  const receipt={label,active,windows:current};
  console.log('[p3-native-permission] windows '+JSON.stringify(receipt));
  return receipt;
}

function captureScreen(label){
  const safe=String(label).replace(/[^a-z0-9_.-]+/gi,'-');
  const file=join(artifactDir,'screen-'+safe+'.png');
  const result=spawnSync('scrot',['-q','100',file],{encoding:'utf8'});
  if(result.status!==0){
    console.log('[p3-native-permission] scrot failed '+JSON.stringify({label,stderr:result.stderr}));
    return null;
  }
  console.log('[p3-native-permission] screenshot '+file);
  return file;
}

function windowGeometry(id){
  const output=xdotool(['getwindowgeometry','--shell',String(id)]);
  const values={};
  for(const line of output.split(/\r?\n/)){
    const match=line.match(/^([A-Z]+)=(.+)$/);
    if(match)values[match[1]]=Number(match[2]);
  }
  const geometry={
    x:values.X,
    y:values.Y,
    width:values.WIDTH,
    height:values.HEIGHT
  };
  assert(
    [geometry.x,geometry.y,geometry.width,geometry.height].every(Number.isFinite),
    'Could not parse native picker geometry',
    {id,output,geometry}
  );
  return geometry;
}

function pickerWindow(){
  const rows=[...visibleWindows()].map(id=>({id,name:windowName(id)}));
  return rows.find(row=>
    /select where this site can save changes|select folder|choose folder|open folder/i.test(row.name)
  )??null;
}

async function waitForPickerWindow(_before,timeoutMs=25000){
  const deadline=Date.now()+timeoutMs;
  let last=[];
  while(Date.now()<deadline){
    const current=visibleWindows();
    const rows=[...current].map(id=>({id,name:windowName(id)}));
    last=rows;
    const preferred=rows.find(row=>
      /select where this site can save changes|select folder|choose folder|open folder/i.test(row.name)
    );
    if(preferred)return preferred;
    await delay(125);
  }
  throw new Error('Named native directory picker window did not appear. Visible windows: '+JSON.stringify(last));
}

async function chooseDirectory(path,before){
  const picker=await waitForPickerWindow(before);
  console.log('[p3-native-permission] picker '+JSON.stringify(picker));
  dumpWindows('picker-open');
  captureScreen('picker-open');

  xdotool(['windowactivate','--sync',picker.id]);
  await delay(200);
  // Send keys to the focused GTK child widget rather than directly to the
  // toplevel window. GTK location-entry handling ignores some synthetic
  // events addressed only to the parent X window.
  xdotool(['key','--clearmodifiers','ctrl+l']);
  await delay(150);
  captureScreen('picker-location-entry');
  xdotool(['type','--clearmodifiers','--delay','1',path]);
  await delay(200);
  captureScreen('picker-path-typed');

  // Pressing Enter in Chrome's GTK location entry aborts the browser picker
  // request in this CI environment. Commit the typed path by clicking the real
  // Open button instead. The button is anchored at the lower-right corner of
  // the native dialog; derive the click point from the actual X window.
  const geometry=windowGeometry(picker.id);
  const openX=Math.max(24,geometry.width-50);
  const openY=Math.max(24,geometry.height-28);
  console.log('[p3-native-permission] open-button '+JSON.stringify({
    picker,geometry,relative:{x:openX,y:openY}
  }));
  xdotool([
    'mousemove','--window',picker.id,'--sync',
    String(openX),String(openY)
  ]);
  await delay(150);
  xdotool(['click','1']);
  await delay(700);

  if(pickerWindow()){
    // A single click may navigate the location rather than accept on some GTK
    // builds. Click the same concrete Open button once more after navigation.
    const current=pickerWindow();
    const currentGeometry=windowGeometry(current.id);
    xdotool([
      'mousemove','--window',current.id,'--sync',
      String(Math.max(24,currentGeometry.width-50)),
      String(Math.max(24,currentGeometry.height-28))
    ]);
    await delay(120);
    xdotool(['click','1']);
    await delay(700);
  }
  dumpWindows('picker-after-open-click');
  captureScreen('picker-after-open-click');
  return Object.freeze({
    windowId:picker.id,
    windowName:picker.name,
    geometry,
    activation:'direct-open-button-click'
  });
}

async function pressChromeConfirmation(){
  const output=xdotool(['search','--onlyvisible','--name','OpenContainer P3 Native External Permission Court'],{allowFailure:true});
  const ids=output.split(/\s+/).filter(Boolean);
  const id=ids.at(-1);
  if(id){
    xdotool(['windowactivate','--sync',id],{allowFailure:true});
    await delay(180);
    captureScreen('chrome-edit-permission-before-allow');
    // Chrome focuses the safe "Don't Allow" action first. Move once to the
    // affirmative "Allow" action, then activate it.
    xdotool(['key','--window',id,'--clearmodifiers','Tab'],{allowFailure:true});
    await delay(120);
    xdotool(['key','--window',id,'--clearmodifiers','Return'],{allowFailure:true});
    await delay(350);
    captureScreen('chrome-edit-permission-after-allow');
    return {
      windowId:id,
      windowName:windowName(id),
      action:'tab-to-allow-then-enter'
    };
  }
  return {windowId:null,windowName:null,action:'chrome-window-not-found'};
}

async function settlePromise(promise,{timeoutMs=12000,onWait=null}={}){
  let settled=false;
  let value;
  let failure;
  promise.then(result=>{settled=true;value=result;},error=>{settled=true;failure=error;});
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline&&!settled){
    if(onWait)await onWait();
    await delay(250);
  }
  if(!settled)throw new Error('Timed out waiting for browser picker/permission promise');
  if(failure)throw failure;
  return value;
}

function courtExpression(method,args=[]){
  return `globalThis.__p3NativePermissionCourt[${JSON.stringify(method)}](...${JSON.stringify(args)})`;
}

async function queryState(cdp){
  return evaluate(cdp,courtExpression('state'));
}

async function waitForPermissionRevocation(cdp,timeoutMs=15000){
  const deadline=Date.now()+timeoutMs;
  let last=null;
  while(Date.now()<deadline){
    try{last=await queryState(cdp);}catch(error){last={error:error.message};}
    if(last?.permission?.readwrite==='denied'||last?.permission?.read==='denied')return last;
    await delay(250);
  }
  throw new Error('Native File System Access permission did not revoke after selected directory removal: '+JSON.stringify(last));
}

const browser=findBrowser();
const xdotoolVersion=requireXdotool();
assert(process.env.DISPLAY,'P3 native picker court requires a real X display (run under xvfb-run)');

const server=spawn(process.execPath,['apps/playground/server.mjs'],{
  env:{...process.env,PORT:String(port),OPENCONTAINER_P5_NETWORK_PORT:String(port+1)},
  stdio:['ignore','pipe','pipe']
});
const runReceipts=[];

try{
  await waitForServer(server);

  for(let iteration=1;iteration<=iterations;iteration++){
    const profile=await mkdtemp(join(tmpdir(),'opencontainer-p3-native-picker-profile-'));
    const externalRoot=resolve(
      'p3-native-picker-fixture-'+process.pid+'-'+iteration+'-'+Date.now()
    );
    await mkdir(externalRoot,{recursive:true});
    const selectedName=basename(externalRoot);
    const linkedPath=join(externalRoot,'linked.txt');
    await writeFile(linkedPath,'outside-v1','utf8');

    const chrome=spawn(browser.command,[
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
      '--user-data-dir='+profile,
      '--remote-debugging-port=0',
      'about:blank'
    ],{stdio:['ignore','ignore','pipe']});

    let target=null;
    let cdp=null;
    try{
      const devtools=await waitForDevTools(chrome,profile);
      const debugPort=Number(new URL(devtools.browserWebSocket).port);
      assert(Number.isInteger(debugPort)&&debugPort>0,'Invalid Chrome debug port');
      target=await newTarget(debugPort,pageUrl+'?iteration='+iteration);
      cdp=await connectCdp(target.webSocketDebuggerUrl);
      await cdp.command('Runtime.enable');
      await cdp.command('Page.enable');
      const ready=await waitForCourt(cdp);
      assert(ready.secure===true,'Native picker court is not a secure context',{iteration,ready});
      assert(ready.picker==='function','showDirectoryPicker() unavailable in declared Chrome',{iteration,ready});

      const before=visibleWindows();
      const pickPromise=evaluate(cdp,courtExpression('pick'),{userGesture:true});
      const picker=await chooseDirectory(externalRoot,before);
      const picked=await settlePromise(pickPromise,{
        timeoutMs:12000,
        onWait:async()=>{
          const stillPicker=pickerWindow();
          if(stillPicker){
            xdotool(['windowactivate','--sync',stillPicker.id],{allowFailure:true});
            const geometry=windowGeometry(stillPicker.id);
            xdotool([
              'mousemove','--window',stillPicker.id,'--sync',
              String(Math.max(24,geometry.width-50)),
              String(Math.max(24,geometry.height-28))
            ],{allowFailure:true});
            xdotool(['click','1'],{allowFailure:true});
            await delay(250);
          }else{
            await pressChromeConfirmation();
          }
        }
      });
      assert(picked?.kind==='directory','showDirectoryPicker did not return a directory handle',{iteration,picked});
      assert(picked?.name===selectedName,'Native picker selected unexpected directory',{iteration,picked,selectedName});

      let permission=picked.permission;
      if(permission?.readwrite!=='granted'){
        const grantPromise=evaluate(cdp,courtExpression('requestWritePermission'),{userGesture:true});
        const granted=await settlePromise(grantPromise,{
          timeoutMs:8000,
          onWait:pressChromeConfirmation
        });
        permission=granted.permission;
      }
      assert(permission?.read==='granted','Native selected handle lacks read permission',{iteration,permission});
      assert(permission?.readwrite==='granted','Native selected handle lacks readwrite permission',{iteration,permission});

      const observed=await evaluate(cdp,courtExpression('read',['linked.txt']));
      assert(observed?.data==='outside-v1','Native handle initial read drifted',{iteration,observed});
      assert(typeof observed?.revision==='string'&&observed.revision.length===64,'Native handle revision digest missing',{iteration,observed});

      await writeFile(linkedPath,'outside-v2','utf8');
      const conflict=await evaluate(cdp,courtExpression('write',['linked.txt','opencontainer-overwrite']));
      assert(conflict?.ok===false,'Native external edit was silently overwritten',{iteration,conflict});
      assert(conflict?.error?.code==='OC_STALE_GENERATION','Native external edit conflict did not return stale generation',{iteration,conflict});
      assert(conflict?.error?.details?.state==='external-change-detected','Native conflict state drifted',{iteration,conflict});
      assert(conflict?.error?.details?.silentOverwritePrevented===true,'Native conflict did not prove silent overwrite prevention',{iteration,conflict});
      assert(await readFile(linkedPath,'utf8')==='outside-v2','Conflict court changed OS file despite stale rejection',{iteration});

      const refreshed=await evaluate(cdp,courtExpression('read',['linked.txt']));
      const merged=await evaluate(cdp,courtExpression('write',['linked.txt','merged-native',refreshed.revision]));
      assert(merged?.ok===true,'Native linked write after conflict reconciliation failed',{iteration,merged});
      assert(merged?.result?.permissionRechecked===true,'Native linked write did not recheck permission immediately before write',{iteration,merged});
      assert(await readFile(linkedPath,'utf8')==='merged-native','Native linked write did not reach selected OS file',{iteration});

      await rm(externalRoot,{recursive:true,force:true});
      const revoked=await waitForPermissionRevocation(cdp);
      assert(
        revoked.permission.read==='denied'||revoked.permission.readwrite==='denied',
        'Selected native handle did not expose revoked permission',
        {iteration,revoked}
      );

      const blocked=await evaluate(cdp,courtExpression('write',['linked.txt','must-not-write-after-revoke',refreshed.revision]));
      assert(blocked?.ok===false,'Privileged write proceeded after native permission revocation',{iteration,blocked});
      assert(blocked?.error?.code==='OC_INVALID_STATE','Revoked native permission did not fail at authority boundary',{iteration,blocked});
      assert(blocked?.error?.details?.privilegedWriteBlocked===true,'Revoked native permission did not mark privileged write blocked',{iteration,blocked});
      assert(blocked?.error?.details?.localCanonicalUnaffected===true,'Revoked native permission did not preserve local canonical boundary',{iteration,blocked});
      assert(blocked?.localCanonical==='local-canonical-survives','Local canonical recovery copy changed after native permission loss',{iteration,blocked});

      const receipt=Object.freeze({
        iteration,
        browser:browser.version,
        display:process.env.DISPLAY,
        xdotool:xdotoolVersion,
        nativePicker:Object.freeze({
          api:'showDirectoryPicker',
          mode:'readwrite',
          selectedKind:picked.kind,
          selectedName:picked.name,
          pickerWindowName:picker.windowName,
          initialRead:permission.read,
          initialReadwrite:permission.readwrite
        }),
        externalEdit:Object.freeze({
          initialValue:'outside-v1',
          externalValueBeforeConflict:'outside-v2',
          conflictCode:conflict.error.code,
          conflictState:conflict.error.details.state,
          silentOverwritePrevented:conflict.error.details.silentOverwritePrevented,
          reconciledWriteValue:'merged-native',
          permissionRechecked:merged.result.permissionRechecked
        }),
        nativeRevocation:Object.freeze({
          trigger:'selected-directory-removed-by-external-os-process',
          read:revoked.permission.read,
          readwrite:revoked.permission.readwrite,
          blockedCode:blocked.error.code,
          privilegedWriteBlocked:blocked.error.details.privilegedWriteBlocked,
          localCanonicalUnaffected:blocked.error.details.localCanonicalUnaffected,
          localCanonical:blocked.localCanonical
        }),
        status:'PASS'
      });
      runReceipts.push(receipt);
      console.log('[p3-native-permission] iteration '+iteration+' PASS '+JSON.stringify(receipt));

      cdp.close();
      cdp=null;
      await closeTarget(debugPort,target);
      target=null;
    }finally{
      try{cdp?.close();}catch{}
      await terminateChild(chrome);
      await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:100});
      await rm(externalRoot,{recursive:true,force:true,maxRetries:8,retryDelay:100});
    }
  }

  const receipt=Object.freeze({
    schema:'opencontainer.p3-native-external-permission.v1.0',
    status:'PASS',
    browser:browser.version,
    profile:'headful Chrome on Xvfb / real OS directory picker',
    iterations,
    passedIterations:runReceipts.length,
    nativeShowDirectoryPicker:true,
    realSelectedFileSystemDirectoryHandle:true,
    nativePermissionRevocation:true,
    realExternalEditConflict:true,
    privilegedWritePermissionRechecked:true,
    localCanonicalPreserved:true,
    runs:Object.freeze(runReceipts),
    productionClosed:false
  });
  await writeFile(
    join(artifactDir,'browser-receipt.json'),
    JSON.stringify(receipt,null,2)+'\n'
  );
  console.log('P3 NATIVE EXTERNAL PERMISSION PASS '+JSON.stringify(receipt));
}finally{
  await terminateChild(server);
}
