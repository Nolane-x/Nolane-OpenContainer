import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticJournal } from '../packages/diagnostics/src/index.js';
import { NetworkAuthority, canonicalizeExternalUrl } from '../packages/network/src/index.js';
import { PackageGraphAuthority, inspectTarArchive } from '../packages/package-env/src/index.js';
import { MemoryPersistenceAuthority } from '../packages/persistence/src/index.js';
import { WorkerRpcAuthority } from '../packages/process/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';
import { MemoryVFS } from '../packages/vfs/src/index.js';

function prng(seed=0x12c0ffee){
  let state=seed>>>0;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/0x100000000;};
}
const random=prng();
const alphabet=['a','b','.','..','%2e','\\','/','\0','node_modules','opencontainer','é'];
function generatedPath(){
  const count=1+Math.floor(random()*8);
  return Array.from({length:count},()=>alphabet[Math.floor(random()*alphabet.length)]).join('/');
}

test('P12 path parser campaign never returns a guest path outside /workspace',()=>{
  const fs=new MemoryVFS();
  for(let i=0;i<300;i++){
    const path=generatedPath();
    try{
      const resolved=fs.normalize(path);
      assert.ok(resolved==='/workspace'||resolved.startsWith('/workspace/'),resolved);
      assert.equal(resolved.startsWith('/opencontainer'),false);
    }catch(error){
      assert.ok([ErrorCodes.PATH_ESCAPE,ErrorCodes.INTERNAL_PATH,ErrorCodes.INVALID_ARGUMENT].includes(error?.code),String(error?.stack??error));
    }
  }
});

test('P12 URL and network capability parser campaign fails closed on ambiguous authority inputs',()=>{
  const net=new NetworkAuthority().allow({origin:'https://example.com',methods:['GET'],paths:['/api/']});
  const adversarial=[
    'https://user:pass@example.com/api/x',
    'https://example.com\\evil.test/api/x',
    'https://%65xample.com/api/x',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://example.com/apix',
    'https://example.com/api/../private',
    'http://127.1/api/x',
    'https://example.com:443/api/x'
  ];
  for(const value of adversarial){
    try{
      const parsed=canonicalizeExternalUrl(value);
      const receipt=net.authorize(parsed.href,{method:'GET'});
      assert.equal(receipt.allowed,true);
      assert.equal(new URL(receipt.url).origin,'https://example.com');
      assert.ok(new URL(receipt.url).pathname.startsWith('/api/'));
    }catch(error){
      assert.ok([ErrorCodes.NETWORK_DENIED,ErrorCodes.INVALID_ARGUMENT].includes(error?.code)||error instanceof TypeError,String(error?.stack??error));
    }
  }
});

test('P12 exports/imports resolver campaign rejects package-root escape targets',()=>{
  const fs=new MemoryVFS();
  fs.mount({
    'package.json':JSON.stringify({name:'app',type:'module',imports:{'#escape':'./../outside.js'}}),
    'src/app.mjs':'',
    'outside.js':'export default 1'
  });
  const packages=new PackageGraphAuthority({fs});
  packages.mountCatalog({
    packages:[{
      location:'node_modules/bad',
      packageJson:{name:'bad',version:'1.0.0',type:'module',exports:{'.':'./../escape.js'}},
      files:{'index.js':'export default 1','escape.js':'export default 2'}
    }]
  });
  assert.throws(()=>packages.resolve('bad','/workspace/src/app.mjs',{mode:'esm'}),error=>error?.code===ErrorCodes.INVALID_PACKAGE_TARGET);
  assert.throws(()=>packages.resolve('#escape','/workspace/src/app.mjs',{mode:'esm'}),error=>error?.code===ErrorCodes.INVALID_PACKAGE_TARGET);
});

test('P12 lockfile and graph parser campaign normalizes malformed and oversized inputs',()=>{
  const fs=new MemoryVFS();
  const packages=new PackageGraphAuthority({fs,maxLockfileBytes:128,maxGraphNodes:2});
  assert.throws(()=>packages.compile('{not json'),error=>error?.code===ErrorCodes.INVALID_PACKAGE_CONFIG);
  assert.throws(()=>packages.compile(JSON.stringify({lockfileVersion:3,padding:'x'.repeat(200),packages:{}})),error=>error?.code===ErrorCodes.RESOURCE_EXHAUSTED);
  assert.throws(()=>packages.compile({lockfileVersion:3,packages:{
    '':{name:'app'},
    'node_modules/a':{name:'a'},
    'node_modules/b':{name:'b'}
  }}),error=>error?.code===ErrorCodes.RESOURCE_EXHAUSTED);
});

test('P12 TAR parser campaign rejects corrupt and non-TAR structural data',async()=>{
  const corrupt=new Uint8Array(1024);
  corrupt[0]=65;
  corrupt[156]=48;
  await assert.rejects(()=>inspectTarArchive(corrupt),error=>error?.code===ErrorCodes.ARCHIVE_UNSAFE);
});

test('P12 diagnostic journal handles structured-clone hostile primitives depth and width without throwing',()=>{
  const journal=new DiagnosticJournal({limit:20,rawBytesLimit:65536,duplicateLimit:4,duplicateFingerprintLimit:16});
  const circular={secret:'secret-value-abcdefghijklmnopqrstuvwxyz'};
  circular.self=circular;
  let deep={leaf:1};
  for(let i=0;i<40;i++)deep={next:deep};
  const wide=Object.fromEntries(Array.from({length:300},(_,i)=>['key-'+i,i]));
  assert.doesNotThrow(()=>journal.record('browser-worker.guest-diagnostic',{
    bigint:12345678901234567890n,
    nan:NaN,
    infinity:Infinity,
    circular,
    deep,
    wide,
    huge:'x'.repeat(100000)
  }));
  const text=JSON.stringify(journal.list());
  assert.equal(text.includes('secret-value-abcdefghijklmnopqrstuvwxyz'),false);
  assert.ok(text.includes('[MaxDepth]'));
  assert.ok(text.includes('__truncated__'));
  assert.ok(journal.summary().usage.rawBytes<=journal.summary().limits.rawBytes);
});

test('P12 snapshot/import parser rejects duplicate, malformed and escaping rows without publication',()=>{
  const fs=new MemoryVFS();
  const persistence=new MemoryPersistenceAuthority({fs,maxImportBytes:4096,maxImportEntries:10});
  const before=fs.generation;
  const cases=[
    [JSON.stringify({format:'opencontainer-ndjson',version:1,generation:1}),JSON.stringify({path:'../../escape',entry:{type:'file',data:btoa('x')}})].join('\n')+'\n',
    [JSON.stringify({format:'opencontainer-ndjson',version:1,generation:1}),JSON.stringify({path:'/workspace/a',entry:{type:'unknown'}})].join('\n')+'\n',
    [JSON.stringify({format:'opencontainer-ndjson',version:1,generation:1}),JSON.stringify({path:'/workspace/a',entry:{type:'file',data:btoa('a')}}),JSON.stringify({path:'a',entry:{type:'file',data:btoa('b')}})].join('\n')+'\n'
  ];
  for(const value of cases){
    assert.throws(()=>persistence.import(value),error=>[
      ErrorCodes.IMPORT_INVALID,ErrorCodes.PATH_ESCAPE,ErrorCodes.INVALID_ARGUMENT
    ].includes(error?.code),value);
    assert.equal(fs.generation,before);
  }
});

class MockTransport{
  constructor(){this.sent=[];this.listeners=new Set();}
  postMessage(value){this.sent.push(value);}
  addEventListener(type,fn){if(type==='message')this.listeners.add(fn);}
  removeEventListener(type,fn){if(type==='message')this.listeners.delete(fn);}
}

test('P12 RPC envelope parser ignores malformed stale and mismatched messages',async()=>{
  const transport=new MockTransport();
  const rpc=new WorkerRpcAuthority({transport,maxPending:2});
  const pending=rpc.request('ping',{});
  const request=transport.sent[0];
  for(const value of [
    null,{}, {v:2,type:'response'}, {v:1,type:'request'},
    {v:1,type:'response',session:'stale',epoch:request.epoch,id:request.id,ok:true,value:'bad'},
    {v:1,type:'response',session:request.session,epoch:request.epoch+1,id:request.id,ok:true,value:'bad'},
    {v:1,type:'response',session:request.session,epoch:request.epoch,id:999999,ok:true,value:'bad'}
  ])assert.equal(rpc.receive(value),false);
  assert.equal(rpc.pendingCount,1);
  assert.equal(rpc.receive({v:1,type:'response',session:request.session,epoch:request.epoch,id:request.id,ok:true,value:'ok'}),true);
  assert.equal(await pending,'ok');
  rpc.close();
});
