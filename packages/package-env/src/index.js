import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';
import { VirtualNodeModulesFS } from './virtual-node-modules.js';
import { NodeResolver } from './resolver.js';
import { CommonJsLoader } from './commonjs-loader.js';
import { FrozenInstallAuthority } from './frozen-install.js';
import { createCoreBuiltinRegistry } from './builtins/registry.js';
import { PackageCommandBridge } from './command-bridge.js';
import { NativeEsmPublicationAuthority } from './native-esm-publication.js';
import { createBrowserNodeCompatBridge } from './browser-node-compat.js';

const PACKAGE_GRAPH_ENCODER=new TextEncoder();

function stableId(prefix,value){
  let h1=0x811c9dc5,h2=0x9e3779b9;
  for(const byte of new TextEncoder().encode(value)){h1=Math.imul(h1^byte,0x01000193)>>>0;h2=Math.imul(h2^byte,0x85ebca6b)>>>0;}
  return prefix+':'+h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}
function packageNameFromPath(path){const marker='node_modules/';const index=path.lastIndexOf(marker);return index>=0?path.slice(index+marker.length):path;}
function frozenRecord(value={}){return Object.freeze({...value});}
function packageLocationDepth(location){
  return String(location).split('/node_modules/').length-1+(String(location).startsWith('node_modules/')?1:0);
}
function deriveLayoutIdentity(nodes,root={}){
  const directNames=new Set(Object.keys({
    ...(root.dependencies??{}),
    ...(root.devDependencies??{}),
    ...(root.optionalDependencies??{})
  }));
  const topLevel=[];
  const hoisted=[];
  const nested=[];
  const linked=[];
  let maxDepth=0;
  for(const node of nodes){
    const depth=packageLocationDepth(node.location);
    maxDepth=Math.max(maxDepth,depth);
    const isTopLevel=depth===1;
    if(isTopLevel)topLevel.push(node.location);
    else nested.push(node.location);
    if(isTopLevel&&!directNames.has(node.name))hoisted.push(node.location);
    if(node.link)linked.push(node.location);
  }
  const structuralRows=nodes.map(node=>[
    node.location,node.name,node.version,node.link===true?'link':'package'
  ].join('|')).sort();
  const kinds=[];
  if(topLevel.length)kinds.push('top-level');
  if(hoisted.length)kinds.push('hoisted-transitive');
  if(nested.length)kinds.push('nested');
  if(linked.length)kinds.push('linked');
  if(nodes.length>0&&nested.length===0)kinds.push('shallow');
  return Object.freeze({
    authority:'package-lock-physical-locations',
    kinds:Object.freeze(kinds),
    topLevelCount:topLevel.length,
    hoistedTransitiveCount:hoisted.length,
    nestedCount:nested.length,
    linkedCount:linked.length,
    maxNodeModulesDepth:maxDepth,
    topLevelLocations:Object.freeze(topLevel.sort()),
    hoistedTransitiveLocations:Object.freeze(hoisted.sort()),
    nestedLocations:Object.freeze(nested.sort()),
    linkedLocations:Object.freeze(linked.sort()),
    fingerprint:stableId('layout',structuralRows.join('\n'))
  });
}

function normalizeWorkspaceContext(value){
  assertOc(typeof value==='string'&&value.startsWith('/workspace'),ErrorCodes.INVALID_ARGUMENT,'Package command context must be inside /workspace',{value});
  const out=[];
  for(const part of value.slice('/workspace'.length).split('/')){
    if(!part||part==='.')continue;
    assertOc(part!=='..',ErrorCodes.INVALID_ARGUMENT,'Package command context cannot escape /workspace',{value});
    out.push(part);
  }
  return out.join('/');
}
function binScopePrefix(descriptor){
  const suffix='node_modules/'+descriptor.package;
  if(descriptor.location===suffix)return '';
  const marker='/'+suffix;
  if(descriptor.location.endsWith(marker))return descriptor.location.slice(0,-marker.length);
  const nested=descriptor.location.lastIndexOf('/node_modules/');
  if(nested>=0)return descriptor.location.slice(0,nested);
  return '';
}
function contextContainsScope(context,scope){
  return scope===''||context===scope||context.startsWith(scope+'/');
}
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
  #generation=0;#graph=null;#baseFs=null;#nodeModules=null;#resolver=null;#contentStore=null;#graphStore=null;#persistentPublication=null;#maxLockfileBytes;#maxGraphNodes;
  #catalogGeneration=0;#catalogPackageCount=0;#catalogSymlinkCount=0;#layoutWatchers=new Set();

  constructor({fs=null,contentStore=null,maxLockfileBytes=16*1024*1024,maxGraphNodes=100000}={}){
    this.#baseFs=fs;
    assertOc(Number.isFinite(Number(maxLockfileBytes))&&Number(maxLockfileBytes)>0,ErrorCodes.INVALID_ARGUMENT,'maxLockfileBytes must be positive');
    assertOc(Number.isInteger(Number(maxGraphNodes))&&Number(maxGraphNodes)>0,ErrorCodes.INVALID_ARGUMENT,'maxGraphNodes must be a positive integer');
    this.#maxLockfileBytes=Math.floor(Number(maxLockfileBytes));
    this.#maxGraphNodes=Math.floor(Number(maxGraphNodes));
    if(contentStore)this.setContentStore(contentStore);
  }
  get generation(){return this.#generation;}
  get graph(){return this.#graph;}
  get nodeModules(){return this.#nodeModules;}
  get resolver(){return this.#resolver;}
  get contentStore(){return this.#contentStore;}
  get graphStore(){return this.#graphStore;}
  get persistentPublication(){return this.#persistentPublication;}
  get catalogGeneration(){return this.#catalogGeneration;}

  #packageLayoutReceipt(reason){
    return Object.freeze({
      schema:'opencontainer.package-layout.v1.0',
      reason,
      graphGeneration:this.#generation,
      catalogGeneration:this.#catalogGeneration,
      mounted:this.#nodeModules!==null,
      packageCount:this.#catalogPackageCount,
      symlinkCount:this.#catalogSymlinkCount,
      layoutFingerprint:this.#graph?.layout?.fingerprint??null,
      nodeModulesGeneration:this.#nodeModules?.generation??null
    });
  }

  #emitPackageLayout(reason){
    const receipt=this.#packageLayoutReceipt(reason);
    for(const listener of [...this.#layoutWatchers]){
      try{listener(receipt);}catch{}
    }
    return receipt;
  }

  watchPackageLayout(listener,{emitInitial=false}={}){
    assertOc(typeof listener==='function',ErrorCodes.INVALID_ARGUMENT,'Package layout watcher must be a function');
    this.#layoutWatchers.add(listener);
    if(emitInitial){
      try{listener(this.#packageLayoutReceipt(this.#nodeModules?'current':'unmounted'));}catch{}
    }
    let active=true;
    return ()=>{
      if(!active)return false;
      active=false;
      return this.#layoutWatchers.delete(listener);
    };
  }

  setContentStore(contentStore){
    assertOc(
      contentStore&&typeof contentStore.has==='function'&&typeof contentStore.get==='function'&&typeof contentStore.ingest==='function',
      ErrorCodes.INVALID_ARGUMENT,
      'Package content store must expose has(), get(), and ingest()'
    );
    this.#contentStore=contentStore;
    return this;
  }

  setGraphStore(graphStore){
    assertOc(
      graphStore&&typeof graphStore.publish==='function'&&typeof graphStore.read==='function',
      ErrorCodes.INVALID_ARGUMENT,
      'Package graph store must expose publish() and read()'
    );
    this.#graphStore=graphStore;
    this.#persistentPublication=null;
    return this;
  }

  compile(lockfile,{expectedGeneration=null}={}){
    if(expectedGeneration!==null){
      assertOc(
        Number.isInteger(expectedGeneration)&&expectedGeneration>=0,
        ErrorCodes.INVALID_ARGUMENT,
        'expectedGeneration must be a non-negative integer',
        {expectedGeneration}
      );
      if(expectedGeneration!==this.#generation){
        throw ocError(ErrorCodes.STALE_GENERATION,'Package graph generation precondition failed',{
          expectedGeneration,
          currentGeneration:this.#generation
        });
      }
    }
    let doc;
    if(typeof lockfile==='string'){
      const bytes=PACKAGE_GRAPH_ENCODER.encode(lockfile).byteLength;
      assertOc(bytes<=this.#maxLockfileBytes,ErrorCodes.RESOURCE_EXHAUSTED,'Lockfile exceeds byte budget',{bytes,limit:this.#maxLockfileBytes});
      try{doc=JSON.parse(lockfile);}
      catch(error){throw Object.assign(ocError(ErrorCodes.INVALID_PACKAGE_CONFIG,'Lockfile JSON is invalid'),{cause:error});}
    }else{
      try{doc=structuredClone(lockfile);}
      catch(error){throw Object.assign(ocError(ErrorCodes.INVALID_PACKAGE_CONFIG,'Lockfile cannot be cloned'),{cause:error});}
    }
    assertOc(doc&&[2,3].includes(doc.lockfileVersion),ErrorCodes.INVALID_ARGUMENT,'Only package-lock v2/v3 is supported in Wave 1');
    const packageEntries=Object.entries(doc.packages??{});
    assertOc(packageEntries.length<=this.#maxGraphNodes,ErrorCodes.RESOURCE_EXHAUSTED,'Lockfile graph exceeds node budget',{nodes:packageEntries.length,limit:this.#maxGraphNodes});
    const nodes=[];const binCandidates={};
    for(const [location,meta] of packageEntries){
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
        hasInstallScript:!!meta.hasInstallScript,
        dev:!!meta.dev,optional:!!meta.optional
      }));
      if(meta.bin){
        const addBin=(command,path)=>{
          assertOc(typeof command==='string'&&command.length>0,ErrorCodes.INVALID_PACKAGE_CONFIG,'Package bin command must be non-empty',{location,name});
          assertOc(typeof path==='string'&&path.length>0,ErrorCodes.INVALID_PACKAGE_CONFIG,'Package bin target must be non-empty',{location,name,command});
          const descriptor=Object.freeze({command,package:name,path,location});
          (binCandidates[command]??=[]).push(descriptor);
        };
        if(typeof meta.bin==='string')addBin(name,meta.bin);
        else for(const [command,path] of Object.entries(meta.bin))addBin(command,path);
      }
    }
    nodes.sort((a,b)=>a.location.localeCompare(b.location));
    const bins={};
    for(const [command,candidates] of Object.entries(binCandidates)){
      bins[command]=Object.freeze([...candidates].sort((a,b)=>a.location.localeCompare(b.location)));
    }
    const root=doc.packages?.['']??{};
    const layout=deriveLayoutIdentity(nodes,root);
    this.#graph=Object.freeze({
      version:1,
      lockfileVersion:doc.lockfileVersion,
      nodes:Object.freeze(nodes),
      bins:Object.freeze(bins),
      layout,
      rootName:doc.name??root.name,
      rootVersion:doc.version??root.version,
      rootDependencies:frozenRecord(root.dependencies),
      rootDevDependencies:frozenRecord(root.devDependencies),
      rootOptionalDependencies:frozenRecord(root.optionalDependencies)
    });
    const hadCatalog=this.#nodeModules!==null;
    this.#nodeModules=null;this.#resolver=null;this.#persistentPublication=null;
    this.#catalogPackageCount=0;this.#catalogSymlinkCount=0;
    this.#generation++;
    if(hadCatalog){
      this.#catalogGeneration++;
      this.#emitPackageLayout('graph-invalidated');
    }
    return this.#graph;
  }

  async publishGraph({baseGeneration,mutationId=null}={}){
    assertOc(this.#graphStore,ErrorCodes.INVALID_STATE,'Persistent package graph store is not configured');
    assertOc(this.#graph,ErrorCodes.INVALID_STATE,'Compile a lockfile before publishing package graph');
    assertOc(
      Number.isInteger(baseGeneration)&&baseGeneration>=0,
      ErrorCodes.INVALID_ARGUMENT,
      'Persistent package graph baseGeneration must be a non-negative integer',
      {baseGeneration}
    );
    const localGeneration=this.#generation;
    const graph=this.#graph;
    const receipt=await this.#graphStore.publish({baseGeneration,graph,mutationId});
    this.assertGraphGeneration(localGeneration);
    assertOc(
      this.#graph===graph,
      ErrorCodes.STALE_GENERATION,
      'In-memory package graph changed while persistent graph publication was in flight',
      {expectedGeneration:localGeneration,currentGeneration:this.#generation}
    );
    this.#persistentPublication=Object.freeze({
      localGeneration,
      generation:receipt.generation,
      graphDigest:receipt.graphDigest,
      mutationId:receipt.mutationId??mutationId??null,
      reused:receipt.reused===true,
      crossContextLocking:receipt.crossContextLocking===true
    });
    return this.#persistentPublication;
  }

  async assertPersistentGraphGeneration(expectedGeneration){
    assertOc(this.#graphStore,ErrorCodes.INVALID_STATE,'Persistent package graph store is not configured');
    assertOc(
      Number.isInteger(expectedGeneration)&&expectedGeneration>=1,
      ErrorCodes.INVALID_ARGUMENT,
      'Expected persistent package graph generation must be a positive integer',
      {expectedGeneration}
    );
    const binding=this.#persistentPublication;
    assertOc(
      binding&&binding.localGeneration===this.#generation,
      ErrorCodes.INVALID_STATE,
      'Current in-memory package graph has not been published persistently',
      {localGeneration:this.#generation,publishedLocalGeneration:binding?.localGeneration??null}
    );
    const current=await this.#graphStore.read();
    const currentGeneration=current?.generation??0;
    if(
      currentGeneration!==expectedGeneration||
      current?.graphDigest!==binding.graphDigest
    ){
      throw ocError(ErrorCodes.STALE_GENERATION,'Persistent package graph changed before publication',{
        expectedGeneration,
        currentGeneration,
        expectedDigest:binding.graphDigest,
        currentDigest:current?.graphDigest??null
      });
    }
    return current;
  }

  async withPersistentGraphGeneration(expectedGeneration,callback){
    assertOc(this.#graphStore,ErrorCodes.INVALID_STATE,'Persistent package graph store is not configured');
    assertOc(typeof callback==='function',ErrorCodes.INVALID_ARGUMENT,'Persistent package graph callback is required');
    const binding=this.#persistentPublication;
    assertOc(
      binding&&binding.localGeneration===this.#generation&&binding.generation===expectedGeneration,
      ErrorCodes.INVALID_STATE,
      'Current package graph is not bound to the expected persistent publication',
      {
        expectedGeneration,
        localGeneration:this.#generation,
        binding:binding?{
          localGeneration:binding.localGeneration,
          generation:binding.generation,
          graphDigest:binding.graphDigest
        }:null
      }
    );
    return this.#graphStore.withGeneration(expectedGeneration,current=>{
      if(current?.graphDigest!==binding.graphDigest){
        throw ocError(ErrorCodes.STALE_GENERATION,'Persistent package graph digest changed before PackageFS publication',{
          expectedGeneration,
          currentGeneration:current?.generation??0,
          expectedDigest:binding.graphDigest,
          currentDigest:current?.graphDigest??null
        });
      }
      this.assertGraphGeneration(binding.localGeneration);
      return callback(current);
    });
  }

  assertGraphGeneration(expectedGeneration){
    assertOc(
      Number.isInteger(expectedGeneration)&&expectedGeneration>=0,
      ErrorCodes.INVALID_ARGUMENT,
      'expected package graph generation must be a non-negative integer',
      {expectedGeneration}
    );
    if(this.#generation!==expectedGeneration){
      throw ocError(ErrorCodes.STALE_GENERATION,'Package graph changed before publication',{
        expectedGeneration,
        currentGeneration:this.#generation
      });
    }
    assertOc(this.#graph,ErrorCodes.INVALID_STATE,'Package graph is not compiled');
    return this.#graph;
  }

  mountCatalog({packages=[],symlinks=[],expectedGraphGeneration=null}={}){
    assertOc(this.#baseFs,ErrorCodes.INVALID_STATE,'Package catalog requires a bound workspace VFS');
    if(expectedGraphGeneration!==null)this.assertGraphGeneration(expectedGraphGeneration);
    const reason=this.#nodeModules===null?'install':'reinstall';
    this.#nodeModules=new VirtualNodeModulesFS({baseFs:this.#baseFs,packages,symlinks});
    this.#resolver=new NodeResolver({fs:this.#nodeModules});
    this.#catalogPackageCount=packages.length;
    this.#catalogSymlinkCount=symlinks.length;
    this.#catalogGeneration++;
    const layout=this.#emitPackageLayout(reason);
    return Object.freeze({fs:this.#nodeModules,resolver:this.#resolver,layout});
  }

  unmountCatalog({expectedGraphGeneration=null}={}){
    if(expectedGraphGeneration!==null)this.assertGraphGeneration(expectedGraphGeneration);
    const hadCatalog=this.#nodeModules!==null;
    this.#nodeModules=null;
    this.#resolver=null;
    this.#catalogPackageCount=0;
    this.#catalogSymlinkCount=0;
    if(!hadCatalog)return this.#packageLayoutReceipt('already-unmounted');
    this.#catalogGeneration++;
    return this.#emitPackageLayout('remove');
  }

  resolve(specifier,issuer,options){
    assertOc(this.#resolver,ErrorCodes.INVALID_STATE,'Package catalog is not mounted');
    return this.#resolver.resolve(specifier,issuer,options);
  }

  resolveBin(command,{cwd='/workspace'}={}){
    assertOc(this.#graph,ErrorCodes.INVALID_STATE,'Compile a lockfile before resolving package commands');
    assertOc(typeof command==='string'&&command.length>0,ErrorCodes.INVALID_ARGUMENT,'Package command is required');
    const candidates=this.#graph.bins?.[command]??[];
    assertOc(candidates.length>0,ErrorCodes.NOT_FOUND,'Package command is absent from graph',{command});

    const logical=normalizeWorkspaceContext(cwd);
    const contexts=[logical];
    for(const node of this.#graph.nodes){
      if(!node.link||typeof node.resolved!=='string'||!node.resolved)continue;
      const target=node.resolved.startsWith('/')
        ? node.resolved.replace(/\/$/,'')
        : '/workspace/'+node.resolved.replace(/^\.\//,'').replace(/^\/+|\/+$/g,'');
      if(cwd===target||cwd.startsWith(target+'/')){
        const suffix=cwd.slice(target.length).replace(/^\//,'');
        contexts.push(node.location+(suffix?'/'+suffix:''));
      }
    }

    let bestDepth=-1;
    let best=[];
    for(const candidate of candidates){
      const scope=binScopePrefix(candidate);
      if(!contexts.some(context=>contextContainsScope(context,scope)))continue;
      const depth=scope?scope.split('/').length:0;
      if(depth>bestDepth){bestDepth=depth;best=[candidate];}
      else if(depth===bestDepth)best.push(candidate);
    }

    assertOc(best.length>0,ErrorCodes.NOT_FOUND,'Package command is not visible from context',{command,cwd});
    if(best.length!==1){
      throw ocError(ErrorCodes.INVALID_PACKAGE_CONFIG,'Package command is ambiguous in current graph context',{
        command,
        cwd,
        candidates:best.map(item=>({package:item.package,location:item.location,path:item.path}))
      });
    }
    return best[0];
  }

  selectDependencyClosure({roots=[],includeOptional=false,includeOptionalPeers=false,peerPolicy='require'}={}){
    assertOc(this.#graph,ErrorCodes.INVALID_STATE,'Compile a lockfile before selecting dependency closure');
    const rootNames=roots.length?[...roots]:Object.keys({...this.#graph.rootDependencies,...this.#graph.rootDevDependencies});
    const byLocation=new Map(this.#graph.nodes.map(node=>[node.location,node]));
    const queue=[];
    for(const name of rootNames){
      const location='node_modules/'+name;
      assertOc(byLocation.has(location),ErrorCodes.INVALID_PACKAGE_CONFIG,'Dependency root is absent from lockfile',{name,location});
      queue.push(location);
    }

    assertOc(['require','ignore'].includes(peerPolicy),ErrorCodes.INVALID_ARGUMENT,'Unsupported peer dependency policy',{peerPolicy});
    const selected=new Set();
    const optionalSkipped=new Set();
    const peersIncluded=new Set();
    const peerOptionalSkipped=new Set();
    const peerRequiredIgnored=new Set();
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
      for(const name of Object.keys(node.peerDependencies??{})){
        const optionalPeer=node.peerDependenciesMeta?.[name]?.optional===true;
        const target=dependencyLocation(byLocation,location,name);
        if(peerPolicy==='ignore'){
          if(optionalPeer)peerOptionalSkipped.add(location+' -> '+name);
          else peerRequiredIgnored.add(location+' -> '+name);
          continue;
        }
        if(!target){
          if(optionalPeer){peerOptionalSkipped.add(location+' -> '+name);continue;}
          assertOc(false,ErrorCodes.INVALID_PACKAGE_CONFIG,'Required peer dependency cannot be resolved',{issuer:location,dependency:name});
        }
        if(optionalPeer&&!includeOptionalPeers){peerOptionalSkipped.add(target);continue;}
        peersIncluded.add(location+' -> '+target);
        if(!selected.has(target))queue.push(target);
      }
    }

    return Object.freeze({
      roots:Object.freeze(rootNames),
      locations:Object.freeze([...selected].sort()),
      optionalSkipped:Object.freeze([...optionalSkipped].sort()),
      peersIncluded:Object.freeze([...peersIncluded].sort()),
      peerOptionalSkipped:Object.freeze([...peerOptionalSkipped].sort()),
      peerRequiredIgnored:Object.freeze([...peerRequiredIgnored].sort())
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
    const contentStore=options.contentStore??this.#contentStore;
    const graphStore=options.graphStore??this.#graphStore;
    return new FrozenInstallAuthority({
      packages:this,
      ...(contentStore?{contentStore}:{}),
      ...(graphStore?{graphStore}:{}),
      ...options
    });
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
export { OpfsPackageGraphStore } from './opfs-package-graph-store.js';

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
