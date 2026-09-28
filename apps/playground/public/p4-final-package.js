import { OpenContainer } from '/packages/sdk/src/index.js';
import {
  PackageContentStore,
  PackageGraphAuthority,
  PackageScriptCapability,
  inspectTarArchive
} from '/packages/package-env/src/index.js';
import { ErrorCodes } from '/packages/protocol/src/index.js';

const encoder=new TextEncoder();
const decoder=new TextDecoder();

function assert(condition,message,details={}){
  if(condition)return;
  const error=new Error(message);
  error.details=details;
  throw error;
}
function writeOctal(buffer,offset,length,value){
  const text=value.toString(8).padStart(length-1,'0')+'\0';
  buffer.set(encoder.encode(text),offset);
}
function tarEntry(path,content='',type='0'){
  const data=content instanceof Uint8Array?content:encoder.encode(String(content));
  const header=new Uint8Array(512);
  header.set(encoder.encode(path),0);
  writeOctal(header,100,8,type==='5'?0o755:0o644);
  writeOctal(header,108,8,0);writeOctal(header,116,8,0);
  writeOctal(header,124,12,type==='5'?0:data.byteLength);writeOctal(header,136,12,0);
  header.fill(32,148,156);header[156]=type.charCodeAt(0);
  header.set(encoder.encode('ustar\0'),257);header.set(encoder.encode('00'),263);
  let checksum=0;for(const byte of header)checksum+=byte;
  header.set(encoder.encode(checksum.toString(8).padStart(6,'0')+'\0 '),148);
  const padded=Math.ceil(data.byteLength/512)*512;
  const out=new Uint8Array(512+padded);
  out.set(header);out.set(data,512);
  return out;
}
function tar(entries){
  const chunks=entries.map(entry=>tarEntry(entry.path,entry.content,entry.type??'0'));
  const out=new Uint8Array(chunks.reduce((sum,chunk)=>sum+chunk.byteLength,0)+1024);
  let offset=0;
  for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}
  return out;
}
function base64(bytes){
  let binary='';
  for(let i=0;i<bytes.length;i+=0x8000){
    binary+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+0x8000)));
  }
  return btoa(binary);
}
function decodeBase64(value){
  const binary=atob(value);
  const out=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
  return out;
}
async function sri(bytes){
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-512',bytes));
  return 'sha512-'+base64(digest);
}
async function gzip(bytes){
  const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function prng(seed=0x4f504334){
  let state=seed>>>0;
  return ()=>{
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    return state/0x100000000;
  };
}
function mutateBytes(input,random){
  const out=new Uint8Array(input);
  const edits=1+Math.floor(random()*Math.min(6,Math.max(1,out.length)));
  for(let i=0;i<edits;i++){
    if(!out.length)break;
    const index=Math.floor(random()*out.length);
    out[index]^=1<<Math.floor(random()*8);
  }
  return out;
}
function mutateText(input,random){
  return decoder.decode(mutateBytes(encoder.encode(input),random));
}
function assertTypedParserFailure(error,target){
  assert(typeof error?.code==='string'&&error.code.startsWith('OC_'),target+' leaked untyped parser error',{
    error:String(error?.stack??error),
    code:error?.code??null
  });
}
async function runManifest(text){
  const bytes=tar([
    {path:'package/',type:'5'},
    {path:'package/package.json',content:text}
  ]);
  const store=new PackageContentStore();
  return store.ingest({
    contentId:'browser-fuzz:'+text.length+':'+text.charCodeAt(0),
    integrity:await sri(bytes),
    bytes
  });
}

async function parserCourt(){
  const response=await fetch('/compat/p4/PARSER-FUZZ-CORPUS.v1.0.json',{cache:'no-store'});
  assert(response.ok,'P4 fuzz corpus fetch failed',{status:response.status});
  const corpus=await response.json();
  assert(corpus.schema==='opencontainer.p4-parser-fuzz-corpus.v1.0','P4 fuzz corpus schema drifted');
  assert(JSON.stringify(corpus.targets.map(item=>item.id))===JSON.stringify(['tar','gzip','manifest','lockfile']),'P4 fuzz target set drifted');

  const retained=[];
  for(const item of corpus.minimizedFailureInputs){
    let error=null;
    try{
      if(item.target==='tar'||item.target==='gzip')await inspectTarArchive(decodeBase64(item.payloadBase64));
      else if(item.target==='manifest')await runManifest(item.text);
      else if(item.target==='lockfile')new PackageGraphAuthority().compile(item.text);
    }catch(value){error=value;}
    assert(error,item.id+' stopped reproducing');
    assertTypedParserFailure(error,item.target);
    assert(item.expectedCodes.includes(error.code),item.id+' returned unexpected error',{expected:item.expectedCodes,actual:error.code});
    retained.push(Object.freeze({id:item.id,target:item.target,code:error.code}));
  }

  const random=prng(Number.parseInt(corpus.seed.slice(2),16));
  const validTar=tar([
    {path:'package/',type:'5'},
    {path:'package/package.json',content:'{"name":"browser-fuzz","version":"1.0.0"}'},
    {path:'package/index.js',content:'export default 1'}
  ]);
  const validGzip=await gzip(validTar);
  const manifestSeed='{"name":"browser-fuzz","version":"1.0.0","main":"index.js"}';
  const lockfileSeed='{"name":"browser-fuzz","version":"1.0.0","lockfileVersion":3,"packages":{}}';
  const counts={tar:0,gzip:0,manifest:0,lockfile:0,accepted:0,failed:0};
  const failureCodes=new Set();

  for(let i=0;i<128;i++){
    const target=['tar','gzip','manifest','lockfile'][i%4];
    counts[target]++;
    try{
      if(target==='tar')await inspectTarArchive(mutateBytes(validTar,random));
      else if(target==='gzip')await inspectTarArchive(mutateBytes(validGzip,random));
      else if(target==='manifest')await runManifest(mutateText(manifestSeed,random));
      else new PackageGraphAuthority({maxLockfileBytes:2048,maxGraphNodes:32}).compile(mutateText(lockfileSeed,random));
      counts.accepted++;
    }catch(error){
      assertTypedParserFailure(error,target);
      counts.failed++;
      failureCodes.add(error.code);
    }
  }
  assert(counts.accepted+counts.failed===128,'P4 browser fuzz campaign lost mutations',{counts});
  assert(counts.failed>70,'P4 browser fuzz campaign exercised too few rejection branches',{counts});
  assert(failureCodes.has(ErrorCodes.ARCHIVE_UNSAFE),'P4 browser fuzz missed archive fail-closed branch',{failureCodes:[...failureCodes]});
  return Object.freeze({
    retainedCount:retained.length,
    retained:Object.freeze(retained),
    mutations:128,
    counts:Object.freeze(counts),
    failureCodes:Object.freeze([...failureCodes].sort()),
    rawParserExceptions:0
  });
}

async function scriptCourt(){
  const runtime=await OpenContainer.boot();
  try{
    const bytes=tar([
      {path:'package/',type:'5'},
      {path:'package/package.json',content:JSON.stringify({
        name:'scripted',
        version:'1.0.0',
        main:'index.cjs',
        type:'commonjs',
        scripts:{install:'node build.cjs'}
      })},
      {path:'package/index.cjs',content:'module.exports=1'},
      {path:'package/build.cjs',content:'module.exports=1'}
    ]);
    const integrity=await sri(bytes);
    runtime.packages.compile({lockfileVersion:3,packages:{
      'node_modules/scripted':{
        name:'scripted',
        version:'1.0.0',
        resolved:'https://registry.example/scripted.tgz',
        integrity,
        hasInstallScript:true
      }
    }});
    const calls=[];
    const capability=new PackageScriptCapability({
      grants:[{location:'node_modules/scripted',event:'install',command:'node build.cjs'}],
      async execute(context){
        calls.push(context);
        assert(Object.keys(context.env).length===0,'lifecycle capability received ambient env',{context});
        assert(context.secretHandles.length===0,'lifecycle capability received ambient secret handles',{context});
        assert(context.networkSecretHandles.length===0,'lifecycle capability received network secret handles',{context});
        return {exitCode:0};
      }
    });
    const installer=runtime.packages.createFrozenInstaller({
      lifecycleScripts:'authorize',
      scriptCapability:capability
    });
    const receipt=await installer.installAll({
      artifactAuthority:{async fetchArtifact(){return {bytes,redirects:0};}}
    });
    assert(receipt.lifecycleScriptsExecuted.length===1,'authorized lifecycle script was not executed',{receipt});
    assert(receipt.lifecycleScriptsSkipped.length===0,'authorized lifecycle script was silently skipped',{receipt});
    let secretFailure=null;
    try{
      await installer.installAll({
        artifactAuthority:{async fetchArtifact(){return {bytes,redirects:0};}},
        secretHandles:['secret-handle']
      });
    }catch(error){secretFailure=error;}
    assert(secretFailure?.code===ErrorCodes.NETWORK_DENIED,'package install accepted ambient secret handle',{secretFailure});
    return Object.freeze({
      executed:receipt.lifecycleScriptsExecuted.length,
      exactGrant:true,
      ambientEnvKeys:0,
      secretHandleCount:0,
      secretHandleInstallRejected:true,
      executorCalls:calls.length
    });
  }finally{
    await runtime.terminate();
  }
}

async function layoutCourt(){
  const runtime=await OpenContainer.boot();
  try{
    runtime.mount({
      'packages/ws/package.json':'{"name":"ws","version":"1.0.0","main":"index.cjs","type":"commonjs"}',
      'packages/ws/index.cjs':'module.exports=1'
    });
    runtime.packages.compile({
      name:'layout-cycle',
      version:'1',
      lockfileVersion:3,
      packages:{
        '':{name:'layout-cycle',version:'1',dependencies:{a:'1',b:'1',ws:'file:packages/ws'}},
        'node_modules/a':{name:'a',version:'1'},
        'node_modules/b':{name:'b',version:'1'},
        'node_modules/ws':{name:'ws',version:'1',resolved:'packages/ws',link:true}
      }
    });
    const events=[];
    const stop=runtime.packages.watchPackageLayout(event=>events.push(event),{emitInitial:true});
    const first=runtime.packages.mountCatalog({
      packages:[{
        location:'node_modules/a',
        packageJson:{name:'a',version:'1',main:'index.cjs',type:'commonjs'},
        files:{'index.cjs':'module.exports=1'}
      }],
      symlinks:[{path:'/workspace/node_modules/ws',target:'/workspace/packages/ws'}]
    });
    assert(first.layout.reason==='install','P4 layout watcher missed install',{first:first.layout});
    assert(JSON.stringify(runtime.packages.nodeModules.readdir('/workspace/node_modules'))===JSON.stringify(['a','ws']),'P4 package readdir drifted after install');
    assert(runtime.packages.nodeModules.realpath('/workspace/node_modules/ws/index.cjs')==='/workspace/packages/ws/index.cjs','P4 package realpath drifted after install');

    const reinstall=runtime.packages.mountCatalog({
      packages:[
        {
          location:'node_modules/a',
          packageJson:{name:'a',version:'2',main:'index.cjs',type:'commonjs'},
          files:{'index.cjs':'module.exports=2'}
        },
        {
          location:'node_modules/b',
          packageJson:{name:'b',version:'1',main:'index.cjs',type:'commonjs'},
          files:{'index.cjs':'module.exports=3'}
        }
      ],
      symlinks:[{path:'/workspace/node_modules/ws',target:'/workspace/packages/ws'}]
    });
    assert(reinstall.layout.reason==='reinstall','P4 layout watcher missed direct reinstall',{layout:reinstall.layout});
    assert(JSON.stringify(runtime.packages.nodeModules.readdir('/workspace/node_modules'))===JSON.stringify(['a','b','ws']),'P4 package readdir drifted after reinstall');

    const removed=runtime.packages.unmountCatalog();
    assert(removed.reason==='remove'&&removed.mounted===false,'P4 layout watcher missed remove',{removed});
    const finalInstall=runtime.packages.mountCatalog({
      packages:[{
        location:'node_modules/a',
        packageJson:{name:'a',version:'3',main:'index.cjs',type:'commonjs'},
        files:{'index.cjs':'module.exports=3'}
      }],
      symlinks:[{path:'/workspace/node_modules/ws',target:'/workspace/packages/ws'}]
    });
    assert(finalInstall.layout.reason==='install','P4 layout watcher missed post-remove install',{layout:finalInstall.layout});
    assert(runtime.packages.nodeModules.realpath('/workspace/node_modules/ws/index.cjs')==='/workspace/packages/ws/index.cjs','P4 package realpath drifted after reinstall cycle');
    stop();
    assert(JSON.stringify(events.map(event=>event.reason))===JSON.stringify(['unmounted','install','reinstall','remove','install']),'P4 package layout event sequence drifted',{events});
    return Object.freeze({
      reasons:Object.freeze(events.map(event=>event.reason)),
      catalogGenerations:Object.freeze(events.map(event=>event.catalogGeneration)),
      readdirAfterInstall:Object.freeze(['a','ws']),
      readdirAfterReinstall:Object.freeze(['a','b','ws']),
      realpath:'/workspace/packages/ws/index.cjs',
      genericFsWatchClaimed:false
    });
  }finally{
    await runtime.terminate();
  }
}

function percentile(values,p){
  const sorted=[...values].sort((a,b)=>a-b);
  const index=Math.min(sorted.length-1,Math.max(0,Math.ceil((p/100)*sorted.length)-1));
  return sorted[index];
}
function measureGraph(lock,expectedNodes,iterations=30){
  for(let i=0;i<5;i++){
    const graph=new PackageGraphAuthority().compile(lock);
    assert(graph.nodes.length===expectedNodes,'P4 graph warmup node count drifted',{expectedNodes,actual:graph.nodes.length});
  }
  const values=[];
  for(let i=0;i<iterations;i++){
    const start=performance.now();
    const graph=new PackageGraphAuthority().compile(lock);
    values.push(performance.now()-start);
    assert(graph.nodes.length===expectedNodes,'P4 measured graph node count drifted',{expectedNodes,actual:graph.nodes.length});
  }
  return Object.freeze({
    nodes:expectedNodes,
    iterations,
    p50Ms:percentile(values,50),
    p95Ms:percentile(values,95),
    maxMs:Math.max(...values),
    minMs:Math.min(...values)
  });
}
async function performanceCourt(){
  const [viteResponse,chokidarResponse]=await Promise.all([
    fetch('/compat/p4/vite-react-tiny.package-lock.json',{cache:'no-store'}),
    fetch('/compat/p4/chokidar.package-lock.json',{cache:'no-store'})
  ]);
  assert(viteResponse.ok&&chokidarResponse.ok,'P4 real graph fixtures could not be loaded');
  const [vite,chokidar]=await Promise.all([viteResponse.json(),chokidarResponse.json()]);
  const viteMeasure=measureGraph(vite,219);
  const chokidarMeasure=measureGraph(chokidar,8);
  assert(Number.isFinite(viteMeasure.p95Ms)&&viteMeasure.p95Ms<5000,'P4 Vite graph-load measurement invalid',{viteMeasure});
  assert(Number.isFinite(chokidarMeasure.p95Ms)&&chokidarMeasure.p95Ms<5000,'P4 Chokidar graph-load measurement invalid',{chokidarMeasure});
  return Object.freeze({
    clock:'browser-performance.now',
    warmupIterations:5,
    viteReactTiny:viteMeasure,
    chokidar:chokidarMeasure,
    thresholdClaimed:false
  });
}

async function run(){
  const parser=await parserCourt();
  const scripts=await scriptCourt();
  const layout=await layoutCourt();
  const graphLoad=await performanceCourt();
  return Object.freeze({
    schema:'opencontainer.p4-final-package.v1.0',
    status:'PASS',
    browser:navigator.userAgent,
    crossOriginIsolated:globalThis.crossOriginIsolated,
    sourceGates:Object.freeze(['P4-07','P4-13','P4-15','P4-16']),
    parser,
    scripts,
    layout,
    graphLoad
  });
}

globalThis.__p4FinalPackageCourt=Object.freeze({run});
document.body.dataset.ready='true';
document.getElementById('result').textContent='ready';
