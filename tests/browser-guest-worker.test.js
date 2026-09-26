import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserGuestWorkerAuthority } from '../packages/process/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';
import { ResourceGovernor } from '../packages/resources/src/index.js';

class FakeWorker {
  static instances=[];
  listeners=new Map();
  sent=[];
  terminated=false;

  constructor(url,options){
    this.url=url;
    this.options=options;
    FakeWorker.instances.push(this);
  }

  addEventListener(type,listener){
    if(!this.listeners.has(type))this.listeners.set(type,new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type,listener){
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message){
    this.sent.push(message);
  }

  emit(type,data){
    for(const listener of this.listeners.get(type)??[])listener({data});
  }

  terminate(){
    this.terminated=true;
  }
}

test('browser guest timeout hard-terminates runaway realm and later execution can recover',async()=>{
  FakeWorker.instances=[];
  const publication={
    session:'timeout-court',
    resolveDynamic(){throw new Error('unused');}
  };
  const authority=new BrowserGuestWorkerAuthority({
    publication,
    WorkerImpl:FakeWorker,
    requestTimeoutMs:15
  });

  await assert.rejects(
    ()=>authority.execute('https://example.invalid/__opencontainer__/esm/timeout-court/runaway.mjs'),
    (error)=>error.code===ErrorCodes.WORKER_TIMEOUT
  );

  assert.equal(FakeWorker.instances.length,1);
  assert.equal(FakeWorker.instances[0].terminated,true);
  assert.equal(authority.identity,null);

  const recovered=authority.execute(
    'https://example.invalid/__opencontainer__/esm/timeout-court/recovered.mjs',
    {exportNames:['ok']}
  );
  assert.equal(FakeWorker.instances.length,2);
  const worker=FakeWorker.instances[1];
  const request=worker.sent[0];
  worker.emit('message',{
    v:1,
    type:'response',
    session:request.session,
    epoch:request.epoch,
    id:request.id,
    ok:true,
    value:{exports:{ok:true},workerCrossOriginIsolated:true,publicationSession:'timeout-court'}
  });

  const result=await recovered;
  assert.equal(result.exports.ok,true);
  assert.equal(worker.terminated,false);
  authority.close();
  assert.equal(worker.terminated,true);
});


test('browser guest workers reserve and release ResourceGovernor worker leases',()=>{
  FakeWorker.instances=[];
  const resources=new ResourceGovernor({workers:1});
  const publication={
    session:'worker-quota-court',
    resolveDynamic(){throw new Error('unused');}
  };
  const first=new BrowserGuestWorkerAuthority({publication,WorkerImpl:FakeWorker,resources});
  const second=new BrowserGuestWorkerAuthority({publication,WorkerImpl:FakeWorker,resources});

  first.start();
  assert.equal(resources.usage.workers,1);
  assert.throws(
    ()=>second.start(),
    (error)=>error.code===ErrorCodes.RESOURCE_EXHAUSTED
  );
  assert.equal(resources.usage.workers,1);

  first.close();
  assert.equal(resources.usage.workers,0);

  second.start();
  assert.equal(resources.usage.workers,1);
  second.close();
  assert.equal(resources.usage.workers,0);
});
