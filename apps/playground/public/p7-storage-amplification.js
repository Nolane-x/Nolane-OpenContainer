import { MemoryVFS, OpfsCheckpointAuthority } from '/packages/vfs/src/index.js';
import { OpfsPackageContentStore } from '/packages/package-env/src/opfs-package-content-store.js';
import { OpfsDerivedIndexStore } from '/packages/persistence/src/index.js';

const resultNode=document.getElementById('result');
const encoder=new TextEncoder();
const LIGHTNING_INTEGRITY='sha512-OLAtqEyInBSVWjPrTjpLzcZUMUHO0q+2PFBXKr86nxZOu0P38givj/ZMtRaZ0d38pMTb9wQx+LtaLtHclv+sEA==';

function assert(condition,message,details=null){
  if(!condition){
    const error=new Error(message);
    error.details=details;
    throw error;
  }
}
function ratio(stored,logical){
  return Math.round((stored/Math.max(1,logical))*1e6)/1e6;
}
async function directoryPayloadBytes(directory){
  let total=0;
  for await(const [,handle] of directory.entries()){
    if(handle.kind==='file'){
      const file=await handle.getFile();
      total+=file.size;
    }else if(handle.kind==='directory'){
      total+=await directoryPayloadBytes(handle);
    }
  }
  return total;
}
async function childDirectoryBytes(root,name){
  const directory=await root.getDirectoryHandle(name);
  return directoryPayloadBytes(directory);
}

async function run(){
  assert(globalThis.isSecureContext,'P7 storage court requires secure context');
  assert(globalThis.crossOriginIsolated,'P7 storage court requires COOP/COEP isolation');
  assert(navigator.storage?.getDirectory,'P7 storage court requires OPFS');

  const root=await navigator.storage.getDirectory();
  const suffix=crypto.randomUUID();
  const checkpointDirectory='opencontainer-p7-amplification-checkpoint-'+suffix;
  const packageDirectory='opencontainer-p7-amplification-package-'+suffix;
  const derivedDirectory='opencontainer-p7-amplification-derived-'+suffix;
  const cleanup=[checkpointDirectory,packageDirectory,derivedDirectory];

  try{
    // Canonical logical source baseline. OpenContainer persists this source
    // through checkpoints; there is intentionally no second hidden source copy.
    const sourceFiles={};
    let sourceLogicalBytes=0;
    for(let index=0;index<32;index++){
      const content='export const value'+index+' = '+index+';\n'+'s'.repeat(4096);
      sourceFiles['src/module-'+String(index).padStart(2,'0')+'.ts']=content;
      sourceLogicalBytes+=encoder.encode(content).byteLength;
    }
    const fs=new MemoryVFS();
    fs.mount(sourceFiles);
    assert(sourceLogicalBytes>128*1024,'P7 source fixture is too small',{sourceLogicalBytes});

    const checkpoint=await new OpfsCheckpointAuthority({
      root,
      directoryName:checkpointDirectory,
      lockManager:navigator.locks
    }).open();
    const stable=await checkpoint.checkpoint(fs);
    const stableCheckpointBytes=await childDirectoryBytes(root,checkpointDirectory);
    assert(stableCheckpointBytes>sourceLogicalBytes,'P7 checkpoint did not retain source plus persistence metadata',{
      stableCheckpointBytes,sourceLogicalBytes
    });

    // Inject a post-payload crash to retain a real orphaned transaction payload.
    const transientContent='t'.repeat(128*1024);
    fs.beginTransaction().writeFile('src/transient.ts',transientContent).commit();
    const transientLogicalBytes=encoder.encode(transientContent).byteLength;
    let crashCode=null;
    try{
      await checkpoint.checkpoint(fs,{crashAt:'after-payload'});
    }catch(error){
      crashCode=error?.code??error?.name??'ERROR';
    }
    assert(crashCode==='OC_INVALID_STATE','P7 temporary checkpoint transaction was not interrupted after payload',{crashCode});
    const withTransientBytes=await childDirectoryBytes(root,checkpointDirectory);
    const transientStorageBytes=withTransientBytes-stableCheckpointBytes;
    assert(transientStorageBytes>0,'P7 temporary transaction did not create measurable retained bytes',{
      stableCheckpointBytes,withTransientBytes
    });
    const gc=await checkpoint.collectGarbage();
    const afterTransientCleanupBytes=await childDirectoryBytes(root,checkpointDirectory);
    assert(gc.removed.length>=1,'P7 checkpoint garbage collector removed no orphan transaction');
    assert(afterTransientCleanupBytes===stableCheckpointBytes,'P7 temporary transaction cleanup did not restore stable checkpoint bytes',{
      stableCheckpointBytes,afterTransientCleanupBytes,gc
    });

    // Persist a real retained production package artifact.
    const packageResponse=await fetch('/toolchain/vendor/lightningcss-wasm-1.33.0.tgz',{cache:'no-store'});
    assert(packageResponse.ok,'P7 package artifact fetch failed',{status:packageResponse.status});
    const packageBytes=new Uint8Array(await packageResponse.arrayBuffer());
    assert(packageBytes.byteLength===3826518,'P7 package artifact byte identity drifted',{bytes:packageBytes.byteLength});
    const contentId='content:p7-lightningcss-wasm-1.33.0';
    const packageStore=await new OpfsPackageContentStore({
      root,
      directoryName:packageDirectory,
      lockManager:navigator.locks
    }).open();
    const packageIngest=await packageStore.ingest({
      contentId,
      integrity:LIGHTNING_INTEGRITY,
      bytes:packageBytes,
      expectedName:'lightningcss-wasm',
      expectedVersion:'1.33.0'
    });
    assert(packageIngest.persisted===true,'P7 package artifact did not persist');
    const packageUsage=await packageStore.persistedUsage(contentId);
    const packageDirectoryBytes=await childDirectoryBytes(root,packageDirectory);
    assert(packageUsage.totalBytes===packageDirectoryBytes,'P7 package persisted usage disagrees with OPFS bytes',{
      packageUsage,packageDirectoryBytes
    });
    assert(packageUsage.artifactBytes===packageBytes.byteLength,'P7 package persisted artifact byte count drifted');

    // Persist a rebuildable derived index and compare its logical payload to
    // visible OPFS payload+manifest bytes.
    const derivedValue={
      files:Array.from({length:512},(_,index)=>({
        path:'src/module-'+String(index).padStart(4,'0')+'.ts',
        dependencies:[
          'dep-'+String(index%31).padStart(2,'0'),
          'dep-'+String((index+7)%31).padStart(2,'0')
        ],
        digest:'d'.repeat(64)
      })),
      generation:fs.generation
    };
    const derivedLogicalBytes=encoder.encode(JSON.stringify(derivedValue)).byteLength;
    const derivedStore=await new OpfsDerivedIndexStore({
      root,
      directoryName:derivedDirectory,
      lockManager:navigator.locks
    }).open();
    await derivedStore.publish({sourceGeneration:fs.generation,value:derivedValue});
    const derivedUsage=await derivedStore.inspectStorage();
    const derivedDirectoryBytes=await childDirectoryBytes(root,derivedDirectory);
    assert(derivedUsage.totalBytes===derivedDirectoryBytes,'P7 derived cache usage disagrees with OPFS bytes',{
      derivedUsage,derivedDirectoryBytes
    });
    assert(derivedUsage.payloadBytes>derivedLogicalBytes,'P7 derived cache payload envelope was not measured');

    const persistentBaselineBytes=sourceLogicalBytes+packageBytes.byteLength+derivedLogicalBytes;
    const persistentStoredBytes=stableCheckpointBytes+packageUsage.totalBytes+derivedUsage.totalBytes;
    const totalAmplification=ratio(persistentStoredBytes,persistentBaselineBytes);

    const receipt={
      schema:'opencontainer.p7-storage-amplification-run.v1.0',
      status:'PASS',
      declaredProfile:'desktop-chrome153-ubuntu2404-x64-ci',
      browserVisibleStorageMetric:'File.size payload bytes exposed by OPFS handles; filesystem allocation metadata is not exposed by the Web API.',
      source:{
        model:'canonical VFS source persisted through checkpoint authority; no duplicate hidden source store is claimed',
        files:Object.keys(sourceFiles).length,
        logicalBytes:sourceLogicalBytes
      },
      checkpoints:{
        stableSequence:stable.sequence,
        stableGeneration:stable.generation,
        storedBytes:stableCheckpointBytes,
        amplificationVsLogicalSource:ratio(stableCheckpointBytes,sourceLogicalBytes)
      },
      temporaryTransactions:{
        injectedCrash:'after-payload',
        crashCode,
        logicalMutationBytes:transientLogicalBytes,
        stableBytes:stableCheckpointBytes,
        bytesWithOrphan:withTransientBytes,
        transientStorageBytes,
        transientAmplificationVsLogicalMutation:ratio(transientStorageBytes,transientLogicalBytes),
        garbageRemoved:gc.removed.length,
        bytesAfterCleanup:afterTransientCleanupBytes,
        cleanupReturnedToStable:true
      },
      packages:{
        package:'lightningcss-wasm',
        version:'1.33.0',
        logicalArtifactBytes:packageBytes.byteLength,
        artifactBytes:packageUsage.artifactBytes,
        manifestBytes:packageUsage.manifestBytes,
        storedBytes:packageUsage.totalBytes,
        amplificationVsArtifact:ratio(packageUsage.totalBytes,packageBytes.byteLength),
        persistentReused:packageIngest.persistentReused
      },
      derivedCaches:{
        logicalValueBytes:derivedLogicalBytes,
        payloadBytes:derivedUsage.payloadBytes,
        manifestBytes:derivedUsage.manifestBytes,
        storedBytes:derivedUsage.totalBytes,
        amplificationVsLogicalValue:ratio(derivedUsage.totalBytes,derivedLogicalBytes),
        rebuildable:derivedUsage.rebuildable
      },
      aggregate:{
        logicalBaselineBytes:persistentBaselineBytes,
        persistentStoredBytes,
        amplification:totalAmplification,
        transientBytesExcludedFromSteadyState:true
      },
      boundaries:{
        filesystemAllocationOverheadClaimed:false,
        weakDeviceFloorClaimed:false,
        eightHourPlateauClaimed:false,
        regressionBudgetClaimed:false,
        crossBrowserClaimed:false,
        productionClosed:false
      }
    };

    assert(Number.isFinite(receipt.aggregate.amplification)&&receipt.aggregate.amplification>=1,'P7 aggregate amplification is invalid',receipt.aggregate);
    document.body.dataset.status='pass';
    resultNode.textContent=JSON.stringify(receipt);
  }finally{
    for(const name of cleanup)await root.removeEntry(name,{recursive:true}).catch(()=>{});
  }
}

run().catch((error)=>{
  document.body.dataset.status='fail';
  resultNode.textContent=JSON.stringify({
    schema:'opencontainer.p7-storage-amplification-run.v1.0',
    status:'FAIL',
    error:{message:error?.message??String(error),stack:error?.stack??null,details:error?.details??null}
  });
});
