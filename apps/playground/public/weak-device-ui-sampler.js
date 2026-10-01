const resultNode=document.getElementById('result');
const frame=document.getElementById('product');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rounded=value=>Math.round(Number(value)*1000)/1000;
function assert(condition,message,details=null){if(!condition){const error=new Error(message);error.details=details;throw error;}}
function percentile(values,p){const xs=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);if(!xs.length)return null;const index=Math.min(xs.length-1,Math.max(0,Math.ceil((p/100)*xs.length)-1));return rounded(xs[index]);}
function slopePerHour(samples,key){const xs=samples.map(x=>({x:Number(x.elapsedMs),y:Number(x[key])})).filter(x=>Number.isFinite(x.x)&&Number.isFinite(x.y));if(xs.length<2)return null;const mx=xs.reduce((a,b)=>a+b.x,0)/xs.length,my=xs.reduce((a,b)=>a+b.y,0)/xs.length;let num=0,den=0;for(const row of xs){const dx=row.x-mx;num+=dx*(row.y-my);den+=dx*dx;}return den?rounded((num/den)*3600000):0;}
async function waitReady(win,timeoutMs=30000){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(win?.__openContainerUi?.ready?.()===true)return win.__openContainerUi;if(win?.document?.querySelector?.('#app')?.dataset?.ready==='error')throw new Error('product shell boot failed');await sleep(100);}throw new Error('product shell did not become ready');}
async function nextFrame(win){return new Promise(resolve=>win.requestAnimationFrame(()=>resolve()));}
async function measureAsync(fn){const start=performance.now();await fn();return performance.now()-start;}
async function run(){
  const params=new URLSearchParams(location.search);
  const durationMs=Number(params.get('durationMs')||1800000);
  const sampleIntervalMs=Number(params.get('sampleIntervalMs')||30000);
  const phase=params.get('phase')||'calibration';
  assert(['calibration','validation','soak-ui'].includes(phase),'unsupported phase',{phase});
  assert(Number.isFinite(durationMs)&&durationMs>=60000,'duration too short',{durationMs});
  assert(Number.isFinite(sampleIntervalMs)&&sampleIntervalMs>=5000,'sample interval too short',{sampleIntervalMs});
  document.body.dataset.stage='wait-product';
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('product iframe load timeout')),20000);frame.addEventListener('load',()=>{clearTimeout(timer);resolve();},{once:true});});
  const win=frame.contentWindow,doc=frame.contentDocument;
  const ui=await waitReady(win);
  assert(win.crossOriginIsolated===true,'product shell lost cross-origin isolation');
  const started=Date.now(),samples=[],target=started+durationMs;
  let cycle=0;
  document.body.dataset.stage='sampling';
  while(Date.now()<target){
    const cycleStarted=performance.now();
    const view=[];
    for(const name of ['preview','inspect','ai','preview']){
      const t=performance.now();assert(ui.setView(name)===true,'setView rejected '+name);await nextFrame(win);view.push(performance.now()-t);
    }
    const ai=[];
    for(const name of ['Discuss','Plan','Build','Discuss']){
      const t=performance.now();ui.setAiMode(name);await nextFrame(win);ai.push(performance.now()-t);
    }
    const editor=doc.querySelector('#source-editor');
    assert(editor,'source editor missing');
    editor.value='<!doctype html><h1>weak-device-'+phase+'-'+cycle+'</h1>';
    const saveMs=await measureAsync(()=>ui.saveSource());
    const processMs=await measureAsync(()=>ui.runProcess('ui:healthy'));
    const heap=Number(win.performance?.memory?.usedJSHeapSize??NaN);
    samples.push({
      cycle,elapsedMs:Date.now()-started,
      viewSwitchMaxMs:rounded(Math.max(...view)),viewSwitchMeanMs:rounded(view.reduce((a,b)=>a+b,0)/view.length),
      aiModeSwitchMaxMs:rounded(Math.max(...ai)),saveCanonicalMs:rounded(saveMs),processRunMs:rounded(processMs),
      heapUsedBytes:Number.isFinite(heap)?heap:null,cycleMs:rounded(performance.now()-cycleStarted)
    });
    cycle+=1;
    const remaining=target-Date.now();if(remaining<=0)break;await sleep(Math.min(sampleIntervalMs,remaining));
  }
  const elapsedMs=Date.now()-started;
  const minSamples=Math.max(1,Math.floor(durationMs/sampleIntervalMs)*0.8);
  assert(samples.length>=minSamples,'too few UI samples',{samples:samples.length,minSamples});
  const receipt={
    schema:'opencontainer.weak-device-ui-session.v1.0',status:'PASS',phase,durationRequestedMs:durationMs,durationObservedMs:elapsedMs,sampleIntervalMs,sampleCount:samples.length,
    browserEnvironment:{userAgent:win.navigator.userAgent,hardwareConcurrency:win.navigator.hardwareConcurrency??null,deviceMemoryGiB:win.navigator.deviceMemory??null,crossOriginIsolated:win.crossOriginIsolated},
    aggregates:{
      viewSwitchP95Ms:percentile(samples.map(x=>x.viewSwitchMaxMs),95),
      aiModeSwitchP95Ms:percentile(samples.map(x=>x.aiModeSwitchMaxMs),95),
      saveCanonicalP95Ms:percentile(samples.map(x=>x.saveCanonicalMs),95),
      processRunP95Ms:percentile(samples.map(x=>x.processRunMs),95),
      cycleP95Ms:percentile(samples.map(x=>x.cycleMs),95),
      heapFirstBytes:samples.find(x=>Number.isFinite(x.heapUsedBytes))?.heapUsedBytes??null,
      heapLastBytes:[...samples].reverse().find(x=>Number.isFinite(x.heapUsedBytes))?.heapUsedBytes??null,
      heapPeakBytes:Math.max(0,...samples.map(x=>Number(x.heapUsedBytes)||0)),
      heapSlopeBytesPerHour:slopePerHour(samples,'heapUsedBytes')
    },samples,
    boundaries:{budgetFrozen:false,budgetValidated:false,p7_12Claimed:false,p9_12Claimed:false,p14_14Claimed:false,productionClosed:false}
  };
  document.body.dataset.stage='complete';document.body.dataset.status='pass';resultNode.textContent=JSON.stringify(receipt);
}
run().catch(error=>{document.body.dataset.stage='failed';document.body.dataset.status='fail';resultNode.textContent=JSON.stringify({schema:'opencontainer.weak-device-ui-session.v1.0',status:'FAIL',error:{message:error?.message??String(error),stack:error?.stack??null,details:error?.details??null}});});
