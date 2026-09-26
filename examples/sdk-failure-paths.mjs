import { OpenContainer } from '../packages/sdk/src/index.js';

function captureSync(fn){
  try{
    fn();
    return null;
  }catch(error){
    return {code:error?.code??null,message:error?.message??String(error)};
  }
}

const runtime=await OpenContainer.boot();

const failures={
  mount:captureSync(()=>runtime.mount({'../escape.txt':'nope'})),
  spawn:captureSync(()=>runtime.spawn('missing-command')),
  preview:captureSync(()=>runtime.listen(0,()=>new Response('invalid'))),
  snapshot:captureSync(()=>runtime.restore('missing-snapshot')),
  export:captureSync(()=>runtime.export('missing-snapshot'))
};

runtime.mount({'ok.txt':'ok'});
const snapshot=runtime.snapshot('valid');
const stream=runtime.export(snapshot);
const imported=await OpenContainer.boot();
await imported.import(stream);

await imported.teardown();
await runtime.teardown();

failures.teardown=captureSync(()=>runtime.mount({'after-teardown.txt':'forbidden'}));

const receipt={
  schema:'opencontainer.sdk-failure-example.v0.1',
  codes:Object.fromEntries(Object.entries(failures).map(([key,value])=>[key,value?.code??null])),
  messages:Object.fromEntries(Object.entries(failures).map(([key,value])=>[key,value?.message??null]))
};

console.log(JSON.stringify(receipt));
