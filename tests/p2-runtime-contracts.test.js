import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProcessSupervisor,
  MutationReceiptAuthority,
  CancellationLineage,
  ProcessPortAuthority,
  BoundedTransferChannel
} from '../packages/process/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';
import { ResourceGovernor } from '../packages/resources/src/index.js';

const delay=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

test('P2 timeout never implies mutation absence and later receipt reconciliation resolves outcome',()=>{
  const authority=new MutationReceiptAuthority();
  const receipt=authority.begin('workspace-write',{identity:'workspace-7:generation-42'});
  const timeout=authority.timeout(receipt);
  assert.equal(timeout.state,'UNKNOWN');
  assert.equal(timeout.mutationMayHaveOccurred,true);

  assert.equal(authority.markApplied(receipt,{generation:43}),true);
  const reconciled=authority.reconcile(receipt);
  assert.equal(reconciled.state,'APPLIED');
  assert.deepEqual(reconciled.value,{generation:43});
  assert.equal(reconciled.identity,'workspace-7:generation-42');
  assert.equal(reconciled.mutationMayHaveOccurred,true);
  assert.equal(authority.markApplied(receipt,{generation:44}),false);
});

test('P2 cancellation lineage propagates caller abort through broker producer and consumer',()=>{
  const lineage=new CancellationLineage({id:'root'});
  const broker=lineage.child('broker');
  const producer=lineage.child('producer','broker');
  const consumer=lineage.child('consumer','producer');
  lineage.abort('caller-cancelled');
  for(const signal of [lineage.signal,broker.signal,producer.signal,consumer.signal]){
    assert.equal(signal.aborted,true);
    assert.equal(signal.reason,'caller-cancelled');
  }
  const receipt=lineage.receipt();
  assert.deepEqual(receipt.nodes.map(node=>node.id),['root','broker','producer','consumer']);
  assert.equal(receipt.nodes.every(node=>node.aborted),true);
});

test('P2 bounded transfer channel enforces backpressure and abort races',async()=>{
  const channel=new BoundedTransferChannel({maxBytes:8});
  assert.equal(await channel.write(new Uint8Array([1,2,3,4])),4);
  assert.equal(await channel.write(new Uint8Array([5,6,7,8])),4);
  await assert.rejects(
    ()=>channel.write(new Uint8Array([9])),
    error=>error.code===ErrorCodes.RESOURCE_EXHAUSTED
  );
  const first=await channel.read();
  assert.deepEqual([...first.value],[1,2,3,4]);
  assert.equal(channel.usage.queuedBytes,4);
  const second=await channel.read();
  assert.deepEqual([...second.value],[5,6,7,8]);
  assert.equal(channel.usage.queuedBytes,0);

  const controller=new AbortController();
  const pending=channel.read({signal:controller.signal});
  controller.abort('consumer-stop');
  await assert.rejects(
    ()=>pending,
    error=>error.code===ErrorCodes.WORKER_STALE&&error.details?.reason==='consumer-stop'
  );
  assert.equal(channel.usage.pendingReaders,0);
  assert.equal(channel.abort('broker-abort'),true);
  assert.equal(channel.abort('again'),false);
  await assert.rejects(
    ()=>channel.read(),
    error=>error.code===ErrorCodes.WORKER_STALE&&error.details?.reason==='broker-abort'
  );
});

test('P2 virtual ports reject stale pid and epoch after route replacement',async()=>{
  const ports=new ProcessPortAuthority();
  const old=ports.publish({port:5173,pid:1001,handler:()=>new Response('old')});
  const current=ports.publish({port:5173,pid:2001,handler:()=>new Response('new')});
  await assert.rejects(
    ()=>ports.dispatch(5173,{},old),
    error=>error.code===ErrorCodes.PREVIEW_STALE
  );
  assert.equal(await (await ports.dispatch(5173,{},current)).text(),'new');
  assert.equal(ports.revoke(5173,{pid:1001}),false);
  assert.equal(ports.revoke(5173,{pid:2001}),true);
  await assert.rejects(
    ()=>ports.dispatch(5173,{},current),
    error=>error.code===ErrorCodes.NOT_FOUND
  );
});

test('P2 process exit waits for stdout drain but never hangs forever',async()=>{
  const supervisor=new ProcessSupervisor();
  supervisor.register('emit',({stdout})=>{stdout('payload');return 0;});
  const started=Date.now();
  const process=supervisor.spawn('emit',[],{
    stdoutSink:async()=>{await delay(30);},
    drainTimeoutMs:200
  });
  assert.equal(await process.exit,0);
  const terminal=await process.terminal;
  assert.ok(Date.now()-started>=20);
  assert.equal(terminal.stdoutDrained,true);
  assert.equal(terminal.drainTimedOut,false);
  assert.equal(terminal.terminalCount,1);

  const stuck=supervisor.spawn('emit',[],{
    stdoutSink:()=>new Promise(()=>{}),
    drainTimeoutMs:20
  });
  assert.equal(await stuck.exit,1);
  const stuckTerminal=await stuck.terminal;
  assert.equal(stuckTerminal.drainTimedOut,true);
  assert.equal(stuckTerminal.stdoutDrained,false);
  assert.equal(stuckTerminal.terminalCount,1);
});

test('P2 kill natural exit and throw races publish exactly one terminal state',async()=>{
  const supervisor=new ProcessSupervisor();
  supervisor.register('slow',async()=>{await delay(25);return 0;});
  supervisor.register('throw',()=>{throw new Error('boom');});

  const killed=supervisor.spawn('slow');
  await delay(2);
  assert.equal(killed.kill('SIGKILL'),true);
  assert.equal(killed.kill('SIGTERM'),false);
  assert.equal(await killed.exit,128);
  const killedTerminal=await killed.terminal;
  assert.equal(killedTerminal.reason,'killed');
  assert.equal(killedTerminal.signal,'SIGKILL');
  assert.equal(killedTerminal.terminalCount,1);
  assert.equal(killed.kill(),false);

  const natural=supervisor.spawn('slow');
  assert.equal(await natural.exit,0);
  const naturalTerminal=await natural.terminal;
  assert.equal(naturalTerminal.reason,'natural-exit');
  assert.equal(naturalTerminal.terminalCount,1);
  assert.equal(natural.kill(),false);

  const thrown=supervisor.spawn('throw');
  assert.equal(await thrown.exit,1);
  const throwTerminal=await thrown.terminal;
  assert.equal(throwTerminal.reason,'throw');
  assert.equal(throwTerminal.terminalCount,1);
  assert.match(thrown.stderr.toString(),/boom/);
});

test('P2 parent teardown terminates bounded children unless explicitly detached',async()=>{
  const supervisor=new ProcessSupervisor();
  supervisor.register('hold',async()=>{await delay(25);return 0;});

  const parent=supervisor.spawn('hold');
  const child=supervisor.spawn('hold',[],{parentPid:parent.pid,orphanPolicy:'terminate'});
  const detached=supervisor.spawn('hold',[],{parentPid:parent.pid,orphanPolicy:'detach'});
  assert.equal(supervisor.activeCount,3);
  assert.equal(parent.kill('SIGTERM'),true);

  assert.equal(await parent.exit,128);
  assert.equal(await child.exit,128);
  assert.equal(await detached.exit,0);
  assert.equal((await child.terminal).reason,'killed');
  assert.equal((await detached.terminal).reason,'natural-exit');
  assert.equal(supervisor.activeCount,0);
});

test('P2 repeated spawn kill cycles release all process/output resource leases',async()=>{
  const resources=new ResourceGovernor({processes:4,outputBytes:4096});
  const supervisor=new ProcessSupervisor({resources,outputLimitBytes:128});
  supervisor.register('cycle',async({stdout})=>{stdout('x');await delay(1);return 0;});

  for(let i=0;i<100;i++){
    const process=supervisor.spawn('cycle');
    if(i%2===0)process.kill();
    await process.exit;
  }
  assert.equal(supervisor.activeCount,0);
  assert.equal(resources.usage.processes,0);
  assert.equal(resources.usage.outputBytes,0);
  assert.equal(supervisor.list().filter(item=>item.state==='RUNNING').length,0);
});

test('P2 stable process errors expose public codes without worker topology',async()=>{
  const supervisor=new ProcessSupervisor();
  assert.throws(
    ()=>supervisor.spawn('missing'),
    error=>error.code===ErrorCodes.COMMAND_NOT_FOUND&&
      error.details?.command==='missing'&&
      !/worker|transport|messageport/i.test(error.message)
  );
});
