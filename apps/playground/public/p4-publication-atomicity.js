import { OpenContainer } from '/packages/sdk/src/index.js';
import { PackageArtifactAuthority } from '/packages/package-env/src/index.js';

const LIGHTNING_INTEGRITY='sha512-OLAtqEyInBSVWjPrTjpLzcZUMUHO0q+2PFBXKr86nxZOu0P38givj/ZMtRaZ0d38pMTb9wQx+LtaLtHclv+sEA==';
const ROLLDOWN_INTEGRITY='sha256-mszzzf49IoetfV9JzSz83bycESq/y8KVhj5AHvRLhXY=';
let activeWorker=null;
let workerFirstReceipt=null;

function fullLockfile(name='p4-publication-atomicity'){
  return {
    name,version:'1.0.0',lockfileVersion:3,
    packages:{
      '':{name,version:'1.0.0'},
      'node_modules/@rolldown/browser':{
        name:'@rolldown/browser',version:'1.2.9',
        resolved:location.origin+'/toolchain/vendor/rolldown-browser-1.2.9.tgz',
        integrity:ROLLDOWN_INTEGRITY
      },
      'node_modules/lightningcss-wasm':{
        name:'lightningcss-wasm',version:'1.33.0',
        resolved:location.origin+'/toolchain/vendor/lightningcss-wasm-1.33.0.tgz',
        integrity:LIGHTNING_INTEGRITY
      }
    }
  };
}
function singleLockfile(){
  return {
    name:'p4-quota',version:'1.0.0',lockfileVersion:3,
    packages:{
      '':{name:'p4-quota',version:'1.0.0'},
      'node_modules/lightningcss-wasm':{
        name:'lightningcss-wasm',version:'1.33.0',
        resolved:location.origin+'/toolchain/vendor/lightningcss-wasm-1.33.0.tgz',
        integrity:LIGHTNING_INTEGRITY
      }
    }
  };
}
function syntheticLock(name){
  return {
    name:'p4-cas',version:'1',lockfileVersion:3,
    packages:{
      '':{name:'p4-cas',version:'1'},
      ['node_modules/'+name]:{name,version:'1.0.0',resolved:'packages/'+name,link:true}
    }
  };
}
async function root(){return navigator.storage.getDirectory();}
async function cleanup(directoryName){
  const r=await root();
  await r.removeEntry(directoryName,{recursive:true}).catch(()=>{});
  await r.removeEntry(directoryName+'-graph',{recursive:true}).catch(()=>{});
  return true;
}
async function bootPersistent(directoryName){
  const r=await root();
  const runtime=await OpenContainer.boot({
    network:{allowLocal:true},
    packagePersistence:{
      root:r,
      directoryName,
      graphDirectoryName:directoryName+'-graph',
      lockManager:navigator.locks
    }
  });
  runtime.net.allow({origin:location.origin,methods:['GET'],paths:['/toolchain/vendor/']});
  return runtime;
}
async function publishCurrentGraph(runtime,mutationId){
  return runtime.packages.publishGraph({
    baseGeneration:runtime.packageGraphStore.current?.generation??0,
    mutationId
  });
}
function artifactAuthority(runtime){
  return new PackageArtifactAuthority({
    fs:runtime.fs,
    network:runtime.net,
    maxArtifactBytes:8*1024*1024,
    maxUnpackedBytes:96*1024*1024
  });
}
function serializeError(error){
  return {
    name:error?.name??'Error',
    code:error?.code??null,
    message:error?.message??String(error),
    details:error?.details??null
  };
}
async function contentState(runtime){
  const rows=[];
  for(const node of runtime.packages.graph.nodes){
    if(node.link||node.inBundle)continue;
    rows.push({
      location:node.location,
      contentId:node.contentId,
      usage:await runtime.packageContentStore.persistedUsage(node.contentId),
      memoryPresent:runtime.packageContentStore.has(node.contentId)
    });
  }
  return rows;
}

async function cas(){
  const runtime=await OpenContainer.boot();
  try{
    runtime.packages.compile(syntheticLock('base'));
    const sharedBase=runtime.packages.generation;
    runtime.packages.compile(syntheticLock('winner'),{expectedGeneration:sharedBase});
    const winnerGeneration=runtime.packages.generation;
    let stale=null;
    try{
      runtime.packages.compile(syntheticLock('loser'),{expectedGeneration:sharedBase});
    }catch(error){stale=serializeError(error);}
    return {
      sharedBase,
      winnerGeneration,
      finalGeneration:runtime.packages.generation,
      finalPackage:runtime.packages.graph.nodes[0]?.name??null,
      stale
    };
  }finally{await runtime.terminate();}
}

async function persistentCas(directoryName){
  await cleanup(directoryName);
  const left=await bootPersistent(directoryName);
  const right=await bootPersistent(directoryName);
  try{
    left.packages.compile(syntheticLock('left'));
    right.packages.compile(syntheticLock('right'));
    const baseGeneration=0;
    const race=await Promise.allSettled([
      left.packages.publishGraph({baseGeneration,mutationId:'p4-cas-left'}),
      right.packages.publishGraph({baseGeneration,mutationId:'p4-cas-right'})
    ]);
    const fulfilled=race
      .map((result,index)=>({result,index}))
      .filter(row=>row.result.status==='fulfilled');
    const rejected=race
      .map((result,index)=>({result,index}))
      .filter(row=>row.result.status==='rejected');
    const winnerIndex=fulfilled[0]?.index??null;
    const loserIndex=rejected[0]?.index??null;
    const winner=winnerIndex===0?left:right;
    const loser=loserIndex===0?left:right;
    const canonical=await winner.packageGraphStore.read();

    let raceFailure=null;
    if(rejected[0])raceFailure=serializeError(rejected[0].result.reason);

    const installer=winner.packages.createFrozenInstaller();
    await installer.installAll({
      artifactAuthority:{
        async fetchArtifact(){throw new Error('link-only persistent CAS court must not fetch artifacts');}
      },
      concurrency:1
    });

    const successor=await loser.packages.publishGraph({
      baseGeneration:canonical.generation,
      mutationId:'p4-cas-successor'
    });
    let mountFailure=null;
    try{await installer.mountFrozenGraphPersistent();}
    catch(error){mountFailure=serializeError(error);}
    const finalCanonical=await loser.packageGraphStore.read();

    return {
      baseGeneration,
      fulfilledCount:fulfilled.length,
      rejectedCount:rejected.length,
      raceFailure,
      winnerIndex,
      loserIndex,
      winnerName:canonical.graph.nodes[0]?.name??null,
      winnerGeneration:canonical.generation,
      successorGeneration:successor.generation,
      finalGeneration:finalCanonical.generation,
      finalName:finalCanonical.graph.nodes[0]?.name??null,
      crossContextLocking:
        left.packageGraphStore.crossContextLocking===true&&
        right.packageGraphStore.crossContextLocking===true,
      mountFailure,
      nodeModulesNull:winner.packages.nodeModules===null
    };
  }finally{
    await left.terminate();
    await right.terminate();
  }
}

async function cancel(directoryName){
  await cleanup(directoryName);
  const runtime=await bootPersistent(directoryName);
  try{
    runtime.packages.compile(fullLockfile('p4-cancel'));
    const graphPublication=await publishCurrentGraph(runtime,'p4-cancel');
    const graphGeneration=runtime.packages.generation;
    const installer=runtime.packages.createFrozenInstaller();
    const controller=new AbortController();
    let failure=null;
    try{
      await installer.installAll({
        artifactAuthority:artifactAuthority(runtime),
        concurrency:1,
        signal:controller.signal,
        onProgress(receipt){
          if(receipt.completed===1)controller.abort('p4-cancel-after-first-content');
        }
      });
    }catch(error){failure=serializeError(error);}

    let mountFailure=null;
    try{await installer.mountFrozenGraphPersistent();}
    catch(error){mountFailure=serializeError(error);}
    const afterFailure=await contentState(runtime);
    const nodeModulesAfterFailure=runtime.packages.nodeModules===null;

    const retry=await installer.installAll({
      artifactAuthority:artifactAuthority(runtime),
      concurrency:1
    });
    const mounted=await installer.mountFrozenGraphPersistent();
    return {
      graphGeneration,
      persistentGraphGeneration:graphPublication.generation,
      failure,
      mountFailure,
      lastInstallFailedAfterFailure:mountFailure?.code==='OC_INVALID_STATE',
      nodeModulesAfterFailure,
      afterFailure,
      retry:{
        requestedContents:retry.requestedContents,
        fetchedContents:retry.fetchedContents,
        contentCount:retry.contentCount,
        packageCount:mounted.packageCount,
        graphGeneration:mounted.graphGeneration,
        publicationPrecondition:mounted.publicationPrecondition
      }
    };
  }finally{await runtime.terminate();}
}

async function quotaAttempt(directoryName){
  await cleanup(directoryName);
  const runtime=await bootPersistent(directoryName);
  try{
    runtime.packages.compile(singleLockfile());
    const graphPublication=await publishCurrentGraph(runtime,'p4-quota-attempt');
    const installer=runtime.packages.createFrozenInstaller();
    let failure=null;
    try{
      await installer.installAll({artifactAuthority:artifactAuthority(runtime),concurrency:1});
    }catch(error){failure=serializeError(error);}
    let mountFailure=null;
    try{await installer.mountFrozenGraphPersistent();}
    catch(error){mountFailure=serializeError(error);}
    return {
      graphPublication,
      failure,
      mountFailure,
      lastInstallFailed:installer.lastInstallFailed,
      nodeModulesNull:runtime.packages.nodeModules===null,
      content:await contentState(runtime)
    };
  }finally{await runtime.terminate();}
}

async function quotaRecover(directoryName){
  const runtime=await bootPersistent(directoryName);
  try{
    runtime.packages.compile(singleLockfile());
    const graphPublication=await publishCurrentGraph(runtime,'p4-quota-recover');
    const installer=runtime.packages.createFrozenInstaller();
    const receipt=await installer.installAll({artifactAuthority:artifactAuthority(runtime),concurrency:1});
    const mounted=await installer.mountFrozenGraphPersistent();
    return {
      requestedContents:receipt.requestedContents,
      fetchedContents:receipt.fetchedContents,
      packageCount:mounted.packageCount,
      graphGeneration:mounted.graphGeneration,
      persistentGraphGeneration:graphPublication.generation,
      publicationPrecondition:mounted.publicationPrecondition,
      content:await contentState(runtime)
    };
  }finally{await runtime.terminate();}
}

async function startWorker(directoryName){
  await cleanup(directoryName);
  if(activeWorker)activeWorker.terminate();
  workerFirstReceipt=null;
  activeWorker=new Worker('/p4-install-worker.js',{type:'module'});
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{
      reject(new Error('P4 installer worker did not reach second-fetch block'));
    },30000);
    activeWorker.addEventListener('message',event=>{
      const message=event.data??{};
      if(message.type==='first-content-persisted'){
        workerFirstReceipt=message;
        return;
      }
      if(message.type==='second-fetch-blocked'){
        clearTimeout(timeout);
        resolve({first:workerFirstReceipt,secondFetchBlocked:true,directoryName});
        return;
      }
      if(message.type==='error'||message.type==='unexpected-complete'){
        clearTimeout(timeout);
        reject(new Error('P4 installer worker failed before termination court: '+JSON.stringify(message)));
      }
    });
    activeWorker.addEventListener('error',event=>{
      clearTimeout(timeout);
      reject(event.error??new Error(event.message||'P4 installer worker error'));
    },{once:true});
    activeWorker.postMessage({type:'start',directoryName});
  });
}

async function killWorker(){
  if(!activeWorker)return {terminated:false};
  activeWorker.terminate();
  activeWorker=null;
  await new Promise(resolve=>setTimeout(resolve,100));
  return {terminated:true,first:workerFirstReceipt};
}

async function inspectWorkerDeath(directoryName){
  const runtime=await bootPersistent(directoryName);
  try{
    runtime.packages.compile(fullLockfile('p4-worker-recovery'));
    const graphPublication=await publishCurrentGraph(runtime,'p4-worker-recovery');
    const hydrate=[];
    for(const node of runtime.packages.graph.nodes){
      hydrate.push({
        location:node.location,
        hydrated:await runtime.packageContentStore.hydrate({
          contentId:node.contentId,
          integrity:node.integrity,
          expectedName:node.name,
          expectedVersion:node.version
        })
      });
    }
    const installer=runtime.packages.createFrozenInstaller();
    let mountFailure=null;
    try{await installer.mountFrozenGraphPersistent();}
    catch(error){mountFailure=serializeError(error);}
    const beforeRecovery={
      hydrate,
      content:await contentState(runtime),
      nodeModulesNull:runtime.packages.nodeModules===null,
      mountFailure
    };
    const receipt=await installer.installAll({artifactAuthority:artifactAuthority(runtime),concurrency:1});
    const mounted=await installer.mountFrozenGraphPersistent();
    return {
      persistentGraphGeneration:graphPublication.generation,
      beforeRecovery,
      recovery:{
        requestedContents:receipt.requestedContents,
        fetchedContents:receipt.fetchedContents,
        packageCount:mounted.packageCount,
        graphGeneration:mounted.graphGeneration,
        publicationPrecondition:mounted.publicationPrecondition
      }
    };
  }finally{await runtime.terminate();}
}

globalThis.__p4AtomicityCourt=Object.freeze({
  cas,persistentCas,cancel,quotaAttempt,quotaRecover,startWorker,killWorker,inspectWorkerDeath,cleanup
});
document.body.dataset.ready='true';
document.getElementById('result').textContent='ready';
