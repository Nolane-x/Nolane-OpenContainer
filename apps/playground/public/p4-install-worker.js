import { FrozenInstallAuthority } from '/packages/package-env/src/frozen-install.js';
import { OpfsPackageContentStore } from '/packages/package-env/src/opfs-package-content-store.js';
import { PackageArtifactAuthority } from '/packages/package-env/src/artifact-authority.js';

const LIGHTNING_INTEGRITY='sha512-OLAtqEyInBSVWjPrTjpLzcZUMUHO0q+2PFBXKr86nxZOu0P38givj/ZMtRaZ0d38pMTb9wQx+LtaLtHclv+sEA==';
const ROLLDOWN_INTEGRITY='sha256-mszzzf49IoetfV9JzSz83bycESq/y8KVhj5AHvRLhXY=';

function stableId(prefix,value){
  let h1=0x811c9dc5,h2=0x9e3779b9;
  for(const byte of new TextEncoder().encode(value)){
    h1=Math.imul(h1^byte,0x01000193)>>>0;
    h2=Math.imul(h2^byte,0x85ebca6b)>>>0;
  }
  return prefix+':'+h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}

function graph(){
  return Object.freeze({
    version:1,
    lockfileVersion:3,
    nodes:Object.freeze([
      Object.freeze({
        name:'@rolldown/browser',
        version:'1.2.9',
        location:'node_modules/@rolldown/browser',
        contentId:stableId('content',ROLLDOWN_INTEGRITY),
        instanceId:stableId('instance',stableId('content',ROLLDOWN_INTEGRITY)+'|node_modules/@rolldown/browser'),
        integrity:ROLLDOWN_INTEGRITY,
        resolved:location.origin+'/toolchain/vendor/rolldown-browser-1.2.9.tgz',
        link:false,inBundle:false,
        dependencies:Object.freeze({}),optionalDependencies:Object.freeze({}),
        peerDependencies:Object.freeze({}),peerDependenciesMeta:Object.freeze({}),
        hasInstallScript:false,dev:false,optional:false
      }),
      Object.freeze({
        name:'lightningcss-wasm',
        version:'1.33.0',
        location:'node_modules/lightningcss-wasm',
        contentId:stableId('content',LIGHTNING_INTEGRITY),
        instanceId:stableId('instance',stableId('content',LIGHTNING_INTEGRITY)+'|node_modules/lightningcss-wasm'),
        integrity:LIGHTNING_INTEGRITY,
        resolved:location.origin+'/toolchain/vendor/lightningcss-wasm-1.33.0.tgz',
        link:false,inBundle:false,
        dependencies:Object.freeze({}),optionalDependencies:Object.freeze({}),
        peerDependencies:Object.freeze({}),peerDependenciesMeta:Object.freeze({}),
        hasInstallScript:false,dev:false,optional:false
      })
    ]),
    bins:Object.freeze({})
  });
}

self.addEventListener('message',async event=>{
  if(event.data?.type!=='start')return;
  const directoryName=event.data.directoryName;
  try{
    const root=await navigator.storage.getDirectory();
    const store=await new OpfsPackageContentStore({
      root,
      directoryName,
      lockManager:navigator.locks
    }).open();
    const currentGraph=graph();
    const packages={
      graph:currentGraph,
      generation:1,
      assertGraphGeneration(expected){
        if(expected!==1){
          const error=new Error('stale worker graph');
          error.code='OC_STALE_GENERATION';
          throw error;
        }
        return currentGraph;
      },
      mountCatalog(){throw new Error('worker-death court must never publish PackageFS');}
    };
    const authority=new PackageArtifactAuthority({
      fs:{beginTransaction(){throw new Error('worker artifact fetch must not mutate workspace VFS');}},
      network:{authorize(url){return {url:String(url)};}},
      maxArtifactBytes:8*1024*1024,
      maxUnpackedBytes:96*1024*1024
    });
    const installer=new FrozenInstallAuthority({packages,contentStore:store});
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
            graphGeneration:1
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
