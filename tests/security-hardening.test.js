import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { inspectTarArchive, PackageGraphAuthority } from '../packages/package-env/src/index.js';
import { MemoryPersistenceAuthority } from '../packages/persistence/src/index.js';
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
  const out=new Uint8Array(512+Math.ceil(data.byteLength/512)*512);
  out.set(header);out.set(data,512);return out;
}
function tar(entries){
  const chunks=entries.map(x=>tarEntry(x.path,x.content,x.type??'0'));
  const out=new Uint8Array(chunks.reduce((n,x)=>n+x.byteLength,0)+1024);
  let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}
  return out;
}

test('gzip archive expansion is bounded while streaming before full decompressed buffering',async()=>{
  const raw=tar([{path:'package/huge.bin',content:'x'.repeat(8192)}]);
  const compressed=new Uint8Array(gzipSync(raw));
  await assert.rejects(
    ()=>inspectTarArchive(compressed,{maxFiles:1,maxUnpackedBytes:16}),
    error=>error?.code===ErrorCodes.ARTIFACT_TOO_LARGE&&error?.details?.phase==='decompression'
  );
});

test('duplicate tar paths are rejected before package publication',async()=>{
  const bytes=tar([
    {path:'package/a.js',content:'first'},
    {path:'package/a.js',content:'second'}
  ]);
  await assert.rejects(
    ()=>inspectTarArchive(bytes),
    error=>error?.code===ErrorCodes.ARCHIVE_UNSAFE&&/Duplicate archive entry/.test(error.message)
  );
});

test('VFS restore rejects duplicate canonical snapshot paths',()=>{
  const fs=new MemoryVFS();
  assert.throws(
    ()=>fs.restore({version:1,generation:1,entries:[
      ['/workspace/a.txt',{type:'file',data:btoa('a')}],
      ['a.txt',{type:'file',data:btoa('b')}]
    ]}),
    error=>error?.code===ErrorCodes.IMPORT_INVALID&&/Duplicate snapshot path/.test(error.message)
  );
});

test('streaming import enforces byte and entry budgets before canonical publication',async()=>{
  const fs=new MemoryVFS();
  const persistence=new MemoryPersistenceAuthority({fs,maxImportBytes:4096,maxImportEntries:1});
  const initial=fs.generation;
  const tooMany=[
    JSON.stringify({format:'opencontainer-ndjson',version:1,generation:1}),
    JSON.stringify({path:'/workspace/a.txt',entry:{type:'file',data:btoa('a')}}),
    JSON.stringify({path:'/workspace/b.txt',entry:{type:'file',data:btoa('b')}})
  ].join('\n')+'\n';
  assert.throws(()=>persistence.import(tooMany),error=>error?.code===ErrorCodes.RESOURCE_EXHAUSTED);
  assert.equal(fs.generation,initial);

  const limited=new MemoryPersistenceAuthority({fs,maxImportBytes:256,maxImportEntries:10});
  const oversized=new ReadableStream({start(controller){controller.enqueue(encoder.encode('x'.repeat(300)));controller.close();}});
  await assert.rejects(()=>limited.importStream(oversized),error=>error?.code===ErrorCodes.RESOURCE_EXHAUSTED);
  assert.equal(fs.generation,initial);
});

test('malformed import row fails closed instead of reaching VFS with ambiguous shape',()=>{
  const fs=new MemoryVFS();
  const persistence=new MemoryPersistenceAuthority({fs});
  const input=[
    JSON.stringify({format:'opencontainer-ndjson',version:1,generation:1}),
    JSON.stringify({path:'/workspace/a.txt',entry:null})
  ].join('\n')+'\n';
  assert.throws(()=>persistence.import(input),error=>error?.code===ErrorCodes.IMPORT_INVALID);
});

test('package-lock text and graph node counts are independently bounded',()=>{
  const fs=new MemoryVFS();
  const bytesBounded=new PackageGraphAuthority({fs,maxLockfileBytes:64,maxGraphNodes:10});
  assert.throws(
    ()=>bytesBounded.compile(JSON.stringify({lockfileVersion:3,padding:'x'.repeat(128),packages:{}})),
    error=>error?.code===ErrorCodes.RESOURCE_EXHAUSTED
  );

  const graphBounded=new PackageGraphAuthority({fs,maxLockfileBytes:4096,maxGraphNodes:2});
  assert.throws(
    ()=>graphBounded.compile({lockfileVersion:3,packages:{
      '':{name:'app',version:'1'},
      'node_modules/a':{name:'a',version:'1'},
      'node_modules/b':{name:'b',version:'1'}
    }}),
    error=>error?.code===ErrorCodes.RESOURCE_EXHAUSTED&&error?.details?.limit===2
  );
});
