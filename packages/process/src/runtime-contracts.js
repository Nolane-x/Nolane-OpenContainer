import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

export class MutationReceiptAuthority {
  #next=0;
  #records=new Map();

  begin(kind,{identity=null}={}){
    assertOc(typeof kind==='string'&&kind.length>0,ErrorCodes.INVALID_ARGUMENT,'Mutation kind is required');
    const id='mutation-'+(++this.#next);
    const record={
      id,
      kind,
      identity:identity==null?null:String(identity),
      state:'PENDING',
      value:undefined,
      error:null,
      createdAt:Date.now(),
      settledAt:null
    };
    this.#records.set(id,record);
    return Object.freeze({id,kind,identity:record.identity});
  }

  markApplied(receipt,value){
    const record=this.#require(receipt);
    if(record.state!=='PENDING')return false;
    record.state='APPLIED';
    record.value=value;
    record.settledAt=Date.now();
    return true;
  }

  markFailed(receipt,error){
    const record=this.#require(receipt);
    if(record.state!=='PENDING')return false;
    record.state='FAILED';
    record.error=Object.freeze({
      code:error?.code??ErrorCodes.INVALID_STATE,
      message:error?.message??String(error??'mutation failed')
    });
    record.settledAt=Date.now();
    return true;
  }

  timeout(receipt){
    const record=this.#require(receipt);
    return Object.freeze({
      id:record.id,
      state:record.state==='PENDING'?'UNKNOWN':record.state,
      mutationMayHaveOccurred:record.state==='PENDING'||record.state==='APPLIED'
    });
  }

  reconcile(receipt){
    const record=this.#require(receipt);
    return Object.freeze({
      id:record.id,
      kind:record.kind,
      identity:record.identity,
      state:record.state,
      value:record.value,
      error:record.error,
      mutationMayHaveOccurred:record.state==='PENDING'||record.state==='APPLIED'
    });
  }

  #require(receipt){
    const id=typeof receipt==='string'?receipt:receipt?.id;
    const record=this.#records.get(id);
    assertOc(record,ErrorCodes.NOT_FOUND,'Mutation receipt is unknown',{id});
    return record;
  }
}

export class CancellationLineage {
  #root;
  #nodes=new Map();

  constructor({id='root'}={}){
    this.#root=this.#node(String(id),null);
  }

  get signal(){return this.#root.controller.signal;}

  child(id,parentId='root'){
    const parent=this.#nodes.get(String(parentId));
    assertOc(parent,ErrorCodes.NOT_FOUND,'Cancellation parent is unknown',{parentId});
    return this.#node(String(id),parent);
  }

  abort(reason='cancelled'){
    if(!this.#root.controller.signal.aborted)this.#root.controller.abort(reason);
  }

  receipt(){
    return Object.freeze({
      nodes:Object.freeze([...this.#nodes.values()].map(node=>Object.freeze({
        id:node.id,
        parentId:node.parent?.id??null,
        aborted:node.controller.signal.aborted,
        reason:node.controller.signal.reason??null
      })))
    });
  }

  #node(id,parent){
    assertOc(id.length>0&&!this.#nodes.has(id),ErrorCodes.INVALID_ARGUMENT,'Cancellation lineage id must be unique',{id});
    const controller=new AbortController();
    const node={id,parent,controller};
    this.#nodes.set(id,node);
    if(parent){
      const propagate=()=>{if(!controller.signal.aborted)controller.abort(parent.controller.signal.reason);};
      if(parent.controller.signal.aborted)propagate();
      else parent.controller.signal.addEventListener('abort',propagate,{once:true});
    }
    return Object.freeze({id,signal:controller.signal,abort:(reason='cancelled')=>{if(!controller.signal.aborted)controller.abort(reason);}});
  }
}

export class ProcessPortAuthority {
  #nextEpoch=0;
  #routes=new Map();

  publish({port,pid,handler}={}){
    assertOc(Number.isInteger(port)&&port>=1&&port<=65535,ErrorCodes.INVALID_ARGUMENT,'Virtual port must be 1..65535');
    assertOc(Number.isInteger(pid)&&pid>0,ErrorCodes.INVALID_ARGUMENT,'Virtual port owner pid is required');
    assertOc(typeof handler==='function',ErrorCodes.INVALID_ARGUMENT,'Virtual port handler is required');
    const epoch=++this.#nextEpoch;
    const route=Object.freeze({port,pid,epoch,handler});
    this.#routes.set(port,route);
    return Object.freeze({port,pid,epoch});
  }

  revoke(port,{pid=null}={}){
    const route=this.#routes.get(port);
    if(!route)return false;
    if(pid!==null&&route.pid!==pid)return false;
    this.#routes.delete(port);
    this.#nextEpoch++;
    return true;
  }

  async dispatch(port,request={},proof={}){
    const route=this.#routes.get(port);
    if(!route)throw ocError(ErrorCodes.NOT_FOUND,'Virtual process port not found',{port});
    if(proof.pid!==undefined&&proof.pid!==route.pid){
      throw ocError(ErrorCodes.PREVIEW_STALE,'Virtual port pid is stale',{expected:route.pid,actual:proof.pid});
    }
    if(proof.epoch!==undefined&&proof.epoch!==route.epoch){
      throw ocError(ErrorCodes.PREVIEW_STALE,'Virtual port epoch is stale',{expected:route.epoch,actual:proof.epoch});
    }
    return route.handler(request);
  }

  list(){
    return Object.freeze([...this.#routes.values()].map(({handler,...route})=>Object.freeze(route)));
  }
}

export class BoundedTransferChannel {
  #maxBytes;
  #queuedBytes=0;
  #closed=false;
  #aborted=false;
  #reason=null;
  #queue=[];
  #waiters=[];

  constructor({maxBytes=1024*1024}={}){
    assertOc(Number.isFinite(maxBytes)&&maxBytes>=1,ErrorCodes.INVALID_ARGUMENT,'Transfer byte budget must be positive');
    this.#maxBytes=Math.floor(maxBytes);
  }

  write(value,{signal=null}={}){
    if(signal?.aborted)return Promise.reject(ocError(ErrorCodes.WORKER_STALE,'Transfer producer cancelled',{reason:signal.reason}));
    if(this.#closed)return Promise.reject(ocError(ErrorCodes.WORKER_CLOSED,'Transfer channel is closed'));
    if(this.#aborted)return Promise.reject(ocError(ErrorCodes.WORKER_STALE,'Transfer channel aborted',{reason:this.#reason}));
    const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
    if(bytes.byteLength>this.#maxBytes){
      return Promise.reject(ocError(ErrorCodes.RESOURCE_EXHAUSTED,'Transfer chunk exceeds byte budget',{bytes:bytes.byteLength,limit:this.#maxBytes}));
    }
    if(this.#queuedBytes+bytes.byteLength>this.#maxBytes){
      return Promise.reject(ocError(ErrorCodes.RESOURCE_EXHAUSTED,'Transfer backpressure budget exhausted',{queued:this.#queuedBytes,bytes:bytes.byteLength,limit:this.#maxBytes}));
    }
    const copy=bytes.slice();
    this.#queuedBytes+=copy.byteLength;
    if(this.#waiters.length){
      const waiter=this.#waiters.shift();
      this.#queuedBytes-=copy.byteLength;
      waiter.resolve({value:copy,done:false});
    }else this.#queue.push(copy);
    return Promise.resolve(copy.byteLength);
  }

  read({signal=null}={}){
    if(signal?.aborted)return Promise.reject(ocError(ErrorCodes.WORKER_STALE,'Transfer consumer cancelled',{reason:signal.reason}));
    if(this.#queue.length){
      const value=this.#queue.shift();
      this.#queuedBytes-=value.byteLength;
      return Promise.resolve({value,done:false});
    }
    if(this.#aborted)return Promise.reject(ocError(ErrorCodes.WORKER_STALE,'Transfer channel aborted',{reason:this.#reason}));
    if(this.#closed)return Promise.resolve({value:undefined,done:true});
    return new Promise((resolve,reject)=>{
      const waiter={resolve,reject};
      this.#waiters.push(waiter);
      if(signal){
        const onAbort=()=>{
          const index=this.#waiters.indexOf(waiter);
          if(index>=0)this.#waiters.splice(index,1);
          reject(ocError(ErrorCodes.WORKER_STALE,'Transfer consumer cancelled',{reason:signal.reason}));
        };
        signal.addEventListener('abort',onAbort,{once:true});
      }
    });
  }

  close(){
    if(this.#closed||this.#aborted)return false;
    this.#closed=true;
    for(const waiter of this.#waiters.splice(0))waiter.resolve({value:undefined,done:true});
    return true;
  }

  abort(reason='aborted'){
    if(this.#aborted)return false;
    this.#aborted=true;
    this.#reason=reason;
    this.#queue=[];
    this.#queuedBytes=0;
    for(const waiter of this.#waiters.splice(0))waiter.reject(ocError(ErrorCodes.WORKER_STALE,'Transfer channel aborted',{reason}));
    return true;
  }

  get usage(){return Object.freeze({queuedBytes:this.#queuedBytes,maxBytes:this.#maxBytes,pendingReaders:this.#waiters.length,closed:this.#closed,aborted:this.#aborted});}
}
