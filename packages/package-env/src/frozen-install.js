import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';
import { inspectTarArchive, verifySri } from './artifact-authority.js';

function cloneFiles(files) {
  const out = {};
  for (const [path, value] of Object.entries(files)) out[path] = value instanceof Uint8Array ? new Uint8Array(value) : value;
  return out;
}

const LIFECYCLE_EVENTS=Object.freeze(['preinstall','install','postinstall']);

function scriptGrantKey({location,event,command}){
  return String(location)+'\n'+String(event)+'\n'+String(command);
}

export class PackageScriptCapability {
  #grants;
  #execute;

  constructor({grants=[],execute}={}){
    assertOc(typeof execute==='function',ErrorCodes.INVALID_ARGUMENT,'Package script capability requires an explicit executor');
    assertOc(Array.isArray(grants)&&grants.length>0,ErrorCodes.INVALID_ARGUMENT,'Package script capability requires explicit grants');
    this.#grants=new Set();
    for(const grant of grants){
      assertOc(grant&&typeof grant.location==='string'&&grant.location.length>0,ErrorCodes.INVALID_ARGUMENT,'Package script grant location is required');
      assertOc(LIFECYCLE_EVENTS.includes(grant.event),ErrorCodes.INVALID_ARGUMENT,'Unsupported package lifecycle event',{event:grant.event});
      assertOc(typeof grant.command==='string'&&grant.command.length>0,ErrorCodes.INVALID_ARGUMENT,'Package script grant command is required');
      this.#grants.add(scriptGrantKey(grant));
    }
    this.#execute=execute;
  }

  authorizes({location,event,command}={}){
    return this.#grants.has(scriptGrantKey({location,event,command}));
  }

  async run({location,event,command,cwd}={}){
    assertOc(this.authorizes({location,event,command}),ErrorCodes.NETWORK_DENIED,'Package lifecycle script is not explicitly authorized',{
      location,event
    });
    const context=Object.freeze({
      location,
      event,
      command,
      cwd,
      env:Object.freeze({}),
      secretHandles:Object.freeze([]),
      networkSecretHandles:Object.freeze([])
    });
    const result=await this.#execute(context);
    const exitCode=typeof result==='number'?result:Number(result?.exitCode??0);
    assertOc(Number.isInteger(exitCode),ErrorCodes.INVALID_STATE,'Package lifecycle executor returned invalid exit code',{location,event});
    if(exitCode!==0){
      throw ocError(ErrorCodes.INVALID_STATE,'Authorized package lifecycle script failed',{location,event,exitCode});
    }
    return Object.freeze({
      location,event,command,cwd,exitCode,
      ambientEnvKeys:0,
      secretHandleCount:0
    });
  }
}

export class PackageContentStore {
  #contents = new Map();

  get size() { return this.#contents.size; }
  has(contentId) { return this.#contents.has(contentId); }

  async ingest({ contentId, integrity, bytes, expectedName = null, expectedVersion = null }) {
    assertOc(typeof contentId === 'string' && contentId.length > 0, ErrorCodes.INVALID_ARGUMENT, 'contentId is required');
    assertOc(bytes instanceof Uint8Array, ErrorCodes.INVALID_ARGUMENT, 'artifact bytes must be Uint8Array');
    await verifySri(bytes, integrity);

    const existing = this.#contents.get(contentId);
    if (existing) {
      if (existing.integrity !== integrity) throw ocError(ErrorCodes.ARTIFACT_INTEGRITY, 'Content identity reused with different integrity', { contentId });
      return Object.freeze({ contentId, reused: true, packageJson: existing.packageJson, fileCount: Object.keys(existing.files).length });
    }

    const archive = await inspectTarArchive(bytes, { requiredPrefix: 'package/' });
    const files = {};
    for (const entry of archive.entries) {
      if (entry.type !== 'file') continue;
      const relative = entry.path.slice('package/'.length);
      if (!relative) continue;
      files[relative] = new Uint8Array(entry.data);
    }

    assertOc(files['package.json'], ErrorCodes.INVALID_PACKAGE_CONFIG, 'Package artifact is missing package.json', { contentId });
    let packageJson;
    try {
      packageJson = JSON.parse(new TextDecoder().decode(files['package.json']));
    } catch {
      throw ocError(ErrorCodes.INVALID_PACKAGE_CONFIG, 'Package artifact has invalid package.json', { contentId });
    }

    if (expectedName && packageJson.name && packageJson.name !== expectedName) {
      throw ocError(ErrorCodes.INVALID_PACKAGE_CONFIG, 'Artifact package name disagrees with lockfile', { expected: expectedName, actual: packageJson.name });
    }
    if (expectedVersion && packageJson.version && packageJson.version !== expectedVersion) {
      throw ocError(ErrorCodes.INVALID_PACKAGE_CONFIG, 'Artifact package version disagrees with lockfile', { expected: expectedVersion, actual: packageJson.version });
    }

    const record = Object.freeze({
      contentId,
      integrity,
      packageJson: Object.freeze(structuredClone(packageJson)),
      files: Object.freeze(files),
      unpackedBytes: archive.totalBytes
    });
    this.#contents.set(contentId, record);
    return Object.freeze({ contentId, reused: false, packageJson: record.packageJson, fileCount: Object.keys(files).length });
  }

  get(contentId) {
    const record = this.#contents.get(contentId);
    if (!record) return null;
    return Object.freeze({
      contentId: record.contentId,
      integrity: record.integrity,
      packageJson: record.packageJson,
      files: cloneFiles(record.files),
      unpackedBytes: record.unpackedBytes
    });
  }
}

export class FrozenInstallAuthority {
  #packages;
  #store;
  #lifecycleScripts;
  #scriptCapability;
  #graphStore;
  #boundGraphGeneration = null;
  #boundPersistentGraphGeneration = null;
  #lastInstallFailed = false;

  constructor({ packages, contentStore = new PackageContentStore(), graphStore = null, lifecycleScripts = 'deny', scriptCapability = null } = {}) {
    assertOc(packages && typeof packages.mountCatalog === 'function', ErrorCodes.INVALID_ARGUMENT, 'PackageGraphAuthority is required');
    assertOc(['deny', 'skip', 'authorize'].includes(lifecycleScripts), ErrorCodes.INVALID_ARGUMENT, 'Unsupported lifecycle script policy', { lifecycleScripts });
    if(lifecycleScripts==='authorize'){
      assertOc(scriptCapability&&typeof scriptCapability.run==='function'&&typeof scriptCapability.authorizes==='function',ErrorCodes.INVALID_ARGUMENT,'Authorized lifecycle scripts require a PackageScriptCapability');
    }else{
      assertOc(scriptCapability===null,ErrorCodes.INVALID_ARGUMENT,'PackageScriptCapability is only valid with lifecycleScripts=authorize');
    }
    if(graphStore!==null){
      assertOc(
        typeof graphStore.read==='function'&&typeof graphStore.withGeneration==='function',
        ErrorCodes.INVALID_ARGUMENT,
        'Persistent package graph store must expose read() and withGeneration()'
      );
    }
    this.#packages = packages;
    this.#store = contentStore;
    this.#graphStore = graphStore;
    this.#lifecycleScripts = lifecycleScripts;
    this.#scriptCapability = scriptCapability;
  }

  get contentStore() { return this.#store; }
  get graphStore() { return this.#graphStore; }
  get boundGraphGeneration() { return this.#boundGraphGeneration; }
  get boundPersistentGraphGeneration() { return this.#boundPersistentGraphGeneration; }
  get lastInstallFailed() { return this.#lastInstallFailed; }

  #bindGraph(){
    const graph=this.#packages.graph;
    assertOc(graph,ErrorCodes.INVALID_STATE,'Compile a lockfile before installing artifacts');
    if(this.#boundGraphGeneration===null)this.#boundGraphGeneration=this.#packages.generation;
    this.#packages.assertGraphGeneration(this.#boundGraphGeneration);
    return graph;
  }

  #assertGraphCurrent(){
    assertOc(this.#boundGraphGeneration!==null,ErrorCodes.INVALID_STATE,'Package installer has no bound graph generation');
    return this.#packages.assertGraphGeneration(this.#boundGraphGeneration);
  }

  async #bindPersistentGraph(){
    if(!this.#graphStore)return null;
    const binding=this.#packages.persistentPublication;
    assertOc(
      binding&&binding.localGeneration===this.#boundGraphGeneration,
      ErrorCodes.INVALID_STATE,
      'Package installer requires the current graph to be persistently published before install',
      {
        graphGeneration:this.#boundGraphGeneration,
        publishedLocalGeneration:binding?.localGeneration??null,
        persistentGeneration:binding?.generation??null
      }
    );
    if(this.#boundPersistentGraphGeneration===null){
      this.#boundPersistentGraphGeneration=binding.generation;
    }
    assertOc(
      this.#boundPersistentGraphGeneration===binding.generation,
      ErrorCodes.STALE_GENERATION,
      'Package installer persistent graph binding changed',
      {
        expectedGeneration:this.#boundPersistentGraphGeneration,
        currentGeneration:binding.generation
      }
    );
    await this.#packages.assertPersistentGraphGeneration(this.#boundPersistentGraphGeneration);
    return this.#boundPersistentGraphGeneration;
  }

  async #assertPublicationCurrent(){
    this.#assertGraphCurrent();
    if(this.#graphStore){
      assertOc(
        this.#boundPersistentGraphGeneration!==null,
        ErrorCodes.INVALID_STATE,
        'Package installer has no persistent graph binding'
      );
      await this.#packages.assertPersistentGraphGeneration(this.#boundPersistentGraphGeneration);
    }
    return true;
  }

  async #runAuthorizedLifecycleScripts(graph,{locations=null}={}){
    if(this.#lifecycleScripts!=='authorize')return Object.freeze([]);
    const selected=locations?new Set(locations):null;
    const receipts=[];
    for(const node of graph.nodes){
      if(selected&&!selected.has(node.location))continue;
      if(node.link||!node.hasInstallScript)continue;
      const content=this.#store.get(node.contentId);
      assertOc(content,ErrorCodes.PACKAGE_CONTENT_MISSING,'Lifecycle script package content is missing',{
        location:node.location,contentId:node.contentId
      });
      const scripts=content.packageJson?.scripts??{};
      const recognized=LIFECYCLE_EVENTS.filter(event=>typeof scripts[event]==='string'&&scripts[event].length>0);
      assertOc(recognized.length>0,ErrorCodes.INVALID_PACKAGE_CONFIG,'Lockfile marks install script but artifact exposes no supported lifecycle command',{
        location:node.location,name:node.name
      });
      for(const event of recognized){
        const command=scripts[event];
        assertOc(this.#scriptCapability.authorizes({location:node.location,event,command}),ErrorCodes.NETWORK_DENIED,'Package lifecycle script lacks an exact capability grant',{
          location:node.location,event
        });
        receipts.push(await this.#scriptCapability.run({
          location:node.location,
          event,
          command,
          cwd:'/workspace/'+node.location
        }));
      }
    }
    return Object.freeze(receipts);
  }

  async installAll({
    artifactAuthority,
    concurrency = 4,
    signal = null,
    onProgress = null,
    locations = null,
    artifactUrlResolver = null,
    secretHandles = null
  } = {}) {
    assertOc(
      secretHandles == null || (Array.isArray(secretHandles) && secretHandles.length === 0),
      ErrorCodes.NETWORK_DENIED,
      'Package installation does not accept network secret handles in the promoted profile'
    );
    const graph = this.#bindGraph();
    // Publication is fail-closed from the first moment of a new attempt,
    // including persistent-graph binding, preflight, hydration and policy
    // validation. Only a complete successful rerun clears it.
    this.#lastInstallFailed = true;
    await this.#bindPersistentGraph();
    assertOc(artifactAuthority && typeof artifactAuthority.fetchArtifact === 'function', ErrorCodes.INVALID_ARGUMENT, 'PackageArtifactAuthority is required');

    const selected = locations ? new Set(locations) : null;
    const unique = new Map();
    let packageInstances = 0;
    let embeddedInstances = 0;
    const lifecycleScriptsSkipped = [];
    for (const node of graph.nodes) {
      if (selected && !selected.has(node.location)) continue;
      if (node.link) continue;
      if (node.hasInstallScript) {
        if (this.#lifecycleScripts === 'deny') {
          throw ocError(ErrorCodes.INVALID_PACKAGE_CONFIG, 'Package lifecycle scripts are disabled by policy', { location: node.location, name: node.name });
        }
        if (this.#lifecycleScripts === 'skip') lifecycleScriptsSkipped.push(node.location);
      }
      if (node.inBundle) { embeddedInstances++; continue; }
      packageInstances++;
      assertOc(node.resolved, ErrorCodes.INVALID_PACKAGE_CONFIG, 'Frozen package is missing resolved artifact URL', { location: node.location });
      assertOc(node.integrity, ErrorCodes.ARTIFACT_INTEGRITY, 'Frozen package is missing integrity', { location: node.location });
      if (!this.#store.has(node.contentId) && typeof this.#store.hydrate === 'function') {
        await this.#store.hydrate({
          contentId: node.contentId,
          integrity: node.integrity,
          expectedName: node.name,
          expectedVersion: node.version && node.version !== '0.0.0-link' ? node.version : null
        });
      }
      if (!this.#store.has(node.contentId) && !unique.has(node.contentId)) unique.set(node.contentId, node);
    }

    const queue = [...unique.values()];
    const workerCount = Math.min(queue.length || 1, Math.max(1, Number(concurrency) || 1));
    let cursor = 0;
    let fetchedContents = 0;
    let bytes = 0;
    let redirects = 0;

    const assertNotAborted = () => {
      if (signal?.aborted) {
        throw ocError(ErrorCodes.INVALID_STATE, 'Frozen package installation aborted', {
          reason: signal.reason ? String(signal.reason) : undefined
        });
      }
    };

    const worker = async () => {
      while (true) {
        assertNotAborted();
        const index = cursor++;
        if (index >= queue.length) return;
        const node = queue[index];

        const artifactUrl = artifactUrlResolver ? await artifactUrlResolver(node) : node.resolved;
        assertOc(artifactUrl, ErrorCodes.INVALID_PACKAGE_CONFIG, 'Artifact URL resolver returned no URL', { location: node.location });
        const artifact = await artifactAuthority.fetchArtifact({
          url: artifactUrl,
          integrity: node.integrity,
          signal
        });
        assertNotAborted();
        await this.#assertPublicationCurrent();

        const receipt = await this.ingestLocation(node.location, artifact.bytes);
        await this.#assertPublicationCurrent();
        fetchedContents++;
        bytes += artifact.bytes.byteLength;
        redirects += artifact.redirects ?? 0;
        onProgress?.(Object.freeze({
          completed: fetchedContents,
          total: queue.length,
          location: node.location,
          contentId: node.contentId,
          bytes: artifact.bytes.byteLength,
          reused: receipt.reused
        }));
      }
    };

    try {
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      assertNotAborted();
      await this.#assertPublicationCurrent();
    } catch (error) {
      this.#lastInstallFailed = true;
      throw error;
    }
    let lifecycleScriptsExecuted;
    try{
      lifecycleScriptsExecuted=await this.#runAuthorizedLifecycleScripts(graph,{locations});
      await this.#assertPublicationCurrent();
    }catch(error){
      this.#lastInstallFailed=true;
      throw error;
    }
    this.#lastInstallFailed = false;
    return Object.freeze({
      packageInstances,
      embeddedInstances,
      requestedContents: queue.length,
      fetchedContents,
      contentCount: this.#store.size,
      bytes,
      redirects,
      lifecycleScriptsSkipped: Object.freeze([...lifecycleScriptsSkipped].sort()),
      lifecycleScriptsExecuted
    });
  }

  async ingestLocation(location, bytes) {
    const graph = this.#bindGraph();
    const node = graph.nodes.find((candidate) => candidate.location === location);
    assertOc(node, ErrorCodes.NOT_FOUND, 'Lockfile location not found', { location });
    assertOc(!node.link, ErrorCodes.INVALID_ARGUMENT, 'Linked workspace package does not accept an artifact', { location });
    assertOc(node.integrity, ErrorCodes.ARTIFACT_INTEGRITY, 'Frozen artifact requires lockfile integrity', { location });

    return this.#store.ingest({
      contentId: node.contentId,
      integrity: node.integrity,
      bytes,
      expectedName: node.name,
      expectedVersion: node.version && node.version !== '0.0.0-link' ? node.version : null
    });
  }

  #prepareMountCatalog(graph,locations){
    const selected = locations ? new Set(locations) : null;
    const packages = [];
    const symlinks = [];
    let embeddedCount = 0;
    const lifecycleScriptsSkipped = [];
    for (const node of graph.nodes) {
      if (selected && !selected.has(node.location)) continue;
      if (node.hasInstallScript) {
        if (this.#lifecycleScripts === 'deny') {
          throw ocError(ErrorCodes.INVALID_PACKAGE_CONFIG, 'Package lifecycle scripts are disabled by policy', { location: node.location, name: node.name });
        }
        if (this.#lifecycleScripts === 'skip') lifecycleScriptsSkipped.push(node.location);
      }
      if (node.inBundle) { embeddedCount++; continue; }
      if (node.link) {
        assertOc(typeof node.resolved === 'string' && node.resolved.length > 0, ErrorCodes.INVALID_PACKAGE_CONFIG, 'Linked package is missing resolved workspace path', { location: node.location });
        const target = node.resolved.startsWith('/') ? node.resolved : '/workspace/' + node.resolved.replace(/^\.\//, '');
        symlinks.push({ path: '/workspace/' + node.location, target });
        continue;
      }
      const content = this.#store.get(node.contentId);
      if (!content) throw ocError(ErrorCodes.PACKAGE_CONTENT_MISSING, 'Verified package content is missing', { location: node.location, contentId: node.contentId });
      packages.push({ location: node.location, packageJson: content.packageJson, files: content.files });
    }
    return Object.freeze({
      packages:Object.freeze(packages),
      symlinks:Object.freeze(symlinks),
      embeddedCount,
      lifecycleScriptsSkipped:Object.freeze([...lifecycleScriptsSkipped].sort())
    });
  }

  #publicationReceipt(mounted,catalog,publicationPrecondition){
    return Object.freeze({
      ...mounted,
      packageCount:catalog.packages.length,
      linkCount:catalog.symlinks.length,
      embeddedCount:catalog.embeddedCount,
      contentCount:this.#store.size,
      graphGeneration:this.#boundGraphGeneration,
      persistentGraphGeneration:this.#boundPersistentGraphGeneration,
      publicationPrecondition,
      lifecycleScriptsSkipped:catalog.lifecycleScriptsSkipped
    });
  }

  mountFrozenGraph({ locations = null } = {}) {
    const graph = this.#bindGraph();
    assertOc(
      this.#graphStore===null,
      ErrorCodes.INVALID_STATE,
      'Persistent package graph requires await mountFrozenGraphPersistent() so PackageFS publication is fenced by Web Locks'
    );
    assertOc(
      this.#lastInstallFailed===false,
      ErrorCodes.INVALID_STATE,
      'Failed or cancelled package install cannot publish PackageFS; rerun install successfully first',
      {graphGeneration:this.#boundGraphGeneration}
    );

    const catalog=this.#prepareMountCatalog(graph,locations);
    this.#assertGraphCurrent();
    const mounted = this.#packages.mountCatalog({
      packages:catalog.packages,
      symlinks:catalog.symlinks,
      expectedGraphGeneration:this.#boundGraphGeneration
    });
    return this.#publicationReceipt(mounted,catalog,'graph-generation-cas');
  }

  async mountFrozenGraphPersistent({locations=null}={}){
    const graph=this.#bindGraph();
    await this.#bindPersistentGraph();
    assertOc(
      this.#lastInstallFailed===false,
      ErrorCodes.INVALID_STATE,
      'Failed or cancelled package install cannot publish PackageFS; rerun install successfully first',
      {
        graphGeneration:this.#boundGraphGeneration,
        persistentGraphGeneration:this.#boundPersistentGraphGeneration
      }
    );

    const catalog=this.#prepareMountCatalog(graph,locations);
    await this.#assertPublicationCurrent();
    const mounted=await this.#packages.withPersistentGraphGeneration(
      this.#boundPersistentGraphGeneration,
      ()=>this.#packages.mountCatalog({
        packages:catalog.packages,
        symlinks:catalog.symlinks,
        expectedGraphGeneration:this.#boundGraphGeneration
      })
    );
    return this.#publicationReceipt(mounted,catalog,'persistent-graph-generation-cas');
  }

}
