import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

const encoder=new TextEncoder();
const SENSITIVE_REQUEST_HEADER=/^(?:authorization|proxy-authorization|cookie)$/i;
const PROFILE_RANK=Object.freeze({
  'offline':0,
  'registry-only':1,
  'restricted':2,
  'open-web':3
});
const DEFAULT_OPEN_WEB_METHODS=Object.freeze(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);

export const NetworkProfiles=Object.freeze({
  OFFLINE:'offline',
  REGISTRY_ONLY:'registry-only',
  RESTRICTED:'restricted',
  OPEN_WEB:'open-web'
});

export const BrokerSsrfRequirements=Object.freeze({
  schema:'opencontainer.broker-ssrf-requirements.v1.0',
  implementedInCore:false,
  rules:Object.freeze([
    'broker mode is a separate trusted service and is never implied by direct-browser networking',
    'no arbitrary URL fetch proxy is permitted',
    'resolve DNS and re-check every resolved address before connect',
    'deny loopback, link-local, private, metadata and platform-internal destinations unless an explicit reviewed policy allows them',
    're-authorize every redirect hop after DNS/address re-evaluation',
    'apply method, path, response-byte, timeout and concurrency budgets',
    'strip caller-supplied Authorization/Cookie credentials and inject only authority-bound secret material'
  ])
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
  for(const byte of encoder.encode(String(value))){
    h1=Math.imul(h1^byte,0x01000193)>>>0;
    h2=Math.imul(h2^byte,0x85ebca6b)>>>0;
  }
  return h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}

function normalizedHost(hostname){
  return String(hostname??'').toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
}

function ipv4Parts(host){
  if(!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))return null;
  const parts=host.split('.').map(Number);
  return parts.every((value)=>value>=0&&value<=255)?parts:null;
}

export function isLocalNetworkHost(hostname){
  const host=normalizedHost(hostname);
  if(host==='localhost'||host.endsWith('.localhost')||host==='::1')return true;
  if(host.startsWith('fc')||host.startsWith('fd')||host.startsWith('fe80:'))return true;
  const v4=ipv4Parts(host);
  if(!v4)return false;
  const [a,b]=v4;
  return a===127||a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===169&&b===254);
}

function rawAuthority(value){
  const match=String(value).match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/);
  return match?.[1]??'';
}

export function canonicalizeExternalUrl(value){
  assertOc(typeof value==='string'&&value.length>0,ErrorCodes.INVALID_ARGUMENT,'Network URL must be a non-empty string');
  if(value!==value.trim()||/[\u0000-\u001f\u007f]/.test(value)||value.includes('\\')){
    throw ocError(ErrorCodes.NETWORK_DENIED,'Ambiguous network URL rejected',{reason:'ambiguous-url'});
  }
  const authority=rawAuthority(value);
  const authorityHost=authority.slice(authority.lastIndexOf('@')+1);
  if(authorityHost.includes('%')){
    throw ocError(ErrorCodes.NETWORK_DENIED,'Encoded host syntax is not accepted by network policy',{reason:'encoded-host'});
  }
  let parsed;
  try{parsed=new URL(value);}catch{
    throw ocError(ErrorCodes.NETWORK_DENIED,'Invalid network URL',{reason:'invalid-url'});
  }
  if(!['http:','https:'].includes(parsed.protocol)){
    throw ocError(ErrorCodes.NETWORK_DENIED,'Only http(s) external networking is allowed',{protocol:parsed.protocol});
  }
  if(parsed.username||parsed.password){
    throw ocError(ErrorCodes.NETWORK_DENIED,'URL credentials are forbidden; use an opaque secret handle',{reason:'url-credentials'});
  }
  return parsed;
}

function normalizeMethod(value){
  const method=String(value??'GET').toUpperCase();
  assertOc(/^[A-Z]+$/.test(method),ErrorCodes.INVALID_ARGUMENT,'Invalid HTTP method',{method});
  return method;
}

function normalizePathPrefix(value){
  const path=String(value??'/');
  assertOc(path.startsWith('/')&&!path.includes('\\')&&!path.includes('\0'),ErrorCodes.INVALID_ARGUMENT,'Invalid network path prefix',{path});
  return path;
}

function pathMatches(path,prefix){
  if(prefix==='/')return true;
  if(prefix.endsWith('/'))return path.startsWith(prefix);
  return path===prefix||path.startsWith(prefix+'/');
}

function abortError(signal){
  if(signal?.reason instanceof Error)return signal.reason;
  return new DOMException('The operation was aborted','AbortError');
}

async function readBoundedBody(response,{limit,signal,skipBody=false}){
  if(skipBody||!response?.body)return new Uint8Array();
  const reader=response.body.getReader?.();
  if(!reader){
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.byteLength>limit)throw ocError(ErrorCodes.OUTPUT_LIMIT,'Network response exceeds decoded-byte budget',{bytes:bytes.byteLength,limit});
    return bytes;
  }
  let aborted=false;
  const chunks=[];
  let total=0;
  const onAbort=()=>{
    aborted=true;
    void reader.cancel(signal?.reason).catch(()=>{});
  };
  signal?.addEventListener?.('abort',onAbort,{once:true});
  try{
    while(true){
      if(aborted||signal?.aborted)throw abortError(signal);
      const {value,done}=await reader.read();
      if(aborted||signal?.aborted)throw abortError(signal);
      if(done)break;
      const chunk=value instanceof Uint8Array?value:new Uint8Array(value);
      total+=chunk.byteLength;
      if(total>limit){
        await reader.cancel('decoded-byte-budget').catch(()=>{});
        throw ocError(ErrorCodes.OUTPUT_LIMIT,'Network response exceeds decoded-byte budget',{bytes:total,limit});
      }
      chunks.push(chunk);
    }
  }finally{
    signal?.removeEventListener?.('abort',onAbort);
  }
  const out=new Uint8Array(total);
  let offset=0;
  for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}
  return out;
}

function responseMayHaveBody(method,status){
  return method!=='HEAD'&&![101,103,204,205,304].includes(status);
}

function redactPolicyRule(rule){
  return Object.freeze({
    origin:rule.origin,
    methods:Object.freeze([...rule.methods].sort()),
    paths:rule.paths?Object.freeze([...rule.paths]):null,
    class:rule.class
  });
}

function freezeScopeSummary(scope){
  return Object.freeze({
    schemes:Object.freeze([...scope.schemes]),
    hosts:Object.freeze([...scope.hosts]),
    methods:Object.freeze([...scope.methods]),
    paths:Object.freeze([...scope.paths]),
    session:scope.session,
    process:scope.process,
    task:scope.task,
    expiresAt:scope.expiresAt
  });
}

export class NetworkAuthority {
  #rules=[];
  #allowLocal=false;
  #profile=NetworkProfiles.RESTRICTED;
  #policyVersion='opencontainer-network-policy-v1';
  #openWebMethods=new Set(DEFAULT_OPEN_WEB_METHODS);
  #fetch;
  #maxResponseBytes=8*1024*1024;
  #maxRedirects=5;
  #secrets=new Map();
  #secretSequence=0;

  constructor({
    allowLocal=false,
    profile=NetworkProfiles.RESTRICTED,
    policyVersion='opencontainer-network-policy-v1',
    openWebMethods=DEFAULT_OPEN_WEB_METHODS,
    fetchImpl=globalThis.fetch,
    maxResponseBytes=8*1024*1024,
    maxRedirects=5
  }={}){
    assertOc(Object.hasOwn(PROFILE_RANK,profile),ErrorCodes.INVALID_ARGUMENT,'Unknown network profile',{profile});
    assertOc(typeof fetchImpl==='function',ErrorCodes.INVALID_ARGUMENT,'Network fetch implementation is required');
    this.#allowLocal=allowLocal===true;
    this.#profile=profile;
    this.#policyVersion=String(policyVersion);
    this.#openWebMethods=new Set(openWebMethods.map(normalizeMethod));
    this.#fetch=(...args)=>Reflect.apply(fetchImpl,globalThis,args);
    this.#maxResponseBytes=Math.max(1,Number(maxResponseBytes)||8*1024*1024);
    this.#maxRedirects=Math.max(0,Number(maxRedirects)||0);
  }

  get profile(){return this.#profile;}
  get policyVersion(){return this.#policyVersion;}
  get allowLocal(){return this.#allowLocal;}

  get policyReceipt(){
    const rules=this.#rules.map(redactPolicyRule);
    const policy={
      schema:'opencontainer.network-policy-receipt.v1.0',
      version:this.#policyVersion,
      profile:this.#profile,
      allowLocal:this.#allowLocal,
      rules,
      maxResponseBytes:this.#maxResponseBytes,
      maxRedirects:this.#maxRedirects
    };
    return Object.freeze({...policy,hash:'ocnp:'+fnv64(stableStringify(policy))});
  }

  allow(rule){
    assertOc(rule&&typeof rule.origin==='string',ErrorCodes.INVALID_ARGUMENT,'Network rule origin is required');
    const parsed=canonicalizeExternalUrl(rule.origin);
    const origin=parsed.origin;
    const methods=new Set((rule.methods??['GET']).map(normalizeMethod));
    const paths=rule.paths?rule.paths.map(normalizePathPrefix):null;
    const classification=rule.class==='registry'?'registry':'restricted';
    this.#rules.push(Object.freeze({origin,methods,paths:paths?Object.freeze([...paths]):null,class:classification}));
    return this;
  }

  setProfile(next){
    assertOc(Object.hasOwn(PROFILE_RANK,next),ErrorCodes.INVALID_ARGUMENT,'Unknown network profile',{profile:next});
    if(PROFILE_RANK[next]>PROFILE_RANK[this.#profile]){
      throw ocError(ErrorCodes.NETWORK_DENIED,'Network profile upgrade requires a new authority',{from:this.#profile,to:next});
    }
    this.#profile=next;
    return this.policyReceipt;
  }

  authorize(url,{method='GET'}={}){
    const parsed=canonicalizeExternalUrl(String(url));
    const normalizedMethod=normalizeMethod(method);
    const policy=this.policyReceipt;
    const local=isLocalNetworkHost(parsed.hostname);
    if(local&&!this.#allowLocal){
      throw ocError(ErrorCodes.NETWORK_DENIED,'Local/private networking denied',{
        reason:'local-network-denied',
        url:parsed.href,
        method:normalizedMethod,
        profile:this.#profile,
        policyVersion:policy.version,
        policyHash:policy.hash
      });
    }

    let rule=null;
    if(this.#profile!==NetworkProfiles.OFFLINE){
      rule=this.#rules.find((candidate)=>
        candidate.origin===parsed.origin&&
        candidate.methods.has(normalizedMethod)&&
        (!candidate.paths||candidate.paths.some((prefix)=>pathMatches(parsed.pathname,prefix)))&&
        (this.#profile!==NetworkProfiles.REGISTRY_ONLY||candidate.class==='registry')
      )??null;
    }
    const openWeb=this.#profile===NetworkProfiles.OPEN_WEB&&!local&&this.#openWebMethods.has(normalizedMethod);
    if(!rule&&!openWeb){
      throw ocError(ErrorCodes.NETWORK_DENIED,'Network capability denied',{
        reason:this.#profile===NetworkProfiles.OFFLINE?'offline-profile':'capability-denied',
        url:parsed.href,
        method:normalizedMethod,
        profile:this.#profile,
        policyVersion:policy.version,
        policyHash:policy.hash
      });
    }
    return Object.freeze({
      schema:'opencontainer.network-decision.v1.0',
      allowed:true,
      url:parsed.href,
      origin:parsed.origin,
      method:normalizedMethod,
      localNetwork:local,
      ruleClass:rule?.class??'open-web',
      profile:this.#profile,
      policyVersion:policy.version,
      policyHash:policy.hash
    });
  }

  bindSecret({
    value,
    header='authorization',
    prefix='',
    scope={}
  }={}){
    assertOc(typeof value==='string'&&value.length>0,ErrorCodes.INVALID_ARGUMENT,'Secret plaintext is required');
    assertOc(typeof header==='string'&&/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header),ErrorCodes.INVALID_ARGUMENT,'Invalid secret injection header');
    const schemes=new Set((scope.schemes??['https:']).map((item)=>String(item).toLowerCase().replace(/:?$/,':')));
    const hosts=new Set((scope.hosts??[]).map(normalizedHost));
    const methods=new Set((scope.methods??['GET']).map(normalizeMethod));
    const paths=(scope.paths??['/']).map(normalizePathPrefix);
    const expiresAt=scope.expiresAt==null?null:Number(scope.expiresAt);
    const handle='ocsecret:'+String(++this.#secretSequence)+':'+(globalThis.crypto?.randomUUID?.()??fnv64(String(Date.now())+':'+this.#secretSequence));
    const record=Object.freeze({
      value,
      header:String(header).toLowerCase(),
      prefix:String(prefix),
      scope:Object.freeze({
        schemes:Object.freeze([...schemes]),
        hosts:Object.freeze([...hosts]),
        methods:Object.freeze([...methods]),
        paths:Object.freeze([...paths]),
        session:scope.session==null?null:String(scope.session),
        process:scope.process==null?null:String(scope.process),
        task:scope.task==null?null:String(scope.task),
        expiresAt:Number.isFinite(expiresAt)?expiresAt:null
      })
    });
    this.#secrets.set(handle,record);
    return Object.freeze({handle,scope:freezeScopeSummary(record.scope)});
  }

  revokeSecret(handle){
    return this.#secrets.delete(String(handle));
  }

  async fetch(url,{
    method='GET',
    headers={},
    body=undefined,
    signal=null,
    secretHandles=[],
    context={},
    maxResponseBytes=this.#maxResponseBytes,
    maxRedirects=this.#maxRedirects,
    mode='cors'
  }={}){
    const normalizedMethod=normalizeMethod(method);
    const baseHeaders=new Headers(headers);
    for(const name of baseHeaders.keys()){
      if(SENSITIVE_REQUEST_HEADER.test(name)){
        throw ocError(ErrorCodes.NETWORK_DENIED,'Sensitive request headers require opaque secret handles',{header:name});
      }
    }
    let current=String(url);
    let redirects=0;
    let response=null;
    let decision=null;
    while(true){
      decision=this.authorize(current,{method:normalizedMethod});
      const requestHeaders=new Headers(baseHeaders);
      this.#injectSecrets(requestHeaders,secretHandles,decision,{...context,redirectHop:redirects},redirects===0);
      response=await this.#fetch(decision.url,{
        method:normalizedMethod,
        headers:requestHeaders,
        body,
        signal,
        credentials:'omit',
        redirect:'manual',
        mode,
        cache:'no-store'
      });
      if(response?.type==='opaqueredirect'){
        throw ocError(ErrorCodes.NETWORK_DENIED,'Opaque redirect cannot be capability-authorized',{
          url:decision.url,
          profile:decision.profile,
          policyHash:decision.policyHash
        });
      }
      if([301,302,303,307,308].includes(response.status)){
        if(redirects>=maxRedirects){
          throw ocError(ErrorCodes.NETWORK_DENIED,'Network redirect limit exceeded',{redirects,limit:maxRedirects,policyHash:decision.policyHash});
        }
        const location=response.headers?.get?.('location');
        if(!location)throw ocError(ErrorCodes.NETWORK_DENIED,'Redirect is missing Location header',{status:response.status,policyHash:decision.policyHash});
        current=new URL(location,decision.url).href;
        redirects++;
        continue;
      }
      break;
    }

    if(response.type==='opaque'){
      const receipt=Object.freeze({
        schema:'opencontainer.network-fetch-receipt.v1.0',
        url:decision.url,
        status:0,
        responseType:'opaque',
        decodedBytes:null,
        redirects,
        profile:decision.profile,
        policyVersion:decision.policyVersion,
        policyHash:decision.policyHash,
        secretCount:secretHandles.length
      });
      return Object.freeze({response,receipt});
    }

    const limit=Math.max(1,Number(maxResponseBytes)||this.#maxResponseBytes);
    const bytes=await readBoundedBody(response,{
      limit,
      signal,
      skipBody:!responseMayHaveBody(normalizedMethod,response.status)
    });
    const responseBody=responseMayHaveBody(normalizedMethod,response.status)?bytes:null;
    const rebuilt=new Response(responseBody,{
      status:response.status,
      statusText:response.statusText,
      headers:response.headers
    });
    const receipt=Object.freeze({
      schema:'opencontainer.network-fetch-receipt.v1.0',
      url:decision.url,
      status:response.status,
      responseType:response.type||'basic',
      decodedBytes:bytes.byteLength,
      redirects,
      profile:decision.profile,
      policyVersion:decision.policyVersion,
      policyHash:decision.policyHash,
      secretCount:secretHandles.length
    });
    return Object.freeze({response:rebuilt,receipt});
  }

  #injectSecrets(headers,handles,decision,context,strict){
    for(const handle of handles??[]){
      const record=this.#secrets.get(String(handle));
      if(!record){
        if(strict)throw ocError(ErrorCodes.NETWORK_DENIED,'Unknown or revoked secret handle',{reason:'secret-handle-invalid'});
        continue;
      }
      if(!this.#secretMatches(record,decision,context)){
        if(strict)throw ocError(ErrorCodes.NETWORK_DENIED,'Secret handle scope denied',{reason:'secret-scope-denied'});
        continue;
      }
      headers.set(record.header,record.prefix+record.value);
    }
  }

  #secretMatches(record,decision,context){
    const parsed=new URL(decision.url);
    const scope=record.scope;
    if(scope.expiresAt!==null&&Date.now()>scope.expiresAt)return false;
    if(!scope.schemes.includes(parsed.protocol))return false;
    if(scope.hosts.length&&!scope.hosts.includes(normalizedHost(parsed.hostname)))return false;
    if(!scope.methods.includes(decision.method))return false;
    if(!scope.paths.some((prefix)=>pathMatches(parsed.pathname,prefix)))return false;
    if(scope.session!==null&&String(context.session??'')!==scope.session)return false;
    if(scope.process!==null&&String(context.process??'')!==scope.process)return false;
    if(scope.task!==null&&String(context.task??'')!==scope.task)return false;
    return true;
  }
}

export default NetworkAuthority;
