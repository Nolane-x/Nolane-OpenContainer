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


test('P4 contextual .bin resolution selects nearest graph candidate by cwd',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.packages.compile({
    name:'app',
    version:'1',
    lockfileVersion:3,
    packages:{
      '':{name:'app',version:'1',dependencies:{a:'1',rootTool:'1'}},
      'node_modules/a':{name:'a',version:'1'},
      'node_modules/root-tool':{
        name:'root-tool',
        version:'1',
        bin:{tool:'bin/tool.cjs'}
      },
      'node_modules/a/node_modules/nested-tool':{
        name:'nested-tool',
        version:'1',
        bin:{tool:'bin/tool.cjs'}
      }
    }
  });
  runtime.mount({'package.json':'{"name":"app","type":"commonjs"}'});
  runtime.packages.mountCatalog({
    packages:[
      {
        location:'node_modules/a',
        packageJson:{name:'a',version:'1',type:'commonjs'},
        files:{'index.js':'module.exports=1'}
      },
      {
        location:'node_modules/root-tool',
        packageJson:{name:'root-tool',version:'1',type:'commonjs'},
        files:{'bin/tool.cjs':'console.log("root:"+process.cwd())'}
      },
      {
        location:'node_modules/a/node_modules/nested-tool',
        packageJson:{name:'nested-tool',version:'1',type:'commonjs'},
        files:{'bin/tool.cjs':'console.log("nested:"+process.cwd())'}
      }
    ]
  });

  const root=runtime.packages.resolveBin('tool',{cwd:'/workspace'});
  const nested=runtime.packages.resolveBin('tool',{cwd:'/workspace/node_modules/a/src'});
  assert.equal(root.package,'root-tool');
  assert.equal(root.location,'node_modules/root-tool');
  assert.equal(nested.package,'nested-tool');
  assert.equal(nested.location,'node_modules/a/node_modules/nested-tool');

  const linked=runtime.installPackageCommands({allowDynamicCode:true});
  assert.deepEqual(linked.commands.map(item=>({
    command:item.command,
    contextual:item.contextual,
    candidateCount:item.candidateCount
  })),[{command:'tool',contextual:true,candidateCount:2}]);

  const rootChild=runtime.spawn('tool',[],{cwd:'/workspace'});
  assert.equal(await rootChild.exit,0);
  assert.equal(rootChild.stdout.toString(),'root:/workspace\n');

  const nestedChild=runtime.spawn('tool',[],{cwd:'/workspace/node_modules/a/src'});
  assert.equal(await nestedChild.exit,0);
  assert.equal(nestedChild.stdout.toString(),'nested:/workspace/node_modules/a/src\n');
  linked.bridge.dispose();
});

test('P4 contextual .bin resolution fails closed on same-scope command ambiguity',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.packages.compile({
    lockfileVersion:3,
    packages:{
      'node_modules/a-tool':{name:'a-tool',version:'1',bin:{tool:'a.cjs'}},
      'node_modules/b-tool':{name:'b-tool',version:'1',bin:{tool:'b.cjs'}}
    }
  });
  runtime.mount({'package.json':'{"type":"commonjs"}'});
  runtime.packages.mountCatalog({
    packages:[
      {location:'node_modules/a-tool',packageJson:{name:'a-tool',type:'commonjs'},files:{'a.cjs':'module.exports=1'}},
      {location:'node_modules/b-tool',packageJson:{name:'b-tool',type:'commonjs'},files:{'b.cjs':'module.exports=1'}}
    ]
  });

  assert.throws(
    ()=>runtime.packages.resolveBin('tool',{cwd:'/workspace'}),
    error=>error?.code==='OC_INVALID_PACKAGE_CONFIG'&&/ambiguous/.test(error.message)
  );
});
