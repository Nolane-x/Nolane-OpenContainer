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
  for(const specifier of ['node:fs','node:fs/promises','node:path','node:path/posix','node:path/win32','node:buffer','node:events','node:process','node:url','node:module','node:crypto','node:perf_hooks','node:util','node:worker_threads','node:child_process','node:dns','node:dns/promises','node:os','node:net','node:tty','node:assert','node:assert/strict','node:v8','node:timers','node:timers/promises','node:readline','node:http','node:https','node:http2','node:tls','node:querystring','node:zlib']){
    const source=await bridge.builtinSource(specifier);
    assert.equal(typeof source,'string');
    assert.ok(source.length>20);
  }
  await assert.rejects(()=>bridge.builtinSource('node:wasi'),e=>e.code===ErrorCodes.BUILTIN_UNAVAILABLE);
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


test('browser node:crypto hash bridge uses Web Crypto with exact SHA-256 bytes',async()=>{
  const {bridge}=fixture();
  const value=await bridge.syncRequestHandler('node.crypto.hash',{
    algorithm:'sha256',
    data:{text:'abc',encoding:'utf8'}
  });
  const hex=value.__opencontainerBytes.map(byte=>byte.toString(16).padStart(2,'0')).join('');
  assert.equal(hex,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});


test('browser node:perf_hooks source binds browser-native performance',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:perf_hooks');
  assert.match(source,/globalThis\.performance/);
  assert.match(source,/export const performance/);
});


test('browser node:util source executes selected Vite helpers',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:util');
  const encoded=Buffer.from(source).toString('base64');
  const util=await import('data:text/javascript;base64,'+encoded+'#'+Date.now());
  assert.equal(util.stripVTControlCharacters('\u001b[31mred\u001b[0m'),'red');
  assert.equal(util.isDeepStrictEqual({a:[1,2]},{a:[1,2]}),true);
  assert.equal(util.isDeepStrictEqual({a:1},{a:2}),false);
  assert.deepEqual({...util.parseEnv('A=1\nB="two"\n# comment')},{A:'1',B:'two'});
  const callback=(value,done)=>done(null,value+1);
  assert.equal(await util.promisify(callback)(41),42);
  assert.equal(util.styleText('red','x'),'\u001b[31mx\u001b[39m');
  assert.equal(util.styleText(['bold','cyan'],'x'),'\u001b[1m\u001b[36mx\u001b[39m\u001b[22m');
  assert.equal(util.styleText('red','x',{validateStream:true,stream:{hasColors:()=>false}}),'x');
  assert.throws(()=>util.styleText('not-a-style','x'),error=>error?.code==='ERR_INVALID_ARG_VALUE');
});

test('browser fs callback realpath supports util.promisify contract',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:fs');
  assert.match(source,/export function realpath\(/);
  assert.match(source,/callback\(null,realpathSync/);
});

test('browser node:fs publishes callback APIs used by Vite',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:fs');
  assert.match(source,/export function readdir\(/);
  assert.match(source,/export function readFile\(/);
  assert.match(source,/export function stat\(/);
  assert.match(source,/export function access\(/);
});

test('browser node:fs/promises exposes constants for Vite imports',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:fs/promises');
  assert.match(source,/export const constants=fs\.constants/);
});


test('browser node:worker_threads keeps logical main-thread semantics and nested Worker fail-closed',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:worker_threads');
  const encoded=Buffer.from(source).toString('base64');
  const wt=await import('data:text/javascript;base64,'+encoded+'#'+Date.now());
  assert.equal(wt.isMainThread,true);
  assert.equal(wt.parentPort,null);
  wt.setEnvironmentData('x',7);
  assert.equal(wt.getEnvironmentData('x'),7);
  assert.throws(()=>new wt.Worker('x'),error=>error?.code==='OC_BUILTIN_UNAVAILABLE');
});


test('browser node:child_process never escapes to host OS',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:child_process');
  const encoded=Buffer.from(source).toString('base64');
  const cp=await import('data:text/javascript;base64,'+encoded+'#'+Date.now());
  assert.throws(()=>cp.spawn('node'),error=>error?.code==='OC_BUILTIN_UNAVAILABLE');
  await new Promise((resolve,reject)=>{
    cp.exec('echo unsafe',(error,stdout,stderr)=>{
      try{
        assert.equal(error?.code,'OC_BUILTIN_UNAVAILABLE');
        assert.equal(stdout,'');
        assert.equal(stderr,'');
        resolve();
      }catch(cause){reject(cause);}
    });
  });
});


test('browser dns/os/net profile is deterministic and privacy-preserving',async()=>{
  const {bridge}=fixture();
  const importSource=async(specifier)=>{
    const source=await bridge.builtinSource(specifier);
    return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')+'#'+encodeURIComponent(specifier)+Date.now());
  };
  const dns=await importSource('node:dns');
  assert.deepEqual(await dns.promises.lookup('localhost'),{address:'127.0.0.1',family:4});
  await assert.rejects(()=>dns.promises.lookup('example.com'),error=>error?.code==='ENOTFOUND');
  const os=await importSource('node:os');
  assert.deepEqual(Object.keys(os.networkInterfaces()),['lo']);
  assert.equal(os.platform(),'linux');
  assert.equal(os.arch(),'wasm32');
  const net=await importSource('node:net');
  assert.equal(net.isIPv4('127.0.0.1'),true);
  assert.equal(net.isIPv6('::1'),true);
  assert.equal(net.isIP('example.com'),0);
  assert.throws(()=>net.createServer(),error=>error?.code==='OC_BUILTIN_UNAVAILABLE');
});


test('browser node:tty reports a non-interactive logical terminal without host leakage',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:tty');
  const encoded=Buffer.from(source).toString('base64');
  const tty=await import('data:text/javascript;base64,'+encoded+'#'+Date.now());
  assert.equal(tty.isatty(0),false);
  const stdout=new tty.WriteStream(1);
  assert.equal(stdout.isTTY,false);
  assert.equal(stdout.getColorDepth(),1);
  assert.equal(stdout.hasColors(),false);
  assert.deepEqual(stdout.getWindowSize(),[0,0]);
});


test('browser node:assert preserves failures instead of stubbing assertions',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:assert');
  const utilSource=await bridge.builtinSource('node:util');
  // Resolve the synthetic node:util import for the data-URL court.
  const rewritten=source.replace("from 'node:util'","from 'data:text/javascript;base64,"+Buffer.from(utilSource).toString('base64')+"'");
  const assertModule=await import('data:text/javascript;base64,'+Buffer.from(rewritten).toString('base64')+'#'+Date.now());
  assertModule.strictEqual(4,4);
  assertModule.deepStrictEqual({a:[1,2]},{a:[1,2]});
  assert.throws(()=>assertModule.strictEqual(4,5),error=>error?.code==='ERR_ASSERTION');
  assert.throws(()=>assertModule.ok(false),error=>error?.code==='ERR_ASSERTION');
});


test('browser node:v8 exposes only deterministic logical metadata and denies host introspection',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:v8');
  const encoded=Buffer.from(source).toString('base64');
  const v8=await import('data:text/javascript;base64,'+encoded+'#'+Date.now());
  const heap=v8.getHeapStatistics();
  assert.equal(heap.heap_size_limit,256*1024*1024);
  assert.equal(heap.used_heap_size,0);
  assert.deepEqual(v8.getHeapSpaceStatistics(),[]);
  assert.throws(()=>v8.writeHeapSnapshot(),error=>error?.code==='OC_BUILTIN_UNAVAILABLE');
  assert.throws(()=>v8.serialize({secret:true}),error=>error?.code==='OC_BUILTIN_UNAVAILABLE');
});


test('browser timers/promises uses browser timers and honors AbortSignal',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:timers/promises');
  const encoded=Buffer.from(source).toString('base64');
  const timers=await import('data:text/javascript;base64,'+encoded+'#'+Date.now());
  assert.equal(await timers.setTimeout(1,42),42);
  const controller=new AbortController();
  controller.abort();
  await assert.rejects(()=>timers.setTimeout(10,1,{signal:controller.signal}),error=>error?.code==='ABORT_ERR');
});

test('browser readline and process stdio stay non-interactive',async()=>{
  const {bridge}=fixture();
  const readlineSource=await bridge.builtinSource('node:readline');
  const readline=await import('data:text/javascript;base64,'+Buffer.from(readlineSource).toString('base64')+'#'+Date.now());
  assert.equal(readline.clearLine(null,0),true);
  const processSource=await bridge.builtinSource('node:process');
  assert.match(processSource,/isTTY:false/);
  assert.match(processSource,/export \{ stdout, stderr, stdin \}/);
});


test('browser HTTP family exposes metadata but never opens host sockets',async()=>{
  const {bridge}=fixture();
  const encode=(source)=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
  const importSynthetic=async(specifier)=>{
    let source=await bridge.builtinSource(specifier);
    if(specifier==='node:https'){
      const http=await bridge.builtinSource('node:http');
      source=source.replace("from 'node:http'","from '"+encode(http)+"'");
    }
    return import(encode(source)+'#'+encodeURIComponent(specifier)+Date.now());
  };
  const http=await importSynthetic('node:http');
  assert.equal(http.STATUS_CODES[200],'OK');
  assert.equal(http.createServer().listening,false);
  assert.throws(()=>http.get('http://example.com'),error=>error?.code==='OC_BUILTIN_UNAVAILABLE');
  const https=await importSynthetic('node:https');
  assert.throws(()=>https.get('https://example.com'),error=>error?.code==='OC_BUILTIN_UNAVAILABLE');
  const http2=await importSynthetic('node:http2');
  assert.throws(()=>http2.connect('https://example.com'),error=>error?.code==='OC_BUILTIN_UNAVAILABLE');
  const tls=await importSynthetic('node:tls');
  assert.throws(()=>tls.connect(443,'example.com'),error=>error?.code==='OC_BUILTIN_UNAVAILABLE');
});


test('browser node:querystring preserves repeated keys and form decoding',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:querystring');
  const qs=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')+'#'+Date.now());
  assert.deepEqual({...qs.parse('a=1&a=2&hello=hello+world')},{a:['1','2'],hello:'hello world'});
  assert.equal(qs.stringify({a:['1','2'],hello:'hello world'}),'a=1&a=2&hello=hello%20world');
  assert.equal(qs.unescape('a%2Fb'),'a/b');
});


test('browser node:zlib exposes async browser codecs and fails unsupported sync APIs closed',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:zlib');
  const zlib=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')+'#'+Date.now());
  assert.throws(()=>zlib.gzipSync('x'),error=>error?.code==='OC_BUILTIN_UNAVAILABLE');
  if(typeof CompressionStream==='function'&&typeof DecompressionStream==='function'){
    const compressed=await new Promise((resolve,reject)=>zlib.gzip('hello',(error,value)=>error?reject(error):resolve(value)));
    const restored=await new Promise((resolve,reject)=>zlib.gunzip(compressed,(error,value)=>error?reject(error):resolve(value)));
    assert.equal(Buffer.from(restored).toString('utf8'),'hello');
  }
});


test('browser node:url synthetic module binds WHATWG globals as lexical exports',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:url');
  assert.match(source,/export const URL=globalThis\.URL/);
  assert.match(source,/export const URLSearchParams=globalThis\.URLSearchParams/);
});


test('browser node:path exposes lexical win32 helpers without host OS access',async()=>{
  const {bridge}=fixture();
  const source=await bridge.builtinSource('node:path');
  const path=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')+'#'+Date.now());
  assert.equal(path.win32.sep,'\\\\');
  assert.equal(path.win32.join('C:\\\\root','.\\\\fixtures\\\\basic.js'),'C:\\\\root\\\\fixtures\\\\basic.js');
  assert.equal(path.win32.isAbsolute('C:\\\\root\\\\x'),true);
  assert.equal(path.win32.basename('C:\\\\root\\\\a.txt'), 'a.txt');
});
