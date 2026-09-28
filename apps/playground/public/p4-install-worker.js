import { OpenContainer } from '/packages/sdk/src/index.js';
import { PackageArtifactAuthority } from '/packages/package-env/src/index.js';

const LIGHTNING_INTEGRITY='sha512-OLAtqEyInBSVWjPrTjpLzcZUMUHO0q+2PFBXKr86nxZOu0P38givj/ZMtRaZ0d38pMTb9wQx+LtaLtHclv+sEA==';
const ROLLDOWN_INTEGRITY='sha256-mszzzf49IoetfV9JzSz83bycESq/y8KVhj5AHvRLhXY=';

function lockfile(){
  return {
    name:'p4-worker-death',
    version:'1.0.0',
    lockfileVersion:3,
    packages:{
      '':{name:'p4-worker-death',version:'1.0.0'},
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

self.addEventListener('message',async event=>{
  if(event.data?.type!=='start')return;
  const directoryName=event.data.directoryName;
  try{
    const root=await navigator.storage.getDirectory();
    const runtime=await OpenContainer.boot({
      network:{allowLocal:true},
      packagePersistence:{root,directoryName,lockManager:navigator.locks}
    });
    runtime.net.allow({origin:location.origin,methods:['GET'],paths:['/toolchain/vendor/']});
    runtime.packages.compile(lockfile());
    const authority=new PackageArtifactAuthority({
      fs:runtime.fs,
      network:runtime.net,
      maxArtifactBytes:8*1024*1024,
      maxUnpackedBytes:96*1024*1024
    });
    const installer=runtime.packages.createFrozenInstaller();
    let fetchOrdinal=0;
    await installer.installAll({
      concurrency:1,
      artifactAuthority:{
        async fetchArtifact(options){
          fetchOrdinal++;
          if(fetchOrdinal===2){
            self.postMessage({type:'second-fetch-blocked',directoryName});
            await new Promise(()=>{});
          }
          return authority.fetchArtifact(options);
        }
      },
      onProgress(receipt){
        if(receipt.completed===1){
          self.postMessage({
            type:'first-content-persisted',
            directoryName,
            contentId:receipt.contentId,
            location:receipt.location,
            graphGeneration:runtime.packages.generation
          });
        }
      }
    });
    self.postMessage({type:'unexpected-complete',directoryName});
  }catch(error){
    self.postMessage({
      type:'error',
      directoryName,
      error:{name:error?.name??'Error',code:error?.code??null,message:error?.message??String(error)}
    });
  }
});
