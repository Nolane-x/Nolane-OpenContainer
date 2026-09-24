import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenContainer } from '../packages/sdk/src/index.js';

test('node:module createRequire is bound to the current OpenContainer loader',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.mount({
    'package.json':'{"type":"commonjs"}',
    'dep.cjs':'module.exports=41',
    'main.cjs':'const {createRequire,isBuiltin}=require("module"); const r=createRequire(__filename); module.exports={value:r("./dep.cjs")+1,resolved:r.resolve("./dep.cjs"),builtin:isBuiltin("node:fs")};'
  });
  runtime.packages.mountCatalog();
  const loader=runtime.packages.createCommonJsLoader({allowDynamicCode:true});
  assert.deepEqual(loader.require('./main.cjs','/workspace/entry.cjs'),{value:42,resolved:'/workspace/dep.cjs',builtin:true});
});

test('package command bridge turns CommandIndex bins into virtual processes',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.packages.compile({name:'app',version:'1',lockfileVersion:3,packages:{
    '':{name:'app',version:'1'},
    'node_modules/tool':{name:'tool',version:'1',resolved:'packages/tool',link:true,bin:{tool:'bin/tool.cjs'}}
  }});
  runtime.mount({
    'packages/tool/package.json':JSON.stringify({name:'tool',version:'1',type:'commonjs'}),
    'packages/tool/bin/tool.cjs':'#!/usr/bin/env node\nconsole.log("args="+process.argv.slice(2).join(",")); process.stderr.write("warn\\n"); process.exitCode=3;'
  });
  runtime.packages.createFrozenInstaller().mountFrozenGraph();
  const linked=runtime.installPackageCommands({allowDynamicCode:true});
  assert.deepEqual(linked.commands.map((entry)=>entry.command),['tool']);

  const child=runtime.spawn('tool',['a','b']);
  assert.equal(await child.exit,3);
  assert.equal(child.stdout.toString(),'args=a,b\n');
  assert.equal(child.stderr.toString(),'warn\n');
  linked.bridge.dispose();
});

test('logical process.exit becomes virtual process exit code instead of killing host',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.packages.compile({lockfileVersion:3,packages:{
    'node_modules/exit-tool':{name:'exit-tool',version:'1',resolved:'packages/exit-tool',link:true,bin:{quit:'quit.cjs'}}
  }});
  runtime.mount({
    'packages/exit-tool/package.json':'{"name":"exit-tool","type":"commonjs"}',
    'packages/exit-tool/quit.cjs':'process.exit(7);'
  });
  runtime.packages.createFrozenInstaller().mountFrozenGraph();
  runtime.installPackageCommands({allowDynamicCode:true});
  const child=runtime.spawn('quit');
  assert.equal(await child.exit,7);
});

test('unimplemented ESM bins fail as process errors without host execution',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.packages.compile({lockfileVersion:3,packages:{
    'node_modules/esm-tool':{name:'esm-tool',version:'1',resolved:'packages/esm-tool',link:true,bin:{esmtool:'cli.js'}}
  }});
  runtime.mount({
    'packages/esm-tool/package.json':'{"name":"esm-tool","type":"module"}',
    'packages/esm-tool/cli.js':'globalThis.__SHOULD_NOT_RUN__=true;'
  });
  runtime.packages.createFrozenInstaller().mountFrozenGraph();
  runtime.installPackageCommands({allowDynamicCode:true});
  const child=runtime.spawn('esmtool');
  assert.equal(await child.exit,1);
  assert.match(child.stderr.toString(),/Synchronous require\(ESM\)/);
  assert.equal(globalThis.__SHOULD_NOT_RUN__,undefined);
});
