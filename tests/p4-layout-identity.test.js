import test from 'node:test';
import assert from 'node:assert/strict';
import { PackageGraphAuthority } from '../packages/package-env/src/index.js';

function lock(packages){
  return {
    name:'layout-app',
    version:'1.0.0',
    lockfileVersion:3,
    packages:{
      '':{
        name:'layout-app',
        version:'1.0.0',
        dependencies:{a:'1.0.0',ws:'file:packages/ws'}
      },
      ...packages
    }
  };
}

test('P4 package graph exposes physical layout identity instead of collapsing paths',()=>{
  const graph=new PackageGraphAuthority().compile(lock({
    'node_modules/a':{
      name:'a',version:'1.0.0',resolved:'https://registry.example/a.tgz',integrity:'sha512-a'
    },
    'node_modules/b':{
      name:'b',version:'1.0.0',resolved:'https://registry.example/b.tgz',integrity:'sha512-b'
    },
    'node_modules/a/node_modules/c':{
      name:'c',version:'1.0.0',resolved:'https://registry.example/c.tgz',integrity:'sha512-c'
    },
    'node_modules/ws':{
      name:'ws',version:'1.0.0',resolved:'packages/ws',link:true
    }
  }));

  assert.equal(graph.layout.authority,'package-lock-physical-locations');
  assert.deepEqual(graph.layout.kinds,[
    'top-level','hoisted-transitive','nested','linked'
  ]);
  assert.equal(graph.layout.topLevelCount,3);
  assert.equal(graph.layout.hoistedTransitiveCount,1);
  assert.equal(graph.layout.nestedCount,1);
  assert.equal(graph.layout.linkedCount,1);
  assert.equal(graph.layout.maxNodeModulesDepth,2);
  assert.deepEqual(graph.layout.hoistedTransitiveLocations,['node_modules/b']);
  assert.deepEqual(graph.layout.nestedLocations,['node_modules/a/node_modules/c']);
  assert.deepEqual(graph.layout.linkedLocations,['node_modules/ws']);
  assert.match(graph.layout.fingerprint,/^layout:[0-9a-f]{16}$/);
});

test('P4 shallow layout remains explicitly observable',()=>{
  const graph=new PackageGraphAuthority().compile(lock({
    'node_modules/a':{
      name:'a',version:'1.0.0',resolved:'https://registry.example/a.tgz',integrity:'sha512-a'
    },
    'node_modules/ws':{
      name:'ws',version:'1.0.0',resolved:'packages/ws',link:true
    }
  }));

  assert.ok(graph.layout.kinds.includes('shallow'));
  assert.ok(graph.layout.kinds.includes('linked'));
  assert.equal(graph.layout.nestedCount,0);
  assert.equal(graph.layout.maxNodeModulesDepth,1);
});

test('P4 layout fingerprint changes when identical packages move between hoisted and nested locations',()=>{
  const hoisted=new PackageGraphAuthority().compile(lock({
    'node_modules/a':{
      name:'a',version:'1.0.0',dependencies:{b:'1.0.0'},resolved:'https://registry.example/a.tgz',integrity:'sha512-a'
    },
    'node_modules/b':{
      name:'b',version:'1.0.0',resolved:'https://registry.example/b.tgz',integrity:'sha512-b'
    },
    'node_modules/ws':{
      name:'ws',version:'1.0.0',resolved:'packages/ws',link:true
    }
  }));
  const nested=new PackageGraphAuthority().compile(lock({
    'node_modules/a':{
      name:'a',version:'1.0.0',dependencies:{b:'1.0.0'},resolved:'https://registry.example/a.tgz',integrity:'sha512-a'
    },
    'node_modules/a/node_modules/b':{
      name:'b',version:'1.0.0',resolved:'https://registry.example/b.tgz',integrity:'sha512-b'
    },
    'node_modules/ws':{
      name:'ws',version:'1.0.0',resolved:'packages/ws',link:true
    }
  }));

  assert.notEqual(hoisted.layout.fingerprint,nested.layout.fingerprint);
  assert.equal(hoisted.layout.hoistedTransitiveCount,1);
  assert.equal(hoisted.layout.nestedCount,0);
  assert.equal(nested.layout.hoistedTransitiveCount,0);
  assert.equal(nested.layout.nestedCount,1);
  assert.ok(hoisted.layout.kinds.includes('shallow'));
  assert.ok(nested.layout.kinds.includes('nested'));
});
