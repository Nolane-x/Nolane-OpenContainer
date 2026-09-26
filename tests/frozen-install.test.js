import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

const encoder=new TextEncoder();

function writeOctal(buffer,offset,length,value){
  const text=value.toString(8).padStart(length-1,'0')+'\0';
  buffer.set(encoder.encode(text),offset);
}

function tarEntry(path,content='',type='0'){
  const data=content instanceof Uint8Array?content:encoder.encode(content);
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
  const out=new Uint8Array(512+padded);out.set(header);out.set(data,512);return out;
}

function tar(entries){
  const chunks=entries.map((entry)=>tarEntry(entry.path,entry.content,entry.type??'0'));
  const out=new Uint8Array(chunks.reduce((sum,chunk)=>sum+chunk.byteLength,0)+1024);
  let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}return out;
}

function sri(bytes){return 'sha512-'+createHash('sha512').update(bytes).digest('base64');}

function packageTar(name='a',version='1.0.0'){
  return tar([
    {path:'package/',type:'5'},
    {path:'package/package.json',content:JSON.stringify({name,version,main:'index.cjs',type:'commonjs'})},
    {path:'package/index.cjs',content:'module.exports={name:"'+name+'",instance:{}}'}
  ]);
}

test('frozen install stores identical content once for multiple logical instances',async()=>{
  const runtime=await OpenContainer.boot();
  const bytes=packageTar('a','1.0.0'),integrity=sri(bytes);
  runtime.packages.compile({name:'app',version:'1',lockfileVersion:3,packages:{
    '':{name:'app',version:'1'},
    'node_modules/a':{name:'a',version:'1.0.0',integrity},
    'node_modules/nested/node_modules/a':{name:'a',version:'1.0.0',integrity}
  }});

  const installer=runtime.packages.createFrozenInstaller();
  const first=await installer.ingestLocation('node_modules/a',bytes);
  assert.equal(first.reused,false);
  const mounted=installer.mountFrozenGraph();

  assert.equal(mounted.contentCount,1);
  assert.equal(mounted.packageCount,2);
  assert.equal(runtime.packages.resolve('a','/workspace/src/app.cjs',{mode:'cjs'}).path,'/workspace/node_modules/a/index.cjs');
  assert.equal(runtime.packages.resolve('a','/workspace/node_modules/nested/index.cjs',{mode:'cjs'}).path,'/workspace/node_modules/nested/node_modules/a/index.cjs');

  const loader=runtime.packages.createCommonJsLoader({allowDynamicCode:true});
  const rootInstance=loader.require('a','/workspace/src/app.cjs');
  const nestedInstance=loader.require('a','/workspace/node_modules/nested/index.cjs');
  assert.notEqual(rootInstance,nestedInstance);
  assert.equal(rootInstance.name,'a');
  assert.equal(nestedInstance.name,'a');
});

test('workspace links are projected without package artifact content',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.mount({
    'packages/ws/package.json':JSON.stringify({name:'ws',version:'1.0.0',main:'index.cjs',type:'commonjs'}),
    'packages/ws/index.cjs':'module.exports=7'
  });
  runtime.packages.compile({name:'app',version:'1',lockfileVersion:3,packages:{
    '':{name:'app',version:'1'},
    'node_modules/ws':{name:'ws',version:'1.0.0',resolved:'packages/ws',link:true}
  }});
  const installer=runtime.packages.createFrozenInstaller();
  const mounted=installer.mountFrozenGraph();
  assert.equal(mounted.linkCount,1);
  assert.equal(runtime.packages.resolve('ws','/workspace/src/app.cjs',{mode:'cjs'}).path,'/workspace/packages/ws/index.cjs');
});

test('missing verified content prevents graph publication',async()=>{
  const runtime=await OpenContainer.boot();
  const bytes=packageTar('a','1.0.0'),integrity=sri(bytes);
  runtime.packages.compile({lockfileVersion:3,packages:{'node_modules/a':{name:'a',version:'1.0.0',integrity}}});
  const installer=runtime.packages.createFrozenInstaller();
  assert.throws(()=>installer.mountFrozenGraph(),e=>e.code===ErrorCodes.PACKAGE_CONTENT_MISSING);
  assert.equal(runtime.packages.nodeModules,null);
});

test('artifact package identity must agree with lockfile before content publication',async()=>{
  const runtime=await OpenContainer.boot();
  const bytes=packageTar('wrong-name','1.0.0'),integrity=sri(bytes);
  runtime.packages.compile({lockfileVersion:3,packages:{'node_modules/a':{name:'a',version:'1.0.0',integrity}}});
  const installer=runtime.packages.createFrozenInstaller();
  await assert.rejects(()=>installer.ingestLocation('node_modules/a',bytes),e=>e.code===ErrorCodes.INVALID_PACKAGE_CONFIG);
  assert.equal(installer.contentStore.size,0);
});


test('frozen installAll deduplicates content across logical instances',async()=>{
  const runtime=await OpenContainer.boot();
  const bytes=packageTar('a','1.0.0'),integrity=sri(bytes);
  runtime.packages.compile({name:'app',version:'1',lockfileVersion:3,packages:{
    '':{name:'app',version:'1'},
    'node_modules/a':{name:'a',version:'1.0.0',resolved:'https://registry.example/a.tgz',integrity},
    'node_modules/nested/node_modules/a':{name:'a',version:'1.0.0',resolved:'https://registry.example/a.tgz',integrity}
  }});

  const calls=[];
  const progress=[];
  const installer=runtime.packages.createFrozenInstaller();
  const receipt=await installer.installAll({
    artifactAuthority:{
      async fetchArtifact({url,integrity:requestedIntegrity}){
        calls.push(url);
        assert.equal(requestedIntegrity,integrity);
        return {url,bytes,verified:{algorithm:'sha512'},redirects:0};
      }
    },
    concurrency:8,
    onProgress:(value)=>progress.push(value)
  });

  assert.deepEqual(calls,['https://registry.example/a.tgz']);
  assert.equal(receipt.packageInstances,2);
  assert.equal(receipt.requestedContents,1);
  assert.equal(receipt.fetchedContents,1);
  assert.equal(receipt.contentCount,1);
  assert.equal(progress.length,1);
  const mounted=installer.mountFrozenGraph();
  assert.equal(mounted.packageCount,2);
});

test('frozen installAll honors bounded concurrency',async()=>{
  const runtime=await OpenContainer.boot();
  const artifacts={};
  const packages={'':{name:'app',version:'1'}};
  for(const name of ['a','b','c','d']){
    const bytes=packageTar(name,'1.0.0');
    const integrity=sri(bytes);
    artifacts[name]={bytes,integrity};
    packages['node_modules/'+name]={name,version:'1.0.0',resolved:'https://registry.example/'+name+'.tgz',integrity};
  }
  runtime.packages.compile({lockfileVersion:3,packages});
  let active=0,maxActive=0;
  const installer=runtime.packages.createFrozenInstaller();
  const receipt=await installer.installAll({
    concurrency:2,
    artifactAuthority:{
      async fetchArtifact({url}){
        active++;maxActive=Math.max(maxActive,active);
        await new Promise(resolve=>setTimeout(resolve,5));
        const name=url.split('/').pop().replace('.tgz','');
        active--;
        return {url,bytes:artifacts[name].bytes,redirects:0};
      }
    }
  });
  assert.equal(receipt.fetchedContents,4);
  assert.ok(maxActive<=2);
  assert.ok(maxActive>=1);
});

test('frozen installAll aborts before requesting more content',async()=>{
  const runtime=await OpenContainer.boot();
  const bytes=packageTar('a','1.0.0'),integrity=sri(bytes);
  runtime.packages.compile({lockfileVersion:3,packages:{
    'node_modules/a':{name:'a',version:'1.0.0',resolved:'https://registry.example/a.tgz',integrity}
  }});
  const controller=new AbortController();
  controller.abort('stop');
  const installer=runtime.packages.createFrozenInstaller();
  await assert.rejects(
    ()=>installer.installAll({
      signal:controller.signal,
      artifactAuthority:{fetchArtifact:async()=>{throw new Error('must not fetch');}}
    }),
    e=>e.code===ErrorCodes.INVALID_STATE&&/aborted/.test(e.message)
  );
});


test('Vite dependency closure excludes optional native Rolldown bindings and retains bundled dependencies',async()=>{
  const {readFile}=await import('node:fs/promises');
  const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
  const runtime=await OpenContainer.boot();
  runtime.packages.compile(lock);
  const closure=runtime.packages.selectDependencyClosure({roots:['vite']});

  assert.ok(closure.locations.includes('node_modules/vite'));
  assert.ok(closure.locations.includes('node_modules/rolldown'));
  assert.ok(closure.locations.includes('node_modules/lightningcss'));
  assert.ok(closure.locations.includes('node_modules/lightningcss/node_modules/napi-wasm'));
  assert.ok(closure.locations.includes('node_modules/postcss'));
  assert.ok(closure.locations.includes('node_modules/tinyglobby'));
  assert.equal(closure.locations.some(location=>location.includes('@rolldown/binding-')),false);
  assert.ok(closure.optionalSkipped.some(location=>location.includes('@rolldown/binding-')));
  assert.ok(closure.optionalSkipped.includes('node_modules/fsevents'));

  const bundled=runtime.packages.graph.nodes.find(node=>node.location==='node_modules/lightningcss/node_modules/napi-wasm');
  assert.equal(bundled.inBundle,true);
});

test('installAll skips inBundle nodes because parent artifact owns their bytes',async()=>{
  const runtime=await OpenContainer.boot();
  const parentBytes=packageTar('parent','1.0.0'),integrity=sri(parentBytes);
  runtime.packages.compile({lockfileVersion:3,packages:{
    'node_modules/parent':{name:'parent',version:'1.0.0',resolved:'https://registry.example/parent.tgz',integrity,dependencies:{child:'1'}},
    'node_modules/parent/node_modules/child':{name:'child',version:'1.0.0',inBundle:true}
  }});
  const closure=runtime.packages.selectDependencyClosure({roots:['parent']});
  let calls=0;
  const installer=runtime.packages.createFrozenInstaller();
  const receipt=await installer.installAll({
    locations:closure.locations,
    artifactAuthority:{async fetchArtifact(){calls++;return {bytes:parentBytes,redirects:0};}}
  });
  assert.equal(calls,1);
  assert.equal(receipt.embeddedInstances,1);
});


test('dependency closure includes required peers and excludes absent optional peers by default',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.packages.compile({lockfileVersion:3,packages:{
    '':{name:'app',version:'1'},
    'node_modules/plugin':{
      name:'plugin',version:'1.0.0',
      peerDependencies:{host:'^2.0.0',optionalHost:'^1.0.0'},
      peerDependenciesMeta:{optionalHost:{optional:true}}
    },
    'node_modules/host':{name:'host',version:'2.1.0'}
  }});
  const closure=runtime.packages.selectDependencyClosure({roots:['plugin']});
  assert.ok(closure.locations.includes('node_modules/plugin'));
  assert.ok(closure.locations.includes('node_modules/host'));
  assert.ok(closure.peersIncluded.includes('node_modules/plugin -> node_modules/host'));
  assert.ok(closure.peerOptionalSkipped.includes('node_modules/plugin -> optionalHost'));
});

test('dependency closure fails closed when a required peer is absent',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.packages.compile({lockfileVersion:3,packages:{
    'node_modules/plugin':{name:'plugin',version:'1.0.0',peerDependencies:{host:'^2.0.0'}}
  }});
  assert.throws(
    ()=>runtime.packages.selectDependencyClosure({roots:['plugin']}),
    error=>error.code===ErrorCodes.INVALID_PACKAGE_CONFIG&&/peer dependency/.test(error.message)
  );
});

test('peer policy can explicitly ignore required peers with an audit receipt',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.packages.compile({lockfileVersion:3,packages:{
    'node_modules/plugin':{name:'plugin',version:'1.0.0',peerDependencies:{host:'^2.0.0'}}
  }});
  const closure=runtime.packages.selectDependencyClosure({roots:['plugin'],peerPolicy:'ignore'});
  assert.deepEqual(closure.locations,['node_modules/plugin']);
  assert.deepEqual(closure.peerRequiredIgnored,['node_modules/plugin -> host']);
});

test('frozen installer denies lifecycle scripts unless skip policy is explicit',async()=>{
  const runtime=await OpenContainer.boot();
  const bytes=packageTar('native-ish','1.0.0'),integrity=sri(bytes);
  runtime.packages.compile({lockfileVersion:3,packages:{
    'node_modules/native-ish':{
      name:'native-ish',version:'1.0.0',
      resolved:'https://registry.example/native-ish.tgz',
      integrity,
      hasInstallScript:true
    }
  }});

  const denied=runtime.packages.createFrozenInstaller();
  await assert.rejects(
    ()=>denied.installAll({artifactAuthority:{async fetchArtifact(){throw new Error('policy must reject before fetch');}}}),
    error=>error.code===ErrorCodes.INVALID_PACKAGE_CONFIG&&/lifecycle scripts/.test(error.message)
  );

  const skipped=runtime.packages.createFrozenInstaller({lifecycleScripts:'skip'});
  const receipt=await skipped.installAll({
    artifactAuthority:{async fetchArtifact(){return {bytes,redirects:0};}}
  });
  assert.deepEqual(receipt.lifecycleScriptsSkipped,['node_modules/native-ish']);
  const mounted=skipped.mountFrozenGraph();
  assert.deepEqual(mounted.lifecycleScriptsSkipped,['node_modules/native-ish']);
  assert.equal(mounted.packageCount,1);
});

test('Vite browser closure remains lifecycle-script clean with optional native packages excluded',async()=>{
  const {readFile}=await import('node:fs/promises');
  const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
  const runtime=await OpenContainer.boot();
  runtime.packages.compile(lock);
  const closure=runtime.packages.selectDependencyClosure({roots:['vite']});
  const selected=new Set(closure.locations);
  const scripted=runtime.packages.graph.nodes.filter(node=>selected.has(node.location)&&node.hasInstallScript);
  assert.deepEqual(scripted,[]);
  assert.ok(closure.optionalSkipped.includes('node_modules/fsevents'));
});
