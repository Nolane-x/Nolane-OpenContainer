import { ErrorCodes, assertOc } from '../../protocol/src/index.js';

function stableId(prefix,value){
  let h1=0x811c9dc5,h2=0x9e3779b9;
  for(const byte of new TextEncoder().encode(value)){h1=Math.imul(h1^byte,0x01000193)>>>0;h2=Math.imul(h2^byte,0x85ebca6b)>>>0;}
  return prefix+':'+h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}
function packageNameFromPath(path){const marker='node_modules/';const index=path.lastIndexOf(marker);return index>=0?path.slice(index+marker.length):path;}

export class PackageGraphAuthority {
  #generation=0;#graph=null;
  get generation(){return this.#generation;}
  get graph(){return this.#graph;}
  compile(lockfile){
    const doc=typeof lockfile==='string'?JSON.parse(lockfile):structuredClone(lockfile);
    assertOc(doc&&[2,3].includes(doc.lockfileVersion),ErrorCodes.INVALID_ARGUMENT,'Only package-lock v2/v3 is supported in Wave 1');
    const nodes=[];const bins={};
    for(const [location,meta] of Object.entries(doc.packages??{})){
      if(!location||!location.includes('node_modules/'))continue;
      const name=meta.name??packageNameFromPath(location);const version=meta.version??'0.0.0-link';
      const contentKey=meta.integrity??meta.resolved??(name+'@'+version);
      const contentId=stableId('content',contentKey);const instanceId=stableId('instance',contentId+'|'+location);
      nodes.push(Object.freeze({name,version,location,contentId,instanceId,integrity:meta.integrity,resolved:meta.resolved,link:!!meta.link}));
      if(meta.bin){
        if(typeof meta.bin==='string')bins[name]=Object.freeze({package:name,path:meta.bin,location});
        else for(const [command,path] of Object.entries(meta.bin))bins[command]=Object.freeze({package:name,path,location});
      }
    }
    nodes.sort((a,b)=>a.location.localeCompare(b.location));
    this.#graph=Object.freeze({version:1,lockfileVersion:doc.lockfileVersion,nodes:Object.freeze(nodes),bins:Object.freeze(bins),rootName:doc.name,rootVersion:doc.version});
    this.#generation++;return this.#graph;
  }
}

export { PackageArtifactAuthority, verifySri, inspectTarArchive } from './artifact-authority.js';
