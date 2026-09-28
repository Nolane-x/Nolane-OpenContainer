import { OpenContainer } from '/packages/sdk/src/index.js';
import { PackageGraphAuthority } from '/packages/package-env/src/index.js';

function assert(condition,message,details={}){
  if(condition)return;
  const error=new Error(message);
  error.details=details;
  throw error;
}
async function json(path){
  const response=await fetch(path,{cache:'no-store'});
  assert(response.ok,'fixture fetch failed',{path,status:response.status});
  return response.json();
}
function layoutSummary(graph){
  return Object.freeze({
    nodes:graph.nodes.length,
    fingerprint:graph.layout.fingerprint,
    authority:graph.layout.authority,
    kinds:Object.freeze([...graph.layout.kinds]),
    topLevelCount:graph.layout.topLevelCount,
    hoistedTransitiveCount:graph.layout.hoistedTransitiveCount,
    nestedCount:graph.layout.nestedCount,
    linkedCount:graph.layout.linkedCount,
    maxNodeModulesDepth:graph.layout.maxNodeModulesDepth
  });
}
function syntheticLock(packages){
  return {
    name:'p4-layout-browser',
    version:'1.0.0',
    lockfileVersion:3,
    packages:{
      '':{
        name:'p4-layout-browser',
        version:'1.0.0',
        dependencies:{a:'1.0.0',ws:'file:packages/ws'}
      },
      ...packages
    }
  };
}
async function resolverCourt(){
  const runtime=await OpenContainer.boot();
  try{
    runtime.mount({
      'package.json':JSON.stringify({
        name:'app',
        type:'module',
        imports:{'#internal':'./src/internal.js'},
        exports:{'./self':'./src/self.js'}
      }),
      'src/app.mjs':'',
      'src/app.cjs':'',
      'src/internal.js':'export default 1',
      'src/self.js':'export default 2',
      'src/local.js':'module.exports=1',
      'packages/ws/package.json':JSON.stringify({name:'ws',main:'index.js',type:'commonjs'}),
      'packages/ws/index.js':'module.exports="ws"'
    });
    runtime.packages.mountCatalog({
      packages:[
        {
          location:'node_modules/dual',
          packageJson:{
            name:'dual',
            type:'module',
            exports:{
              '.':{import:'./esm.js',require:'./cjs.cjs',default:'./fallback.js'},
              './feature/*':{node:'./node/*.js',default:'./browser/*.js'}
            }
          },
          files:{
            'esm.js':'export default 1',
            'cjs.cjs':'module.exports=1',
            'fallback.js':'',
            'node/x.js':'',
            'browser/x.js':''
          }
        },
        {location:'node_modules/b',packageJson:{name:'b',main:'index.js',type:'commonjs'},files:{'index.js':'module.exports="root-b"'}},
        {location:'node_modules/a',packageJson:{name:'a',main:'index.js',type:'commonjs'},files:{'index.js':'module.exports=require("b")'}},
        {location:'node_modules/a/node_modules/b',packageJson:{name:'b',main:'index.js',type:'commonjs'},files:{'index.js':'module.exports="nested-b"'}}
      ],
      symlinks:[{path:'/workspace/node_modules/ws',target:'/workspace/packages/ws'}]
    });
    const out={
      cjsRelative:runtime.packages.resolve('./local','/workspace/src/app.cjs',{mode:'cjs'}).path,
      cjsConditional:runtime.packages.resolve('dual','/workspace/src/app.cjs',{mode:'cjs'}).path,
      esmConditional:runtime.packages.resolve('dual','/workspace/src/app.mjs',{mode:'esm'}).path,
      esmPattern:runtime.packages.resolve('dual/feature/x','/workspace/src/app.mjs',{mode:'esm'}).path,
      packageImports:runtime.packages.resolve('#internal','/workspace/src/app.mjs',{mode:'esm'}).path,
      selfReference:runtime.packages.resolve('app/self','/workspace/src/app.mjs',{mode:'esm'}).path,
      nestedDependency:runtime.packages.resolve('b','/workspace/node_modules/a/index.js',{mode:'cjs'}).path,
      rootDependency:runtime.packages.resolve('b','/workspace/src/app.cjs',{mode:'cjs'}).path,
      symlinkRealpath:runtime.packages.resolve('ws','/workspace/src/app.cjs',{mode:'cjs'}).path,
      symlinkPreserved:runtime.packages.resolve('ws','/workspace/src/app.cjs',{mode:'cjs',preserveSymlinks:true}).path
    };
    assert(out.cjsRelative==='/workspace/src/local.js','CJS extension fallback drifted',out);
    assert(out.cjsConditional==='/workspace/node_modules/dual/cjs.cjs','CJS conditional export drifted',out);
    assert(out.esmConditional==='/workspace/node_modules/dual/esm.js','ESM conditional export drifted',out);
    assert(out.esmPattern==='/workspace/node_modules/dual/node/x.js','ESM pattern export drifted',out);
    assert(out.packageImports==='/workspace/src/internal.js','package imports drifted',out);
    assert(out.selfReference==='/workspace/src/self.js','self reference drifted',out);
    assert(out.nestedDependency==='/workspace/node_modules/a/node_modules/b/index.js','nested dependency drifted',out);
    assert(out.rootDependency==='/workspace/node_modules/b/index.js','root dependency drifted',out);
    assert(out.symlinkRealpath==='/workspace/packages/ws/index.js','symlink realpath drifted',out);
    assert(out.symlinkPreserved==='/workspace/node_modules/ws/index.js','preserveSymlinks drifted',out);
    return Object.freeze(out);
  }finally{
    await runtime.terminate();
  }
}
async function run(){
  const [manifest,viteLock,chokidarLock]=await Promise.all([
    json('/compat/p4/ECOSYSTEM-LAYOUT-CORPUS.v1.0.json'),
    json('/compat/p4/vite-react-tiny.package-lock.json'),
    json('/compat/p4/chokidar.package-lock.json')
  ]);
  assert(manifest.fixtures.length===2,'P4 browser corpus fixture count drifted');

  const vite=new PackageGraphAuthority().compile(viteLock);
  const chokidar=new PackageGraphAuthority().compile(chokidarLock);
  assert(vite.nodes.length===219,'Vite real package graph node count drifted',{nodes:vite.nodes.length});
  assert(chokidar.nodes.length===8,'Chokidar real package graph node count drifted',{nodes:chokidar.nodes.length});
  assert(vite.layout.fingerprint!==chokidar.layout.fingerprint,'real repository layouts collapsed to one identity');

  const hoisted=new PackageGraphAuthority().compile(syntheticLock({
    'node_modules/a':{name:'a',version:'1.0.0',dependencies:{b:'1.0.0'},resolved:'https://registry.example/a.tgz',integrity:'sha512-a'},
    'node_modules/b':{name:'b',version:'1.0.0',resolved:'https://registry.example/b.tgz',integrity:'sha512-b'},
    'node_modules/ws':{name:'ws',version:'1.0.0',resolved:'packages/ws',link:true}
  }));
  const nested=new PackageGraphAuthority().compile(syntheticLock({
    'node_modules/a':{name:'a',version:'1.0.0',dependencies:{b:'1.0.0'},resolved:'https://registry.example/a.tgz',integrity:'sha512-a'},
    'node_modules/a/node_modules/b':{name:'b',version:'1.0.0',resolved:'https://registry.example/b.tgz',integrity:'sha512-b'},
    'node_modules/ws':{name:'ws',version:'1.0.0',resolved:'packages/ws',link:true}
  }));
  assert(hoisted.layout.hoistedTransitiveCount===1,'hoisted layout identity missing');
  assert(hoisted.layout.kinds.includes('shallow'),'shallow layout identity missing');
  assert(nested.layout.nestedCount===1,'nested layout identity missing');
  assert(hoisted.layout.linkedCount===1&&nested.layout.linkedCount===1,'linked layout identity missing');
  assert(hoisted.layout.fingerprint!==nested.layout.fingerprint,'hoisted and nested layouts collapsed');

  const resolver=await resolverCourt();
  return Object.freeze({
    browser:navigator.userAgent,
    crossOriginIsolated:globalThis.crossOriginIsolated,
    realRepositoryGraphs:Object.freeze({
      viteReactTiny:layoutSummary(vite),
      chokidar:layoutSummary(chokidar)
    }),
    structuralLayouts:Object.freeze({
      hoisted:layoutSummary(hoisted),
      nested:layoutSummary(nested)
    }),
    resolver,
    sourceGates:Object.freeze(['P4-01','P4-02','P4-03','P4-06']),
    status:'PASS'
  });
}

globalThis.__p4EcosystemLayoutCourt=Object.freeze({run});
document.body.dataset.ready='true';
document.getElementById('result').textContent='ready';
