const resultNode=document.getElementById('result');

function assert(condition,message,details=null){
  if(!condition){
    const error=new Error(message);
    error.details=details;
    throw error;
  }
}
function now(){return performance.now();}
function rounded(value){return Math.round(Number(value)*1000)/1000;}
function sumResourceBytes(entries){
  return entries.reduce((sum,entry)=>{
    const values=[entry.encodedBodySize,entry.decodedBodySize,entry.transferSize].map(Number).filter(Number.isFinite);
    return sum+Math.max(0,...values);
  },0);
}
function waitWorkerReady(worker,timeoutMs=10000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('P7 worker ready timeout')),timeoutMs);
    const onMessage=(event)=>{
      if(event.data?.type!=='ready')return;
      clearTimeout(timer);
      worker.removeEventListener('message',onMessage);
      resolve();
    };
    worker.addEventListener('message',onMessage);
    worker.addEventListener('error',(event)=>{
      clearTimeout(timer);
      reject(new Error('P7 worker failed before ready: '+event.message));
    },{once:true});
  });
}
function checksum(bytes){
  let sum=0;
  for(let index=0;index<bytes.length;index+=4096)sum=(sum+bytes[index])>>>0;
  return sum;
}

async function run(){
  assert(globalThis.isSecureContext,'P7 court requires secure context');
  assert(globalThis.crossOriginIsolated,'P7 court requires COOP/COEP isolation');

  performance.clearResourceTimings();
  const importStarted=now();
  const [{OpenContainer},{WorkerRpcAuthority},{ResourceGovernor}]=await Promise.all([
    import('/packages/sdk/src/index.js?p7-declared-profile=v1'),
    import('/packages/process/src/worker-authority.js?p7-declared-profile=v1'),
    import('/packages/resources/src/index.js?p7-declared-profile=v1')
  ]);
  const moduleImportAndEvaluateMs=now()-importStarted;

  const bootStarted=now();
  const runtime=await OpenContainer.boot();
  const runtimeBootMs=now()-bootStarted;
  const moduleResources=performance.getEntriesByType('resource').filter((entry)=>
    entry.name.includes('/packages/')||entry.name.includes('/__deps__/')
  );
  const moduleResourceBytes=sumResourceBytes(moduleResources);
  assert(moduleResources.length>0,'P7 module resource set is empty');
  assert(moduleResourceBytes>0,'P7 module resource bytes are unavailable',{moduleResources:moduleResources.length});
  assert(moduleImportAndEvaluateMs>0,'P7 module import/parse/compile/evaluate timer did not advance');

  const warmStarted=now();
  const warmRuntime=await OpenContainer.boot();
  const warmOpenMs=now()-warmStarted;
  await warmRuntime.terminate();

  runtime.registerCommand('p7:first-command',({args,stdout})=>{
    stdout(args.join('|'));
    return 0;
  });
  const commandStarted=now();
  const firstCommand=runtime.spawn('p7:first-command',['declared','profile']);
  const firstCommandExit=await firstCommand.exit;
  const firstCommandMs=now()-commandStarted;
  assert(firstCommandExit===0,'P7 first command failed');
  assert(firstCommand.stdout.toString()==='declared|profile','P7 first command output drifted');

  const lockResponse=await fetch('/package-lock.json',{cache:'no-store'});
  assert(lockResponse.ok,'P7 failed to load frozen package graph');
  const lock=await lockResponse.json();
  const graphStarted=now();
  const graph=runtime.packages.compile(lock);
  const packageGraphLoadMs=now()-graphStarted;
  const packageGraphLocations=graph?.locations?.size??graph?.packages?.length??Object.keys(lock.packages??{}).length;
  assert(packageGraphLocations>0,'P7 package graph is empty');

  const fileCount=128;
  const payloadBytes=4096;
  const payload=new Uint8Array(payloadBytes);
  for(let i=0;i<payload.length;i++)payload[i]=i&255;

  const writeStarted=now();
  const writeTx=runtime.fs.beginTransaction().mkdir('p7-bench');
  for(let index=0;index<fileCount;index++)writeTx.writeFile('p7-bench/file-'+index+'.bin',payload);
  writeTx.commit();
  const vfsWriteMs=now()-writeStarted;

  const readStarted=now();
  let bytesRead=0;
  for(let index=0;index<fileCount;index++){
    const bytes=runtime.fs.readFile('p7-bench/file-'+index+'.bin',{encoding:null});
    bytesRead+=bytes.byteLength;
  }
  const vfsReadMs=now()-readStarted;
  assert(bytesRead===fileCount*payloadBytes,'P7 VFS read byte count drifted',{bytesRead});

  const listStarted=now();
  const children=runtime.fs.readdir('p7-bench');
  const vfsReaddirMs=now()-listStarted;
  assert(children.length===fileCount,'P7 VFS directory count drifted',{count:children.length});

  const renameStarted=now();
  const renameTx=runtime.fs.beginTransaction();
  for(let index=0;index<32;index++)renameTx.rename('p7-bench/file-'+index+'.bin','p7-bench/renamed-'+index+'.bin');
  renameTx.commit();
  const vfsRenameMs=now()-renameStarted;

  const removeStarted=now();
  runtime.fs.beginTransaction().remove('p7-bench').commit();
  const vfsRemoveMs=now()-removeStarted;
  assert(!runtime.fs.exists('p7-bench'),'P7 VFS cleanup failed');

  const concurrency=4;
  const rounds=16;
  const transferBytesPerRequest=256*1024;
  const resources=new ResourceGovernor({
    workers:concurrency,
    tasks:concurrency*2,
    inFlightBytes:concurrency*transferBytesPerRequest*2
  });
  const workers=[];
  const workerLeases=[];
  const authorities=[];

  const workerSpawnStarted=now();
  for(let index=0;index<concurrency;index++){
    const lease=resources.reserve({workers:1});
    const worker=new Worker('/p7-transfer-worker.mjs',{type:'module',name:'p7-transfer-'+index});
    workerLeases.push(lease);
    workers.push(worker);
  }
  await Promise.all(workers.map((worker)=>waitWorkerReady(worker)));
  for(const worker of workers){
    authorities.push(new WorkerRpcAuthority({
      transport:worker,
      resources,
      maxPending:concurrency*2,
      requestTimeoutMs:10000,
      diagnostics:runtime.diagnostics
    }));
  }
  const workerSpawnReadyMs=now()-workerSpawnStarted;

  const transferStarted=now();
  let transferredBytes=0;
  for(let round=0;round<rounds;round++){
    const responses=await Promise.all(authorities.map((authority,index)=>{
      const buffer=new ArrayBuffer(transferBytesPerRequest);
      const bytes=new Uint8Array(buffer);
      bytes.fill((round+index)&255);
      const expectedChecksum=checksum(bytes);
      return authority.request('roundtrip',{buffer},{transfer:[buffer]}).then((value)=>({value,expectedChecksum}));
    }));
    for(const {value,expectedChecksum} of responses){
      assert(value?.buffer instanceof ArrayBuffer,'P7 worker roundtrip did not transfer ArrayBuffer back');
      assert(value.byteLength===transferBytesPerRequest,'P7 worker roundtrip byte length drifted');
      assert(value.checksum===expectedChecksum,'P7 worker roundtrip checksum drifted');
      transferredBytes+=value.byteLength;
    }
  }
  const sustainedTransferMs=now()-transferStarted;
  const transferMiB=transferredBytes/(1024*1024);
  const transferMiBPerSecond=sustainedTransferMs>0?transferMiB/(sustainedTransferMs/1000):null;

  const teardownStarted=now();
  for(const authority of authorities)authority.close();
  for(const worker of workers)worker.terminate();
  for(const lease of workerLeases)lease.release();
  const workerTeardownMs=now()-teardownStarted;
  assert(Object.values(resources.usage).every((value)=>value===0),'P7 resource governor leaked after worker contention',{usage:resources.usage});

  const heapUsedBytes=Number(globalThis.performance?.memory?.usedJSHeapSize??0);
  await runtime.terminate();

  const receipt={
    schema:'opencontainer.p7-declared-profile-run.v1.0',
    status:'PASS',
    declaredProfile:'desktop-chrome153-ubuntu2404-x64-ci',
    crossOriginIsolated:true,
    p7_02:{
      moduleResourceCount:moduleResources.length,
      moduleResourceBytes,
      moduleImportParseCompileEvaluateMs:rounded(moduleImportAndEvaluateMs),
      runtimeBootMs:rounded(runtimeBootMs),
      isolatedV8ParseCompileClaimed:false
    },
    p7_03:{
      warmOpenMs:rounded(warmOpenMs),
      firstCommandMs:rounded(firstCommandMs),
      packageGraphLoadMs:rounded(packageGraphLoadMs),
      packageGraphLocations,
      vfs:{
        files:fileCount,
        payloadBytesPerFile:payloadBytes,
        writeMs:rounded(vfsWriteMs),
        readMs:rounded(vfsReadMs),
        readdirMs:rounded(vfsReaddirMs),
        rename32Ms:rounded(vfsRenameMs),
        removeTreeMs:rounded(vfsRemoveMs),
        bytesRead
      }
    },
    p7_04:{
      concurrency,
      rounds,
      requests:concurrency*rounds,
      transferBytesPerRequest,
      transferredBytes,
      workerSpawnReadyMs:rounded(workerSpawnReadyMs),
      sustainedTransferMs:rounded(sustainedTransferMs),
      transferMiBPerSecond:rounded(transferMiBPerSecond),
      workerTeardownMs:rounded(workerTeardownMs),
      finalGovernorUsage:resources.usage
    },
    heapUsedBytes,
    boundaries:{
      weakDeviceFloorClaimed:false,
      fourGiBCampaignClaimed:false,
      eightGiBCampaignClaimed:false,
      eightHourPlateauClaimed:false,
      regressionBudgetClaimed:false,
      crossBrowserClaimed:false,
      isolatedV8ParseCompileClaimed:false,
      productionClosed:false
    }
  };
  document.body.dataset.status='pass';
  resultNode.textContent=JSON.stringify(receipt);
}

run().catch((error)=>{
  document.body.dataset.status='fail';
  resultNode.textContent=JSON.stringify({
    schema:'opencontainer.p7-declared-profile-run.v1.0',
    status:'FAIL',
    error:{message:error?.message??String(error),stack:error?.stack??null,details:error?.details??null}
  });
});
