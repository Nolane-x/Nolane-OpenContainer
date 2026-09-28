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
  writeOctal(header,124,12,type==='5'?0:data.byteLength);
  writeOctal(header,136,12,0);
  header.fill(32,148,156);header[156]=type.charCodeAt(0);
  header.set(encoder.encode('ustar\0'),257);header.set(encoder.encode('00'),263);
  let checksum=0;for(const byte of header)checksum+=byte;
  header.set(encoder.encode(checksum.toString(8).padStart(6,'0')+'\0 '),148);
  const padded=Math.ceil(data.byteLength/512)*512;
  const out=new Uint8Array(512+padded);out.set(header);out.set(data,512);return out;
}
function packageTar(name,version='1.0.0'){
  const entries=[
    tarEntry('package/','', '5'),
    tarEntry('package/package.json',JSON.stringify({name,version,main:'index.cjs'})),
    tarEntry('package/index.cjs','module.exports='+JSON.stringify({name,version}))
  ];
  const total=entries.reduce((n,x)=>n+x.byteLength,0);
  const out=new Uint8Array(total+1024);let offset=0;
  for(const entry of entries){out.set(entry,offset);offset+=entry.byteLength;}
  return out;
}
function sri(bytes){return 'sha512-'+createHash('sha512').update(bytes).digest('base64');}
function lock(name,integrity){
  return {
    name:'app',version:'1',lockfileVersion:3,
    packages:{
      '':{name:'app',version:'1'},
      ['node_modules/'+name]:{
        name,version:'1.0.0',resolved:'https://registry.example/'+name+'.tgz',integrity
      }
    }
  };
}

test('P4 graph compile rejects stale base generation instead of last-writer-wins overwrite',async()=>{
  const runtime=await OpenContainer.boot();
  const a=packageTar('a'),b=packageTar('b'),c=packageTar('c');
  runtime.packages.compile(lock('a',sri(a)));
  const sharedBase=runtime.packages.generation;

  runtime.packages.compile(lock('b',sri(b)),{expectedGeneration:sharedBase});
  const committedGeneration=runtime.packages.generation;
  const committedName=runtime.packages.graph.nodes[0].name;

  assert.throws(
    ()=>runtime.packages.compile(lock('c',sri(c)),{expectedGeneration:sharedBase}),
    error=>error.code===ErrorCodes.STALE_GENERATION &&
      error.details?.expectedGeneration===sharedBase &&
      error.details?.currentGeneration===committedGeneration
  );
  assert.equal(runtime.packages.generation,committedGeneration);
  assert.equal(runtime.packages.graph.nodes[0].name,committedName);
  assert.equal(committedName,'b');
});

test('P4 stale frozen installer cannot publish PackageFS after graph changes',async()=>{
  const runtime=await OpenContainer.boot();
  const a=packageTar('a'),b=packageTar('b');
  runtime.packages.compile(lock('a',sri(a)));
  const installer=runtime.packages.createFrozenInstaller();
  const bound=runtime.packages.generation;
  await installer.ingestLocation('node_modules/a',a);

  runtime.packages.compile(lock('b',sri(b)),{expectedGeneration:bound});

  assert.throws(
    ()=>installer.mountFrozenGraph(),
    error=>error.code===ErrorCodes.STALE_GENERATION &&
      error.details?.expectedGeneration===bound &&
      error.details?.currentGeneration===runtime.packages.generation
  );
  assert.equal(runtime.packages.nodeModules,null);
});

test('P4 cancelled multi-package install retains immutable cache only and blocks PackageFS publication',async()=>{
  const runtime=await OpenContainer.boot();
  const a=packageTar('a'),b=packageTar('b');
  const ia=sri(a),ib=sri(b);
  runtime.packages.compile({
    name:'app',version:'1',lockfileVersion:3,
    packages:{
      '':{name:'app',version:'1'},
      'node_modules/a':{name:'a',version:'1.0.0',resolved:'https://registry.example/a.tgz',integrity:ia},
      'node_modules/b':{name:'b',version:'1.0.0',resolved:'https://registry.example/b.tgz',integrity:ib}
    }
  });
  const installer=runtime.packages.createFrozenInstaller();
  const controller=new AbortController();
  let fetches=0;

  await assert.rejects(
    ()=>installer.installAll({
      concurrency:1,
      signal:controller.signal,
      artifactAuthority:{
        async fetchArtifact({url}){
          fetches++;
          return {url,bytes:url.endsWith('/a.tgz')?a:b,redirects:0};
        }
      },
      onProgress(){controller.abort('cancel-after-first-content');}
    }),
    error=>error.code===ErrorCodes.INVALID_STATE && /aborted/.test(error.message)
  );

  assert.equal(fetches,1);
  assert.equal(installer.contentStore.size,1);
  assert.equal(installer.lastInstallFailed,true);
  assert.throws(
    ()=>installer.mountFrozenGraph(),
    error=>error.code===ErrorCodes.INVALID_STATE && /cannot publish PackageFS/.test(error.message)
  );
  assert.equal(runtime.packages.nodeModules,null);
});

test('P4 failed install can recover only after a complete successful rerun on the same graph generation',async()=>{
  const runtime=await OpenContainer.boot();
  const a=packageTar('a'),b=packageTar('b');
  const ia=sri(a),ib=sri(b);
  runtime.packages.compile({
    name:'app',version:'1',lockfileVersion:3,
    packages:{
      '':{name:'app',version:'1'},
      'node_modules/a':{name:'a',version:'1.0.0',resolved:'https://registry.example/a.tgz',integrity:ia},
      'node_modules/b':{name:'b',version:'1.0.0',resolved:'https://registry.example/b.tgz',integrity:ib}
    }
  });
  const installer=runtime.packages.createFrozenInstaller();
  let fault=true;
  await assert.rejects(
    ()=>installer.installAll({
      concurrency:1,
      artifactAuthority:{
        async fetchArtifact({url}){
          if(url.endsWith('/b.tgz')&&fault)throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});
          return {url,bytes:url.endsWith('/a.tgz')?a:b,redirects:0};
        }
      }
    }),
    /quota/
  );
  assert.equal(installer.lastInstallFailed,true);
  assert.throws(()=>installer.mountFrozenGraph(),/cannot publish PackageFS/);

  fault=false;
  const receipt=await installer.installAll({
    concurrency:1,
    artifactAuthority:{
      async fetchArtifact({url}){
        return {url,bytes:url.endsWith('/a.tgz')?a:b,redirects:0};
      }
    }
  });
  assert.equal(receipt.fetchedContents,1);
  assert.equal(installer.lastInstallFailed,false);
  const mounted=installer.mountFrozenGraph();
  assert.equal(mounted.packageCount,2);
  assert.equal(mounted.graphGeneration,runtime.packages.generation);
  assert.equal(mounted.publicationPrecondition,'graph-generation-cas');
});
