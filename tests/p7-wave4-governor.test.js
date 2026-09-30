import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { ToolchainAuthority } from '../packages/toolchain/src/authority.js';
import { AiSharedConcurrencyAuthority } from '../packages/ai-consumer/src/index.js';

test('P7-06 Core/UI/preview/toolchain/AI coexist under one ResourceGovernor',async()=>{
  const runtime=await OpenContainer.boot({
    resources:{workers:4,tasks:12,inFlightBytes:1024*1024,processes:4,outputBytes:4*1024*1024}
  });

  let releaseCore;
  let coreStartedResolve;
  const coreStarted=new Promise(resolve=>{coreStartedResolve=resolve;});
  runtime.registerCommand('p7-hold',async()=>{
    coreStartedResolve();
    await new Promise(resolve=>{releaseCore=resolve;});
    return 0;
  });

  const ui=runtime.resources.acquireTask({owner:'ui',inFlightBytes:64});
  const proc=runtime.spawn('p7-hold');
  await coreStarted;

  let releasePreview;
  const route=runtime.listen(5198,async()=>{
    await new Promise(resolve=>{releasePreview=resolve;});
    return new Response('ok');
  },{owner:'p7'});
  const preview=runtime.preview.dispatch(5198,{},route);
  await Promise.resolve();

  const entry={packageName:'p7-tool',toolVersion:'1',artifactDigest:'a'.repeat(64),adapterSemanticProfile:'p7'};
  const tools=new ToolchainAuthority({entries:[entry],maxWorkers:1,resources:runtime.resources});
  const tool=tools.acquireWorker({entry});
  const agents=new AiSharedConcurrencyAuthority({resources:runtime.resources,maxAgents:1});
  const ai=agents.acquire({background:false,inFlightBytes:64});

  const owners=runtime.resources.usageByOwner;
  for(const owner of ['ui','core:process','preview','toolchain','ai-consumer'])assert.ok(owners[owner],owner);
  assert.equal(runtime.preview.resourceBound,true);
  assert.equal(tools.resourceBound,true);

  releasePreview();
  assert.equal(await (await preview).text(),'ok');
  releaseCore();
  assert.equal(await proc.exit,0);
  ai.release();
  tool.release();
  ui.release();

  assert.ok(Object.values(runtime.resources.usage).every(value=>value===0));
  assert.deepEqual(runtime.resources.activeLeases,[]);
  await runtime.terminate();
});
