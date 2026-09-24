import { ErrorCodes, assertOc } from '../../protocol/src/index.js';
import { VirtualNodeModulesFS } from './virtual-node-modules.js';
import { NodeResolver } from './resolver.js';
import { CommonJsLoader } from './commonjs-loader.js';
import { FrozenInstallAuthority } from './frozen-install.js';
import { createCoreBuiltinRegistry } from './builtins/registry.js';
import { PackageCommandBridge } from './command-bridge.js';
import { NativeEsmPublicationAuthority } from './native-esm-publication.js';

function stableId(prefix,value){
  let h1=0x811c9dc5,h2=0x9e3779b9;
  for(const byte of new TextEncoder().encode(value)){h1=Math.imul(h1^byte,0x01000193)>>>0;h2=Math.imul(h2^byte,0x85ebca6b)>>>0;}
  return prefix+':'+h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}
function packageNameFromPath(path){const marker='node_modules/';const index=path.lastIndexOf(marker);return index>=0?path.slice(index+marker.length):path;}

export class PackageGraphAuthority {
  #generation=0;#graph=null;#baseFs=null;#nodeModules=null;#resolver=null;

  constructor({fs=null}={}){this.#baseFs=fs;}
  get generation(){return this.#generation;}
  get graph(){return this.#graph;}
  get nodeModules(){return this.#nodeModules;}
  get resolver(){return this.#resolver;}

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
    this.#nodeModules=null;this.#resolver=null;
    this.#generation++;return this.#graph;
  }

  mountCatalog({packages=[],symlinks=[]}={}){
    assertOc(this.#baseFs,ErrorCodes.INVALID_STATE,'Package catalog requires a bound workspace VFS');
    this.#nodeModules=new VirtualNodeModulesFS({baseFs:this.#baseFs,packages,symlinks});
    this.#resolver=new NodeResolver({fs:this.#nodeModules});
    return Object.freeze({fs:this.#nodeModules,resolver:this.#resolver});
  }

  resolve(specifier,issuer,options){
    assertOc(this.#resolver,ErrorCodes.INVALID_STATE,'Package catalog is not mounted');
    return this.#resolver.resolve(specifier,issuer,options);
  }

  createCommonJsLoader(options={}){
    assertOc(this.#nodeModules&&this.#resolver,ErrorCodes.INVALID_STATE,'Package catalog is not mounted');
    const {builtins={},globals={},cwd='/workspace',env={},argv=['opencontainer'],platform='linux',stdout=()=>{},stderr=()=>{},...rest}=options;
    let loader;
    const core=createCoreBuiltinRegistry({
      fs:this.#nodeModules,
      writableFs:this.#baseFs,
      cwd,
      env,
      argv,
      platform,
      stdout,
      stderr,
      createRequire:(issuer)=>loader.createRequire(issuer)
    });
    const merged={...core,...builtins};
    const compatConsole=Object.freeze({
      log:(...values)=>stdout(values.map(String).join(' ')+'\n'),
      info:(...values)=>stdout(values.map(String).join(' ')+'\n'),
      warn:(...values)=>stderr(values.map(String).join(' ')+'\n'),
      error:(...values)=>stderr(values.map(String).join(' ')+'\n')
    });
    loader=new CommonJsLoader({
      fs:this.#nodeModules,
      resolver:this.#resolver,
      builtins:merged,
      globals:{
        Buffer:merged.buffer?.Buffer,
        process:merged.process,
        console:compatConsole,
        ...globals
      },
      ...rest
    });
    return loader;
  }

  createFrozenInstaller(options={}){
    return new FrozenInstallAuthority({packages:this,...options});
  }

  bindCommands(processSupervisor,options={}){
    const bridge=new PackageCommandBridge({packages:this,process:processSupervisor,options});
    return Object.freeze({bridge,commands:bridge.registerAll()});
  }

  createNativeEsmPublication(options={}){
    assertOc(this.#nodeModules&&this.#resolver,ErrorCodes.INVALID_STATE,'Package catalog is not mounted');
    return new NativeEsmPublicationAuthority({fs:this.#nodeModules,resolver:this.#resolver,...options});
  }
}

export { PackageArtifactAuthority, verifySri, inspectTarArchive } from './artifact-authority.js';
export { VirtualNodeModulesFS } from './virtual-node-modules.js';
export { NodeResolver, NODE_BUILTINS } from './resolver.js';
export { CommonJsLoader } from './commonjs-loader.js';

export { FrozenInstallAuthority, PackageContentStore } from './frozen-install.js';

export { createCoreBuiltinRegistry } from './builtins/registry.js';
export { createPosixPath } from './builtins/path.js';
export { EventEmitter, createEventsBuiltin } from './builtins/events.js';

export { BufferCompat, createBufferBuiltin } from './builtins/buffer.js';
export { createUrlBuiltin } from './builtins/url.js';
export { createProcessBuiltin } from './builtins/process.js';
export { createFsBuiltins } from './builtins/fs.js';

export { PackageCommandBridge } from './command-bridge.js';
export { createModuleBuiltin, BUILTIN_MODULES } from './builtins/module.js';

export { NativeEsmPublicationAuthority } from './native-esm-publication.js';
