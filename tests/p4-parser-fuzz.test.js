import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import {
  inspectTarArchive,
  PackageContentStore,
  PackageGraphAuthority
} from '../packages/package-env/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

const encoder=new TextEncoder();
const corpus=JSON.parse(readFileSync('compat/p4/PARSER-FUZZ-CORPUS.v1.0.json','utf8'));

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
  const out=new Uint8Array(512+padded);out.set(header);out.set(data,512);return out;
}
function tar(entries){
  const chunks=entries.map(entry=>tarEntry(entry.path,entry.content,entry.type??'0'));
  const out=new Uint8Array(chunks.reduce((sum,chunk)=>sum+chunk.byteLength,0)+1024);
  let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}return out;
}
function sri(bytes){return 'sha512-'+createHash('sha512').update(bytes).digest('base64');}
function decodeBase64(value){return new Uint8Array(Buffer.from(value,'base64'));}

async function runManifest(text){
  const bytes=tar([
    {path:'package/',type:'5'},
    {path:'package/package.json',content:text}
  ]);
  const store=new PackageContentStore();
  return store.ingest({
    contentId:'content:'+createHash('sha256').update(text).digest('hex').slice(0,16),
    integrity:sri(bytes),
    bytes
  });
}

async function executeRetainedCase(item){
  if(item.target==='tar'||item.target==='gzip'){
    return inspectTarArchive(decodeBase64(item.payloadBase64));
  }
  if(item.target==='manifest')return runManifest(item.text);
  if(item.target==='lockfile'){
    const authority=new PackageGraphAuthority();
    return authority.compile(item.text);
  }
  throw new Error('Unknown fuzz target '+item.target);
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
  const edits=1+Math.floor(random()*Math.min(8,Math.max(1,out.length)));
  for(let i=0;i<edits;i++){
    if(!out.length)break;
    const index=Math.floor(random()*out.length);
    out[index]^=1<<Math.floor(random()*8);
  }
  return out;
}
function mutateText(input,random){
  const bytes=new Uint8Array(encoder.encode(input));
  return new TextDecoder().decode(mutateBytes(bytes,random));
}
function assertNormalizedFailure(error,target){
  assert.equal(typeof error?.code,'string',target+' leaked an untyped parser exception: '+String(error?.stack??error));
  assert.ok(error.code.startsWith('OC_'),target+' leaked a non-OpenContainer error code '+error.code);
}

test('P4 retained parser fuzz corpus covers every required parser class',()=>{
  assert.equal(corpus.schema,'opencontainer.p4-parser-fuzz-corpus.v1.0');
  assert.equal(corpus.sourceGate,'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P4-07');
  assert.deepEqual(corpus.targets.map(item=>item.id),['tar','gzip','manifest','lockfile']);
  assert.ok(corpus.targets.every(item=>item.coverageGuide.length>=3));
  assert.equal(corpus.minimizedFailureInputs.length,8);
  assert.equal(new Set(corpus.minimizedFailureInputs.map(item=>item.id)).size,8);
  assert.match(corpus.retentionRule,/may only be removed/);
});

test('P4 minimized parser failure inputs remain reproducible and typed',async()=>{
  for(const item of corpus.minimizedFailureInputs){
    let error=null;
    try{await executeRetainedCase(item);}
    catch(value){error=value;}
    assert.ok(error,item.id+' unexpectedly stopped reproducing a failure');
    assertNormalizedFailure(error,item.target);
    assert.ok(
      item.expectedCodes.includes(error.code),
      item.id+' expected '+item.expectedCodes.join(',')+' but got '+error.code
    );
  }
});

test('P4 seeded mutation campaign never leaks raw parser exceptions',async()=>{
  const random=prng(Number.parseInt(corpus.seed.slice(2),16));
  const validTar=tar([
    {path:'package/',type:'5'},
    {path:'package/package.json',content:'{"name":"fuzz","version":"1.0.0"}'},
    {path:'package/index.js',content:'export default 1'}
  ]);
  const validGzip=new Uint8Array(gzipSync(validTar));
  const manifestSeed='{"name":"fuzz","version":"1.0.0","main":"index.js"}';
  const lockfileSeed='{"name":"fuzz","version":"1.0.0","lockfileVersion":3,"packages":{}}';
  const counts={tar:0,gzip:0,manifest:0,lockfile:0,accepted:0,failed:0};
  const failureCodes=new Set();

  for(let i=0;i<512;i++){
    const target=['tar','gzip','manifest','lockfile'][i%4];
    counts[target]++;
    try{
      if(target==='tar')await inspectTarArchive(mutateBytes(validTar,random));
      else if(target==='gzip')await inspectTarArchive(mutateBytes(validGzip,random));
      else if(target==='manifest')await runManifest(mutateText(manifestSeed,random));
      else new PackageGraphAuthority({maxLockfileBytes:2048,maxGraphNodes:32}).compile(mutateText(lockfileSeed,random));
      counts.accepted++;
    }catch(error){
      assertNormalizedFailure(error,target);
      counts.failed++;
      failureCodes.add(error.code);
    }
  }

  assert.equal(counts.tar,128);
  assert.equal(counts.gzip,128);
  assert.equal(counts.manifest,128);
  assert.equal(counts.lockfile,128);
  assert.equal(counts.accepted+counts.failed,512);
  assert.ok(counts.failed>300,'mutation campaign did not exercise enough fail-closed parser branches');
  assert.ok(failureCodes.has(ErrorCodes.ARCHIVE_UNSAFE));
  assert.ok(
    failureCodes.has(ErrorCodes.INVALID_PACKAGE_CONFIG)||failureCodes.has(ErrorCodes.INVALID_ARGUMENT),
    'mutation campaign did not exercise JSON/package parser rejection'
  );
});
