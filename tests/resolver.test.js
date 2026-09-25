import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

async function fixture(){
  const runtime=await OpenContainer.boot();
  runtime.mount({
    'package.json':JSON.stringify({name:'app',type:'module',imports:{'#internal':'./src/internal.js'},exports:{'./self':'./src/self.js'}}),
    'src/app.mjs':'',
    'src/internal.js':'export default 1',
    'src/self.js':'export default 2',
    'src/local.js':'module.exports=1',
    'packages/ws/package.json':JSON.stringify({name:'ws',main:'index.js',type:'commonjs'}),
    'packages/ws/index.js':'module.exports="ws"'
  });
  runtime.packages.mountCatalog({
    packages:[
      {location:'node_modules/dual',packageJson:{name:'dual',type:'module',exports:{'.':{import:'./esm.js',require:'./cjs.cjs',default:'./fallback.js'},'./feature/*':{node:'./node/*.js',default:'./browser/*.js'}}},files:{'esm.js':'export default 1','cjs.cjs':'module.exports=1','fallback.js':'','node/x.js':'','browser/x.js':'','private.js':''}},
      {location:'node_modules/b',packageJson:{name:'b',main:'index.js',type:'commonjs'},files:{'index.js':'module.exports="root-b"'}},
      {location:'node_modules/a',packageJson:{name:'a',main:'index.js',type:'commonjs'},files:{'index.js':'module.exports=require("b")'}},
      {location:'node_modules/a/node_modules/b',packageJson:{name:'b',main:'index.js',type:'commonjs'},files:{'index.js':'module.exports="nested-b"'}}
    ],
    symlinks:[
      {path:'/workspace/node_modules/ws',target:'/workspace/packages/ws'},
      {path:'/workspace/node_modules/.bin/dual',target:'/workspace/node_modules/dual/cjs.cjs'}
    ]
  });
  return runtime;
}

test('VirtualNodeModulesFS projects packages and symlinks',async()=>{
  const runtime=await fixture(),fs=runtime.packages.nodeModules;
  assert.deepEqual(fs.readdir('/workspace/node_modules'),['.bin','a','b','dual','ws']);
  assert.equal(fs.readFile('/workspace/node_modules/dual/esm.js'),'export default 1');
  assert.equal(fs.lstat('/workspace/node_modules/ws').type,'symlink');
  assert.equal(fs.readlink('/workspace/node_modules/ws'),'/workspace/packages/ws');
  assert.equal(fs.realpath('/workspace/node_modules/ws/index.js'),'/workspace/packages/ws/index.js');
  assert.equal(fs.stat('/workspace/node_modules/ws').type,'dir');
});

test('CJS extension fallback differs from ESM exact resolution',async()=>{
  const runtime=await fixture();
  assert.equal(runtime.packages.resolve('./local','/workspace/src/app.cjs',{mode:'cjs'}).path,'/workspace/src/local.js');
  assert.throws(()=>runtime.packages.resolve('./local','/workspace/src/app.mjs',{mode:'esm'}),(e)=>e.code===ErrorCodes.MODULE_NOT_FOUND);
});

test('conditional exports distinguish import and require',async()=>{
  const runtime=await fixture();
  const esm=runtime.packages.resolve('dual','/workspace/src/app.mjs',{mode:'esm'});
  const cjs=runtime.packages.resolve('dual','/workspace/src/app.cjs',{mode:'cjs'});
  assert.equal(esm.path,'/workspace/node_modules/dual/esm.js');
  assert.equal(esm.format,'module');
  assert.equal(cjs.path,'/workspace/node_modules/dual/cjs.cjs');
  assert.equal(cjs.format,'commonjs');
  assert.equal(runtime.packages.resolve('dual/feature/x','/workspace/src/app.mjs',{mode:'esm'}).path,'/workspace/node_modules/dual/node/x.js');
});

test('exports block undeclared deep imports',async()=>{
  const runtime=await fixture();
  assert.throws(()=>runtime.packages.resolve('dual/private.js','/workspace/src/app.mjs',{mode:'esm'}),(e)=>e.code===ErrorCodes.PACKAGE_PATH_NOT_EXPORTED);
});

test('package imports and self-reference use nearest package scope',async()=>{
  const runtime=await fixture();
  assert.equal(runtime.packages.resolve('#internal','/workspace/src/app.mjs',{mode:'esm'}).path,'/workspace/src/internal.js');
  assert.equal(runtime.packages.resolve('app/self','/workspace/src/app.mjs',{mode:'esm'}).path,'/workspace/src/self.js');
});

test('nearest nested node_modules wins',async()=>{
  const runtime=await fixture();
  assert.equal(runtime.packages.resolve('b','/workspace/node_modules/a/index.js',{mode:'cjs'}).path,'/workspace/node_modules/a/node_modules/b/index.js');
  assert.equal(runtime.packages.resolve('b','/workspace/src/app.cjs',{mode:'cjs'}).path,'/workspace/node_modules/b/index.js');
});

test('symlink canonicalization matches cache identity policy',async()=>{
  const runtime=await fixture();
  const canonical=runtime.packages.resolve('ws','/workspace/src/app.cjs',{mode:'cjs'});
  const preserved=runtime.packages.resolve('ws','/workspace/src/app.cjs',{mode:'cjs',preserveSymlinks:true});
  assert.equal(canonical.path,'/workspace/packages/ws/index.js');
  assert.equal(canonical.cacheKey,'/workspace/packages/ws/index.js');
  assert.equal(preserved.path,'/workspace/node_modules/ws/index.js');
});

test('ESM URL query participates in cache identity',async()=>{
  const runtime=await fixture();
  const a=runtime.packages.resolve('./internal.js?x=1','/workspace/src/app.mjs',{mode:'esm'});
  const b=runtime.packages.resolve('./internal.js?x=2','/workspace/src/app.mjs',{mode:'esm'});
  assert.notEqual(a.cacheKey,b.cacheKey);
  assert.match(a.url,/\?x=1$/);
});

test('Node builtin specifiers bypass package filesystem',async()=>{
  const runtime=await fixture();
  assert.deepEqual(runtime.packages.resolve('fs','/workspace/src/app.cjs',{mode:'cjs'}),{kind:'builtin',specifier:'node:fs',url:'node:fs',format:'builtin',cacheKey:'node:fs'});
});


test('browser package aliases substitute package roots without weakening normal resolution',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.mount({'package.json':JSON.stringify({name:'alias-app',type:'module'}),'src/app.mjs':''});
  runtime.packages.mountCatalog({
    packages:[
      {location:'node_modules/rolldown',packageJson:{name:'rolldown',version:'1.2.9',type:'module',exports:{'.':'./dist/index.mjs'}},files:{'dist/index.mjs':'export const target="native"'}},
      {location:'node_modules/@rolldown/browser',packageJson:{name:'@rolldown/browser',version:'1.2.9',type:'module',exports:{'.':{browser:'./dist/index.browser.mjs',default:'./dist/index.mjs'}}},files:{'dist/index.browser.mjs':'export const target="browser"','dist/index.mjs':'export const target="node"'}}
    ]
  });
  const normal=runtime.packages.resolve('rolldown','/workspace/src/app.mjs',{mode:'esm'});
  const browser=runtime.packages.resolve('rolldown','/workspace/src/app.mjs',{
    mode:'esm',
    conditions:['browser','import','default'],
    packageAliases:{rolldown:'@rolldown/browser'}
  });
  assert.equal(normal.path,'/workspace/node_modules/rolldown/dist/index.mjs');
  assert.equal(browser.path,'/workspace/node_modules/@rolldown/browser/dist/index.browser.mjs');
  assert.throws(
    ()=>runtime.packages.resolve('rolldown','/workspace/src/app.mjs',{mode:'esm',packageAliases:{rolldown:'rolldown'}}),
    (error)=>error.code===ErrorCodes.INVALID_ARGUMENT
  );
});
