import { ErrorCodes, assertOc } from '../../protocol/src/index.js';
import { VirtualNodeModulesFS } from './virtual-node-modules.js';
import { NodeResolver } from './resolver.js';
import { CommonJsLoader } from './commonjs-loader.js';
import { FrozenInstallAuthority } from './frozen-install.js';
import { createCoreBuiltinRegistry } from './builtins/registry.js';
import { PackageCommandBridge } from './command-bridge.js';
import { NativeEsmPublicationAuthority } from './native-esm-publication.js';
import { createBrowserNodeCompatBridge } from './browser-node-compat.js';

function stableId(prefix,value){
  let h1=0x811c9dc5,h2=0x9e3779b9;
  for(const byte of new TextEncoder().encode(value)){h1=Math.imul(h1^byte,0x01000193)>>>0;h2=Math.imul(h2^byte,0x85ebca6b)>>>0;}
  return prefix+':'+h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}
function packageNameFromPath(path){const marker='node_modules/';const index=path.lastIndexOf(marker);return index>=0?path.slice(index+marker.length):path;}
function frozenRecord(value={}){return Object.freeze({...value});}
function dependencyLocation(nodesByLocation,issuerLocation,name){
  let current=issuerLocation;
  while(true){
    const candidate=(current?current+'/':'')+'node_modules/'+name;
    if(nodesByLocation.has(candidate))return candidate;
    if(!current)break;
    const nested=current.lastIndexOf('/node_modules/');
    if(nested>=0)current=current.slice(0,nested);
    else if(current.startsWith('node_modules/'))current='';
    else current='';
  }
  return null;
}

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
      nodes.push(Object.freeze({
        name,version,location,contentId,instanceId,
        integrity:meta.integrity,resolved:meta.resolved,link:!!meta.link,inBundle:!!meta.inBundle,
        dependencies:frozenRecord(meta.dependencies),
        optionalDependencies:frozenRecord(meta.optionalDependencies),
        peerDependencies:frozenRecord(meta.peerDependencies),
        peerDependenciesMeta:frozenRecord(meta.peerDependenciesMeta),
        dev:!!meta.dev,optional:!!meta.optional
      }));
      if(meta.bin){
        if(typeof meta.bin==='string')bins[name]=Object.freeze({package:name,path:meta.bin,location});
        else for(const [command,path] of Object.entries(meta.bin))bins[command]=Object.freeze({package:name,path,location});
      }
    }
    nodes.sort((a,b)=>a.location.localeCompare(b.location));
    const root=doc.packages?.['']??{};
    this.#graph=Object.freeze({
      version:1,
      lockfileVersion:doc.lockfileVersion,
      nodes:Object.freeze(nodes),
      bins:Object.freeze(bins),
      rootName:doc.name??root.name,
      rootVersion:doc.version??root.version,
      rootDependencies:frozenRecord(root.dependencies),
      rootDevDependencies:frozenRecord(root.devDependencies),
      rootOptionalDependencies:frozenRecord(root.optionalDependencies)
    });
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

  selectDependencyClosure({roots=[],includeOptional=false}={}){
    assertOc(this.#graph,ErrorCodes.INVALID_STATE,'Compile a lockfile before selecting dependency closure');
    const rootNames=roots.length?[...roots]:Object.keys({...this.#graph.rootDependencies,...this.#graph.rootDevDependencies});
    const byLocation=new Map(this.#graph.nodes.map(node=>[node.location,node]));
    const queue=[];
    for(const name of rootNames){
      const location='node_modules/'+name;
      assertOc(byLocation.has(location),ErrorCodes.INVALID_PACKAGE_CONFIG,'Dependency root is absent from lockfile',{name,location});
      queue.push(location);
    }

    const selected=new Set();
    const optionalSkipped=new Set();
    while(queue.length){
      const location=queue.shift();
      if(selected.has(location))continue;
      const node=byLocation.get(location);
      assertOc(node,ErrorCodes.INVALID_PACKAGE_CONFIG,'Selected dependency location is absent from lockfile',{location});
      selected.add(location);

      for(const name of Object.keys(node.dependencies??{})){
        const target=dependencyLocation(byLocation,location,name);
        assertOc(target,ErrorCodes.INVALID_PACKAGE_CONFIG,'Required lockfile dependency cannot be resolved',{issuer:location,dependency:name});
        if(!selected.has(target))queue.push(target);
      }
      for(const name of Object.keys(node.optionalDependencies??{})){
        const target=dependencyLocation(byLocation,location,name);
        if(!target){optionalSkipped.add(location+' -> '+name);continue;}
        if(includeOptional){if(!selected.has(target))queue.push(target);}
        else optionalSkipped.add(target);
      }
    }

    return Object.freeze({
      roots:Object.freeze(rootNames),
      locations:Object.freeze([...selected].sort()),
      optionalSkipped:Object.freeze([...optionalSkipped].sort())
    });
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

  createBrowserNodeCompat(options={}){
    assertOc(this.#nodeModules&&this.#resolver,ErrorCodes.INVALID_STATE,'Package catalog is not mounted');
    return createBrowserNodeCompatBridge({fs:this.#nodeModules,writableFs:this.#baseFs,resolver:this.#resolver,...options});
  }
}

export { PackageArtifactAuthority, verifySri, inspectTarArchive } from './artifact-authority.js';
export { VirtualNodeModulesFS } from './virtual-node-modules.js';
export { NodeResolver, NODE_BUILTINS } from './resolver.js';
export { CommonJsLoader } from './commonjs-loader.js';

export { FrozenInstallAuthority, PackageContentStore } from './frozen-install.js';
export { OpfsPackageContentStore } from './opfs-package-content-store.js';

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

export { BrowserEsmServiceWorkerBridge } from './browser-esm-edge.js';

export { createBrowserNodeCompatBridge } from './browser-node-compat.js';
