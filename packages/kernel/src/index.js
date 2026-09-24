import { ErrorCodes, ocError } from '../../protocol/src/index.js';

export const RuntimeState=Object.freeze({NEW:'NEW',BOOTING:'BOOTING',READY:'READY',DRAINING:'DRAINING',TERMINATED:'TERMINATED',FAILED:'FAILED'});

export class OpenContainerKernel {
  #state=RuntimeState.NEW;#bootPromise=null;#diagnostics;
  constructor({diagnostics}={}){this.#diagnostics=diagnostics;}
  get state(){return this.#state;}
  get health(){return Object.freeze({state:this.#state,ready:this.#state===RuntimeState.READY});}
  boot(start=async()=>{}){
    if(this.#bootPromise)return this.#bootPromise;
    if(this.#state!==RuntimeState.NEW)throw ocError(ErrorCodes.INVALID_STATE,'Runtime cannot boot from current state',{state:this.#state});
    this.#state=RuntimeState.BOOTING;this.#diagnostics?.record('runtime.state',{state:this.#state});
    this.#bootPromise=(async()=>{
      try{await start();this.#state=RuntimeState.READY;this.#diagnostics?.record('runtime.state',{state:this.#state});return this;}
      catch(error){this.#state=RuntimeState.FAILED;this.#diagnostics?.record('runtime.state',{state:this.#state,error:error?.message});throw error;}
    })();
    return this.#bootPromise;
  }
  async terminate(stop=async()=>{}){
    if(this.#state===RuntimeState.TERMINATED)return;
    if(![RuntimeState.READY,RuntimeState.FAILED].includes(this.#state))throw ocError(ErrorCodes.INVALID_STATE,'Runtime cannot terminate from current state',{state:this.#state});
    this.#state=RuntimeState.DRAINING;this.#diagnostics?.record('runtime.state',{state:this.#state});
    await stop();this.#state=RuntimeState.TERMINATED;this.#diagnostics?.record('runtime.state',{state:this.#state});
  }
  assertReady(){if(this.#state!==RuntimeState.READY)throw ocError(ErrorCodes.INVALID_STATE,'Runtime is not ready',{state:this.#state});}
}
