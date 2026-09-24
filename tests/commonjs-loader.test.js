import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

async function makeRuntime(files={},packages=[]){
  const runtime=await OpenContainer.boot();
  runtime.mount({'package.json':'{"type":"commonjs"}',...files});
  runtime.packages.mountCatalog({packages});
  return runtime;
}

test('CommonJS executes module wrapper and JSON',async()=>{
  const runtime=await makeRuntime({
    'main.cjs':'const data=require("./data.json"); module.exports={value:data.value,dir:__dirname,file:__filename};',
    'data.json':'{"value":7}'
  });
  const loader=runtime.packages.createCommonJsLoader({allowDynamicCode:true});
  assert.deepEqual(loader.require('./main.cjs','/workspace/entry.cjs'),{value:7,dir:'/workspace',file:'/workspace/main.cjs'});
});

test('CommonJS caches by canonical resolved filename',async()=>{
  const runtime=await makeRuntime({'value.cjs':'module.exports={n:1}'});
  const loader=runtime.packages.createCommonJsLoader({allowDynamicCode:true});
  const a=loader.require('./value.cjs','/workspace/a.cjs');
  const b=loader.require('./value.cjs','/workspace/b.cjs');
  assert.equal(a,b);
  assert.equal(loader.hasCached('/workspace/value.cjs'),true);
});

test('CommonJS cycle observes partial exports',async()=>{
  const runtime=await makeRuntime({
    'a.cjs':'exports.name="a"; const b=require("./b.cjs"); exports.fromB=b.name; exports.bSawA=b.sawA;',
    'b.cjs':'exports.name="b"; const a=require("./a.cjs"); exports.sawA=a.name;'
  });
  const loader=runtime.packages.createCommonJsLoader({allowDynamicCode:true});
  assert.deepEqual(loader.require('./a.cjs','/workspace/entry.cjs'),{name:'a',fromB:'b',bSawA:'a'});
});

test('module.exports reassignment replaces the exports alias result',async()=>{
  const runtime=await makeRuntime({'x.cjs':'exports.a=1; module.exports={b:2};'});
  const loader=runtime.packages.createCommonJsLoader({allowDynamicCode:true});
  assert.deepEqual(loader.require('./x.cjs','/workspace/entry.cjs'),{b:2});
});

test('builtin compatibility profile is explicit and injectable',async()=>{
  const runtime=await makeRuntime({'x.cjs':'module.exports=require("path").marker'});
  const loader=runtime.packages.createCommonJsLoader({allowDynamicCode:true,builtins:{path:{marker:'path'}}});
  assert.equal(loader.require('./x.cjs','/workspace/entry.cjs'),'path');
  assert.throws(()=>loader.require('fs','/workspace/entry.cjs'),e=>e.code===ErrorCodes.BUILTIN_UNAVAILABLE);
});

test('failed CommonJS modules are removed from cache',async()=>{
  const runtime=await makeRuntime({'x.cjs':'throw new Error("boom")'});
  const loader=runtime.packages.createCommonJsLoader({allowDynamicCode:true});
  assert.throws(()=>loader.require('./x.cjs','/workspace/entry.cjs'),/boom/);
  assert.equal(loader.hasCached('/workspace/x.cjs'),false);
  runtime.fs.beginTransaction().writeFile('x.cjs','module.exports=42').commit();
  assert.equal(loader.require('./x.cjs','/workspace/entry.cjs'),42);
});

test('dynamic source execution is denied by default',async()=>{
  const runtime=await makeRuntime({'x.cjs':'module.exports=1'});
  const loader=runtime.packages.createCommonJsLoader();
  assert.throws(()=>loader.require('./x.cjs','/workspace/entry.cjs'),e=>e.code===ErrorCodes.MODULE_EXECUTION_DISABLED);
});

test('require of ESM remains an explicit separate gate',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.mount({'package.json':'{"type":"module"}','x.js':'export default 1'});
  runtime.packages.mountCatalog();
  const loader=runtime.packages.createCommonJsLoader({allowDynamicCode:true});
  assert.throws(()=>loader.require('./x.js','/workspace/entry.cjs'),e=>e.code===ErrorCodes.REQUIRE_ESM_UNSUPPORTED);
});
