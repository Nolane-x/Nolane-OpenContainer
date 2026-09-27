const SUPPORT_SECRET_KEYS=/(?:authorization|cookie|token|secret|password|api[-_]?key|credential|session[-_]?key)/i;
const SUPPORT_PRIVATE_KEYS=/^(?:body|source|sourceText|content|fileContents)$/i;
const SUPPORT_SECRET_VALUE=/\b(?:bearer\s+)?[A-Za-z0-9_\-]{20,}\b/gi;
const SUPPORT_SIGNED_QUERY=/([?&](?:token|access_token|api[-_]?key|signature|sig|x-amz-signature|x-goog-signature|credential)=)[^&#\s]+/gi;

function sanitizeOptIn(value,seen=new WeakSet()){
  if(typeof value==='string')return value.replace(SUPPORT_SIGNED_QUERY,'$1[REDACTED]').replace(SUPPORT_SECRET_VALUE,'[REDACTED]');
  if(value===null||typeof value!=='object')return value;
  if(seen.has(value))return '[Circular]';
  seen.add(value);
  if(Array.isArray(value))return value.map((item)=>sanitizeOptIn(item,seen));
  const out={};
  for(const [key,item] of Object.entries(value)){
    out[key]=(SUPPORT_SECRET_KEYS.test(key)||SUPPORT_PRIVATE_KEYS.test(key))?'[REDACTED]':sanitizeOptIn(item,seen);
  }
  return out;
}

const SUPPORT_TYPES=new Set([
  'runtime.state','process.spawn','process.error','process.exit',
  'worker.session','worker.timeout','worker.request','worker.response','worker.stale-response','worker.closed',
  'browser-worker.guest-diagnostic','browser-worker.error',
  'esm-edge.binary-response','esm-edge.fetch-failure',
  'preview-edge.response','preview-edge.failure',
  'workspace.recovery','release.migration','release.rollback','service-worker.update'
]);

function stableStringify(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(stableStringify).join(',')+']';
  const keys=Object.keys(value).sort();
  return '{'+keys.map((key)=>JSON.stringify(key)+':'+stableStringify(value[key])).join(',')+'}';
}

function stableFingerprint(value){
  let h1=0x811c9dc5,h2=0x9e3779b9;
  for(const byte of new TextEncoder().encode(stableStringify(value))){
    h1=Math.imul(h1^byte,0x01000193)>>>0;
    h2=Math.imul(h2^byte,0x85ebca6b)>>>0;
  }
  return 'ocfp-v1-'+h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}

function safeDiagnosticType(type){
  return SUPPORT_TYPES.has(type)?type:'[custom]';
}

function pick(value,keys){
  if(!value||typeof value!=='object')return null;
  const out={};
  for(const key of keys){
    const item=value[key];
    if(item!==undefined&&item!==null&&(typeof item==='string'||typeof item==='number'||typeof item==='boolean')){
      out[key]=item;
    }
  }
  return Object.freeze(out);
}

function lastOutcome(entries,type,keys){
  for(let index=entries.length-1;index>=0;index--){
    const entry=entries[index];
    if(entry.type!==type)continue;
    return pick(entry.detail,keys);
  }
  return null;
}

export function browserCapabilityProbe(scope=globalThis){
  const nav=scope?.navigator;
  return Object.freeze({
    environment:nav?'browser':'non-browser',
    crossOriginIsolated:scope?.crossOriginIsolated===true,
    sharedArrayBuffer:typeof scope?.SharedArrayBuffer==='function',
    worker:typeof scope?.Worker==='function',
    serviceWorker:!!nav?.serviceWorker,
    webAssembly:typeof scope?.WebAssembly==='object',
    opfs:typeof nav?.storage?.getDirectory==='function',
    storageEstimate:typeof nav?.storage?.estimate==='function',
    storagePersist:typeof nav?.storage?.persist==='function',
    webLocks:typeof nav?.locks?.request==='function',
    indexedDb:typeof scope?.indexedDB==='object',
    cacheStorage:typeof scope?.caches==='object'
  });
}

function normalizedBaseUrl(value){
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol))throw new TypeError('Deployment probe requires an http(s) URL');
  url.username='';
  url.password='';
  url.search='';
  url.hash='';
  if(!url.pathname.endsWith('/'))url.pathname+='/';
  return url;
}

function selectedHeaders(response,names){
  const out={};
  for(const name of names)out[name]=response.headers.get(name);
  return Object.freeze(out);
}

export async function probeDeploymentHeaders(baseUrl,{fetchImpl=globalThis.fetch}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('Deployment probe requires fetch()');
  const base=normalizedBaseUrl(baseUrl);
  const requests=[
    {
      path:'/',
      headers:['cross-origin-opener-policy','cross-origin-embedder-policy','cross-origin-resource-policy']
    },
    {
      path:'/opencontainer-guest-worker.mjs',
      headers:['content-security-policy','x-opencontainer-worker-profile']
    },
    {
      path:'/opencontainer-toolchain-worker.mjs',
      headers:['content-security-policy','x-opencontainer-worker-profile']
    },
    {
      path:'/opencontainer-sw.js',
      headers:['service-worker-allowed']
    }
  ];
  const receipts=[];
  for(const request of requests){
    try{
      const response=await fetchImpl(new URL(request.path,base),{cache:'no-store',redirect:'manual'});
      receipts.push(Object.freeze({
        path:request.path,
        status:response.status,
        ok:response.ok,
        headers:selectedHeaders(response,request.headers)
      }));
    }catch(error){
      receipts.push(Object.freeze({
        path:request.path,
        status:null,
        ok:false,
        error:Object.freeze({name:error?.name??'Error',code:error?.code??null})
      }));
    }
  }
  const root=receipts[0];
  const strict=receipts[1];
  const toolchain=receipts[2];
  const serviceWorker=receipts[3];
  const checks=Object.freeze({
    coop:root?.headers?.['cross-origin-opener-policy']==='same-origin',
    coep:root?.headers?.['cross-origin-embedder-policy']==='require-corp',
    corp:root?.headers?.['cross-origin-resource-policy']==='same-origin',
    strictWorker:strict?.headers?.['x-opencontainer-worker-profile']==='strict',
    strictWorkerNoUnsafeEval:!(strict?.headers?.['content-security-policy']??'').includes("'unsafe-eval'"),
    toolchainWorker:toolchain?.headers?.['x-opencontainer-worker-profile']==='toolchain',
    serviceWorkerScope:serviceWorker?.headers?.['service-worker-allowed']==='/'
  });
  return Object.freeze({
    schema:'opencontainer.deployment-header-diagnostics.v0.1',
    baseOrigin:base.origin,
    basePath:base.pathname,
    ok:Object.values(checks).every(Boolean)&&receipts.every((item)=>item.ok),
    checks,
    receipts:Object.freeze(receipts)
  });
}

export function supportPreview({
  includeAiContent=false,
  deploymentProbe=false,
  packageGraph=true,
  storage=true
}={}){
  return Object.freeze({
    schema:'opencontainer.support-bundle-preview.v0.1',
    categories:Object.freeze([
      Object.freeze({id:'profile',included:true}),
      Object.freeze({id:'runtime-status',included:true}),
      Object.freeze({id:'failure-fingerprint',included:true}),
      Object.freeze({id:'browser-capabilities',included:true}),
      Object.freeze({id:'diagnostic-summary',included:true,details:false}),
      Object.freeze({id:'package-identity',included:packageGraph,privateFileBytes:false}),
      Object.freeze({id:'storage-metadata',included:storage,privateFileBytes:false}),
      Object.freeze({id:'recovery-migration-update-outcomes',included:true}),
      Object.freeze({id:'deployment-headers',included:deploymentProbe,httpBodies:false}),
      Object.freeze({id:'ai-prompt-transcript',included:includeAiContent,defaultIncluded:false})
    ]),
    privacy:Object.freeze({
      workspaceContentsIncluded:false,
      privateSourceIncluded:false,
      diagnosticDetailsIncluded:false,
      httpBodiesIncluded:false,
      secretsIncluded:false,
      aiContentIncluded:includeAiContent
    })
  });
}

function packageIdentity(packages){
  const graph=packages?.graph;
  if(!graph)return Object.freeze({
    generation:packages?.generation??0,
    graphVersion:null,
    lockfileVersion:null,
    nodeCount:0,
    content:Object.freeze([])
  });
  const seen=new Map();
  for(const node of graph.nodes??[]){
    const key=node.contentId+'|'+String(node.integrity??'');
    if(!seen.has(key)){
      seen.set(key,Object.freeze({
        contentId:node.contentId,
        integrity:node.integrity??null
      }));
    }
  }
  return Object.freeze({
    generation:packages.generation,
    graphVersion:graph.version,
    lockfileVersion:graph.lockfileVersion,
    nodeCount:graph.nodes?.length??0,
    content:Object.freeze([...seen.values()].sort((a,b)=>String(a.contentId).localeCompare(String(b.contentId))))
  });
}

function storageIdentity({fs,workspacePersistence,packageContentStore}){
  return Object.freeze({
    workspaceGeneration:fs?.generation??null,
    workspaceCheckpointSequence:workspacePersistence?.current?.sequence??null,
    workspaceCheckpointGeneration:workspacePersistence?.current?.generation??null,
    workspaceCrossContextLocking:workspacePersistence?.crossContextLocking??null,
    packageHydratedCount:packageContentStore?.hydratedCount??null,
    packageCorruptCount:packageContentStore?.corruptCount??null,
    packageCrossContextLocking:packageContentStore?.crossContextLocking??null
  });
}

export function buildSupportBundle({
  profile,
  status,
  resources,
  process,
  diagnostics,
  packages,
  preview,
  fs,
  workspacePersistence=null,
  packageContentStore=null,
  error=null,
  includeAiContent=false,
  aiContent=null,
  deployment=null,
  capabilities=browserCapabilityProbe()
}={}){
  const entries=diagnostics?.list?.()??[];
  const diagnosticStats=diagnostics?.stats?.()??null;
  const packageSummary=packageIdentity(packages);
  const storageSummary=storageIdentity({fs,workspacePersistence,packageContentStore});
  const errorReceipt=error?Object.freeze({
    name:typeof error?.name==='string'?error.name:'Error',
    code:typeof error?.code==='string'?error.code:'OC_INTERNAL'
  }):null;
  const identity=Object.freeze({
    profileId:profile?.profileId??null,
    runtimeVersion:profile?.runtime?.version??null,
    protocolPackageVersion:profile?.protocol?.packageVersion??null,
    workerRpcEnvelopeVersion:profile?.protocol?.workerRpcEnvelopeVersion??null,
    snapshotFormatVersion:profile?.snapshot?.portableFormatVersion??null,
    serviceWorkerCompatibilityId:profile?.browser?.serviceWorkerCompatibilityId??null,
    runtimeState:status?.state??null,
    previewEpoch:preview?.epoch??0,
    workspaceGeneration:fs?.generation??null,
    packageGeneration:packages?.generation??0,
    workspaceCheckpointSequence:workspacePersistence?.current?.sequence??null,
    workspaceCheckpointGeneration:workspacePersistence?.current?.generation??null,
    errorCode:errorReceipt?.code??null
  });
  const outcomes=Object.freeze({
    recovery:lastOutcome(entries,'workspace.recovery',['status','sequence','generation']),
    migration:lastOutcome(entries,'release.migration',['status','fromVersion','toVersion','generation','sequence']),
    rollback:lastOutcome(entries,'release.rollback',['status','mode','runtimeStorageVersion','canonicalStorageVersion']),
    update:lastOutcome(entries,'service-worker.update',['status','compatibilityId','activation'])
  });
  const safeDiagnostics=Object.freeze(entries.map((entry)=>Object.freeze({
    seq:entry.seq,
    type:safeDiagnosticType(entry.type)
  })));
  const previewReceipt=supportPreview({
    includeAiContent,
    deploymentProbe:deployment!==null,
    packageGraph:true,
    storage:true
  });
  const bundle={
    schema:'opencontainer.support-bundle.v0.2',
    preview:previewReceipt,
    fingerprint:Object.freeze({
      schema:'opencontainer.failure-fingerprint.v0.1',
      id:stableFingerprint(identity),
      identity
    }),
    profile:Object.freeze({
      profileId:profile?.profileId??null,
      runtimeVersion:profile?.runtime?.version??null,
      productionClosed:profile?.productionClosed===true,
      filesystem:Object.freeze({
        logicalProfile:profile?.filesystem?.logicalProfile??null,
        snapshotSchemaVersion:profile?.filesystem?.snapshotSchemaVersion??null,
        opfsCheckpointProfile:profile?.filesystem?.opfsCheckpointProfile??null,
        opfsManifestVersion:profile?.filesystem?.opfsManifestVersion??null
      }),
      protocol:Object.freeze({
        packageVersion:profile?.protocol?.packageVersion??null,
        workerRpcEnvelopeVersion:profile?.protocol?.workerRpcEnvelopeVersion??null,
        syncRpcMailboxProfile:profile?.protocol?.syncRpcMailboxProfile??null
      }),
      browser:Object.freeze({
        referenceProfile:profile?.browser?.referenceProfile??null,
        serviceWorkerCompatibilityId:profile?.browser?.serviceWorkerCompatibilityId??null
      })
    }),
    status,
    resources:Object.freeze({
      limits:resources?.limits??null,
      usage:resources?.usage??null
    }),
    terminalBounds:process?.limits??null,
    browserCapabilities:capabilities,
    packageIdentity:packageSummary,
    storage:storageSummary,
    outcomes,
    error:errorReceipt,
    diagnostics:safeDiagnostics,
    diagnosticBounds:diagnosticStats,
    deployment,
    ai:includeAiContent?Object.freeze({included:true,content:sanitizeOptIn(aiContent)}):Object.freeze({included:false}),
    telemetry:Object.freeze({
      remoteAnalytics:false,
      crashUpload:false,
      networkEmission:false
    }),
    privacy:Object.freeze({
      workspaceContentsIncluded:false,
      privateSourceIncluded:false,
      diagnosticDetailsIncluded:false,
      httpBodiesIncluded:false,
      secretsIncluded:false,
      aiContentIncluded:includeAiContent
    })
  };
  return Object.freeze(bundle);
}
