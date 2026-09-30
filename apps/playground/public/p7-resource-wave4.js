import { OpenContainer } from '/packages/sdk/src/index.js';
import { ToolchainAuthority } from '/packages/toolchain/src/authority.js';
import { AiSharedConcurrencyAuthority } from '/packages/ai-consumer/src/index.js';
import { OpfsPackageContentStore, inspectTarArchive } from '/packages/package-env/src/index.js';
import { MemoryVFS, OpfsCheckpointAuthority } from '/packages/vfs/src/index.js';
import { OpfsDerivedIndexStore } from '/packages/persistence/src/index.js';

const resultNode=document.getElementById('result');
const encoder=new TextEncoder();

function assert(condition,message,details=null){
  if(!condition){const error=new Error(message);error.details=details;throw error;}
}
function rounded(value){return Math.round(Number(value)*1e6)/1e6;}
function zeroUsage(usage){return Object.values(usage).every(value=>value===0);}
function bytesToBase64(bytes){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);}
async function sri512(bytes){const digest=await crypto.subtle.digest('SHA-512',bytes);return 'sha512-'+bytesToBase64(new Uint8Array(digest));}
async function directoryFiles(directory,prefix=''){
  const rows=[];
  for await(const [name,handle] of directory.entries()){
    const path=prefix?prefix+'/'+name:name;
    if(handle.kind==='file'){const file=await handle.getFile();rows.push({path,size:file.size});}
    else rows.push(...await directoryFiles(handle,path));
  }
  rows.sort((a,b)=>a.path.localeCompare(b));
  return rows;
}
function sumRows(rows,predicate=()=>true){return rows.filter(predicate).reduce((sum,row)=>sum+row.size,0);}
async function cleanRoot(root,name){try{await root.removeEntry(name,{recursive:true});}catch(error){if(error?.name!=='NotFoundError')throw error;}}
async function microtask(){await Promise.resolve();await Promise.resolve();}

async function coexistenceCourt(){
  const runtime=await OpenContainer.boot({resources:{workers:4,tasks:12,inFlightBytes:4*1024*1024,processes:4,outputBytes:4*1024*1024}});
  let coreRelease;
  let coreStartedResolve;
  const coreStarted=new Promise(resolve=>{coreStartedResolve=resolve;});
  runtime.registerCommand('p7:coexist-core',async({stdout})=>{
    stdout('core-active');
    coreStartedResolve();
    await new Promise(resolve=>{coreRelease=resolve;});
    return 0;
  });

  const uiLease=runtime.resources.acquireTask({owner:'ui',inFlightBytes:1024});
  const process=runtime.spawn('p7:coexist-core');
  await coreStarted;

  let previewRelease;
  let previewStartedResolve;
  const previewStarted=new Promise(resolve=>{previewStartedResolve=resolve;});
  const route=runtime.listen(5198,async()=>{
    previewStartedResolve();
    await new Promise(resolve=>{previewRelease=resolve;});
    return new Response('preview-active');
  },{owner:'p7-wave4'});
  const previewPromise=runtime.preview.dispatch(5198,{},route);
  await previewStarted;

  const entry={packageName:'p7-wave4-tool',toolVersion:'1.0.0',artifactDigest:'a'.repeat(64),adapterSemanticProfile:'p7-wave4'};
  const toolchain=new ToolchainAuthority({entries:[entry],maxWorkers:1,resources:runtime.resources});
  const toolLease=toolchain.acquireWorker({agentId:'p7-wave4',entry});
  const agents=new AiSharedConcurrencyAuthority({resources:runtime.resources,maxAgents:2});
  const aiLease=agents.acquire({background:false,inFlightBytes:2048});
  await microtask();

  const owners=runtime.resources.usageByOwner;
  const requiredOwners=['ui','core:process','preview','toolchain','ai-consumer'];
  for(const owner of requiredOwners){
    assert(owners[owner],'P7-06 missing owner '+owner,{owners});
    assert(Object.values(owners[owner]).some(value=>value>0),'P7-06 owner has no resource '+owner,{usage:owners[owner]});
  }
  assert(runtime.preview.resourceBound===true,'P7-06 preview is not governor-bound');
  assert(toolchain.resourceBound===true,'P7-06 toolchain is not governor-bound');
  assert(runtime.resources.activeLeases.length>=5,'P7-06 did not retain five simultaneous leases',{leases:runtime.resources.activeLeases});

  runtime.resources.setPressure('critical');
  let pressureCode=null;
  try{agents.acquire({background:true,inFlightBytes:128});}catch(error){pressureCode=error?.code??error?.name??'ERROR';}
  assert(pressureCode==='OC_RESOURCE_EXHAUSTED','P7-06 pressure did not block new AI background admission',{pressureCode});
  runtime.resources.setPressure('normal');

  previewRelease();
  const previewResponse=await previewPromise;
  assert(await previewResponse.text()==='preview-active','P7-06 preview response drifted');
  coreRelease();
  assert(await process.exit===0,'P7-06 core process failed');
  toolLease.release();
  aiLease.release();
  uiLease.release();
  runtime.preview.revoke(5198,{owner:'p7-wave4'});
  await microtask();
  const finalUsage=runtime.resources.usage;
  assert(zeroUsage(finalUsage),'P7-06 shared governor leaked',{finalUsage,leases:runtime.resources.activeLeases});
  await runtime.terminate();

  return Object.freeze({
    globalGovernor:true,
    simultaneousOwners:requiredOwners,
    ownerUsageAtPeak:owners,
    activeLeaseCountAtPeak:requiredOwners.length,
    pressureBlockedNewAiBackground:pressureCode,
    previewResourceBound:true,
    toolchainResourceBound:true,
    finalUsage
  });
}

async function storageCourt(){
  assert(navigator.storage?.getDirectory,'P7-11 storage court requires OPFS');
  const root=await navigator.storage.getDirectory();
  const prefix='opencontainer-p7-wave4';
  for(const suffix of ['-workspace','-packages','-derived'])await cleanRoot(root,prefix+suffix);

  const vfs=new MemoryVFS();
  const fileCount=64;
  const bytesPerFile=4096;
  const logicalSourceBytes=fileCount*bytesPerFile;
  const payload=new Uint8Array(bytesPerFile);
  for(let i=0;i<payload.length;i++)payload[i]=(i*17)&255;
  const tx=vfs.beginTransaction().mkdir('src');
  for(let i=0;i<fileCount;i++)tx.writeFile('src/file-'+i+'.bin',payload);
  tx.commit();
  const serializedSnapshotBytes=encoder.encode(JSON.stringify(vfs.snapshot())).byteLength;

  const checkpoint=await new OpfsCheckpointAuthority({root,directoryName:prefix+'-workspace',lockManager:navigator.locks??null}).open();
  await checkpoint.checkpoint(vfs);
  const workspaceDir=await root.getDirectoryHandle(prefix+'-workspace');
  const canonicalRows=await directoryFiles(workspaceDir);
  const sourceSnapshotPhysicalBytes=sumRows(canonicalRows,row=>row.path.startsWith('generations/'));
  const checkpointMetadataPhysicalBytes=sumRows(canonicalRows,row=>!row.path.startsWith('generations/'));
  assert(sourceSnapshotPhysicalBytes>0&&checkpointMetadataPhysicalBytes>0,'P7-11 checkpoint accounting is empty',{canonicalRows});

  const beforeTempBytes=sumRows(canonicalRows);
  vfs.beginTransaction().writeFile('src/temp-change.bin',new Uint8Array(32768).fill(91)).commit();
  let crashObserved=false;
  try{await checkpoint.checkpoint(vfs,{crashAt:'after-payload'});}catch{crashObserved=true;}
  assert(crashObserved,'P7-11 temp transaction crash fixture did not interrupt publication');
  const tempPeakBytes=sumRows(await directoryFiles(workspaceDir));
  const tempTransactionBytes=tempPeakBytes-beforeTempBytes;
  assert(tempTransactionBytes>0,'P7-11 temp transaction did not create transient storage',{beforeTempBytes,tempPeakBytes});
  await checkpoint.collectGarbage();
  const afterGcBytes=sumRows(await directoryFiles(workspaceDir));
  assert(afterGcBytes<tempPeakBytes,'P7-11 GC did not reclaim transient storage',{tempPeakBytes,afterGcBytes});

  const packageStore=await new OpfsPackageContentStore({root,directoryName:prefix+'-packages',lockManager:navigator.locks??null}).open();
  const packageResponse=await fetch('/toolchain/vendor/lightningcss-wasm-1.33.0.tgz',{cache:'no-store'});
  assert(packageResponse.ok,'P7-11 retained package fixture fetch failed');
  const packageBytes=new Uint8Array(await packageResponse.arrayBuffer());
  const packageArchive=await inspectTarArchive(packageBytes,{requiredPrefix:'package/'});
  const packageId='p7-wave4:lightningcss-wasm';
  const packageReceipt=await packageStore.ingest({contentId:packageId,integrity:await sri512(packageBytes),bytes:packageBytes});
  assert(packageReceipt.persisted===true,'P7-11 package was not persisted');
  const packageUsage=await packageStore.persistedUsage(packageId);
  assert(packageUsage.exists===true&&packageUsage.totalBytes>0,'P7-11 package usage missing');

  const derivedValue={
    files:Array.from({length:fileCount},(_,i)=>({path:'src/file-'+i+'.bin',symbols:['symbol-'+i,'shared']})),
    sourceGeneration:vfs.generation
  };
  const derivedLogicalBytes=encoder.encode(JSON.stringify({version:1,sourceGeneration:vfs.generation,value:derivedValue})).byteLength;
  const derived=await new OpfsDerivedIndexStore({root,directoryName:prefix+'-derived',lockManager:navigator.locks??null}).open();
  await derived.publish({sourceGeneration:vfs.generation,value:derivedValue});
  const derivedUsage=await derived.inspectStorage();
  assert(derivedUsage.totalBytes>0,'P7-11 derived cache usage missing');

  const primaryLogicalBytes=logicalSourceBytes+packageArchive.totalBytes;
  const steadyPhysicalBytes=sourceSnapshotPhysicalBytes+checkpointMetadataPhysicalBytes+packageUsage.totalBytes+derivedUsage.totalBytes;
  const transientPeakPhysicalBytes=steadyPhysicalBytes+tempTransactionBytes;
  const steadyAmplification=steadyPhysicalBytes/primaryLogicalBytes;
  const transientPeakAmplification=transientPeakPhysicalBytes/primaryLogicalBytes;
  assert(Number.isFinite(steadyAmplification)&&steadyAmplification>0,'P7-11 steady amplification invalid');
  assert(Number.isFinite(transientPeakAmplification)&&transientPeakAmplification>=steadyAmplification,'P7-11 transient amplification invalid');

  return Object.freeze({
    formula:'physical-persistent-bytes/primary-logical-content-bytes',
    physicalScope:'exact File.size payload bytes under dedicated OPFS court directories; filesystem allocation metadata excluded',
    source:{
      logicalFileBytes:logicalSourceBytes,fileCount,serializedSnapshotBytes,
      snapshotPhysicalBytes:sourceSnapshotPhysicalBytes,
      snapshotAmplification:rounded(sourceSnapshotPhysicalBytes/logicalSourceBytes)
    },
    packages:{
      packedArtifactBytes:packageBytes.byteLength,
      uniqueVerifiedLogicalContentBytes:packageArchive.totalBytes,
      physicalPersistentBytes:packageUsage.totalBytes,
      amplification:rounded(packageUsage.totalBytes/packageArchive.totalBytes)
    },
    checkpoints:{
      metadataPhysicalBytes:checkpointMetadataPhysicalBytes,
      canonicalTotalPhysicalBytes:beforeTempBytes,
      metadataOverSourceRatio:rounded(checkpointMetadataPhysicalBytes/logicalSourceBytes)
    },
    tempTransactions:{
      interruptedAfterPayload:true,transientBytes:tempTransactionBytes,
      peakWorkspaceBytes:tempPeakBytes,postGcWorkspaceBytes:afterGcBytes,reclaimed:true
    },
    derivedCaches:{
      logicalBytes:derivedLogicalBytes,physicalPersistentBytes:derivedUsage.totalBytes,
      amplification:rounded(derivedUsage.totalBytes/derivedLogicalBytes),rebuildable:derivedUsage.rebuildable===true
    },
    totals:{
      primaryLogicalBytes,steadyPhysicalBytes,transientPeakPhysicalBytes,
      steadyAmplification:rounded(steadyAmplification),transientPeakAmplification:rounded(transientPeakAmplification)
    },
    thresholdClaimed:false
  });
}

async function run(){
  assert(globalThis.isSecureContext,'P7 wave4 requires secure context');
  assert(globalThis.crossOriginIsolated,'P7 wave4 requires COOP/COEP isolation');
  const receipt={
    schema:'opencontainer.p7-wave4-run.v1.0',
    status:'PASS',
    declaredProfile:'desktop-chrome153-ubuntu2404-x64-ci',
    browser:navigator.userAgent,
    crossOriginIsolated:true,
    sourceGates:['P7-06','P7-11'],
    coexistence:await coexistenceCourt(),
    storage:await storageCourt(),
    boundaries:{
      fourGiBCampaignClaimed:false,eightGiBCampaignClaimed:false,eightHourPlateauClaimed:false,
      systemSleepResumeClaimed:false,weakDeviceRegressionBudgetClaimed:false,
      filesystemAllocationMetadataClaimed:false,crossBrowserClaimed:false,productionClosed:false
    }
  };
  document.body.dataset.status='pass';
  resultNode.textContent=JSON.stringify(receipt);
}
run().catch(error=>{
  document.body.dataset.status='fail';
  resultNode.textContent=JSON.stringify({
    schema:'opencontainer.p7-wave4-run.v1.0',status:'FAIL',
    error:{message:error?.message??String(error),stack:error?.stack??null,details:error?.details??null}
  });
});
