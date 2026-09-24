import { ErrorCodes, ocError } from '../../protocol/src/index.js';

export class ResourceGovernor {
  #limits; #used; #leases=new Map(); #next=0;
  constructor(limits={}) {
    this.#limits=Object.freeze({
      processes:limits.processes??32,
      outputBytes:limits.outputBytes??4*1024*1024,
      memoryBytes:limits.memoryBytes??256*1024*1024,
      workers:limits.workers??8
    });
    this.#used={processes:0,outputBytes:0,memoryBytes:0,workers:0};
  }
  get limits(){return this.#limits;}
  get usage(){return Object.freeze({...this.#used});}
  reserve(request={}) {
    const normalized={};
    for (const key of Object.keys(this.#used)) normalized[key]=Math.max(0,Number(request[key]??0));
    for (const [key,amount] of Object.entries(normalized)) {
      if (this.#used[key]+amount>this.#limits[key]) {
        throw ocError(ErrorCodes.RESOURCE_EXHAUSTED,'Resource limit exceeded: '+key,{resource:key,requested:amount,used:this.#used[key],limit:this.#limits[key]});
      }
    }
    for (const [key,amount] of Object.entries(normalized)) this.#used[key]+=amount;
    const id='lease-'+(++this.#next);
    let released=false;
    const lease=Object.freeze({
      id,
      resources:Object.freeze(normalized),
      release:()=>{
        if(released)return false;
        released=true;
        for(const [key,amount] of Object.entries(normalized))this.#used[key]-=amount;
        this.#leases.delete(id);
        return true;
      }
    });
    this.#leases.set(id,lease);
    return lease;
  }
}
