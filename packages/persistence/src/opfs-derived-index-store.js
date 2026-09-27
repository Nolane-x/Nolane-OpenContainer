import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';
import { PersistenceCorruptionClass, corruptionDisposition } from './corruption.js';

const MANIFEST='derived-index-manifest.json';
const PAYLOAD='derived-index.json';
const encoder=new TextEncoder();

async function sha256Hex(text){
  const digest=await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(text));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
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

async function writeText(directory,name,text){
  const handle=await directory.getFileHandle(name,{create:true});
  const writable=await handle.createWritable();
  try{await writable.write(text);await writable.close();}
  catch(error){try{await writable.abort?.();}catch{}throw error;}
}

function parseManifest(text){
  if(!text)return null;
  try{
    const value=JSON.parse(text);
    if(
      value?.version!==1||
      !Number.isInteger(value.sourceGeneration)||
      value.sourceGeneration<0||
      typeof value.sha256!=='string'
    )return null;
    return Object.freeze(value);
  }catch{return null;}
}

export class OpfsDerivedIndexStore{
  #root;
  #directoryName;
  #directory=null;
  #lockManager;
  #lockName;

  constructor({
    root,
    directoryName='opencontainer-derived-index',
    lockManager=globalThis.navigator?.locks??null,
    lockName=null
  }={}){
    assertOc(root&&typeof root.getDirectoryHandle==='function',ErrorCodes.INVALID_ARGUMENT,'OPFS root directory handle is required');
    if(lockManager!==null)assertOc(typeof lockManager?.request==='function',ErrorCodes.INVALID_ARGUMENT,'Derived index lock manager must expose request()');
    this.#root=root;
    this.#directoryName=directoryName;
    this.#lockManager=lockManager;
    this.#lockName=lockName??'opencontainer:derived-index:'+directoryName;
  }

  get crossContextLocking(){return this.#lockManager!==null;}

  async open(){
    this.#directory=await this.#root.getDirectoryHandle(this.#directoryName,{create:true});
    return this;
  }

  async publish({sourceGeneration,value}={}){
    this.#assertOpen();
    assertOc(Number.isInteger(sourceGeneration)&&sourceGeneration>=0,ErrorCodes.INVALID_ARGUMENT,'Derived index sourceGeneration must be a non-negative integer');
    const payloadText=JSON.stringify({version:1,sourceGeneration,value});
    const manifest=Object.freeze({
      version:1,
      sourceGeneration,
      sha256:await sha256Hex(payloadText)
    });
    return this.#withLock(async()=>{
      await writeText(this.#directory,PAYLOAD,payloadText);
      await writeText(this.#directory,MANIFEST,JSON.stringify(manifest));
      return Object.freeze({status:'published',sourceGeneration,sha256:manifest.sha256});
    });
  }

  async read({sourceGeneration=null}={}){
    this.#assertOpen();
    return this.#withLock(async()=>{
      const manifestText=await readText(this.#directory,MANIFEST);
      const payloadText=await readText(this.#directory,PAYLOAD);
      if(manifestText===null&&payloadText===null)return Object.freeze({status:'missing'});
      const manifest=parseManifest(manifestText);
      if(!manifest||payloadText===null)return this.#corrupt('manifest-or-payload-invalid');
      if(sourceGeneration!==null&&manifest.sourceGeneration!==sourceGeneration)return this.#corrupt('source-generation-mismatch');
      if(await sha256Hex(payloadText)!==manifest.sha256)return this.#corrupt('digest-mismatch');
      try{
        const payload=JSON.parse(payloadText);
        if(payload?.version!==1||payload.sourceGeneration!==manifest.sourceGeneration)return this.#corrupt('payload-shape-invalid');
        return Object.freeze({
          status:'verified',
          sourceGeneration:manifest.sourceGeneration,
          value:payload.value,
          sha256:manifest.sha256
        });
      }catch{
        return this.#corrupt('payload-json-invalid');
      }
    });
  }

  async discard(){
    this.#assertOpen();
    return this.#withLock(async()=>{
      const removed=[];
      for(const name of [MANIFEST,PAYLOAD]){
        try{await this.#directory.removeEntry(name);removed.push(name);}
        catch(error){if(error?.name!=='NotFoundError')throw error;}
      }
      return Object.freeze({status:'discarded',removed:Object.freeze(removed)});
    });
  }

  async rebuild(options={}){
    await this.discard();
    return this.publish(options);
  }

  #corrupt(reason){
    const disposition=corruptionDisposition(PersistenceCorruptionClass.DERIVED_INDEX);
    return Object.freeze({
      status:'corrupt',
      reason,
      corruptionClass:disposition.kind,
      action:disposition.action,
      rebuildable:disposition.rebuildable
    });
  }

  async #withLock(callback){
    if(!this.#lockManager)return callback();
    return this.#lockManager.request(this.#lockName,{mode:'exclusive'},callback);
  }

  #assertOpen(){
    if(!this.#directory)throw ocError(ErrorCodes.INVALID_STATE,'Derived index store is not open');
  }
}
