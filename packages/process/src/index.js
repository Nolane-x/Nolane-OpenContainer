import { ErrorCodes, ocError } from '../../protocol/src/index.js';

class OutputBuffer {
  #chunks=[];#bytes=0;#limit;
  constructor(limit){this.#limit=limit;}
  write(value){
    const text=String(value);const bytes=new TextEncoder().encode(text).byteLength;
    if(this.#bytes+bytes>this.#limit)throw ocError(ErrorCodes.OUTPUT_LIMIT,'Process output limit exceeded',{limit:this.#limit});
    this.#bytes+=bytes;this.#chunks.push(text);
  }
  toString(){return this.#chunks.join('');}
  get bytes(){return this.#bytes;}
}

export class ProcessSupervisor {
  #commands=new Map();#resources;#diagnostics;#nextPid=1000;#outputLimit;
  constructor({resources,diagnostics,outputLimitBytes=1024*1024}={}){
    this.#resources=resources;this.#diagnostics=diagnostics;
    this.#outputLimit=Math.min(outputLimitBytes,resources?.limits?.outputBytes??outputLimitBytes);
  }
  register(name,handler){
    if(typeof name!=='string'||typeof handler!=='function')throw ocError(ErrorCodes.INVALID_ARGUMENT,'Invalid command registration');
    this.#commands.set(name,handler);return()=>this.#commands.delete(name);
  }
  has(name){return this.#commands.has(name);}
  spawn(command,args=[],options={}){
    const handler=this.#commands.get(command);
    if(!handler)throw ocError(ErrorCodes.COMMAND_NOT_FOUND,'Command not found: '+command,{command});
    const lease=this.#resources?.reserve({processes:1,outputBytes:this.#outputLimit})??{release(){}};
    const pid=++this.#nextPid;const stdout=new OutputBuffer(this.#outputLimit);const stderr=new OutputBuffer(this.#outputLimit);
    let killed=false,signal=null,resolveExit;
    const exit=new Promise((resolve)=>{resolveExit=resolve;});
    const process={pid,command,argv:[command,...args],stdout,stderr,exit,
      kill(sig='SIGTERM'){if(killed)return false;killed=true;signal=sig;return true;},
      get killed(){return killed;},get signal(){return signal;}
    };
    queueMicrotask(async()=>{
      let code=0;
      try{
        if(killed)code=128;
        else{
          const result=await handler({argv:process.argv,args:[...args],cwd:options.cwd??'/workspace',env:Object.freeze({...options.env}),stdout:(v)=>stdout.write(v),stderr:(v)=>stderr.write(v),signal:()=>signal});
          code=Number.isInteger(result)?result:Number.isInteger(result?.code)?result.code:0;
        }
      }catch(error){
        code=1;try{stderr.write(error?.message??String(error));}catch{}
        this.#diagnostics?.record('process.error',{pid,command,error:error?.message});
      }finally{
        lease.release();this.#diagnostics?.record('process.exit',{pid,command,code,signal});resolveExit(code);
      }
    });
    this.#diagnostics?.record('process.spawn',{pid,command,args});
    return process;
  }
}

export { WorkerRpcAuthority } from './worker-authority.js';

export { BrowserGuestWorkerAuthority } from './browser-guest-worker.js';
