import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryVFS } from '../packages/vfs/src/index.js';
import { VirtualNodeModulesFS } from '../packages/package-env/src/virtual-node-modules.js';
import { createBrowserNodeCompatBridge } from '../packages/package-env/src/browser-node-compat.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

function fixture(){
  const base=new MemoryVFS();
  base.mount({'src/a.txt':'hello'});
  const fs=new VirtualNodeModulesFS({baseFs:base});
  const resolver={
    resolve(specifier,issuer){
      if(specifier==='fs'||specifier==='node:fs')return {kind:'builtin',specifier:'node:fs'};
      if(specifier==='pkg')return {kind:'file',path:'/workspace/node_modules/pkg/index.cjs'};
      if(specifier.startsWith('./'))return {kind:'file',path:'/workspace/src/'+specifier.slice(2)};
      const error=new Error('not found');error.code=ErrorCodes.MODULE_NOT_FOUND;throw error;
    }
  };
  return {base,fs,bridge:createBrowserNodeCompatBridge({fs,writableFs:base,cwd:'/workspace',resolver})};
}

test('browser Node compat fs host bridge reads and writes WorkspaceFS',async()=>{
  const {base,bridge}=fixture();
  const read=await bridge.syncRequestHandler('node.fs.readFileSync',{path:'/workspace/src/a.txt',options:'utf8'});
  assert.equal(read,'hello');
  await bridge.syncRequestHandler('node.fs.writeFileSync',{path:'/workspace/src/b.txt',data:'world',options:'utf8'});
  assert.equal(base.readFile('/workspace/src/b.txt'),'world');
});

test('browser Node compat path and process share logical cwd',async()=>{
  const {bridge}=fixture();
  assert.equal(await bridge.syncRequestHandler('node.process.cwd'),'/workspace');
  assert.equal(await bridge.syncRequestHandler('node.path.join',{args:['/workspace','src','..','x']}),'/workspace/x');
  await bridge.syncRequestHandler('node.process.chdir',{directory:'src'});
  assert.equal(await bridge.syncRequestHandler('node.process.cwd'),'/workspace/src');
  assert.equal(await bridge.syncRequestHandler('node.path.resolve',{args:['a.txt']}),'/workspace/src/a.txt');
});

test('browser Node compat exposes promoted native ESM builtin sources',async()=>{
  const {bridge}=fixture();
  for(const specifier of ['node:fs','node:fs/promises','node:path','node:path/posix','node:buffer','node:events','node:process','node:url','node:module']){
    const source=await bridge.builtinSource(specifier);
    assert.equal(typeof source,'string');
    assert.ok(source.length>20);
  }
  await assert.rejects(()=>bridge.builtinSource('node:crypto'),e=>e.code===ErrorCodes.BUILTIN_UNAVAILABLE);
});


test('browser node:module resolve maps publication URL issuers back to VFS authority',async()=>{
  const {bridge}=fixture();
  assert.equal(
    await bridge.syncRequestHandler('node.module.resolve',{
      specifier:'pkg',
      issuer:'http://127.0.0.1:4187/__opencontainer__/esm/session/fs/workspace/node_modules/vite/dist/node/index.js'
    }),
    '/workspace/node_modules/pkg/index.cjs'
  );
  assert.equal(
    await bridge.syncRequestHandler('node.module.resolve',{
      specifier:'node:fs',
      issuer:'/workspace/src/main.mjs'
    }),
    'node:fs'
  );
});
