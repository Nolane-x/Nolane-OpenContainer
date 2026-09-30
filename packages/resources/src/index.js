import { ErrorCodes, ocError } from '../../protocol/src/index.js';

const PRESSURE_STATES=Object.freeze(['normal','elevated','serious','critical']);

function positiveInt(value,fallback,{minimum=1}={}){
  const number=Math.floor(Number(value));
  return Number.isFinite(number)&&number>=minimum?number:fallback;
}

export function deriveWorkerBudget({hardwareConcurrency=null,configuredWorkers=null,hardCap=8}={}){
  const cap=positiveInt(hardCap,8);
  if(configuredWorkers!==null&&configuredWorkers!==undefined){
    const workers=positiveInt(configuredWorkers,cap);
    return Object.freeze({
      workers,
      source:'explicit',
      hardwareConcurrencyHint:Number.isFinite(Number(hardwareConcurrency))?Math.max(1,Math.floor(Number(hardwareConcurrency))):null,
      hardCap:cap,
      directHardwareMapping:false
    });
  }
  const hint=Number.isFinite(Number(hardwareConcurrency))?Math.max(1,Math.floor(Number(hardwareConcurrency))):null;
  // Hardware concurrency is only a scheduling hint. Never map N logical CPUs to N
  // guest workers. Leave headroom for the page, Service Worker and toolchain.
  const workers=hint===null?cap:Math.max(1,Math.min(cap,Math.ceil(hint/2)));
  return Object.freeze({
    workers,
    source:hint===null?'default-cap':'hardware-hint-clamped',
    hardwareConcurrencyHint:hint,
    hardCap:cap,
    directHardwareMapping:false
  });
}

export class ResourceGovernor {
  #limits; #used; #leases=new Map(); #next=0; #workerPolicy; #pressureState='normal'; #pressureEpoch=0;
  constructor(limits={}) {
    this.#workerPolicy=deriveWorkerBudget({
      hardwareConcurrency:limits.hardwareConcurrencyHint??null,
      configuredWorkers:Object.prototype.hasOwnProperty.call(limits,'workers')?limits.workers:null,
      hardCap:limits.workerHardCap??8
    });
    this.#limits=Object.freeze({
      processes:positiveInt(limits.processes,32),
      outputBytes:positiveInt(limits.outputBytes,4*1024*1024),
      memoryBytes:positiveInt(limits.memoryBytes,256*1024*1024),
      workers:this.#workerPolicy.workers,
      tasks:positiveInt(limits.tasks,128),
      inFlightBytes:positiveInt(limits.inFlightBytes,16*1024*1024),
      // Retained source-map cache is disabled by default. A future cache must
      // reserve this budget explicitly before it can retain map bytes.
      sourceMapBytes:Math.max(0,Math.floor(Number(limits.sourceMapBytes??0))||0)
    });
    this.#used={processes:0,outputBytes:0,memoryBytes:0,workers:0,tasks:0,inFlightBytes:0,sourceMapBytes:0};
  }
  get limits(){return this.#limits;}
  get usage(){return Object.freeze({...this.#used});}
  get activeLeases(){
    return Object.freeze([...this.#leases.values()].map(lease=>Object.freeze({
      id:lease.id,
      owner:lease.owner,
      resources:lease.resources
    })));
  }
  get usageByOwner(){
    const totals=new Map();
    for(const lease of this.#leases.values()){
      if(!totals.has(lease.owner))totals.set(lease.owner,Object.fromEntries(Object.keys(this.#used).map(key=>[key,0])));
      const usage=totals.get(lease.owner);
      for(const [key,amount] of Object.entries(lease.resources))usage[key]+=amount;
    }
    return Object.freeze(Object.fromEntries([...totals].map(([owner,usage])=>[owner,Object.freeze({...usage})])));
  }
  get workerPolicy(){return this.#workerPolicy;}
  get pressure(){
    return Object.freeze({
      state:this.#pressureState,
      paused:this.#pressureState==='serious'||this.#pressureState==='critical',
      epoch:this.#pressureEpoch
    });
  }
  setPressure(state='normal'){
    const normalized=String(state).toLowerCase();
    if(!PRESSURE_STATES.includes(normalized)){
      throw ocError(ErrorCodes.INVALID_ARGUMENT,'Unknown resource pressure state',{state});
    }
    const wasPaused=this.#pressureState==='serious'||this.#pressureState==='critical';
    const nextPaused=normalized==='serious'||normalized==='critical';
    this.#pressureState=normalized;
    if(nextPaused&&!wasPaused)this.#pressureEpoch+=1;
    return this.pressure;
  }
  acquireTask({background=false,inFlightBytes=0,owner='task'}={}){
    const isBackground=background===true;
    if(isBackground&&(this.#pressureState==='serious'||this.#pressureState==='critical')){
      throw ocError(ErrorCodes.RESOURCE_EXHAUSTED,'Background task admission paused by resource pressure',{
        pressure:this.#pressureState,
        pressureEpoch:this.#pressureEpoch
      });
    }
    const pressureEpoch=this.#pressureEpoch;
    const lease=this.reserve({tasks:1,inFlightBytes,owner});
    const governor=this;
    let released=false;
    return Object.freeze({
      id:lease.id,
      owner:lease.owner,
      background:isBackground,
      pressureEpoch,
      assertPublish(){
        if(isBackground&&governor.#pressureEpoch!==pressureEpoch){
          throw ocError(ErrorCodes.WORKER_STALE,'Background task result became stale after pressure cancellation',{
            startedPressureEpoch:pressureEpoch,
            currentPressureEpoch:governor.#pressureEpoch,
            pressure:governor.#pressureState
          });
        }
        return true;
      },
      release(){
        if(released)return false;
        released=true;
        return lease.release();
      }
    });
  }
  reserve(request={}) {
    const owner=typeof request.owner==='string'&&request.owner.trim()?request.owner.trim().slice(0,96):'unscoped';
    const normalized={};
    for (const key of Object.keys(this.#used)) normalized[key]=Math.max(0,Number(request[key]??0));
    for (const [key,amount] of Object.entries(normalized)) {
      if (!Number.isFinite(amount)) {
        throw ocError(ErrorCodes.INVALID_ARGUMENT,'Resource reservation must be finite',{resource:key,requested:request[key]});
      }
      if (this.#used[key]+amount>this.#limits[key]) {
        throw ocError(ErrorCodes.RESOURCE_EXHAUSTED,'Resource limit exceeded: '+key,{resource:key,requested:amount,used:this.#used[key],limit:this.#limits[key]});
      }
    }
    for (const [key,amount] of Object.entries(normalized)) this.#used[key]+=amount;
    const id='lease-'+(++this.#next);
    let released=false;
    const lease=Object.freeze({
      id,
      owner,
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
