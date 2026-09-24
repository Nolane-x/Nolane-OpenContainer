import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';
import { MemoryVFS } from '../packages/vfs/src/index.js';
import { ResourceGovernor } from '../packages/resources/src/index.js';
import { NetworkAuthority } from '../packages/network/src/index.js';
import { PreviewAuthority } from '../packages/preview/src/index.js';
import { PackageGraphAuthority } from '../packages/package-env/src/index.js';
import { certifyToolchain, FrozenToolchains } from '../packages/toolchain/src/index.js';

async function expectCode(action,code){try{await action();assert.fail('expected '+code);}catch(error){assert.equal(error.code,code);}}

test('runtime boots and terminates monotonically',async()=>{
  const runtime=await OpenContainer.boot();
  assert.equal(runtime.state,'READY');
  for(const surface of ['fs','process','packages','net','preview','snapshots','resources','diagnostics'])assert.ok(runtime[surface]);
  await runtime.terminate();assert.equal(runtime.state,'TERMINATED');
});

test('boot is idempotent',async()=>{
  const runtime=new OpenContainer();const [a,b]=await Promise.all([runtime.boot(),runtime.boot()]);
  assert.equal(a,runtime);assert.equal(b,runtime);
});

test('VFS reads and rejects stale writers',async()=>{
  const fs=new MemoryVFS();fs.mount({'package.json':'{"name":"demo"}','src/index.js':'export default 1'});
  assert.equal(fs.readFile('package.json'),'{"name":"demo"}');assert.deepEqual(fs.readdir('/workspace'),['package.json','src']);
  const a=fs.beginTransaction(),b=fs.beginTransaction();a.writeFile('a.txt','a').commit();
  await expectCode(()=>Promise.resolve(b.writeFile('b.txt','b').commit()),ErrorCodes.STALE_GENERATION);assert.equal(fs.exists('b.txt'),false);
});

test('VFS contains guest paths',async()=>{
  const fs=new MemoryVFS();
  await expectCode(()=>Promise.resolve(fs.stat('/etc/passwd')),ErrorCodes.PATH_ESCAPE);
  await expectCode(()=>Promise.resolve(fs.mount({'../../escape':'x'})),ErrorCodes.PATH_ESCAPE);
});

test('resource leases reserve and release',async()=>{
  const resources=new ResourceGovernor({processes:1,outputBytes:100,memoryBytes:100,workers:1});const lease=resources.reserve({processes:1});
  assert.equal(resources.usage.processes,1);await expectCode(()=>Promise.resolve(resources.reserve({processes:1})),ErrorCodes.RESOURCE_EXHAUSTED);
  assert.equal(lease.release(),true);assert.equal(lease.release(),false);assert.equal(resources.usage.processes,0);
});

test('registered virtual process executes',async()=>{
  const runtime=await OpenContainer.boot({resources:{processes:1,outputBytes:1024}});
  runtime.registerCommand('echo',({args,stdout})=>{stdout(args.join(' '));return 0;});
  const process=runtime.spawn('echo',['hello','world']);assert.equal(await process.exit,0);assert.equal(process.stdout.toString(),'hello world');
  assert.equal(runtime.resources.usage.processes,0);
});

test('unknown command is rejected',async()=>{
  const runtime=await OpenContainer.boot();await expectCode(()=>Promise.resolve(runtime.spawn('missing')),ErrorCodes.COMMAND_NOT_FOUND);
});

test('package graph separates content and instance identity',()=>{
  const graph=new PackageGraphAuthority().compile({name:'x',version:'1',lockfileVersion:3,packages:{
    '':{name:'x',version:'1'},'node_modules/a':{name:'a',version:'1.2.3',integrity:'sha512-abc',bin:{a:'bin.js'}},
    'node_modules/nested/node_modules/a':{name:'a',version:'1.2.3',integrity:'sha512-abc'}
  }});
  assert.equal(graph.nodes.length,2);assert.equal(graph.nodes[0].contentId,graph.nodes[1].contentId);assert.notEqual(graph.nodes[0].instanceId,graph.nodes[1].instanceId);
});

test('network is deny by default',async()=>{
  const net=new NetworkAuthority();await expectCode(()=>Promise.resolve(net.authorize('https://example.com/api')),ErrorCodes.NETWORK_DENIED);
  net.allow({origin:'https://example.com',methods:['GET'],paths:['/api/']});assert.equal(net.authorize('https://example.com/api/v1').origin,'https://example.com');
  await expectCode(()=>Promise.resolve(net.authorize('http://127.0.0.1:3000')),ErrorCodes.NETWORK_DENIED);
});

test('preview rejects stale route proof',async()=>{
  const preview=new PreviewAuthority();const old=preview.publish({port:3000,owner:'p1',handler:()=>new Response('old')});
  const current=preview.publish({port:3000,owner:'p2',handler:()=>new Response('new')});
  await expectCode(()=>preview.dispatch(3000,{},old),ErrorCodes.PREVIEW_STALE);assert.equal(await (await preview.dispatch(3000,{},current)).text(),'new');
});

test('snapshot and export import restore state',async()=>{
  const runtime=await OpenContainer.boot();runtime.mount({'a.txt':'one'});const snap=runtime.snapshots.create();
  runtime.fs.beginTransaction().writeFile('a.txt','two').commit();runtime.snapshots.restore(snap.id);assert.equal(runtime.fs.readFile('a.txt'),'one');
  const archive=runtime.snapshots.export();const second=await OpenContainer.boot();second.snapshots.import(archive);assert.equal(second.fs.readFile('a.txt'),'one');
});

test('diagnostics redact secrets',async()=>{
  const runtime=await OpenContainer.boot();runtime.diagnostics.record('request',{authorization:'Bearer abcdefghijklmnopqrstuvwxyz',nested:{apiKey:'secret'}});
  const entry=runtime.diagnostics.list().at(-1);assert.equal(entry.detail.authorization,'[REDACTED]');assert.equal(entry.detail.nested.apiKey,'[REDACTED]');
});

test('toolchain exact profile passes and skew fails',async()=>{
  assert.equal(certifyToolchain({...FrozenToolchains.vite830}).status,'EXACT_PROFILE');
  await expectCode(()=>Promise.resolve(certifyToolchain({...FrozenToolchains.vite830,rolldownBinding:'1.2.8'})),ErrorCodes.TOOLCHAIN_SKEW);
});
