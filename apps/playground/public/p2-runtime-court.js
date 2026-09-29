import {
  ProcessSupervisor,
  WorkerRpcAuthority,
  MutationReceiptAuthority,
  CancellationLineage,
  ProcessPortAuthority,
  BoundedTransferChannel,
  SyncRpcPolicy
} from '/packages/process/src/index.js';
import { ResourceGovernor } from '/packages/resources/src/index.js';
import { ErrorCodes } from '/packages/protocol/src/index.js';

const delay=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
function assert(condition,message,details={}){
  if(condition)return;
  const error=new Error(message);
  error.details=details;
  throw error;
}
async function expectCode(action,code){
  try{await action();throw new Error('expected '+code);}
  catch(error){
    if(error?.message==='expected '+code)throw error;
    assert(error?.code===code,'unexpected error code',{expected:code,actual:error?.code,message:error?.message});
    return error;
  }
}

async function rpcCourt(){
  const worker=new Worker('/p2-runtime-worker.mjs',{type:'module',name:'p2-rpc-primary'});
  const rpc=new WorkerRpcAuthority({transport:worker,requestTimeoutMs:20});
  const echo=await rpc.request('echo',{answer:42});
  assert(echo.answer===42,'actual browser worker RPC echo failed');

  const mutationAuthority=new MutationReceiptAuthority();
  const mutation=mutationAuthority.begin('browser-worker-mutation',{identity:'p2-browser-mutation'});
  const timeoutPromise=rpc.request('delayed-mutation',{
    mutationId:mutation.id,
    value:{generation:7},
    delayMs:80
  });
  const timeoutError=await expectCode(()=>timeoutPromise,ErrorCodes.WORKER_TIMEOUT);
  const unknown=mutationAuthority.timeout(mutation);
  assert(unknown.state==='UNKNOWN'&&unknown.mutationMayHaveOccurred===true,'timeout incorrectly implied mutation absence',{unknown});
  await delay(100);
  const reconciliation=await rpc.request('reconcile-mutation',{mutationId:mutation.id});
  assert(reconciliation.applied===true,'mutation was not reconciled after timeout',{reconciliation});
  mutationAuthority.markApplied(mutation,reconciliation.value);
  const reconciled=mutationAuthority.reconcile(mutation);
  assert(reconciled.state==='APPLIED','host mutation receipt did not reconcile to APPLIED',{reconciled});
  rpc.close();
  worker.terminate();

  const oldWorker=new Worker('/p2-runtime-worker.mjs',{type:'module',name:'p2-rpc-old'});
  const epochRpc=new WorkerRpcAuthority({transport:oldWorker,requestTimeoutMs:1000});
  const oldIdentity=epochRpc.identity;
  const stalePending=epochRpc.request('delayed-echo',{value:'stale',delayMs:100});
  const newWorker=new Worker('/p2-runtime-worker.mjs',{type:'module',name:'p2-rpc-new'});
  const newIdentity=epochRpc.restart(newWorker);
  const staleError=await expectCode(()=>stalePending,ErrorCodes.WORKER_STALE);
  assert(newIdentity.epoch===oldIdentity.epoch+1,'worker epoch did not advance on restart',{oldIdentity,newIdentity});
  const fresh=await epochRpc.request('echo',{value:'fresh'});
  assert(fresh.value==='fresh','fresh request failed after worker restart',{fresh});
  await delay(120);
  assert(epochRpc.pendingCount===0,'stale delayed response resurrected pending request',{pending:epochRpc.pendingCount});
  epochRpc.close();
  oldWorker.terminate();
  newWorker.terminate();

  const crashResources=new ResourceGovernor({tasks:4,inFlightBytes:16*1024*1024,workers:2});
  const crashWorker=new Worker('/p2-runtime-worker.mjs',{type:'module',name:'p2-rpc-crash'});
  const crashRpc=new WorkerRpcAuthority({transport:crashWorker,requestTimeoutMs:1000,resources:crashResources});
  const crashPending=crashRpc.request('crash',{stage:'after-acquire'});
  const crashError=await expectCode(()=>crashPending,ErrorCodes.GUEST_WORKER_FAILED);
  await delay(20);
  assert(crashRpc.pendingCount===0,'worker crash retained pending RPC',{pending:crashRpc.pendingCount});
  assert(crashResources.usage.tasks===0&&crashResources.usage.inFlightBytes===0,'worker crash leaked task/in-flight leases',{usage:crashResources.usage});
  assert(crashWorker instanceof Worker,'worker crash court did not use browser Worker');
  crashRpc.close();
  crashWorker.terminate();

  let pressure=[];
  const heapBefore=Number(performance?.memory?.usedJSHeapSize??0);
  for(let i=0;i<8;i++)pressure.push(new Array(250000).fill(i));
  const heapUnderPressure=Number(performance?.memory?.usedJSHeapSize??0);
  const transferWorker=new Worker('/p2-runtime-worker.mjs',{type:'module',name:'p2-transfer'});
  const transferResources=new ResourceGovernor({tasks:4,inFlightBytes:32*1024*1024});
  const transferRpc=new WorkerRpcAuthority({transport:transferWorker,requestTimeoutMs:3000,resources:transferResources});
  const buffer=new ArrayBuffer(8*1024*1024);
  new Uint8Array(buffer).fill(7);
  const transferPending=transferRpc.request('transfer-checksum',{buffer},{transfer:[buffer]});
  assert(buffer.byteLength===0,'transferable ArrayBuffer was not detached by Chromium');
  const transfer=await transferPending;
  assert(transfer.byteLength===8*1024*1024,'large transferable byte length drifted',{transfer});
  assert(transfer.checksum===14336,'large transferable checksum drifted',{transfer});
  assert(transferResources.usage.tasks===0&&transferResources.usage.inFlightBytes===0,'large transfer leaked resource leases',{usage:transferResources.usage});
  transferRpc.close();
  transferWorker.terminate();
  pressure=[];
  await delay(0);
  const heapAfter=Number(performance?.memory?.usedJSHeapSize??0);

  return Object.freeze({
    actualWorkerRpc:true,
    echo,
    timeoutCode:timeoutError.code,
    timeoutMutationState:unknown.state,
    reconciledMutationState:reconciled.state,
    staleEpochCode:staleError.code,
    oldEpoch:oldIdentity.epoch,
    newEpoch:newIdentity.epoch,
    workerCrashCode:crashError.code,
    workerCrashLeaseUsage:crashResources.usage,
    transferBytes:transfer.byteLength,
    transferChecksum:transfer.checksum,
    transferDetached:true,
    pressureArrays:8,
    pressureElements:8*250000,
    heapBefore,
    heapUnderPressure,
    heapAfter
  });
}

async function cancellationCourt(){
  const lineage=new CancellationLineage({id:'root'});
  const broker=lineage.child('broker');
  const producer=lineage.child('producer','broker');
  const consumer=lineage.child('consumer','producer');
  const channel=new BoundedTransferChannel({maxBytes:2*1024*1024});
  const pending=channel.read({signal:consumer.signal});
  lineage.abort('caller-abort');
  const abortError=await expectCode(()=>pending,ErrorCodes.WORKER_STALE);
  const receipt=lineage.receipt();
  assert(receipt.nodes.every(node=>node.aborted),'cancellation did not propagate through entire lineage',{receipt});
  assert(channel.usage.pendingReaders===0,'cancelled stream retained pending consumer',{usage:channel.usage});
  channel.abort('lineage-aborted');
  return Object.freeze({
    abortCode:abortError.code,
    nodeCount:receipt.nodes.length,
    nodeIds:receipt.nodes.map(node=>node.id),
    allAborted:receipt.nodes.every(node=>node.aborted),
    pendingReaders:channel.usage.pendingReaders
  });
}

async function syncRpcCourt(){
  const policy=new SyncRpcPolicy({allowedMethods:['fs.readFile','path.resolve']});
  const release=policy.enter('fs.readFile');
  let reentrantCode=null;
  let deniedCode=null;
  try{policy.enter('path.resolve');}catch(error){reentrantCode=error?.code??null;}
  release();
  try{policy.enter('net.fetch');}catch(error){deniedCode=error?.code??null;}
  assert(reentrantCode===ErrorCodes.INVALID_STATE,'sync RPC reentrancy did not fail fast',{reentrantCode});
  assert(deniedCode===ErrorCodes.BUILTIN_UNAVAILABLE,'sync RPC allowlist did not reject forbidden method',{deniedCode});
  return Object.freeze({
    allowedMethods:policy.allowedMethods,
    reentrantCode,
    deniedCode,
    activeMethod:policy.activeMethod
  });
}

async function processCourt(){
  const supervisor=new ProcessSupervisor();
  supervisor.register('drain',({stdout,stderr})=>{stdout('out');stderr('err');return 0;});
  const drainStart=performance.now();
  const drained=supervisor.spawn('drain',[],{
    stdoutSink:async()=>delay(25),
    stderrSink:async()=>delay(20),
    drainTimeoutMs:250
  });
  assert(await drained.exit===0,'drain process failed');
  const drainReceipt=await drained.terminal;
  const drainElapsed=performance.now()-drainStart;
  assert(drainReceipt.stdoutDrained&&drainReceipt.stderrDrained&&!drainReceipt.drainTimedOut,'process exit did not wait for output drain',{drainReceipt});
  assert(drainElapsed>=15,'process terminal published before output drain completed',{drainElapsed});

  const stuck=supervisor.spawn('drain',[],{
    stdoutSink:()=>new Promise(()=>{}),
    drainTimeoutMs:25
  });
  assert(await stuck.exit===1,'bounded drain timeout did not convert process to failure');
  const stuckReceipt=await stuck.terminal;
  assert(stuckReceipt.drainTimedOut===true,'stuck output drain did not hit bounded timeout',{stuckReceipt});

  supervisor.register('short',async()=>{await delay(2);return 0;});
  supervisor.register('boom',()=>{throw new Error('p2-boom');});
  const terminals=[];
  for(let i=0;i<60;i++){
    const process=i%10===0?supervisor.spawn('boom'):supervisor.spawn('short');
    if(i%3===0)process.kill(i%2===0?'SIGTERM':'SIGKILL');
    await process.exit;
    terminals.push(await process.terminal);
  }
  assert(terminals.every(item=>item.terminalCount===1),'process race emitted duplicate terminal states',{terminals});
  assert(terminals.some(item=>item.reason==='killed')&&terminals.some(item=>item.reason==='natural-exit')&&terminals.some(item=>item.reason==='throw'),'race court did not cover kill/natural/throw',{reasons:[...new Set(terminals.map(x=>x.reason))]});

  supervisor.register('hold',async()=>{await delay(30);return 0;});
  const parent=supervisor.spawn('hold');
  const child=supervisor.spawn('hold',[],{parentPid:parent.pid,orphanPolicy:'terminate'});
  const detached=supervisor.spawn('hold',[],{parentPid:parent.pid,orphanPolicy:'detach'});
  parent.kill('SIGTERM');
  const [parentCode,childCode,detachedCode]=await Promise.all([parent.exit,child.exit,detached.exit]);
  assert(parentCode===128&&childCode===128&&detachedCode===0,'process tree orphan policy drifted',{parentCode,childCode,detachedCode});

  const ports=new ProcessPortAuthority();
  const old=ports.publish({port:5173,pid:101,handler:()=>new Response('old')});
  const current=ports.publish({port:5173,pid:202,handler:()=>new Response('new')});
  const stalePortError=await expectCode(()=>ports.dispatch(5173,{},old),ErrorCodes.PREVIEW_STALE);
  const currentBody=await (await ports.dispatch(5173,{},current)).text();
  assert(currentBody==='new','virtual process port routed to stale owner',{currentBody});
  ports.revoke(5173,{pid:202});
  assert(ports.list().length===0,'virtual port release leaked route',{routes:ports.list()});

  const floodResources=new ResourceGovernor({processes:2,outputBytes:65536});
  const floodSupervisor=new ProcessSupervisor({resources:floodResources,outputLimitBytes:16384});
  floodSupervisor.register('flood',({stdout,stderr})=>{
    for(let i=0;i<40;i++)stdout('x'.repeat(1024));
    stderr('unreachable');
    return 0;
  });
  const flood=floodSupervisor.spawn('flood');
  assert(await flood.exit===1,'stdout flood did not fail at bounded retention limit');
  const floodReceipt=await flood.terminal;
  assert(floodReceipt.stdoutBytes<=16384,'stdout retention exceeded configured bound',{floodReceipt});
  assert(floodResources.usage.processes===0&&floodResources.usage.outputBytes===0,'stdout flood leaked resource reservation',{usage:floodResources.usage});

  const cycleResources=new ResourceGovernor({processes:2,outputBytes:8192});
  const cycleSupervisor=new ProcessSupervisor({resources:cycleResources,outputLimitBytes:256});
  cycleSupervisor.register('cycle',async({stdout})=>{stdout('x');await Promise.resolve();return 0;});
  for(let i=0;i<200;i++){
    const process=cycleSupervisor.spawn('cycle');
    if(i%2===0)process.kill();
    await process.exit;
  }
  assert(cycleSupervisor.activeCount===0,'repeated process cycles retained active process state',{active:cycleSupervisor.activeCount});
  assert(cycleResources.usage.processes===0&&cycleResources.usage.outputBytes===0,'repeated process cycles retained resource leases',{usage:cycleResources.usage});

  let stableError=null;
  try{cycleSupervisor.spawn('__missing__');}catch(error){stableError={code:error?.code??null,message:error?.message??String(error),details:error?.details??null};}
  assert(stableError?.code===ErrorCodes.COMMAND_NOT_FOUND,'public command error code drifted',{stableError});
  assert(!/worker|transport|messageport|dedicated/i.test(stableError.message),'public error leaked worker topology',{stableError});

  return Object.freeze({
    drainElapsedMs:drainElapsed,
    drainTimedOut:stuckReceipt.drainTimedOut,
    terminalCases:terminals.length,
    terminalReasons:[...new Set(terminals.map(item=>item.reason))].sort(),
    terminalCountsUnique:[...new Set(terminals.map(item=>item.terminalCount))],
    processTree:{parentCode,childCode,detachedCode},
    stalePortCode:stalePortError.code,
    portRoutesAfterRevoke:ports.list().length,
    flood:{code:floodReceipt.code,stdoutBytes:floodReceipt.stdoutBytes,limit:16384},
    repeatedCycles:200,
    retainedActiveProcesses:cycleSupervisor.activeCount,
    retainedResourceUsage:cycleResources.usage,
    stableError
  });
}

async function run(){
  const [rpc,cancellation,syncRpc,process]=await Promise.all([
    rpcCourt(),
    cancellationCourt(),
    syncRpcCourt(),
    processCourt()
  ]);
  return Object.freeze({
    schema:'opencontainer.p2-runtime-process.v1.0',
    status:'PASS',
    browser:navigator.userAgent,
    crossOriginIsolated:globalThis.crossOriginIsolated,
    sourceGates:Array.from({length:14},(_,index)=>'P2-'+String(index+1).padStart(2,'0')),
    rpc,
    cancellation,
    syncRpc,
    process,
    productionClosed:false
  });
}

globalThis.__p2RuntimeCourt=Object.freeze({run});
document.body.dataset.ready='true';
document.getElementById('result').textContent='ready';
