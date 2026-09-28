import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

test('P4 package layout watcher tracks install remove reinstall with readdir and realpath coherence',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.mount({
    'packages/ws/package.json':'{"name":"ws","version":"1.0.0","main":"index.cjs","type":"commonjs"}',
    'packages/ws/index.cjs':'module.exports=1'
  });
  runtime.packages.compile({
    name:'layout-cycle',
    version:'1.0.0',
    lockfileVersion:3,
    packages:{
      '':{
        name:'layout-cycle',
        version:'1.0.0',
        dependencies:{a:'1.0.0',b:'1.0.0',ws:'file:packages/ws'}
      },
      'node_modules/a':{
        name:'a',
        version:'1.0.0'
      },
      'node_modules/b':{
        name:'b',
        version:'1.0.0'
      },
      'node_modules/ws':{
        name:'ws',
        version:'1.0.0',
        resolved:'packages/ws',
        link:true
      }
    }
  });

  const events=[];
  const stop=runtime.packages.watchPackageLayout(event=>events.push(event),{emitInitial:true});
  assert.equal(events.length,1);
  assert.equal(events[0].reason,'unmounted');
  assert.equal(events[0].mounted,false);

  const first=runtime.packages.mountCatalog({
    packages:[{
      location:'node_modules/a',
      packageJson:{name:'a',version:'1.0.0',main:'index.cjs',type:'commonjs'},
      files:{'index.cjs':'module.exports="first"'}
    }],
    symlinks:[{
      path:'/workspace/node_modules/ws',
      target:'/workspace/packages/ws'
    }]
  });

  assert.equal(first.layout.reason,'install');
  assert.equal(first.layout.catalogGeneration,1);
  assert.deepEqual(runtime.packages.nodeModules.readdir('/workspace/node_modules'),['a','ws']);
  assert.equal(
    runtime.packages.nodeModules.realpath('/workspace/node_modules/ws/index.cjs'),
    '/workspace/packages/ws/index.cjs'
  );

  const removed=runtime.packages.unmountCatalog();
  assert.equal(removed.reason,'remove');
  assert.equal(removed.catalogGeneration,2);
  assert.equal(runtime.packages.nodeModules,null);
  assert.throws(
    ()=>runtime.packages.resolve('a','/workspace/index.cjs',{mode:'cjs'}),
    error=>error?.code===ErrorCodes.INVALID_STATE
  );

  const second=runtime.packages.mountCatalog({
    packages:[
      {
        location:'node_modules/a',
        packageJson:{name:'a',version:'1.0.1',main:'index.cjs',type:'commonjs'},
        files:{'index.cjs':'module.exports="second"'}
      },
      {
        location:'node_modules/b',
        packageJson:{name:'b',version:'1.0.0',main:'index.cjs',type:'commonjs'},
        files:{'index.cjs':'module.exports="b"'}
      }
    ],
    symlinks:[{
      path:'/workspace/node_modules/ws',
      target:'/workspace/packages/ws'
    }]
  });

  assert.equal(second.layout.reason,'install');
  assert.equal(second.layout.catalogGeneration,3);
  assert.deepEqual(runtime.packages.nodeModules.readdir('/workspace/node_modules'),['a','b','ws']);
  assert.equal(
    runtime.packages.nodeModules.realpath('/workspace/node_modules/ws/index.cjs'),
    '/workspace/packages/ws/index.cjs'
  );

  assert.deepEqual(events.map(event=>event.reason),['unmounted','install','remove','install']);
  assert.deepEqual(events.map(event=>event.catalogGeneration),[0,1,2,3]);
  assert.equal(events[1].packageCount,1);
  assert.equal(events[1].symlinkCount,1);
  assert.equal(events[2].mounted,false);
  assert.equal(events[3].packageCount,2);
  assert.equal(stop(),true);
  assert.equal(stop(),false);
});

test('P4 package layout watcher survives direct reinstall and graph invalidation',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.packages.compile({
    name:'app',
    version:'1',
    lockfileVersion:3,
    packages:{
      '':{name:'app',version:'1',dependencies:{a:'1'}},
      'node_modules/a':{name:'a',version:'1'}
    }
  });
  const events=[];
  runtime.packages.watchPackageLayout(event=>events.push(event));

  runtime.packages.mountCatalog({
    packages:[{
      location:'node_modules/a',
      packageJson:{name:'a',version:'1',main:'index.cjs',type:'commonjs'},
      files:{'index.cjs':'module.exports=1'}
    }]
  });
  runtime.packages.mountCatalog({
    packages:[{
      location:'node_modules/a',
      packageJson:{name:'a',version:'2',main:'index.cjs',type:'commonjs'},
      files:{'index.cjs':'module.exports=2'}
    }]
  });

  assert.deepEqual(events.map(event=>event.reason),['install','reinstall']);
  assert.equal(runtime.packages.nodeModules.readFile('/workspace/node_modules/a/index.cjs'),'module.exports=2');

  runtime.packages.compile({
    name:'app',
    version:'2',
    lockfileVersion:3,
    packages:{
      '':{name:'app',version:'2',dependencies:{b:'1'}},
      'node_modules/b':{name:'b',version:'1'}
    }
  });

  assert.equal(events.at(-1).reason,'graph-invalidated');
  assert.equal(events.at(-1).mounted,false);
  assert.equal(runtime.packages.nodeModules,null);
  assert.equal(events.at(-1).layoutFingerprint,runtime.packages.graph.layout.fingerprint);
});
