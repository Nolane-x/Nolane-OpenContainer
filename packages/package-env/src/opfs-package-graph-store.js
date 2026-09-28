import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

const encoder=new TextEncoder();
const decoder=new TextDecoder();
const ROOT='root.json';
const GENERATIONS='generations';

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
}
function graphText(graph){return JSON.stringify(canonical(graph));}
function hex(bytes){return [...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
async function sha256(text){
  const digest=await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(text));
  return hex(new Uint8Array(digest));
}
async function readText(directory,name){
  try{
    const handle=await directory.getFileHandle(name);
    return await (await handle.getFile()).text();
  }catch(error){
    if(error?.name==='NotFoundError')return null;
    throw error;
  }
}
async function writeText(directory,name,text){
  const handle=await directory.getFileHandle(name,{create:true});
  const writable=await handle.createWritable();
  try{
    await writable.write(text);
    await writable.close();
  }catch(error){
    try{await writable.abort?.();}catch{}
    throw error;
  }
}
function parseRoot(text){
  if(text===null)return null;
  try{
    const value=JSON.parse(text);
    if(
      value?.schema!=='opencontainer.package-graph-root.v1.0'||
      !Number.isInteger(value.generation)||
      value.generation<1||
      typeof value.objectName!=='string'||
      !/^graph-\d+-[0-9a-f]{64}\.json$/.test(value.objectName)||
      typeof value.graphDigest!=='string'||
      !/^[0-9a-f]{64}$/.test(value.graphDigest)
    )return null;
    return Object.freeze({
      schema:value.schema,
      generation:value.generation,
      objectName:value.objectName,
      graphDigest:value.graphDigest,
      mutationId:typeof value.mutationId==='string'?value.mutationId:null
    });
  }catch{return null;}
}

export class OpfsPackageGraphStore{
  #root;
  #directoryName;
  #directory=null;
  #generations=null;
  #lockManager;
  #lockName;
  #current=null;

  constructor({
    root,
    directoryName='opencontainer-package-graph',
    lockManager=globalThis.navigator?.locks??null,
    lockName=null
  }={}){
    assertOc(root&&typeof root.getDirectoryHandle==='function',ErrorCodes.INVALID_ARGUMENT,'OPFS root directory handle is required');
    assertOc(lockManager&&typeof lockManager.request==='function',ErrorCodes.INVALID_ARGUMENT,'Package graph publication requires Web Locks coordination');
    this.#root=root;
    this.#directoryName=directoryName;
    this.#lockManager=lockManager;
    this.#lockName=lockName??'opencontainer:package-graph:'+directoryName+':publish';
  }

  get current(){return this.#current;}
  get crossContextLocking(){return true;}
  get directoryName(){return this.#directoryName;}

  async open(){
    this.#directory=await this.#root.getDirectoryHandle(this.#directoryName,{create:true});
    this.#generations=await this.#directory.getDirectoryHandle(GENERATIONS,{create:true});
    this.#current=await this.#readVerifiedRoot();
    return this;
  }

  async refresh(){
    this.#assertOpen();
    this.#current=await this.#readVerifiedRoot();
    return this.#current;
  }

  async read(){
    this.#assertOpen();
    const current=await this.refresh();
    if(!current)return null;
    const text=await readText(this.#generations,current.objectName);
    assertOc(text!==null,ErrorCodes.INVALID_STATE,'Canonical package graph object is missing',{generation:current.generation,objectName:current.objectName});
    const digest=await sha256(text);
    assertOc(digest===current.graphDigest,ErrorCodes.INVALID_STATE,'Canonical package graph digest mismatch',{generation:current.generation,expected:current.graphDigest,actual:digest});
    try{return Object.freeze({generation:current.generation,graph:JSON.parse(text),graphDigest:digest,mutationId:current.mutationId});}
    catch{throw ocError(ErrorCodes.INVALID_STATE,'Canonical package graph JSON is invalid',{generation:current.generation});}
  }

  async publish({baseGeneration,graph,mutationId=null}={}){
    this.#assertOpen();
    assertOc(Number.isInteger(baseGeneration)&&baseGeneration>=0,ErrorCodes.INVALID_ARGUMENT,'baseGeneration must be a non-negative integer',{baseGeneration});
    assertOc(graph&&typeof graph==='object'&&Array.isArray(graph.nodes),ErrorCodes.INVALID_ARGUMENT,'Package graph object is required');
    if(mutationId!==null)assertOc(typeof mutationId==='string'&&mutationId.length>0,ErrorCodes.INVALID_ARGUMENT,'mutationId must be a non-empty string');

    return this.#lockManager.request(this.#lockName,{mode:'exclusive'},async()=>{
      const canonicalRoot=await this.#readVerifiedRoot();
      const currentGeneration=canonicalRoot?.generation??0;
      if(currentGeneration!==baseGeneration){
        throw ocError(ErrorCodes.STALE_GENERATION,'Persistent package graph base generation is stale',{
          expectedGeneration:baseGeneration,
          currentGeneration
        });
      }

      const text=graphText(graph);
      const graphDigest=await sha256(text);
      if(canonicalRoot?.graphDigest===graphDigest){
        this.#current=canonicalRoot;
        return Object.freeze({...canonicalRoot,reused:true,crossContextLocking:true});
      }

      const generation=currentGeneration+1;
      const objectName='graph-'+generation+'-'+graphDigest+'.json';
      await writeText(this.#generations,objectName,text);

      const verifiedText=await readText(this.#generations,objectName);
      assertOc(verifiedText!==null,ErrorCodes.INVALID_STATE,'Package graph candidate disappeared before publication',{generation,objectName});
      const verifiedDigest=await sha256(verifiedText);
      assertOc(verifiedDigest===graphDigest,ErrorCodes.INVALID_STATE,'Package graph candidate verification failed before publication',{generation,objectName,expected:graphDigest,actual:verifiedDigest});

      const root=Object.freeze({
        schema:'opencontainer.package-graph-root.v1.0',
        generation,
        objectName,
        graphDigest,
        mutationId
      });
      await writeText(this.#directory,ROOT,JSON.stringify(root));

      const published=await this.#readVerifiedRoot();
      assertOc(
        published?.generation===generation&&
        published?.objectName===objectName&&
        published?.graphDigest===graphDigest,
        ErrorCodes.INVALID_STATE,
        'Persistent package graph publication verification failed',
        {generation,objectName}
      );
      this.#current=published;
      return Object.freeze({...published,reused:false,crossContextLocking:true});
    });
  }

  async #readVerifiedRoot(){
    const text=await readText(this.#directory,ROOT);
    if(text===null)return null;
    const root=parseRoot(text);
    assertOc(root,ErrorCodes.INVALID_STATE,'Persistent package graph root is corrupt');
    const graph=await readText(this.#generations,root.objectName);
    assertOc(graph!==null,ErrorCodes.INVALID_STATE,'Persistent package graph root references a missing object',{generation:root.generation,objectName:root.objectName});
    const digest=await sha256(graph);
    assertOc(digest===root.graphDigest,ErrorCodes.INVALID_STATE,'Persistent package graph root references a digest-invalid object',{generation:root.generation,expected:root.graphDigest,actual:digest});
    return root;
  }

  #assertOpen(){
    assertOc(this.#directory&&this.#generations,ErrorCodes.INVALID_STATE,'Persistent package graph store is not open');
  }
}
