const SECRET_KEYS = /(?:authorization|cookie|token|secret|password|api[-_]?key|private[-_]?key|prompt|transcript|(?:request|response)?[-_]?body|source(?:[-_]?code)?|file[-_]?contents|workspace[-_]?text)/i;
const SECRET_VALUE = /\b(?:bearer\s+)?[A-Za-z0-9_\-]{20,}\b/gi;
const SIGNED_QUERY_VALUE = /([?&](?:token|signature|sig|x-amz-signature|x-goog-signature|key|credential)=)[^&#\s]*/gi;
const encoder=new TextEncoder();

export const DiagnosticsPolicy=Object.freeze({
  schema:'opencontainer.diagnostics-policy.v0.1',
  budgets:Object.freeze({
    entries:1000,
    rawBytes:256*1024,
    duplicatePerFingerprint:25,
    duplicateFingerprints:512,
    terminalEntries:200,
    terminalBytes:64*1024
  }),
  telemetry:Object.freeze({
    remoteEnabledByDefault:false,
    builtInRemoteTransport:false,
    optInRequiresExplicitSink:true,
    eventPayload:'metadata-only'
  }),
  supportBundle:Object.freeze({
    workspaceContentsIncluded:false,
    privateSourceIncluded:false,
    httpBodiesIncluded:false,
    diagnosticDetailsIncluded:false,
    rawTerminalContentIncluded:false,
    aiContentIncludedByDefault:false,
    secretsIncluded:false
  })
});

function stableStringify(value){
  if(Array.isArray(value))return '['+value.map(stableStringify).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort().map((key)=>JSON.stringify(key)+':'+stableStringify(value[key])).join(',')+'}';
  }
  return JSON.stringify(value);
}

function fnv64(value){
  let h1=0x811c9dc5,h2=0x9e3779b9;
  for(const byte of encoder.encode(value)){
    h1=Math.imul(h1^byte,0x01000193)>>>0;
    h2=Math.imul(h2^byte,0x85ebca6b)>>>0;
  }
  return h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}

function byteLength(value){
  return encoder.encode(typeof value==='string'?value:stableStringify(value)).byteLength;
}

function freezeArray(values){return Object.freeze(values.map((value)=>Object.freeze(value)));}

const PUBLIC_DIAGNOSTIC_TYPE = /^(?:runtime|process|worker|browser-worker|esm-edge|preview-edge)\.[a-z0-9._-]+$/;
function publicDiagnosticType(value){
  const redacted=redact(String(value??'diagnostic.unknown'));
  return PUBLIC_DIAGNOSTIC_TYPE.test(redacted)?redacted:'[custom]';
}

export function redact(value, seen = new WeakSet()) {
  if (typeof value === 'string'){
    return value
      .replace(SIGNED_QUERY_VALUE,'$1[REDACTED]')
      .replace(SECRET_VALUE,'[REDACTED]');
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out = {};
  for (const [key,item] of Object.entries(value)) out[key] = SECRET_KEYS.test(key) ? '[REDACTED]' : redact(item, seen);
  return out;
}

export function diagnosticFingerprint(value){
  return 'ocfp:'+fnv64(stableStringify(redact(value)));
}

export function browserCapabilityProbe(scope=globalThis){
  const navigator=scope?.navigator??null;
  return Object.freeze({
    schema:'opencontainer.browser-capability-probe.v0.1',
    browser:typeof scope?.document!=='undefined',
    secureContext:scope?.isSecureContext===true,
    crossOriginIsolated:scope?.crossOriginIsolated===true,
    sharedArrayBuffer:typeof scope?.SharedArrayBuffer==='function',
    webAssembly:typeof scope?.WebAssembly==='object',
    worker:typeof scope?.Worker==='function',
    messageChannel:typeof scope?.MessageChannel==='function',
    serviceWorker:!!navigator?.serviceWorker,
    opfs:typeof navigator?.storage?.getDirectory==='function',
    storageEstimate:typeof navigator?.storage?.estimate==='function',
    webLocks:typeof navigator?.locks?.request==='function'
  });
}

export class DiagnosticJournal {
  #entries=[];
  #limit;
  #sequence=0;
  #rawBytesLimit;
  #rawBytes=0;
  #entryBytes=new Map();
  #duplicateLimit;
  #duplicateFingerprintLimit;
  #duplicateCounts=new Map();
  #duplicateSuppressed=0;
  #terminal=[];
  #terminalLimit;
  #terminalBytesLimit;
  #terminalBytes=0;
  #telemetryEnabled=false;
  #telemetrySink=null;
  #telemetryErrors=0;

  constructor({
    limit=DiagnosticsPolicy.budgets.entries,
    rawBytesLimit=DiagnosticsPolicy.budgets.rawBytes,
    duplicateLimit=DiagnosticsPolicy.budgets.duplicatePerFingerprint,
    duplicateFingerprintLimit=DiagnosticsPolicy.budgets.duplicateFingerprints,
    terminalHistoryLimit=DiagnosticsPolicy.budgets.terminalEntries,
    terminalBytesLimit=DiagnosticsPolicy.budgets.terminalBytes,
    telemetry=null
  }={}) {
    this.#limit=Math.max(1,Number(limit)||DiagnosticsPolicy.budgets.entries);
    this.#rawBytesLimit=Math.max(1024,Number(rawBytesLimit)||DiagnosticsPolicy.budgets.rawBytes);
    this.#duplicateLimit=Math.max(1,Number(duplicateLimit)||DiagnosticsPolicy.budgets.duplicatePerFingerprint);
    this.#duplicateFingerprintLimit=Math.max(8,Number(duplicateFingerprintLimit)||DiagnosticsPolicy.budgets.duplicateFingerprints);
    this.#terminalLimit=Math.max(1,Number(terminalHistoryLimit)||DiagnosticsPolicy.budgets.terminalEntries);
    this.#terminalBytesLimit=Math.max(1024,Number(terminalBytesLimit)||DiagnosticsPolicy.budgets.terminalBytes);
    if(telemetry?.enabled===true){
      if(typeof telemetry.sink!=='function')throw new TypeError('Opt-in telemetry requires an explicit sink function');
      this.#telemetryEnabled=true;
      this.#telemetrySink=telemetry.sink;
    }
  }

  get limits(){
    return Object.freeze({
      entries:this.#limit,
      rawBytes:this.#rawBytesLimit,
      duplicatePerFingerprint:this.#duplicateLimit,
      duplicateFingerprints:this.#duplicateFingerprintLimit,
      terminalEntries:this.#terminalLimit,
      terminalBytes:this.#terminalBytesLimit
    });
  }

  get usage(){
    return Object.freeze({
      entries:this.#entries.length,
      rawBytes:this.#rawBytes,
      duplicateFingerprints:this.#duplicateCounts.size,
      duplicateSuppressed:this.#duplicateSuppressed,
      terminalEntries:this.#terminal.length,
      terminalBytes:this.#terminalBytes
    });
  }

  get telemetry(){
    return Object.freeze({
      remoteEnabled:this.#telemetryEnabled,
      sinkConfigured:this.#telemetrySink!==null,
      deliveryErrors:this.#telemetryErrors
    });
  }

  record(type, detail={}) {
    const safeType=publicDiagnosticType(typeof type==='string'&&type.length?type:'diagnostic.unknown');
    const safeDetail=redact(detail);
    const fingerprint=diagnosticFingerprint({type:safeType,detail:safeDetail});
    const duplicateCount=this.#duplicateCounts.get(fingerprint)??0;
    if(duplicateCount===0&&!this.#duplicateCounts.has(fingerprint)&&this.#duplicateCounts.size>=this.#duplicateFingerprintLimit){
      const oldest=this.#duplicateCounts.keys().next().value;
      if(oldest!==undefined)this.#duplicateCounts.delete(oldest);
    }
    this.#duplicateCounts.set(fingerprint,duplicateCount+1);
    if(duplicateCount>=this.#duplicateLimit){
      this.#duplicateSuppressed++;
      return Object.freeze({suppressed:true,type:safeType,fingerprint,count:duplicateCount+1});
    }

    const entry=Object.freeze({seq:++this.#sequence,type:safeType,detail:safeDetail,fingerprint});
    const bytes=byteLength(entry);
    this.#entries.push(entry);
    this.#entryBytes.set(entry.seq,bytes);
    this.#rawBytes+=bytes;
    this.#trimEntries();

    if(this.#telemetryEnabled){
      try{
        const pending=this.#telemetrySink(Object.freeze({
          schema:'opencontainer.telemetry-event.v0.1',
          seq:entry.seq,
          type:publicDiagnosticType(entry.type),
          fingerprint:entry.fingerprint
        }));
        if(pending&&typeof pending.catch==='function')pending.catch(()=>{this.#telemetryErrors++;});
      }catch{
        this.#telemetryErrors++;
      }
    }
    return entry;
  }

  recordTerminal({pid=null,stream='stdout',byteLength:bytes=0}={}){
    const item=Object.freeze({
      seq:++this.#sequence,
      pid:Number.isInteger(pid)?pid:null,
      stream:stream==='stderr'?'stderr':'stdout',
      byteLength:Math.max(0,Number(bytes)||0)
    });
    const itemBytes=byteLength(item);
    this.#terminal.push(item);
    this.#terminalBytes+=itemBytes;
    while(this.#terminal.length>this.#terminalLimit||this.#terminalBytes>this.#terminalBytesLimit){
      const removed=this.#terminal.shift();
      this.#terminalBytes-=byteLength(removed);
    }
    return item;
  }

  list({since=0}={}) { return this.#entries.filter((entry)=>entry.seq>since); }
  terminalHistory({since=0}={}) { return this.#terminal.filter((entry)=>entry.seq>since); }

  summary(){
    return Object.freeze({
      limits:this.limits,
      usage:this.usage,
      telemetry:this.telemetry,
      latestSequence:this.#sequence
    });
  }

  clear() {
    this.#entries.length=0;
    this.#terminal.length=0;
    this.#entryBytes.clear();
    this.#duplicateCounts.clear();
    this.#rawBytes=0;
    this.#terminalBytes=0;
    this.#duplicateSuppressed=0;
  }

  #trimEntries(){
    while(this.#entries.length>this.#limit||this.#rawBytes>this.#rawBytesLimit){
      const removed=this.#entries.shift();
      const bytes=this.#entryBytes.get(removed.seq)??0;
      this.#entryBytes.delete(removed.seq);
      this.#rawBytes-=bytes;
    }
  }
}

function stablePublicIdentifier(key,value){
  if(typeof value!=='string')return null;
  if(key==='schema'&&/^opencontainer\.[a-z0-9._-]+\.v\d+$/i.test(value))return value;
  if(key==='profileId'&&/^opencontainer-[a-z0-9._:-]+$/i.test(value))return value;
  if(key==='compatibilityId'&&/^opencontainer-[a-z0-9._:-]+$/i.test(value))return value;
  if(key==='version'&&/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value))return value;
  if(key==='code'&&/^OC_[A-Z0-9_]+$/.test(value))return value;
  return null;
}

function safeOutcome(value){
  if(value===null||value===undefined)return null;
  const redacted=redact(value);
  if(!redacted||typeof redacted!=='object')return redacted;
  const allowed={};
  for(const key of ['schema','status','mode','strategy','sequence','generation','storageVersion','fromVersion','toVersion','version','profileId','compatibilityId','activation','ok','code','result']){
    if(!Object.hasOwn(value,key)&&!Object.hasOwn(redacted,key))continue;
    const stable=stablePublicIdentifier(key,value?.[key]);
    allowed[key]=stable??redacted[key];
  }
  return Object.freeze(allowed);
}

function safePackageIntegrity(value){
  if(value===null||value===undefined)return null;
  const text=String(value);
  if(/^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/.test(text))return text;
  return diagnosticFingerprint(text);
}

function packageIdentity(packages){
  const graph=packages?.graph;
  if(!graph)return Object.freeze({generation:packages?.generation??0,compiled:false});
  const nodes=graph.nodes.map((node)=>({
    name:node.name,
    version:node.version,
    location:node.location,
    contentId:node.contentId,
    integrity:node.integrity??null
  }));
  return Object.freeze({
    compiled:true,
    generation:packages.generation,
    lockfileVersion:graph.lockfileVersion,
    rootName:graph.rootName??null,
    rootVersion:graph.rootVersion??null,
    nodeCount:nodes.length,
    graphFingerprint:diagnosticFingerprint(nodes),
    components:freezeArray(nodes.map((node)=>({
      name:node.name,
      version:node.version,
      contentId:node.contentId,
      integrity:safePackageIntegrity(node.integrity)
    })))
  });
}

function storageIdentity(runtime){
  return Object.freeze({
    workspaceGeneration:runtime?.fs?.generation??null,
    workspaceCheckpoint:runtime?.workspacePersistence?Object.freeze({
      sequence:runtime.workspacePersistence.current?.sequence??null,
      generation:runtime.workspacePersistence.current?.generation??null,
      digest:runtime.workspacePersistence.current?.sha256??null,
      crossContextLocking:runtime.workspacePersistence.crossContextLocking===true
    }):null,
    packagePersistence:runtime?.packageContentStore?Object.freeze({
      hydratedCount:runtime.packageContentStore.hydratedCount??0,
      corruptCount:runtime.packageContentStore.corruptCount??0,
      crossContextLocking:runtime.packageContentStore.crossContextLocking===true
    }):null
  });
}

function profileIdentity(profile){
  return Object.freeze({
    profileId:profile.profileId,
    runtimeVersion:profile.runtime.version,
    nodeOracle:profile.oracle.node,
    npmOracle:profile.oracle.npm,
    snapshotFormatVersion:profile.snapshot.portableFormatVersion,
    snapshotSchemaVersion:profile.filesystem.snapshotSchemaVersion,
    opfsManifestVersion:profile.filesystem.opfsManifestVersion,
    workerRpcEnvelopeVersion:profile.protocol.workerRpcEnvelopeVersion,
    serviceWorkerCompatibilityId:profile.browser.serviceWorkerCompatibilityId,
    productionClosed:profile.productionClosed
  });
}

export class SupportBundleAuthority{
  #runtime;
  #profile;
  #browserScope;
  #lastOutcomes={recovery:null,migration:null,update:null};

  constructor({runtime,profile,browserScope=globalThis}={}){
    if(!runtime)throw new TypeError('SupportBundleAuthority requires runtime');
    if(!profile)throw new TypeError('SupportBundleAuthority requires production profile');
    this.#runtime=runtime;
    this.#profile=profile;
    this.#browserScope=browserScope;
  }

  recordOutcome(kind,outcome){
    if(!['recovery','migration','update'].includes(kind))throw new TypeError('Unsupported support outcome: '+kind);
    this.#lastOutcomes={...this.#lastOutcomes,[kind]:safeOutcome(outcome)};
    return this.#lastOutcomes[kind];
  }

  preview({
    error=null,
    hostingDiagnostics=null,
    includeAi=false,
    ai=null
  }={}){
    const categories=[
      'profile',
      'runtime-status',
      'resource-usage',
      'diagnostic-summary',
      'failure-fingerprint',
      'browser-capabilities',
      'deployment-headers',
      'package-graph-identity',
      'storage-generation',
      'recovery-migration-update'
    ];
    if(includeAi===true)categories.push('ai-content-redacted');
    return Object.freeze({
      schema:'opencontainer.support-bundle-preview.v0.1',
      categories:Object.freeze(categories),
      privacy:Object.freeze({
        ...DiagnosticsPolicy.supportBundle,
        aiContentIncluded:includeAi===true
      }),
      estimated:Object.freeze({
        diagnosticEntries:this.#runtime.diagnostics.list().length,
        terminalMetadataEntries:this.#runtime.diagnostics.terminalHistory().length,
        packageGraphCompiled:this.#runtime.packages.graph!==null,
        hostingDiagnosticsIncluded:hostingDiagnostics!==null,
        errorIncluded:error!==null,
        aiIncluded:includeAi===true&&ai!==null
      })
    });
  }

  build(error=null,{
    hostingDiagnostics=null,
    includeAi=false,
    ai=null
  }={}){
    const preview=this.preview({error,hostingDiagnostics,includeAi,ai});
    const errorReceipt=error?Object.freeze({
      name:typeof error?.name==='string'?error.name:'Error',
      code:typeof error?.code==='string'?error.code:'OC_INTERNAL'
    }):null;
    const diagSummary=this.#runtime.diagnostics.summary();
    const fingerprintBasis=Object.freeze({
      code:errorReceipt?.code??null,
      profileId:this.#profile.profileId,
      runtimeVersion:this.#profile.runtime.version,
      workerRpcEnvelopeVersion:this.#profile.protocol.workerRpcEnvelopeVersion,
      snapshotFormatVersion:this.#profile.snapshot.portableFormatVersion,
      serviceWorkerCompatibilityId:this.#profile.browser.serviceWorkerCompatibilityId,
      state:this.#runtime.state,
      previewEpoch:this.#runtime.preview?.epoch??null,
      workspaceGeneration:this.#runtime.fs.generation,
      packageGeneration:this.#runtime.packages.generation,
      workspaceSequence:this.#runtime.workspacePersistence?.current?.sequence??null,
      persistedWorkspaceGeneration:this.#runtime.workspacePersistence?.current?.generation??null
    });
    const failureFingerprint=diagnosticFingerprint({
      basis:fingerprintBasis,
      diagnostics:this.#runtime.diagnostics.list().map((entry)=>({type:publicDiagnosticType(entry.type),fingerprint:entry.fingerprint}))
    });
    const diagnostics=freezeArray(this.#runtime.diagnostics.list().map((entry)=>({
      seq:entry.seq,
      type:publicDiagnosticType(entry.type),
      fingerprint:entry.fingerprint
    })));
    const hosting=hostingDiagnostics?Object.freeze({
      schema:hostingDiagnostics.schema??null,
      ok:hostingDiagnostics.ok===true,
      profileId:hostingDiagnostics.profileId??null,
      failures:freezeArray((hostingDiagnostics.failures??[]).map((failure)=>redact(failure))),
      receipts:freezeArray((hostingDiagnostics.receipts??[]).map((receipt)=>redact(receipt)))
    }):null;

    return Object.freeze({
      schema:'opencontainer.support-bundle.v0.2',
      preview,
      fingerprint:failureFingerprint,
      fingerprintBasis,
      profile:profileIdentity(this.#profile),
      status:this.#runtime.status(),
      resources:Object.freeze({
        limits:this.#runtime.resources.limits,
        usage:this.#runtime.resources.usage
      }),
      diagnostics:Object.freeze({
        summary:diagSummary,
        events:diagnostics,
        terminalMetadata:Object.freeze(this.#runtime.diagnostics.terminalHistory())
      }),
      browser:browserCapabilityProbe(this.#browserScope),
      hosting,
      packages:packageIdentity(this.#runtime.packages),
      storage:storageIdentity(this.#runtime),
      outcomes:Object.freeze({...this.#lastOutcomes}),
      error:errorReceipt,
      ai:includeAi===true?redact(ai??null):null,
      telemetry:this.#runtime.diagnostics.telemetry,
      privacy:preview.privacy
    });
  }
}
