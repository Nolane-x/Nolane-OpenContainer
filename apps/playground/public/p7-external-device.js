const resultNode=document.getElementById('result');
function assert(condition,message,details=null){if(!condition){const error=new Error(message);error.details=details;throw error;}}
const rounded=value=>Math.round(Number(value)*1000)/1000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function percentile(values,p){const xs=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);if(!xs.length)return null;const index=Math.min(xs.length-1,Math.max(0,Math.ceil((p/100)*xs.length)-1));return rounded(xs[index]);}
function heapSlopeBytesPerHour(samples){const xs=samples.filter(x=>Number.isFinite(x.elapsedMs)&&Number.isFinite(x.heapUsedBytes));if(xs.length<2)return null;const meanX=xs.reduce((a,b)=>a+b.elapsedMs,0)/xs.length;const meanY=xs.reduce((a,b)=>a+b.heapUsedBytes,0)/xs.length;let num=0,den=0;for(const item of xs){const dx=item.elapsedMs-meanX;num+=dx*(item.heapUsedBytes-meanY);den+=dx*dx;}if(!den)return 0;return rounded((num/den)*3600000);}

async function run(){
  const params=new URLSearchParams(location.search);
  const mode=params.get('mode')||'weak-device';
  const durationMs=Number(params.get('durationMs')||60000);
  const sampleIntervalMs=Number(params.get('sampleIntervalMs')||30000);
  const expectSuspend=params.get('expectSuspend')==='1';
  const minimumSuspendGapMs=Number(params.get('minimumSuspendGapMs')||15000);
  assert(['weak-device','soak','lifecycle'].includes(mode),'unsupported external-device mode',{mode});
  assert(Number.isFinite(durationMs)&&durationMs>=1000,'durationMs invalid',{durationMs});
  assert(Number.isFinite(sampleIntervalMs)&&sampleIntervalMs>=1000,'sampleIntervalMs invalid',{sampleIntervalMs});
  assert(globalThis.isSecureContext,'external-device court requires secure context');
  assert(globalThis.crossOriginIsolated,'external-device court requires COOP/COEP isolation');

  document.body.dataset.stage='import';
  const {OpenContainer}=await import('/packages/sdk/src/index.js?p7-external-device=v1');
  const runtime=await OpenContainer.boot();
  runtime.registerCommand('p7:device-heartbeat',({args,stdout})=>{stdout(args.join(':'));return 0;});
  runtime.fs.beginTransaction().mkdir('p7-device-session').commit();
  const lockResponse=await fetch('/package-lock.json',{cache:'no-store'});
  assert(lockResponse.ok,'frozen package graph unavailable');
  const lock=await lockResponse.json();

  const startedWall=Date.now(),startedPerf=performance.now();
  let previousWall=startedWall,previousPerf=startedPerf,cycle=0;
  const samples=[],suspendEvents=[],targetEnd=startedWall+durationMs;
  document.body.dataset.stage='session';

  while(Date.now()<targetEnd){
    const cycleStarted=performance.now(),wallNow=Date.now(),perfNow=performance.now();
    if(cycle>0){
      const wallDelta=wallNow-previousWall,perfDelta=perfNow-previousPerf,suspendGap=wallDelta-perfDelta;
      if(suspendGap>=minimumSuspendGapMs)suspendEvents.push({cycle,atWallMs:wallNow,wallDeltaMs:rounded(wallDelta),perfDeltaMs:rounded(perfDelta),suspendGapMs:rounded(suspendGap)});
    }
    previousWall=wallNow;previousPerf=perfNow;

    const bootStarted=performance.now();
    const warm=await OpenContainer.boot();
    const warmBootMs=performance.now()-bootStarted;
    await warm.terminate();

    const commandStarted=performance.now();
    const processHandle=runtime.spawn('p7:device-heartbeat',[mode,String(cycle)]);
    const exit=await processHandle.exit;
    const commandMs=performance.now()-commandStarted;
    assert(exit===0,'device heartbeat command failed',{cycle});

    const payload=new Uint8Array(64*1024);payload.fill(cycle&255);
    const writeStarted=performance.now();
    runtime.fs.beginTransaction().writeFile('p7-device-session/cycle.bin',payload).commit();
    const writeMs=performance.now()-writeStarted;
    const readStarted=performance.now();
    const readBack=runtime.fs.readFile('p7-device-session/cycle.bin',{encoding:null});
    const readMs=performance.now()-readStarted;
    assert(readBack.byteLength===payload.byteLength,'device VFS round-trip size drift',{cycle});

    const graphStarted=performance.now();
    const graph=runtime.packages.compile(lock);
    const packageGraphMs=performance.now()-graphStarted;
    const packageLocations=graph?.locations?.size??graph?.packages?.length??Object.keys(lock.packages??{}).length;
    assert(packageLocations>0,'device package graph empty',{cycle});

    const heapUsedBytes=Number(globalThis.performance?.memory?.usedJSHeapSize??NaN);
    samples.push({
      cycle,elapsedMs:Date.now()-startedWall,wallTimeMs:Date.now(),cycleMs:rounded(performance.now()-cycleStarted),
      warmBootMs:rounded(warmBootMs),commandMs:rounded(commandMs),vfsWrite64KiBMs:rounded(writeMs),
      vfsRead64KiBMs:rounded(readMs),packageGraphMs:rounded(packageGraphMs),packageLocations,
      heapUsedBytes:Number.isFinite(heapUsedBytes)?heapUsedBytes:null,resourceUsage:{...(runtime.resources?.usage??{})}
    });
    cycle+=1;
    const remaining=targetEnd-Date.now();
    if(remaining<=0)break;
    await sleep(Math.min(sampleIntervalMs,remaining));
  }

  runtime.fs.beginTransaction().remove('p7-device-session').commit();
  await runtime.terminate();

  const elapsedMs=Date.now()-startedWall;
  const minSamples=Math.max(1,Math.floor(durationMs/sampleIntervalMs)*0.8);
  assert(samples.length>=minSamples,'external-device session produced too few samples',{samples:samples.length,minSamples});
  if(expectSuspend)assert(suspendEvents.length>=1,'real suspend/resume discontinuity was not observed',{minimumSuspendGapMs});

  const receipt={
    schema:'opencontainer.p7-external-device-browser-session.v1.0',status:'PASS',mode,
    durationRequestedMs:durationMs,durationObservedMs:elapsedMs,sampleIntervalMs,sampleCount:samples.length,expectSuspend,suspendEvents,
    browserEnvironment:{userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency??null,deviceMemoryGiB:navigator.deviceMemory??null,crossOriginIsolated:globalThis.crossOriginIsolated},
    aggregates:{
      cycleP50Ms:percentile(samples.map(x=>x.cycleMs),50),cycleP95Ms:percentile(samples.map(x=>x.cycleMs),95),
      warmBootP95Ms:percentile(samples.map(x=>x.warmBootMs),95),commandP95Ms:percentile(samples.map(x=>x.commandMs),95),
      vfsWrite64KiBP95Ms:percentile(samples.map(x=>x.vfsWrite64KiBMs),95),vfsRead64KiBP95Ms:percentile(samples.map(x=>x.vfsRead64KiBMs),95),
      packageGraphP95Ms:percentile(samples.map(x=>x.packageGraphMs),95),
      heapFirstBytes:samples.find(x=>Number.isFinite(x.heapUsedBytes))?.heapUsedBytes??null,
      heapLastBytes:[...samples].reverse().find(x=>Number.isFinite(x.heapUsedBytes))?.heapUsedBytes??null,
      heapPeakBytes:Math.max(0,...samples.map(x=>Number(x.heapUsedBytes)||0)),heapSlopeBytesPerHour:heapSlopeBytesPerHour(samples)
    },
    samples,
    boundaries:{referenceDeviceClosureClaimed:false,eightHourPlateauClaimed:false,weakDeviceBudgetClaimed:false,p9_12Claimed:false,p14_14Claimed:false,productionClosed:false}
  };
  document.body.dataset.stage='complete';document.body.dataset.status='pass';resultNode.textContent=JSON.stringify(receipt);
}
run().catch(error=>{document.body.dataset.stage='failed';document.body.dataset.status='fail';resultNode.textContent=JSON.stringify({schema:'opencontainer.p7-external-device-browser-session.v1.0',status:'FAIL',error:{message:error?.message??String(error),stack:error?.stack??null,details:error?.details??null}});});
