import { ErrorCodes, ocError } from '../../protocol/src/index.js';

class OutputBuffer {
  #chunks=[];#bytes=0;#limit;#onWrite;#drains=[];
  constructor(limit,onWrite=null){this.#limit=limit;this.#onWrite=onWrite;}
  write(value){
    const text=String(value);const bytes=new TextEncoder().encode(text).byteLength;
    if(this.#bytes+bytes>this.#limit)throw ocError(ErrorCodes.OUTPUT_LIMIT,'Process output limit exceeded',{limit:this.#limit});
    this.#bytes+=bytes;this.#chunks.push(text);
    try{
      const pending=this.#onWrite?.(text,bytes);
      if(pending&&typeof pending.then==='function')this.#drains.push(Promise.resolve(pending));
    }catch(error){
      this.#drains.push(Promise.reject(error));
    }
  }
  async drain(timeoutMs=5000){
    const pending=this.#drains.splice(0);
    if(pending.length===0)return Object.freeze({pending:0,timedOut:false});
    let timer;
    try{
      const timeout=new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(ocError(ErrorCodes.WORKER_TIMEOUT,'Process output drain timed out',{timeoutMs,pending:pending.length})),Math.max(1,Number(timeoutMs)||5000));
      });
      await Promise.race([Promise.allSettled(pending),timeout]);
      return Object.freeze({pending:pending.length,timedOut:false});
    }catch(error){
      return Object.freeze({pending:pending.length,timedOut:true,error});
    }finally{
      if(timer)clearTimeout(timer);
    }
  }
  toString(){return this.#chunks.join('');}
  get bytes(){return this.#bytes;}
}

export class ProcessSupervisor {
  #commands=new Map();#resources;#diagnostics;#nextPid=1000;#outputLimit;#processes=new Map();#children=new Map();
  constructor({resources,diagnostics,outputLimitBytes=1024*1024}={}){
    this.#resources=resources;this.#diagnostics=diagnostics;
    this.#outputLimit=Math.min(outputLimitBytes,resources?.limits?.outputBytes??outputLimitBytes);
  }
  register(name,handler){
    if(typeof name!=='string'||typeof handler!=='function')throw ocError(ErrorCodes.INVALID_ARGUMENT,'Invalid command registration');
    this.#commands.set(name,handler);return()=>this.#commands.delete(name);
  }
  has(name){return this.#commands.has(name);}
  get activeCount(){return [...this.#processes.values()].filter(record=>record.state==='RUNNING').length;}
  list(){
    return Object.freeze([...this.#processes.values()].map(record=>Object.freeze({
      pid:record.pid,
      command:record.command,
      parentPid:record.parentPid,
      state:record.state,
      signal:record.signal,
      code:record.code
    })));
  }
  spawn(command,args=[],options={}){
    const handler=this.#commands.get(command);
    if(!handler)throw ocError(ErrorCodes.COMMAND_NOT_FOUND,'Command not found: '+command,{command});
    const parentPid=options.parentPid??null;
    if(parentPid!==null){
      const parent=this.#processes.get(parentPid);
      if(!parent||parent.state!=='RUNNING')throw ocError(ErrorCodes.INVALID_ARGUMENT,'Parent process is not active',{parentPid});
    }
    const orphanPolicy=options.orphanPolicy??'terminate';
    if(!['terminate','detach'].includes(orphanPolicy))throw ocError(ErrorCodes.INVALID_ARGUMENT,'Unsupported process orphan policy',{orphanPolicy});

    const lease=this.#resources?.reserve({processes:1,outputBytes:this.#outputLimit})??{release(){}};
    const pid=++this.#nextPid;
    const stdout=new OutputBuffer(this.#outputLimit,(text,bytes)=>{
      this.#diagnostics?.recordTerminal({pid,stream:'stdout',byteLength:bytes});
      return options.stdoutSink?.(text,{pid,stream:'stdout',byteLength:bytes});
    });
    const stderr=new OutputBuffer(this.#outputLimit,(text,bytes)=>{
      this.#diagnostics?.recordTerminal({pid,stream:'stderr',byteLength:bytes});
      return options.stderrSink?.(text,{pid,stream:'stderr',byteLength:bytes});
    });
    let resolveExit,resolveTerminal;
    const exit=new Promise((resolve)=>{resolveExit=resolve;});
    const terminal=new Promise((resolve)=>{resolveTerminal=resolve;});
    const record={
      pid,command,parentPid,orphanPolicy,state:'RUNNING',signal:null,code:null,terminalCount:0,
      killed:false,lease,stdout,stderr,resolveExit,resolveTerminal
    };
    this.#processes.set(pid,record);
    if(parentPid!==null){
      if(!this.#children.has(parentPid))this.#children.set(parentPid,new Set());
      this.#children.get(parentPid).add(pid);
    }

    const process={
      pid,command,argv:[command,...args],stdout,stderr,exit,terminal,
      kill:(sig='SIGTERM')=>this.#kill(pid,sig),
      get killed(){return record.killed;},
      get signal(){return record.signal;},
      get state(){return record.state;}
    };

    queueMicrotask(async()=>{
      let code=0;
      let thrown=null;
      try{
        if(record.killed)code=128;
        else{
          const result=await handler({
            argv:process.argv,
            args:[...args],
            cwd:options.cwd??'/workspace',
            env:Object.freeze({...options.env}),
            stdout:(v)=>stdout.write(v),
            stderr:(v)=>stderr.write(v),
            signal:()=>record.signal,
            abortSignal:options.signal??null,
            pid,
            parentPid
          });
          code=record.killed?128:(Number.isInteger(result)?result:Number.isInteger(result?.code)?result.code:0);
        }
      }catch(error){
        thrown=error;code=record.killed?128:1;
        try{stderr.write(error?.message??String(error));}catch{}
        this.#diagnostics?.record('process.error',{pid,command,error:error?.message});
      }finally{
        const drainTimeoutMs=Math.max(1,Number(options.drainTimeoutMs??5000)||5000);
        const [stdoutDrain,stderrDrain]=await Promise.all([stdout.drain(drainTimeoutMs),stderr.drain(drainTimeoutMs)]);
        if((stdoutDrain.timedOut||stderrDrain.timedOut)&&!record.killed)code=1;
        this.#finalize(record,{
          code,
          signal:record.signal,
          reason:record.killed?'killed':thrown?'throw':'natural-exit',
          stdoutDrained:!stdoutDrain.timedOut,
          stderrDrained:!stderrDrain.timedOut,
          drainTimedOut:stdoutDrain.timedOut||stderrDrain.timedOut
        });
      }
    });

    this.#diagnostics?.record('process.spawn',{pid,command,args,parentPid,orphanPolicy});
    return process;
  }

  #kill(pid,signal='SIGTERM'){
    const record=this.#processes.get(pid);
    if(!record||record.state!=='RUNNING'||record.killed)return false;
    record.killed=true;record.signal=signal;
    this.#diagnostics?.record('process.kill',{pid,signal});
    for(const childPid of this.#children.get(pid)??[]){
      const child=this.#processes.get(childPid);
      if(child?.state==='RUNNING'&&child.orphanPolicy==='terminate')this.#kill(childPid,'SIGTERM');
    }
    return true;
  }

  #finalize(record,{code,signal,reason,stdoutDrained,stderrDrained,drainTimedOut}){
    if(record.state!=='RUNNING')return false;
    record.state='EXITED';record.code=code;record.signal=signal;record.terminalCount++;
    for(const childPid of this.#children.get(record.pid)??[]){
      const child=this.#processes.get(childPid);
      if(child?.state==='RUNNING'&&child.orphanPolicy==='terminate')this.#kill(childPid,'SIGTERM');
    }
    this.#children.delete(record.pid);
    if(record.parentPid!==null)this.#children.get(record.parentPid)?.delete(record.pid);
    record.lease.release();
    const receipt=Object.freeze({
      pid:record.pid,
      command:record.command,
      parentPid:record.parentPid,
      code,
      signal,
      reason,
      stdoutBytes:record.stdout.bytes,
      stderrBytes:record.stderr.bytes,
      stdoutDrained,
      stderrDrained,
      drainTimedOut,
      terminalCount:record.terminalCount
    });
    this.#diagnostics?.record('process.exit',receipt);
    record.resolveTerminal(receipt);
    record.resolveExit(code);
    return true;
  }
}

export { WorkerRpcAuthority } from './worker-authority.js';
export { BrowserGuestWorkerAuthority } from './browser-guest-worker.js';
export { createSyncRpcMailbox, settleSyncRpcMailbox, waitSyncRpcMailbox, SyncRpcConstants } from './sync-rpc.js';
export { MutationReceiptAuthority, CancellationLineage, ProcessPortAuthority, BoundedTransferChannel } from './runtime-contracts.js';
