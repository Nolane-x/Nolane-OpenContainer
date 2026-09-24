import test from 'node:test';
import assert from 'node:assert/strict';
import nodePath from 'node:path';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { createPosixPath, EventEmitter } from '../packages/package-env/src/index.js';

const compat=createPosixPath({cwd:()=>'/workspace/project'});
const posix=nodePath.posix;

test('selected node:path POSIX court matches exact Node semantics',()=>{
  const paths=['','.', '..','/','//','/foo/bar//baz/../','foo/bar/../baz','/.hidden','file.txt','archive.tar.gz','foo/.bar','foo/..bar.js'];
  for(const value of paths){
    assert.equal(compat.normalize(value),posix.normalize(value),'normalize '+value);
    assert.equal(compat.dirname(value),posix.dirname(value),'dirname '+value);
    assert.equal(compat.basename(value),posix.basename(value),'basename '+value);
    assert.equal(compat.extname(value),posix.extname(value),'extname '+value);
    assert.deepEqual(compat.parse(value),posix.parse(value),'parse '+value);
  }
  const joins=[['/foo','bar','baz','..'],['foo','','bar'],['..','a','b'],[]];
  for(const args of joins)assert.equal(compat.join(...args),posix.join(...args),'join '+JSON.stringify(args));
  const resolves=[['a','b'],['/a','b','..','c'],['','x']];
  for(const args of resolves)assert.equal(compat.resolve(...args),posix.resolve('/workspace/project',...args),'resolve '+JSON.stringify(args));
  const relatives=[['/a/b/c','/a/d'],['/a','/a'],['x/y','x/z']];
  for(const [a,b] of relatives)assert.equal(compat.relative(a,b),posix.relative(posix.resolve('/workspace/project',a),posix.resolve('/workspace/project',b)),'relative '+a+' '+b);
});

test('EventEmitter selected ordering once and removal semantics',()=>{
  const ee=new EventEmitter();
  const order=[];
  const a=()=>order.push('a');
  const b=()=>order.push('b');
  ee.on('x',a);
  ee.prependListener('x',b);
  ee.once('x',()=>order.push('once'));
  assert.equal(ee.emit('x'),true);
  assert.equal(ee.emit('x'),true);
  assert.deepEqual(order,['b','a','once','b','a']);
  assert.equal(ee.listenerCount('x'),2);
  ee.off('x',a);
  assert.equal(ee.listenerCount('x'),1);
});

test('EventEmitter unhandled error throws',()=>{
  const ee=new EventEmitter();
  const error=new Error('boom');
  assert.throws(()=>ee.emit('error',error),error);
});

test('once listeners are unwrapped by listeners but retained by rawListeners',()=>{
  const ee=new EventEmitter();
  const fn=()=>{};
  ee.once('x',fn);
  assert.equal(ee.listeners('x')[0],fn);
  assert.notEqual(ee.rawListeners('x')[0],fn);
  assert.equal(ee.rawListeners('x')[0].listener,fn);
});

test('CommonJS loader receives core path/events builtins by default',async()=>{
  const runtime=await OpenContainer.boot();
  runtime.mount({
    'package.json':'{"type":"commonjs"}',
    'main.cjs':'const path=require("path"); const EventEmitter=require("events"); const e=new EventEmitter(); let n=0; e.once("x",()=>n++); e.emit("x"); e.emit("x"); module.exports={joined:path.join("/a","b","..","c"),n};'
  });
  runtime.packages.mountCatalog();
  const loader=runtime.packages.createCommonJsLoader({allowDynamicCode:true});
  assert.deepEqual(loader.require('./main.cjs','/workspace/entry.cjs'),{joined:'/a/c',n:1});
});
