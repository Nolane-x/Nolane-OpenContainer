import test from 'node:test';
import assert from 'node:assert/strict';
import { OpfsPackageGraphStore } from '../packages/package-env/src/index.js';

const encoder=new TextEncoder();
const decoder=new TextDecoder();

class FakeNotFoundError extends Error{
  constructor(){super('Not found');this.name='NotFoundError';}
}
class FakeFileHandle{
  data=null;
  async getFile(){
    if(this.data===null)throw new FakeNotFoundError();
    const data=this.data instanceof Uint8Array?new Uint8Array(this.data):encoder.encode(String(this.data));
    return {text:async()=>decoder.decode(data)};
  }
  async createWritable(){
    let next=null;
    return {
      write:async value=>{next=value instanceof Uint8Array?new Uint8Array(value):String(value);},
      close:async()=>{this.data=next;},
      abort:async()=>{}
    };
  }
}
class FakeDirectoryHandle{
  files=new Map();
  dirs=new Map();
  async getDirectoryHandle(name,{create=false}={}){
    if(!this.dirs.has(name)){
      if(!create)throw new FakeNotFoundError();
      this.dirs.set(name,new FakeDirectoryHandle());
    }
    return this.dirs.get(name);
  }
  async getFileHandle(name,{create=false}={}){
    if(!this.files.has(name)){
      if(!create)throw new FakeNotFoundError();
      this.files.set(name,new FakeFileHandle());
    }
    return this.files.get(name);
  }
}
class FakeLockManager{
  tails=new Map();
  requests=[];
  request(name,options,callback){
    const previous=this.tails.get(name)??Promise.resolve();
    let release;
    const current=new Promise(resolve=>{release=resolve;});
    this.tails.set(name,current);
    this.requests.push({name,mode:options?.mode??'exclusive'});
    return previous
      .then(()=>callback({name,mode:options?.mode??'exclusive'}))
      .finally(()=>{
        release();
        if(this.tails.get(name)===current)this.tails.delete(name);
      });
  }
}
function graph(name){
  return Object.freeze({
    version:1,
    lockfileVersion:3,
    nodes:Object.freeze([
      Object.freeze({
        name,
        version:'1.0.0',
        location:'node_modules/'+name,
        contentId:'content:'+name,
        instanceId:'instance:'+name,
        resolved:'packages/'+name,
        link:true,
        inBundle:false,
        dependencies:Object.freeze({}),
        optionalDependencies:Object.freeze({}),
        peerDependencies:Object.freeze({}),
        peerDependenciesMeta:Object.freeze({}),
        hasInstallScript:false,
        dev:false,
        optional:false
      })
    ]),
    bins:Object.freeze({})
  });
}

test('persistent package graph CAS admits exactly one concurrent base-generation winner',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const first=await new OpfsPackageGraphStore({
    root,directoryName:'graph-cas',lockManager:locks
  }).open();
  const second=await new OpfsPackageGraphStore({
    root,directoryName:'graph-cas',lockManager:locks
  }).open();

  const race=await Promise.allSettled([
    first.publish({baseGeneration:0,graph:graph('left'),mutationId:'left'}),
    second.publish({baseGeneration:0,graph:graph('right'),mutationId:'right'})
  ]);
  const fulfilled=race.filter(result=>result.status==='fulfilled');
  const rejected=race.filter(result=>result.status==='rejected');

  assert.equal(fulfilled.length,1);
  assert.equal(rejected.length,1);
  assert.equal(rejected[0].reason?.code,'OC_STALE_GENERATION');

  const current=await first.read();
  assert.equal(current.generation,1);
  assert.ok(['left','right'].includes(current.graph.nodes[0].name));
  assert.equal(first.crossContextLocking,true);
  assert.equal(second.crossContextLocking,true);
  assert.ok(locks.requests.length>=2);
  assert.ok(locks.requests.every(request=>request.mode==='exclusive'));
});

test('persistent PackageFS generation section rejects stale generation after successor publish',async()=>{
  const root=new FakeDirectoryHandle();
  const locks=new FakeLockManager();
  const writer=await new OpfsPackageGraphStore({
    root,directoryName:'graph-publication',lockManager:locks
  }).open();
  const successor=await new OpfsPackageGraphStore({
    root,directoryName:'graph-publication',lockManager:locks
  }).open();

  const first=await writer.publish({
    baseGeneration:0,
    graph:graph('base'),
    mutationId:'base'
  });
  const observed=await writer.withGeneration(first.generation,current=>({
    generation:current.generation,
    digest:current.graphDigest
  }));
  assert.equal(observed.generation,1);
  assert.equal(typeof observed.digest,'string');

  const next=await successor.publish({
    baseGeneration:first.generation,
    graph:graph('next'),
    mutationId:'next'
  });
  assert.equal(next.generation,2);

  await assert.rejects(
    ()=>writer.withGeneration(first.generation,()=>true),
    error=>error?.code==='OC_STALE_GENERATION'&&
      error?.details?.expectedGeneration===1&&
      error?.details?.currentGeneration===2
  );
  const canonical=await writer.read();
  assert.equal(canonical.generation,2);
  assert.equal(canonical.graph.nodes[0].name,'next');
});
