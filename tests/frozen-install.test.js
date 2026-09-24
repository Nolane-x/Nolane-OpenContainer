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
