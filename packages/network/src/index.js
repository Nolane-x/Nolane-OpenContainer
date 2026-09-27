import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

export const NETWORK_POLICY_VERSION='opencontainer-network-policy-v2';

export const NetworkProfiles=Object.freeze({
  OFFLINE:'offline',
  REGISTRY_ONLY:'registry-only',
  RESTRICTED:'restricted',
  OPEN_WEB:'open-web'
});

const PROFILE_SET=new Set(Object.values(NetworkProfiles));
const SECRET_REQUEST_HEADERS=new Set(['authorization','cookie','proxy-authorization']);
const FORBIDDEN_SECRET_HEADERS=new Set([
  'cookie','host','origin','referer','content-length','connection','proxy-authorization','proxy-authenticate'
]);
const REDIRECT_STATUSES=new Set([301,302,303,307,308]);

function stableValue(value){
  if(Array.isArray(value))return value.map(stableValue);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stableValue(value[key])]));
  }
  return value;
}

function policyHash(value){
  const text=JSON.stringify(stableValue(value));
  let hash=0x811c9dc5;
  for(let index=0;index<text.length;index++){
    hash^=text.charCodeAt(index);
    hash=Math.imul(hash,0x01000193)>>>0;
  }
  return 'ocnp:'+hash.toString(16).padStart(8,'0');
}

function normalizeMethod(value){
  const method=String(value??'GET').trim().toUpperCase();
  assertOc(/^[A-Z]+$/.test(method),ErrorCodes.INVALID_ARGUMENT,'Invalid network method',{method});
  return method;
}

function stripIpv6Brackets(value){
  return value.startsWith('[')&&value.endsWith(']')?value.slice(1,-1):value;
}

function ipv4Parts(host){
  const match=host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if(!match)return null;
  const parts=match.slice(1).map(Number);
  return parts.every((part)=>part>=0&&part<=255)?parts:null;
}

export function classifyNetworkHost(hostname){
  const host=stripIpv6Brackets(String(hostname??'').toLowerCase().replace(/\.$/,''));
  if(host==='localhost'||host.endsWith('.localhost'))return 'loopback';
  const parts=ipv4Parts(host);
  if(parts){
    const [a,b]=parts;
    if(a===127||a===0)return 'loopback';
    if(a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===169&&b===254))return 'private';
    return 'public';
  }
  if(host==='::1'||host==='0:0:0:0:0:0:0:1')return 'loopback';
  if(host.startsWith('::ffff:')){
    const mapped=host.slice('::ffff:'.length);
    return classifyNetworkHost(mapped);
  }
  if(/^f[cd][0-9a-f:]*$/i.test(host)||/^fe[89ab][0-9a-f:]*$/i.test(host))return 'private';
  return 'public';
}

function rawAuthority(raw){
  const match=String(raw).match(/^[A-Za-z][A-Za-z\d+.-]*:\/\/([^/?#]*)/);
  return match?.[1]??'';
}

export function canonicalizeNetworkUrl(value){
  const raw=String(value??'');
  assertOc(raw.length>0,ErrorCodes.INVALID_ARGUMENT,'Network URL is required');
  if(/[\u0000-\u001f\u007f\\]/.test(raw)||/%5c/i.test(raw)){
    throw ocError(ErrorCodes.NETWORK_DENIED,'Ambiguous backslash/control network URL rejected');
  }
  const authority=rawAuthority(raw);
  if(/%/.test(authority)){
    throw ocError(ErrorCodes.NETWORK_DENIED,'Encoded network authority/host rejected');
  }
  let parsed;
  try{parsed=new URL(raw);}catch{
    throw ocError(ErrorCodes.NETWORK_DENIED,'Invalid network URL');
  }
  if(!['http:','https:'].includes(parsed.protocol)){
    throw ocError(ErrorCodes.NETWORK_DENIED,'Only http(s) external networking is allowed',{protocol:parsed.protocol});
  }
  if(parsed.username||parsed.password){
    throw ocError(ErrorCodes.NETWORK_DENIED,'Credential-bearing network URL rejected',{origin:parsed.origin});
  }
  if(/%(?:2f|5c)/i.test(parsed.pathname)){
    throw ocError(ErrorCodes.NETWORK_DENIED,'Encoded path separator rejected',{origin:parsed.origin});
  }
  parsed.hash='';
  return parsed;
}

function normalizePathRule(value){
  const path=String(value??'/');
  assertOc(path.startsWith('/'),ErrorCodes.INVALID_ARGUMENT,'Network path rule must start with /',{path});
  assertOc(!path.includes('\\')&&!/%(?:2f|5c)/i.test(path),ErrorCodes.INVALID_ARGUMENT,'Ambiguous network path rule rejected',{path});
  return path;
}

function pathAllowed(pathname,prefix){
  if(prefix==='/')return true;
  if(pathname===prefix)return true;
  return prefix.endsWith('/')?pathname.startsWith(prefix):pathname.startsWith(prefix+'/');
}

function sanitizeDecisionUrl(parsed){
  return parsed.origin+parsed.pathname;
}

function normalizeOrigin(value){
  const parsed=canonicalizeNetworkUrl(value);
  assertOc(parsed.pathname==='/'&&parsed.search==='',ErrorCodes.INVALID_ARGUMENT,'Network rule origin must not contain path/query',{origin:value});
  return parsed.origin;
}

function freezeRule(rule,index){
  const origin=normalizeOrigin(rule.origin);
  const methods=[...new Set((rule.methods??['GET']).map(normalizeMethod))].sort();
  const paths=rule.paths? [...new Set(rule.paths.map(normalizePathRule))].sort():null;
  return Object.freeze({
    id:String(rule.id??('rule-'+(index+1))),
    origin,
    methods:Object.freeze(methods),
    paths:paths?Object.freeze(paths):null,
    category:String(rule.category??'restricted')
  });
}

function secretScope(scope={}){
  return Object.freeze({
    schemes:Object.freeze([...(scope.schemes??['https:'])].map((item)=>String(item).toLowerCase()).sort()),
    hosts:Object.freeze([...(scope.hosts??[])].map((item)=>stripIpv6Brackets(String(item).toLowerCase())).sort()),
    methods:Object.freeze([...(scope.methods??['GET'])].map(normalizeMethod).sort()),
    paths:Object.freeze([...(scope.paths??['/'])].map(normalizePathRule).sort()),
    session:scope.session==null?null:String(scope.session),
    task:scope.task==null?null:String(scope.task)
  });
}

function secretAllowed(secret,parsed,{method,session,task}){
  const host=stripIpv6Brackets(parsed.hostname.toLowerCase());
  if(!secret.scope.schemes.includes(parsed.protocol))return false;
  if(secret.scope.hosts.length&&!secret.scope.hosts.includes(host))return false;
  if(!secret.scope.methods.includes(method))return false;
  if(!secret.scope.paths.some((prefix)=>pathAllowed(parsed.pathname,prefix)))return false;
  if(secret.scope.session!==null&&secret.scope.session!==String(session??''))return false;
  if(secret.scope.task!==null&&secret.scope.task!==String(task??''))return false;
  if(secret.expiresAt!==null&&Date.now()>secret.expiresAt)return false;
  return true;
}

function cloneHeaders(input){
  const headers=new Headers(input??{});
  for(const key of SECRET_REQUEST_HEADERS){
    if(headers.has(key)){
      throw ocError(ErrorCodes.NETWORK_DENIED,'Sensitive request headers must use an opaque secret handle',{header:key});
    }
  }
  return headers;
}

async function readBoundedResponse(response,{limit,signal}){
  if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');
  if(!response.body)return new Uint8Array();
  const reader=response.body.getReader();
  const chunks=[];
  let total=0;
  const abort=()=>{
    try{void reader.cancel(signal?.reason);}catch{}
  };
  signal?.addEventListener?.('abort',abort,{once:true});
  try{
    while(true){
      if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');
      const {done,value}=await reader.read();
      if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');
      if(done)break;
      const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
      total+=bytes.byteLength;
      if(total>limit){
        try{await reader.cancel('response-budget');}catch{}
        throw ocError(ErrorCodes.OUTPUT_LIMIT,'Decoded network response exceeded byte budget',{bytes:total,limit});
      }
      chunks.push(bytes);
    }
  }finally{
    signal?.removeEventListener?.('abort',abort);
  }
  const merged=new Uint8Array(total);
  let offset=0;
  for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.byteLength;}
  return merged;
}

export async function probeLocalNetworkAccess(scope=globalThis.navigator){
  const result={
    schema:'opencontainer.local-network-access-probe.v0.1',
    permissionsApi:typeof scope?.permissions?.query==='function',
    permissionName:null,
    state:'unsupported'
  };
  if(!result.permissionsApi)return Object.freeze(result);
  for(const name of ['local-network-access','local-network']){
    try{
      const receipt=await scope.permissions.query({name});
      return Object.freeze({...result,permissionName:name,state:String(receipt?.state??'unknown')});
    }catch{}
  }
  return Object.freeze(result);
}

export class NetworkAuthority{
  #rules=[];
  #allowLocal=false;
  #profile;
  #registryOrigins;
  #policyId;
  #policyHash;
  #decisions=[];
  #decisionLimit;
  #fetch;
  #maxResponseBytes;
  #maxRedirects;
  #secrets=new Map();
  #secretCounter=0;

  constructor({
    allowLocal=false,
    profile=NetworkProfiles.RESTRICTED,
    registryOrigins=['https://registry.npmjs.org'],
    policyId='opencontainer-default-network',
    decisionLimit=256,
    fetchImpl=globalThis.fetch,
    maxResponseBytes=8*1024*1024,
    maxRedirects=5
  }={}){
    assertOc(PROFILE_SET.has(profile),ErrorCodes.INVALID_ARGUMENT,'Unknown network profile',{profile});
    assertOc(Number.isInteger(decisionLimit)&&decisionLimit>=1,ErrorCodes.INVALID_ARGUMENT,'decisionLimit must be positive');
    assertOc(Number.isInteger(maxResponseBytes)&&maxResponseBytes>=1,ErrorCodes.INVALID_ARGUMENT,'maxResponseBytes must be positive');
    assertOc(Number.isInteger(maxRedirects)&&maxRedirects>=0,ErrorCodes.INVALID_ARGUMENT,'maxRedirects must be non-negative');
    if(fetchImpl!==undefined&&fetchImpl!==null)assertOc(typeof fetchImpl==='function',ErrorCodes.INVALID_ARGUMENT,'fetchImpl must be a function');
    this.#allowLocal=allowLocal===true;
    this.#profile=profile;
    this.#registryOrigins=new Set(registryOrigins.map(normalizeOrigin));
    this.#policyId=String(policyId);
    this.#decisionLimit=decisionLimit;
    this.#fetch=fetchImpl?((...args)=>Reflect.apply(fetchImpl,globalThis,args)):null;
    this.#maxResponseBytes=maxResponseBytes;
    this.#maxRedirects=maxRedirects;
    this.#refreshHash();
  }

  get profile(){return this.#profile;}
  get policyVersion(){return NETWORK_POLICY_VERSION;}
  get policyHash(){return this.#policyHash;}
  get policyId(){return this.#policyId;}

  policy(){
    return Object.freeze({
      schema:'opencontainer.network-policy-receipt.v0.1',
      id:this.#policyId,
      version:NETWORK_POLICY_VERSION,
      hash:this.#policyHash,
      profile:this.#profile,
      allowLocal:this.#allowLocal,
      registryOrigins:Object.freeze([...this.#registryOrigins].sort()),
      rules:Object.freeze(this.#rules.map((rule)=>Object.freeze({
        id:rule.id,origin:rule.origin,methods:rule.methods,paths:rule.paths,category:rule.category
      }))),
      broker:Object.freeze({
        enabled:false,
        openProxy:false,
        requirement:'Future broker mode must reauthorize normalized target/redirect hops and enforce explicit destination classes; Core exposes no broker fetch proxy.'
      })
    });
  }

  allow(rule){
    assertOc(this.#profile!==NetworkProfiles.OFFLINE,ErrorCodes.NETWORK_DENIED,'Offline profile cannot accept external network rules');
    const normalized=freezeRule(rule,this.#rules.length);
    if(this.#profile===NetworkProfiles.REGISTRY_ONLY){
      assertOc(
        normalized.category==='registry'&&this.#registryOrigins.has(normalized.origin),
        ErrorCodes.NETWORK_DENIED,
        'Registry-only profile accepts only declared registry origins',
        {origin:normalized.origin,category:normalized.category}
      );
    }
    this.#rules.push(normalized);
    this.#refreshHash();
    return this;
  }

  authorize(url,{method='GET'}={}){
    const parsed=canonicalizeNetworkUrl(url);
    const normalizedMethod=normalizeMethod(method);
    const networkClass=classifyNetworkHost(parsed.hostname);
    const publicUrl=sanitizeDecisionUrl(parsed);

    if(networkClass!=='public'&&!this.#allowLocal){
      return this.#deny('Loopback/private networking denied',parsed,normalizedMethod,{networkClass});
    }

    let rule=null;
    if(this.#profile===NetworkProfiles.OPEN_WEB){
      rule={id:'profile:open-web',origin:parsed.origin,methods:[normalizedMethod],paths:['/'],category:'open-web'};
    }else if(this.#profile!==NetworkProfiles.OFFLINE){
      rule=this.#rules.find((candidate)=>
        candidate.origin===parsed.origin&&
        candidate.methods.includes(normalizedMethod)&&
        (!candidate.paths||candidate.paths.some((prefix)=>pathAllowed(parsed.pathname,prefix)))
      )??null;
    }

    if(!rule)return this.#deny('Network capability denied',parsed,normalizedMethod,{networkClass});

    const receipt=Object.freeze({
      schema:'opencontainer.network-decision.v0.1',
      decision:'allow',
      url:parsed.href,
      auditUrl:publicUrl,
      origin:parsed.origin,
      method:normalizedMethod,
      networkClass,
      ruleId:rule.id,
      profile:this.#profile,
      policyId:this.#policyId,
      policyVersion:NETWORK_POLICY_VERSION,
      policyHash:this.#policyHash
    });
    this.#recordDecision(receipt);
    return receipt;
  }

  decisions(){
    return Object.freeze(this.#decisions.map((item)=>Object.freeze({...item})));
  }

  createSecret({
    value,
    header='authorization',
    prefix='',
    scope={},
    ttlMs=null
  }={}){
    assertOc(typeof value==='string'&&value.length>0,ErrorCodes.INVALID_ARGUMENT,'Secret plaintext is required');
    const normalizedHeader=String(header).toLowerCase();
    assertOc(/^[a-z0-9-]+$/.test(normalizedHeader),ErrorCodes.INVALID_ARGUMENT,'Invalid secret header name');
    assertOc(!FORBIDDEN_SECRET_HEADERS.has(normalizedHeader),ErrorCodes.NETWORK_DENIED,'Secret header is not permitted',{header:normalizedHeader});
    if(ttlMs!==null)assertOc(Number.isFinite(ttlMs)&&ttlMs>0,ErrorCodes.INVALID_ARGUMENT,'ttlMs must be positive');
    const random=globalThis.crypto?.randomUUID?.()??String(++this.#secretCounter)+'-'+Date.now().toString(36);
    const handle='ocsecret:'+random;
    const record=Object.freeze({
      value,
      header:normalizedHeader,
      prefix:String(prefix),
      scope:secretScope(scope),
      expiresAt:ttlMs===null?null:Date.now()+Number(ttlMs)
    });
    this.#secrets.set(handle,record);
    return Object.freeze({
      handle,
      header:record.header,
      scope:record.scope,
      expiresAt:record.expiresAt,
      plaintextExposed:false
    });
  }

  revokeSecret(handle){
    return this.#secrets.delete(String(handle));
  }

  secretInfo(handle){
    const secret=this.#secrets.get(String(handle));
    if(!secret)return null;
    return Object.freeze({
      handle:String(handle),
      header:secret.header,
      scope:secret.scope,
      expiresAt:secret.expiresAt,
      plaintextExposed:false
    });
  }

  async fetch(url,{
    method='GET',
    headers,
    body,
    signal,
    secretHandle=null,
    session=null,
    task=null,
    maxResponseBytes=this.#maxResponseBytes
  }={}){
    assertOc(this.#fetch,ErrorCodes.INVALID_STATE,'Managed network fetch is unavailable');
    assertOc(Number.isInteger(maxResponseBytes)&&maxResponseBytes>=1,ErrorCodes.INVALID_ARGUMENT,'maxResponseBytes must be positive');
    let current=String(url);
    let currentMethod=normalizeMethod(method);
    let currentBody=body;
    let redirects=0;
    let finalDecision=null;
    const hops=[];

    while(true){
      const decision=this.authorize(current,{method:currentMethod});
      finalDecision=decision;
      const parsed=canonicalizeNetworkUrl(decision.url);
      const requestHeaders=cloneHeaders(headers);
      if(secretHandle!==null){
        const secret=this.#secrets.get(String(secretHandle));
        if(!secret||!secretAllowed(secret,parsed,{method:currentMethod,session,task})){
          throw ocError(ErrorCodes.NETWORK_DENIED,'Opaque secret handle is outside its request scope',{
            auditUrl:decision.auditUrl,
            method:currentMethod,
            policyHash:this.#policyHash
          });
        }
        requestHeaders.set(secret.header,secret.prefix+secret.value);
      }

      let response;
      try{
        response=await this.#fetch(decision.url,{
          method:currentMethod,
          headers:requestHeaders,
          body:currentBody,
          credentials:'omit',
          redirect:'manual',
          signal
        });
      }catch(error){
        if(signal?.aborted)throw signal.reason??error;
        throw error;
      }

      if(response?.type==='opaque'||response?.type==='opaqueredirect'){
        throw ocError(ErrorCodes.NETWORK_DENIED,'Opaque network response cannot be capability-authorized',{
          auditUrl:decision.auditUrl,
          type:response?.type,
          policyHash:this.#policyHash
        });
      }

      if(REDIRECT_STATUSES.has(response.status)){
        if(redirects>=this.#maxRedirects){
          throw ocError(ErrorCodes.NETWORK_DENIED,'Network redirect limit exceeded',{limit:this.#maxRedirects,policyHash:this.#policyHash});
        }
        const location=response.headers?.get?.('location');
        if(!location)throw ocError(ErrorCodes.NETWORK_DENIED,'Network redirect is missing Location',{status:response.status,policyHash:this.#policyHash});
        const next=new URL(location,decision.url).href;
        hops.push(Object.freeze({url:decision.auditUrl,status:response.status,policyHash:decision.policyHash}));
        redirects++;
        if(response.status===303||((response.status===301||response.status===302)&&currentMethod==='POST')){
          currentMethod='GET';
          currentBody=undefined;
        }
        current=next;
        continue;
      }

      const bytes=await readBoundedResponse(response,{limit:maxResponseBytes,signal});
      const safeHeaders=new Headers(response.headers);
      safeHeaders.delete('set-cookie');
      safeHeaders.delete('set-cookie2');
      safeHeaders.delete('content-encoding');
      safeHeaders.set('content-length',String(bytes.byteLength));
      const rebuilt=new Response(bytes,{
        status:response.status,
        statusText:response.statusText,
        headers:safeHeaders
      });
      return Object.freeze({
        response:rebuilt,
        receipt:Object.freeze({
          schema:'opencontainer.network-fetch.v0.1',
          decision:finalDecision,
          redirects,
          hops:Object.freeze(hops),
          decodedBytes:bytes.byteLength,
          maxResponseBytes,
          secretHandleUsed:secretHandle!==null,
          secretPlaintextExposed:false,
          policyVersion:NETWORK_POLICY_VERSION,
          policyHash:this.#policyHash
        })
      });
    }
  }

  #deny(message,parsed,method,extra={}){
    const receipt=Object.freeze({
      schema:'opencontainer.network-decision.v0.1',
      decision:'deny',
      auditUrl:sanitizeDecisionUrl(parsed),
      origin:parsed.origin,
      method,
      profile:this.#profile,
      policyId:this.#policyId,
      policyVersion:NETWORK_POLICY_VERSION,
      policyHash:this.#policyHash,
      ...extra
    });
    this.#recordDecision(receipt);
    throw ocError(ErrorCodes.NETWORK_DENIED,message,receipt);
  }

  #recordDecision(receipt){
    const audit=Object.freeze({
      ...receipt,
      ...(Object.hasOwn(receipt,'url')?{url:receipt.auditUrl}:null)
    });
    this.#decisions.push(audit);
    if(this.#decisions.length>this.#decisionLimit)this.#decisions.splice(0,this.#decisions.length-this.#decisionLimit);
  }

  #refreshHash(){
    this.#policyHash=policyHash({
      id:this.#policyId,
      version:NETWORK_POLICY_VERSION,
      profile:this.#profile,
      allowLocal:this.#allowLocal,
      registryOrigins:[...this.#registryOrigins].sort(),
      rules:this.#rules.map((rule)=>({
        id:rule.id,origin:rule.origin,methods:rule.methods,paths:rule.paths,category:rule.category
      }))
    });
  }
}
