import { ErrorCodes, ocError } from '../../protocol/src/index.js';

let shared=null;

class BrowserOpfsSyncFlushWriter{
  #worker=null;
  #pending=new Map();
  #nextId=0;

  constructor(){
    if(typeof globalThis.Worker!=='function'){
      throw ocError(ErrorCodes.INVALID_STATE,'Dedicated Worker is unavailable for OPFS sync-flush durability');
    }
    this.#worker=new Worker(new URL('./opfs-sync-flush-worker.js',import.meta.url),{type:'module',name:'opencontainer-opfs-sync-flush'});
    this.#worker.addEventListener('message',(event)=>{
      const {id,ok,receipt,error}=event.data??{};
      const waiter=this.#pending.get(id);
      if(!waiter)return;
      this.#pending.delete(id);
      if(ok)waiter.resolve(Object.freeze(receipt));
      else waiter.reject(ocError(
        error?.name==='QuotaExceededError'?ErrorCodes.RESOURCE_EXHAUSTED:ErrorCodes.INVALID_STATE,
        'OPFS sync-flush worker failed',
        {
          workerError:error??null,
          durabilityBoundary:'sync-access-handle-flush'
        }
      ));
    });
    this.#worker.addEventListener('error',(event)=>{
      const error=ocError(ErrorCodes.INVALID_STATE,'OPFS sync-flush worker crashed',{
        message:event?.message??'worker error',
        durabilityBoundary:'sync-access-handle-flush'
      });
      for(const waiter of this.#pending.values())waiter.reject(error);
      this.#pending.clear();
    });
  }

  async write(directory,name,content){
    if(!this.#worker)throw ocError(ErrorCodes.INVALID_STATE,'OPFS sync-flush writer is closed');
    const id=++this.#nextId;
    const result=new Promise((resolve,reject)=>this.#pending.set(id,{resolve,reject}));
    try{
      this.#worker.postMessage({id,directory,name,content:String(content)});
    }catch(error){
      this.#pending.delete(id);
      throw ocError(ErrorCodes.INVALID_STATE,'OPFS directory handle could not be sent to sync-flush worker',{
        cause:error?.message??String(error),
        durabilityBoundary:'sync-access-handle-flush'
      });
    }
    return result;
  }

  close(){
    if(!this.#worker)return false;
    this.#worker.terminate();
    this.#worker=null;
    const error=ocError(ErrorCodes.INVALID_STATE,'OPFS sync-flush writer closed');
    for(const waiter of this.#pending.values())waiter.reject(error);
    this.#pending.clear();
    return true;
  }
}

export function defaultBrowserOpfsSyncFlushWriter(){
  if(typeof globalThis.Worker!=='function')return null;
  if(!shared)shared=new BrowserOpfsSyncFlushWriter();
  return shared;
}

export { BrowserOpfsSyncFlushWriter };
