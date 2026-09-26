import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

async function streamText(stream){
  const reader=stream.getReader();
  const chunks=[];
  let total=0;
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
    chunks.push(bytes);
    total+=bytes.byteLength;
  }
  const joined=new Uint8Array(total);
  let offset=0;
  for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder().decode(joined);
}

test('public S7 SDK snapshots restore and export pins the invocation generation',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.mount({'state.txt':'one'});
  const snapshot=runtime.snapshot('before-edit');

  runtime.fs.beginTransaction().writeFile('state.txt','two').commit();
  assert.equal(runtime.fs.readFile('state.txt'),'two');
  runtime.restore(snapshot);
  assert.equal(runtime.fs.readFile('state.txt'),'one');

  const pinnedGeneration=runtime.fs.generation;
  const archive=runtime.export();
  runtime.fs.beginTransaction().writeFile('state.txt','after-export').commit();

  const text=await streamText(archive);
  const header=JSON.parse(text.split(/\r?\n/)[0]);
  assert.equal(header.generation,pinnedGeneration);

  const imported=await OpenContainer.boot();
  await imported.import(new ReadableStream({
    start(controller){
      const bytes=new TextEncoder().encode(text);
      const mid=Math.floor(bytes.byteLength/2);
      controller.enqueue(bytes.slice(0,mid));
      controller.enqueue(bytes.slice(mid));
      controller.close();
    }
  }));
  assert.equal(imported.fs.readFile('state.txt'),'one');
  assert.equal(imported.fs.generation,pinnedGeneration);

  const status=runtime.status();
  assert.equal(status.state,'READY');
  assert.equal(status.generation,runtime.fs.generation);
  assert.equal(status.workspacePersistence,null);
  assert.equal(status.packagePersistence,null);

  await imported.teardown();
  await runtime.teardown();
  assert.equal(runtime.state,'TERMINATED');
});

test('public S7 SDK can export an explicit immutable snapshot after later edits',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.mount({'state.txt':'snapshot-value'});
  const snapshot=runtime.snapshot('pinned');
  runtime.fs.beginTransaction().writeFile('state.txt','live-value').commit();

  const imported=await OpenContainer.boot();
  await imported.import(runtime.export(snapshot));
  assert.equal(imported.fs.readFile('state.txt'),'snapshot-value');
  assert.equal(imported.fs.generation,snapshot.vfs.generation);

  await imported.terminate();
  await runtime.terminate();
});

test('public S7 SDK rejects invalid snapshot and import references',async()=>{
  const runtime=await OpenContainer.boot();
  assert.throws(
    ()=>runtime.restore(null),
    (error)=>error.code===ErrorCodes.INVALID_ARGUMENT
  );
  assert.throws(
    ()=>runtime.export({}),
    (error)=>error.code===ErrorCodes.INVALID_ARGUMENT
  );
  await assert.rejects(
    ()=>runtime.import(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('not-json\n'));controller.close();}})),
    (error)=>error.code===ErrorCodes.IMPORT_INVALID
  );
  await runtime.terminate();
});
