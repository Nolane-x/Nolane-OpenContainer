import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

const MANIFEST_A='release-manifest-a.json';
const MANIFEST_B='release-manifest-b.json';
const PAYLOAD_DIR='release-generations';
const encoder=new TextEncoder();

async function sha256Hex(text){
  const digest=await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(text));
  return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
}

async function readText(directory,name){
  try{
    const handle=await directory.getFileHandle(name);
    const file=await handle.getFile();
    return await file.text();
  }catch(error){
    if(error?.name==='NotFoundError')return null;
    throw error;
  }
}

async function writeText(directory,name,content){
  const handle=await directory.getFileHandle(name,{create:true});
  const writable=await handle.createWritable();
  try{
    await writable.write(content);
    await writable.close();
  }catch(error){
    try{await writable.abort?.();}catch{}
    throw error;
  }
}

function parseManifest(text,slot){
  if(!text)return null;
  try{
    const value=JSON.parse(text);
    if(
      value?.version!==1||
      !Number.isInteger(value.sequence)||
      !Number.isInteger(value.generation)||
      !Number.isInteger(value.storageVersion)||
      typeof value.payload!=='string'||
      typeof value.sha256!=='string'
    )return null;
    return Object.freeze({...value,slot});
  }catch{
    return null;
  }
}

function assertStorageVersion(value,label){
  assertOc(Number.isInteger(value)&&value>0,ErrorCodes.INVALID_ARGUMENT,label+' must be a positive integer',{value});
}

function sanitizeNamespacePart(value){
  return String(value??'unknown').replace(/[^0-9A-Za-z._-]+/g,'-');
}

export function releaseCacheNamespace({
  runtimeVersion,
  storageVersion,
  cacheSchemaVersion=1
}={}){
  assertStorageVersion(storageVersion,'Storage version');
  assertStorageVersion(cacheSchemaVersion,'Cache schema version');
  return 'opencontainer-derived-'+sanitizeNamespacePart(runtimeVersion)+'-storage-v'+storageVersion+'-cache-v'+cacheSchemaVersion;
}

export function assessReleaseStorageCompatibility({
  runtimeStorageVersion,
  canonicalStorageVersion,
  readableStorageVersions=[runtimeStorageVersion]
}={}){
  assertStorageVersion(runtimeStorageVersion,'Runtime storage version');
  assertStorageVersion(canonicalStorageVersion,'Canonical storage version');
  assertOc(Array.isArray(readableStorageVersions),ErrorCodes.INVALID_ARGUMENT,'readableStorageVersions must be an array');
  const readable=new Set(readableStorageVersions);
  if(runtimeStorageVersion===canonicalStorageVersion){
    return Object.freeze({
      mode:'read-write',
      runtimeStorageVersion,
      canonicalStorageVersion,
      destructiveDowngradeRequired:false
    });
  }
  if(runtimeStorageVersion<canonicalStorageVersion&&readable.has(canonicalStorageVersion)){
    return Object.freeze({
      mode:'read-only',
      runtimeStorageVersion,
      canonicalStorageVersion,
      destructiveDowngradeRequired:false,
      reason:'rolled-back runtime can read newer storage but is not allowed to write it'
    });
  }
  if(runtimeStorageVersion>canonicalStorageVersion&&readable.has(canonicalStorageVersion)){
    return Object.freeze({
      mode:'migration-required',
      runtimeStorageVersion,
      canonicalStorageVersion,
      destructiveDowngradeRequired:false,
      reason:'runtime is newer than canonical storage and must migrate before write'
    });
  }
  return Object.freeze({
    mode:'unsupported',
    runtimeStorageVersion,
    canonicalStorageVersion,
    destructiveDowngradeRequired:false,
    reason:'runtime cannot safely read canonical storage'
  });
}

export function applyReleaseStorageCompatibility(fs,receipt){
  assertOc(fs&&typeof fs.setReadOnly==='function',ErrorCodes.INVALID_ARGUMENT,'VFS with setReadOnly() is required');
  assertOc(receipt&&typeof receipt.mode==='string',ErrorCodes.INVALID_ARGUMENT,'Compatibility receipt is required');
  if(receipt.mode==='read-write'){
    return fs.setReadOnly(false);
  }
  if(receipt.mode==='read-only'){
    return fs.setReadOnly(true,'release-storage:'+receipt.canonicalStorageVersion+':runtime:'+receipt.runtimeStorageVersion);
  }
  throw ocError(ErrorCodes.STORAGE_MIGRATION_INVALID,'Release storage is not writable by this runtime',{
    mode:receipt.mode,
    runtimeStorageVersion:receipt.runtimeStorageVersion,
    canonicalStorageVersion:receipt.canonicalStorageVersion,
    destructiveDowngradeRequired:false
  });
}

export class OpfsReleaseStorageAuthority{
  #root;
  #directoryName;
  #directory=null;
  #payloads=null;
  #current=null;
  #lockManager;
  #lockName;
  #capacityProvider;
  #safetyReserveBytes;

  constructor({
    root,
    directoryName='opencontainer-release-storage',
    lockManager=globalThis.navigator?.locks??null,
    lockName=null,
    capacityProvider=null,
    safetyReserveBytes=64*1024
  }={}){
    assertOc(root&&typeof root.getDirectoryHandle==='function',ErrorCodes.INVALID_ARGUMENT,'OPFS root directory handle is required');
    if(lockManager!==null)assertOc(typeof lockManager?.request==='function',ErrorCodes.INVALID_ARGUMENT,'Release migration lock manager must expose request()');
    if(capacityProvider!==null)assertOc(typeof capacityProvider?.availableBytes==='function',ErrorCodes.INVALID_ARGUMENT,'capacityProvider must expose availableBytes()');
    assertOc(Number.isInteger(safetyReserveBytes)&&safetyReserveBytes>=0,ErrorCodes.INVALID_ARGUMENT,'safetyReserveBytes must be a non-negative integer');
    this.#root=root;
    this.#directoryName=directoryName;
    this.#lockManager=lockManager;
    this.#lockName=lockName??'opencontainer:release-storage:'+directoryName;
    this.#capacityProvider=capacityProvider;
    this.#safetyReserveBytes=safetyReserveBytes;
  }

  get current(){return this.#current;}
  get crossContextLocking(){return this.#lockManager!==null;}
  get lockName(){return this.#lockName;}

  async open(){
    this.#directory=await this.#root.getDirectoryHandle(this.#directoryName,{create:true});
    this.#payloads=await this.#directory.getDirectoryHandle(PAYLOAD_DIR,{create:true});
    this.#current=await this.#withLock(()=>this.#recoverUnlocked());
    return this;
  }

  async seed({
    storageVersion,
    runtimeVersion='seed',
    data,
    cacheSchemaVersion=1,
    minimumWriterStorageVersion=storageVersion
  }={}){
    this.#assertOpen();
    assertStorageVersion(storageVersion,'Storage version');
    assertStorageVersion(minimumWriterStorageVersion,'Minimum writer storage version');
    return this.#withLock(async()=>{
      await this.#recoverUnlocked();
      assertOc(!this.#current,ErrorCodes.INVALID_STATE,'Release storage is already initialized');
      const envelope={
        format:'opencontainer-release-storage',
        envelopeVersion:1,
        generation:1,
        storageVersion,
        minimumWriterStorageVersion,
        runtimeVersion:String(runtimeVersion),
        cacheNamespace:releaseCacheNamespace({runtimeVersion,storageVersion,cacheSchemaVersion}),
        data
      };
      return this.#publishEnvelopeUnlocked(envelope,{sequence:1,slot:'a'});
    });
  }

  async readCanonical(){
    this.#assertOpen();
    return this.#withLock(async()=>{
      const current=await this.#recoverUnlocked();
      if(!current)return null;
      return this.#readEnvelopeForManifest(current);
    });
  }

  async recoveryRoots(){
    this.#assertOpen();
    return this.#withLock(async()=>{
      const manifests=await this.#validManifestsUnlocked();
      const roots=[];
      for(const manifest of manifests){
        try{
          const envelope=await this.#readEnvelopeForManifest(manifest);
          roots.push(Object.freeze({
            slot:manifest.slot,
            sequence:manifest.sequence,
            generation:manifest.generation,
            storageVersion:manifest.storageVersion,
            payload:manifest.payload,
            valid:true,
            envelope
          }));
        }catch{
          roots.push(Object.freeze({
            slot:manifest.slot,
            sequence:manifest.sequence,
            generation:manifest.generation,
            storageVersion:manifest.storageVersion,
            payload:manifest.payload,
            valid:false
          }));
        }
      }
      return Object.freeze(roots);
    });
  }

  async dryRun({
    fromVersion,
    toVersion,
    runtimeVersion,
    cacheSchemaVersion=1,
    transform=(data)=>data,
    validate=()=>true
  }={}){
    this.#assertOpen();
    assertStorageVersion(fromVersion,'fromVersion');
    assertStorageVersion(toVersion,'toVersion');
    assertOc(toVersion===fromVersion+1,ErrorCodes.STORAGE_MIGRATION_INVALID,'Release storage migration must be adjacent',{fromVersion,toVersion});
    assertOc(typeof transform==='function',ErrorCodes.INVALID_ARGUMENT,'Migration transform must be a function');
    assertOc(typeof validate==='function',ErrorCodes.INVALID_ARGUMENT,'Migration validator must be a function');

    return this.#withLock(async()=>{
      const current=await this.#recoverUnlocked();
      assertOc(current,ErrorCodes.NOT_FOUND,'No canonical release storage exists');
      assertOc(current.storageVersion===fromVersion,ErrorCodes.STORAGE_MIGRATION_INVALID,'Canonical storage version does not match migration source',{
        expected:fromVersion,
        actual:current.storageVersion
      });
      const source=await this.#readEnvelopeForManifest(current);
      const transformed=await transform(structuredClone(source.data),Object.freeze({source}));
      const envelope={
        format:'opencontainer-release-storage',
        envelopeVersion:1,
        generation:source.generation+1,
        storageVersion:toVersion,
        minimumWriterStorageVersion:toVersion,
        runtimeVersion:String(runtimeVersion??source.runtimeVersion),
        cacheNamespace:releaseCacheNamespace({
          runtimeVersion:runtimeVersion??source.runtimeVersion,
          storageVersion:toVersion,
          cacheSchemaVersion
        }),
        data:transformed
      };
      assertOc(validate(envelope,source)!==false,ErrorCodes.STORAGE_MIGRATION_INVALID,'Migration candidate failed validation',{
        fromVersion,
        toVersion
      });
      const payloadText=JSON.stringify(envelope);
      const digest=await sha256Hex(payloadText);
      const sequence=current.sequence+1;
      const payload='release-generation-'+envelope.generation+'-v'+toVersion+'-'+digest.slice(0,16)+'.json';
      const slot=current.slot==='a'?'b':'a';
      const manifest={
        version:1,
        sequence,
        generation:envelope.generation,
        storageVersion:toVersion,
        payload,
        sha256:digest
      };
      const manifestText=JSON.stringify(manifest);
      const payloadBytes=encoder.encode(payloadText).byteLength;
      const manifestBytes=encoder.encode(manifestText).byteLength;
      const requiredBytes=payloadBytes+manifestBytes+this.#safetyReserveBytes;
      const availableBytes=await this.#availableBytes();
      const ok=availableBytes===Infinity||availableBytes>=requiredBytes;
      return Object.freeze({
        schema:'opencontainer.release-storage-dry-run.v0.1',
        ok,
        fromVersion,
        toVersion,
        sourceGeneration:source.generation,
        targetGeneration:envelope.generation,
        requiredBytes,
        availableBytes:Number.isFinite(availableBytes)?availableBytes:null,
        payloadBytes,
        manifestBytes,
        candidate:Object.freeze({envelope,payloadText,digest,manifest:Object.freeze({...manifest,slot}),manifestText}),
        derivedCache:Object.freeze({
          strategy:'lazy-rebuild',
          criticalOpenPath:false,
          migrateBytes:0,
          sourceNamespace:source.cacheNamespace,
          targetNamespace:envelope.cacheNamespace
        }),
        canonicalUnchanged:true
      });
    });
  }

  async migrate(options={}){
    this.#assertOpen();
    const crashAt=options.crashAt??null;
    const phases=['after-preflight','after-payload','after-verify','after-publish'];
    assertOc(crashAt===null||phases.includes(crashAt),ErrorCodes.INVALID_ARGUMENT,'Unknown migration crash phase',{crashAt,phases});
    return this.#withLock(async()=>{
      const plan=await this.#dryRunUnlocked(options);
      if(!plan.ok){
        throw ocError(ErrorCodes.RESOURCE_EXHAUSTED,'Release storage migration dry-run rejected capacity',{
          requiredBytes:plan.requiredBytes,
          availableBytes:plan.availableBytes,
          fromVersion:plan.fromVersion,
          toVersion:plan.toVersion
        });
      }
      this.#injectCrash(crashAt,'after-preflight',plan);
      const {candidate}=plan;
      await writeText(this.#payloads,candidate.manifest.payload,candidate.payloadText);
      this.#injectCrash(crashAt,'after-payload',plan);
      const stored=await readText(this.#payloads,candidate.manifest.payload);
      assertOc(stored!==null&&await sha256Hex(stored)===candidate.digest,ErrorCodes.STORAGE_MIGRATION_INVALID,'Migration candidate payload verification failed');
      const verified=JSON.parse(stored);
      assertOc(
        verified?.format==='opencontainer-release-storage'&&
        verified?.envelopeVersion===1&&
        verified?.generation===candidate.envelope.generation&&
        verified?.storageVersion===candidate.envelope.storageVersion,
        ErrorCodes.STORAGE_MIGRATION_INVALID,
        'Migration candidate envelope verification failed'
      );
      this.#injectCrash(crashAt,'after-verify',plan);
      const manifestName=candidate.manifest.slot==='a'?MANIFEST_A:MANIFEST_B;
      await writeText(this.#directory,manifestName,candidate.manifestText);
      this.#current=Object.freeze(candidate.manifest);
      this.#injectCrash(crashAt,'after-publish',plan);
      return Object.freeze({
        schema:'opencontainer.release-storage-migration.v0.1',
        fromVersion:plan.fromVersion,
        toVersion:plan.toVersion,
        generation:candidate.envelope.generation,
        sequence:candidate.manifest.sequence,
        slot:candidate.manifest.slot,
        payload:candidate.manifest.payload,
        derivedCache:plan.derivedCache,
        destructiveDowngrade:false,
        canonicalPublished:true
      });
    });
  }

  async compatibility({runtimeStorageVersion,readableStorageVersions=[runtimeStorageVersion]}={}){
    const canonical=await this.readCanonical();
    assertOc(canonical,ErrorCodes.NOT_FOUND,'No canonical release storage exists');
    return assessReleaseStorageCompatibility({
      runtimeStorageVersion,
      canonicalStorageVersion:canonical.storageVersion,
      readableStorageVersions
    });
  }

  async applyCompatibility(fs,options={}){
    const receipt=await this.compatibility(options);
    return Object.freeze({
      ...receipt,
      vfs:applyReleaseStorageCompatibility(fs,receipt)
    });
  }

  async rollbackPolicy({runtimeStorageVersion,readableStorageVersions=[runtimeStorageVersion]}={}){
    const receipt=await this.compatibility({runtimeStorageVersion,readableStorageVersions});
    return Object.freeze({
      schema:'opencontainer.release-storage-rollback.v0.1',
      strategy:receipt.mode==='read-only'?'reuse-newer-storage-read-only':
        receipt.mode==='read-write'?'reuse-compatible-storage':
        receipt.mode==='migration-required'?'upgrade-before-write':'refuse-open',
      mode:receipt.mode,
      destructiveStorageDowngrade:false,
      runtimeStorageVersion:receipt.runtimeStorageVersion,
      canonicalStorageVersion:receipt.canonicalStorageVersion,
      reason:receipt.reason??null
    });
  }

  async #dryRunUnlocked(options){
    const current=await this.#recoverUnlocked();
    assertOc(current,ErrorCodes.NOT_FOUND,'No canonical release storage exists');
    const fromVersion=options.fromVersion;
    const toVersion=options.toVersion;
    assertStorageVersion(fromVersion,'fromVersion');
    assertStorageVersion(toVersion,'toVersion');
    assertOc(toVersion===fromVersion+1,ErrorCodes.STORAGE_MIGRATION_INVALID,'Release storage migration must be adjacent',{fromVersion,toVersion});
    assertOc(current.storageVersion===fromVersion,ErrorCodes.STORAGE_MIGRATION_INVALID,'Canonical storage version does not match migration source',{
      expected:fromVersion,actual:current.storageVersion
    });
    const source=await this.#readEnvelopeForManifest(current);
    const transform=options.transform??((data)=>data);
    const validate=options.validate??(()=>true);
    assertOc(typeof transform==='function'&&typeof validate==='function',ErrorCodes.INVALID_ARGUMENT,'Migration transform/validator must be functions');
    const transformed=await transform(structuredClone(source.data),Object.freeze({source}));
    const envelope={
      format:'opencontainer-release-storage',
      envelopeVersion:1,
      generation:source.generation+1,
      storageVersion:toVersion,
      minimumWriterStorageVersion:toVersion,
      runtimeVersion:String(options.runtimeVersion??source.runtimeVersion),
      cacheNamespace:releaseCacheNamespace({
        runtimeVersion:options.runtimeVersion??source.runtimeVersion,
        storageVersion:toVersion,
        cacheSchemaVersion:options.cacheSchemaVersion??1
      }),
      data:transformed
    };
    assertOc(validate(envelope,source)!==false,ErrorCodes.STORAGE_MIGRATION_INVALID,'Migration candidate failed validation',{fromVersion,toVersion});
    const payloadText=JSON.stringify(envelope);
    const digest=await sha256Hex(payloadText);
    const sequence=current.sequence+1;
    const payload='release-generation-'+envelope.generation+'-v'+toVersion+'-'+digest.slice(0,16)+'.json';
    const slot=current.slot==='a'?'b':'a';
    const manifest={version:1,sequence,generation:envelope.generation,storageVersion:toVersion,payload,sha256:digest};
    const manifestText=JSON.stringify(manifest);
    const payloadBytes=encoder.encode(payloadText).byteLength;
    const manifestBytes=encoder.encode(manifestText).byteLength;
    const requiredBytes=payloadBytes+manifestBytes+this.#safetyReserveBytes;
    const availableBytes=await this.#availableBytes();
    return Object.freeze({
      schema:'opencontainer.release-storage-dry-run.v0.1',
      ok:availableBytes===Infinity||availableBytes>=requiredBytes,
      fromVersion,toVersion,
      sourceGeneration:source.generation,
      targetGeneration:envelope.generation,
      requiredBytes,
      availableBytes:Number.isFinite(availableBytes)?availableBytes:null,
      payloadBytes,manifestBytes,
      candidate:Object.freeze({envelope,payloadText,digest,manifest:Object.freeze({...manifest,slot}),manifestText}),
      derivedCache:Object.freeze({
        strategy:'lazy-rebuild',
        criticalOpenPath:false,
        migrateBytes:0,
        sourceNamespace:source.cacheNamespace,
        targetNamespace:envelope.cacheNamespace
      }),
      canonicalUnchanged:true
    });
  }

  async #publishEnvelopeUnlocked(envelope,{sequence,slot}){
    const payloadText=JSON.stringify(envelope);
    const digest=await sha256Hex(payloadText);
    const payload='release-generation-'+envelope.generation+'-v'+envelope.storageVersion+'-'+digest.slice(0,16)+'.json';
    const manifest={version:1,sequence,generation:envelope.generation,storageVersion:envelope.storageVersion,payload,sha256:digest};
    await writeText(this.#payloads,payload,payloadText);
    await writeText(this.#directory,slot==='a'?MANIFEST_A:MANIFEST_B,JSON.stringify(manifest));
    this.#current=Object.freeze({...manifest,slot});
    return this.#current;
  }

  async #validManifestsUnlocked(){
    return [
      parseManifest(await readText(this.#directory,MANIFEST_A),'a'),
      parseManifest(await readText(this.#directory,MANIFEST_B),'b')
    ].filter(Boolean).sort((a,b)=>b.sequence-a.sequence);
  }

  async #recoverUnlocked(){
    const manifests=await this.#validManifestsUnlocked();
    for(const manifest of manifests){
      try{
        await this.#readEnvelopeForManifest(manifest);
        this.#current=Object.freeze(manifest);
        return this.#current;
      }catch{}
    }
    this.#current=null;
    return null;
  }

  async #readEnvelopeForManifest(manifest){
    const text=await readText(this.#payloads,manifest.payload);
    assertOc(text!==null,ErrorCodes.STORAGE_MIGRATION_INVALID,'Release storage payload is missing',{payload:manifest.payload});
    assertOc(await sha256Hex(text)===manifest.sha256,ErrorCodes.STORAGE_MIGRATION_INVALID,'Release storage payload digest mismatch',{payload:manifest.payload});
    let envelope;
    try{envelope=JSON.parse(text);}catch(error){throw ocError(ErrorCodes.STORAGE_MIGRATION_INVALID,'Release storage payload is invalid JSON',{payload:manifest.payload,cause:error?.message??String(error)});}
    assertOc(
      envelope?.format==='opencontainer-release-storage'&&
      envelope?.envelopeVersion===1&&
      envelope?.generation===manifest.generation&&
      envelope?.storageVersion===manifest.storageVersion,
      ErrorCodes.STORAGE_MIGRATION_INVALID,
      'Release storage envelope does not match manifest',
      {payload:manifest.payload}
    );
    return Object.freeze(envelope);
  }

  async #availableBytes(){
    if(this.#capacityProvider)return this.#capacityProvider.availableBytes();
    const estimate=await globalThis.navigator?.storage?.estimate?.();
    if(estimate&&Number.isFinite(estimate.quota)&&Number.isFinite(estimate.usage)){
      return Math.max(0,estimate.quota-estimate.usage);
    }
    return Infinity;
  }

  #injectCrash(crashAt,phase,plan){
    if(crashAt!==phase)return;
    throw ocError(ErrorCodes.STORAGE_MIGRATION_INVALID,'Injected release storage migration crash',{
      phase,
      fromVersion:plan.fromVersion,
      toVersion:plan.toVersion
    });
  }

  async #withLock(callback){
    if(!this.#lockManager)return callback();
    return this.#lockManager.request(this.#lockName,{mode:'exclusive'},callback);
  }

  #assertOpen(){
    if(!this.#directory||!this.#payloads)throw ocError(ErrorCodes.INVALID_STATE,'Release storage authority is not open');
  }
}
