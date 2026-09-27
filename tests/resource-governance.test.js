import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceGovernor, deriveWorkerBudget } from '../packages/resources/src/index.js';
import { WorkerRpcAuthority } from '../packages/process/src/worker-authority.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';
import { readFileSync } from 'node:fs';

class Transport {
  listeners=new Set();
  sent=[];
  addEventListener(type,listener){if(type==='message')this.listeners.add(listener);}
  removeEventListener(type,listener){if(type==='message')this.listeners.delete(listener);}
  postMessage(message){this.sent.push(message);}
  respond(message){for(const listener of this.listeners)listener({data:message});}
}

test('P7 hardwareConcurrency is only a clamped worker hint never a direct worker count',()=>{
  assert.deepEqual(deriveWorkerBudget({hardwareConcurrency:4}),{
    workers:2,source:'hardware-hint-clamped',hardwareConcurrencyHint:4,hardCap:8,directHardwareMapping:false
  });
  assert.equal(deriveWorkerBudget({hardwareConcurrency:64}).workers,8);
  assert.equal(deriveWorkerBudget({hardwareConcurrency:8}).workers,4);
  assert.equal(deriveWorkerBudget({hardwareConcurrency:2}).workers,1);
  assert.equal(deriveWorkerBudget({hardwareConcurrency:16,configuredWorkers:3}).workers,3);
  for(const hint of [2,4,8,16,32,64]){
    const policy=deriveWorkerBudget({hardwareConcurrency:hint});
    assert.notEqual(policy.workers,hint);
    assert.equal(policy.directHardwareMapping,false);
    assert.ok(policy.workers<=policy.hardCap);
  }
});

test('P7 governor exposes explicit bounded task in-flight and disabled source-map cache budgets',()=>{
  const resources=new ResourceGovernor({hardwareConcurrencyHint:8,tasks:2,inFlightBytes:128,sourceMapBytes:0});
  assert.equal(resources.limits.workers,4);
  assert.equal(resources.workerPolicy.hardwareConcurrencyHint,8);
  assert.equal(resources.limits.tasks,2);
  assert.equal(resources.limits.inFlightBytes,128);
  assert.equal(resources.limits.sourceMapBytes,0);
  const lease=resources.reserve({tasks:2,inFlightBytes:100});
  assert.throws(()=>resources.reserve({tasks:1}),error=>error.code===ErrorCodes.RESOURCE_EXHAUSTED);
  assert.throws(()=>resources.reserve({inFlightBytes:29}),error=>error.code===ErrorCodes.RESOURCE_EXHAUSTED);
  assert.throws(()=>resources.reserve({sourceMapBytes:1}),error=>error.code===ErrorCodes.RESOURCE_EXHAUSTED);
  lease.release();
  assert.deepEqual(resources.usage,{processes:0,outputBytes:0,memoryBytes:0,workers:0,tasks:0,inFlightBytes:0,sourceMapBytes:0});
});

test('P7 Worker RPC reserves task and in-flight bytes until response then releases them',async()=>{
  const resources=new ResourceGovernor({tasks:1,inFlightBytes:4096});
  const transport=new Transport();
  const rpc=new WorkerRpcAuthority({transport,resources});
  const pending=rpc.request('probe',{payload:'x'.repeat(64)});
  assert.equal(resources.usage.tasks,1);
  assert.ok(resources.usage.inFlightBytes>0);
  assert.throws(()=>rpc.request('second',{}),error=>error.code===ErrorCodes.RESOURCE_EXHAUSTED);
  const sent=transport.sent[0];
  transport.respond({v:1,type:'response',session:sent.session,epoch:sent.epoch,id:sent.id,ok:true,value:{ok:true}});
  assert.deepEqual(await pending,{ok:true});
  assert.equal(resources.usage.tasks,0);
  assert.equal(resources.usage.inFlightBytes,0);
  rpc.close();
});

test('P7 measurement policy preserves hardware and weak-device boundaries',()=>{
  const policy=JSON.parse(readFileSync('release/RESOURCE-MEASUREMENT-POLICY.v1.0.json','utf8'));
  assert.equal(policy.declaredEvidenceProfile,'desktop-chrome153-ubuntu2404-x64-ci');
  assert.equal(policy.workerBudget.directHardwareMappingForbidden,true);
  assert.deepEqual(policy.measurementMetadata.requiredValidityThreats,['warmup','cache','cpuThrottling','gc','thermal','network','devtools']);
  assert.equal(policy.measurementMetadata.claims.latencyFloor,false);
  assert.equal(policy.measurementMetadata.claims.weakDeviceFloor,false);
  assert.equal(policy.gateAuthority['P7-07'].machineClosable,true);
  assert.equal(policy.gateAuthority['P7-14'].machineClosable,true);
  assert.equal(policy.gateAuthority['P7-08'].machineClosable,false);
  assert.equal(policy.gateAuthority['P7-01'].machineClosable,false);
  assert.equal(policy.gateAuthority['P7-09'].machineClosable,false);
  assert.equal(policy.productionClosed,false);
});
