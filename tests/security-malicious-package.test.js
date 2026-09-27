import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { NetworkAuthority } from '../packages/network/src/index.js';
import { PackageArtifactAuthority, inspectTarArchive } from '../packages/package-env/src/index.js';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';
import { MemoryVFS } from '../packages/vfs/src/index.js';

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
  const out=new Uint8Array(512+Math.ceil(data.byteLength/512)*512);out.set(header);out.set(data,512);return out;
}
function tar(entries){
  const chunks=entries.map(x=>tarEntry(x.path,x.content,x.type??'0'));
  const out=new Uint8Array(chunks.reduce((n,x)=>n+x.byteLength,0)+1024);
  let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}return out;
}
function sri(bytes){return 'sha512-'+createHash('sha512').update(bytes).digest('base64');}
async function expectCode(action,code){
  await assert.rejects(action,error=>error?.code===code,String(code));
}

test('P12 malicious package corpus executes every retained negative case',async()=>{
  const corpus=JSON.parse(await readFile('release/SECURITY-MALICIOUS-PACKAGE-CORPUS.v1.0.json','utf8'));
  const executed=new Set();

  for(const [id,path] of [
    ['MP-01','package/../../escape.js'],
    ['MP-02','/package/escape.js'],
    ['MP-03','package\\..\\escape.js']
  ]){
    await expectCode(()=>inspectTarArchive(tar([{path,content:'bad'}])),ErrorCodes.ARCHIVE_UNSAFE);
    executed.add(id);
  }
  for(const [id,type] of [['MP-04','2'],['MP-05','1']]){
    await expectCode(()=>inspectTarArchive(tar([{path:'package/link',content:'',type}])),ErrorCodes.ARCHIVE_UNSAFE);
    executed.add(id);
  }
  await expectCode(()=>inspectTarArchive(tar([
    {path:'package/a.js',content:'one'},
    {path:'package/a.js',content:'two'}
  ])),ErrorCodes.ARCHIVE_UNSAFE);
  executed.add('MP-06');

  const huge=tar([{path:'package/huge.bin',content:'x'.repeat(8192)}]);
  await expectCode(()=>inspectTarArchive(new Uint8Array(gzipSync(huge)),{maxFiles:1,maxUnpackedBytes:16}),ErrorCodes.ARTIFACT_TOO_LARGE);
  executed.add('MP-07');

  {
    const runtime=await OpenContainer.boot();
    runtime.packages.compile({lockfileVersion:3,packages:{
      'node_modules/evil':{name:'evil',version:'1.0.0',resolved:'https://registry.example/evil.tgz',integrity:'sha512-placeholder',hasInstallScript:true}
    }});
    const installer=runtime.packages.createFrozenInstaller();
    await expectCode(()=>installer.installAll({artifactAuthority:{async fetchArtifact(){throw new Error('must not fetch');}}}),ErrorCodes.INVALID_PACKAGE_CONFIG);
    await runtime.teardown();
    executed.add('MP-08');
  }

  {
    const runtime=await OpenContainer.boot();
    const bytes=tar([
      {path:'package/',type:'5'},
      {path:'package/package.json',content:JSON.stringify({name:'wrong',version:'1.0.0'})}
    ]);
    runtime.packages.compile({lockfileVersion:3,packages:{
      'node_modules/expected':{name:'expected',version:'1.0.0',integrity:sri(bytes)}
    }});
    await expectCode(()=>runtime.packages.createFrozenInstaller().ingestLocation('node_modules/expected',bytes),ErrorCodes.INVALID_PACKAGE_CONFIG);
    await runtime.teardown();
    executed.add('MP-09');
  }

  {
    const runtime=await OpenContainer.boot();
    runtime.packages.compile({lockfileVersion:3,packages:{
      'node_modules/no-integrity':{name:'no-integrity',version:'1.0.0',resolved:'https://registry.example/no.tgz'}
    }});
    await expectCode(()=>runtime.packages.createFrozenInstaller().installAll({artifactAuthority:{async fetchArtifact(){throw new Error('must not fetch');}}}),ErrorCodes.ARTIFACT_INTEGRITY);
    await runtime.teardown();
    executed.add('MP-10');
  }

  {
    const fs=new MemoryVFS();
    const net=new NetworkAuthority().allow({origin:'https://registry.example',methods:['GET'],paths:['/pkg/']});
    const authority=new PackageArtifactAuthority({
      fs,network:net,
      fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://evil.example/payload.tgz'}})
    });
    const bytes=encoder.encode('unused');
    await expectCode(()=>authority.fetchArtifact({url:'https://registry.example/pkg/a.tgz',integrity:sri(bytes)}),ErrorCodes.NETWORK_DENIED);
    executed.add('MP-11');
  }

  assert.deepEqual([...executed].sort(),corpus.cases.map(x=>x.id).sort());
});
