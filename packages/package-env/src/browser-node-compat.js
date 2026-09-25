import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';
import { createCoreBuiltinRegistry } from './builtins/registry.js';
import { BUILTIN_MODULES } from './builtins/module.js';

function statRecord(value) {
  return {
    size: value.size ?? 0,
    mode: value.mode ?? 0,
    file: !!value.isFile?.(),
    directory: !!value.isDirectory?.(),
    symlink: !!value.isSymbolicLink?.()
  };
}

function fsResult(value) {
  if (typeof value === 'string' || value === undefined || value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (value instanceof Uint8Array) return { __opencontainerBytes: [...value] };
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry === 'string') return entry;
      return {
        name: entry.name,
        file: !!entry.isFile?.(),
        directory: !!entry.isDirectory?.(),
        symlink: !!entry.isSymbolicLink?.()
      };
    });
  }
  return value;
}

function fsSource() {
  return `
const call=(method,payload)=>globalThis.__opencontainer_sync_host_call__('node.fs.'+method,payload);
const bytes=(value)=>value&&value.__opencontainerBytes?Buffer.from(value.__opencontainerBytes):value;
const stats=(value)=>Object.freeze({
  size:value.size, mode:value.mode,
  isFile:()=>!!value.file,
  isDirectory:()=>!!value.directory,
  isSymbolicLink:()=>!!value.symlink,
  isBlockDevice:()=>false,isCharacterDevice:()=>false,isFIFO:()=>false,isSocket:()=>false
});
const dirent=(value)=>Object.freeze({
  name:value.name,
  isFile:()=>!!value.file,
  isDirectory:()=>!!value.directory,
  isSymbolicLink:()=>!!value.symlink,
  isBlockDevice:()=>false,isCharacterDevice:()=>false,isFIFO:()=>false,isSocket:()=>false
});
export const constants=Object.freeze({F_OK:0,R_OK:4,W_OK:2,X_OK:1});
export function existsSync(path){return call('existsSync',{path});}
export function accessSync(path,mode){return call('accessSync',{path,mode});}
export function readFileSync(path,options=null){return bytes(call('readFileSync',{path:String(path),options}));}
export function writeFileSync(path,data,options=null){
  const payload=data instanceof Uint8Array?{__opencontainerBytes:[...data]}:data;
  return call('writeFileSync',{path:String(path),data:payload,options});
}
export function readdirSync(path,options=null){
  const value=call('readdirSync',{path:String(path),options});
  return options&&typeof options==='object'&&options.withFileTypes?value.map(dirent):value;
}
export function statSync(path){return stats(call('statSync',{path:String(path)}));}
export function lstatSync(path){return stats(call('lstatSync',{path:String(path)}));}
export function realpathSync(path){return call('realpathSync',{path:String(path)});}
realpathSync.native=realpathSync;
export function realpath(path,options,callback){
  if(typeof options==='function'){callback=options;options=null;}
  if(typeof callback!=='function')throw new TypeError('callback must be a function');
  queueMicrotask(()=>{
    try{callback(null,realpathSync(path,options));}
    catch(error){callback(error);}
  });
}
realpath.native=realpath;
export function readlinkSync(path){return call('readlinkSync',{path:String(path)});}
function callbackResult(callback,fn,{value=true}={}){
  if(typeof callback!=='function')throw new TypeError('callback must be a function');
  queueMicrotask(()=>{try{const result=fn();value?callback(null,result):callback(null);}catch(error){callback(error);}});
}
export function access(path,mode,callback){if(typeof mode==='function'){callback=mode;mode=undefined;}return callbackResult(callback,()=>accessSync(path,mode),{value:false});}
export function readFile(path,options,callback){if(typeof options==='function'){callback=options;options=null;}return callbackResult(callback,()=>readFileSync(path,options));}
export function writeFile(path,data,options,callback){if(typeof options==='function'){callback=options;options=null;}return callbackResult(callback,()=>writeFileSync(path,data,options),{value:false});}
export function readdir(path,options,callback){if(typeof options==='function'){callback=options;options=null;}return callbackResult(callback,()=>readdirSync(path,options));}
export function stat(path,options,callback){if(typeof options==='function'){callback=options;options=null;}return callbackResult(callback,()=>statSync(path));}
export function lstat(path,options,callback){if(typeof options==='function'){callback=options;options=null;}return callbackResult(callback,()=>lstatSync(path));}
export function readlink(path,options,callback){if(typeof options==='function'){callback=options;options=null;}return callbackResult(callback,()=>readlinkSync(path));}
export function openSync(path,flags='r',mode=0o666){return call('openSync',{path:String(path),flags,mode});}
export function closeSync(fd){return call('closeSync',{fd:Number(fd)});}
export function open(path,flags,mode,callback){
  if(typeof mode==='function'){callback=mode;mode=0o666;}
  return callbackResult(callback,()=>openSync(path,flags,mode));
}
export function close(fd,callback){return callbackResult(callback,()=>closeSync(fd),{value:false});}
export function mkdirSync(path,options=null){return call('mkdirSync',{path:String(path),options});}
export function renameSync(from,to){return call('renameSync',{from:String(from),to:String(to)});}
export function rmSync(path,options=null){return call('rmSync',{path:String(path),options});}
export function unlinkSync(path){return call('unlinkSync',{path:String(path)});}
export function mkdir(path,options,callback){if(typeof options==='function'){callback=options;options=null;}return callbackResult(callback,()=>mkdirSync(path,options));}
export function rename(from,to,callback){return callbackResult(callback,()=>renameSync(from,to),{value:false});}
export function rm(path,options,callback){if(typeof options==='function'){callback=options;options=null;}return callbackResult(callback,()=>rmSync(path,options),{value:false});}
export function unlink(path,callback){return callbackResult(callback,()=>unlinkSync(path),{value:false});}
export const promises=Object.freeze({
  access:async(...args)=>accessSync(...args),
  readFile:async(...args)=>readFileSync(...args),
  writeFile:async(...args)=>writeFileSync(...args),
  readdir:async(...args)=>readdirSync(...args),
  stat:async(...args)=>statSync(...args),
  lstat:async(...args)=>lstatSync(...args),
  realpath:async(...args)=>realpathSync(...args),
  readlink:async(...args)=>readlinkSync(...args),
  mkdir:async(...args)=>mkdirSync(...args),
  rename:async(...args)=>renameSync(...args),
  rm:async(...args)=>rmSync(...args),
  unlink:async(...args)=>unlinkSync(...args)
});
const api={constants,existsSync,accessSync,access,readFileSync,readFile,writeFileSync,writeFile,readdirSync,readdir,statSync,stat,lstatSync,lstat,realpathSync,realpath,readlinkSync,readlink,openSync,open,closeSync,close,mkdirSync,mkdir,renameSync,rename,rmSync,rm,unlinkSync,unlink,promises};
export default api;
`;
}

function fsPromisesSource() {
  return `
import fs from 'node:fs';
export const constants=fs.constants;
export const access=fs.promises.access;
export const readFile=fs.promises.readFile;
export const writeFile=fs.promises.writeFile;
export const readdir=fs.promises.readdir;
export const stat=fs.promises.stat;
export const lstat=fs.promises.lstat;
export const realpath=fs.promises.realpath;
export const readlink=fs.promises.readlink;
export const mkdir=fs.promises.mkdir;
export const rename=fs.promises.rename;
export const rm=fs.promises.rm;
export const unlink=fs.promises.unlink;
const api=Object.freeze({...fs.promises,constants});
export default api;
`;
}

function pathSource() {
  return `
const call=(method,args)=>globalThis.__opencontainer_sync_host_call__('node.path.'+method,{args});
export const sep='/';
export const delimiter=':';
export const normalize=(path)=>call('normalize',[path]);
export const isAbsolute=(path)=>call('isAbsolute',[path]);
export const join=(...paths)=>call('join',paths);
export const resolve=(...paths)=>call('resolve',paths);
export const relative=(from,to)=>call('relative',[from,to]);
export const dirname=(path)=>call('dirname',[path]);
export const basename=(path,suffix)=>call('basename',[path,suffix]);
export const extname=(path)=>call('extname',[path]);
export const parse=(path)=>call('parse',[path]);
export const format=(value)=>call('format',[value]);
export const toNamespacedPath=(path)=>path;
function winSlashes(value){return String(value).replace(/\\//g,'\\\\');}
function winRoot(value){
  const path=winSlashes(value);
  const unc=/^\\\\\\\\([^\\\\]+)\\\\([^\\\\]+)(?:\\\\|$)/.exec(path);
  if(unc)return {root:'\\\\\\\\'+unc[1]+'\\\\'+unc[2]+'\\\\',rest:path.slice(unc[0].length)};
  const drive=/^[A-Za-z]:/.exec(path);
  if(drive){
    const absolute=path[2]==='\\\\';
    return {root:drive[0]+(absolute?'\\\\':''),rest:path.slice(absolute?3:2)};
  }
  if(path.startsWith('\\\\'))return {root:'\\\\',rest:path.slice(1)};
  return {root:'',rest:path};
}
function winNormalize(value){
  const original=winSlashes(value);
  if(!original)return '.';
  const {root,rest}=winRoot(original);
  const absolute=root.endsWith('\\\\')||root==='\\\\';
  const parts=[];
  for(const part of rest.split(/\\\\+/)){
    if(!part||part==='.')continue;
    if(part==='..'){
      if(parts.length&&parts[parts.length-1]!=='..')parts.pop();
      else if(!absolute)parts.push('..');
    }else parts.push(part);
  }
  let out=root+parts.join('\\\\');
  if(!out)out='.';
  if(original.endsWith('\\\\')&&out!==root&&!out.endsWith('\\\\'))out+='\\\\';
  return out;
}
function winIsAbsolute(value){
  const path=winSlashes(value);
  return /^\\\\\\\\/.test(path)||/^[A-Za-z]:\\\\/.test(path)||path.startsWith('\\\\');
}
function winJoin(...values){
  const parts=values.filter((value)=>String(value).length>0).map(winSlashes);
  if(!parts.length)return '.';
  return winNormalize(parts.join('\\\\'));
}
function winResolve(...values){
  let combined='';
  for(let i=values.length-1;i>=0;i--){
    const value=winSlashes(values[i]);
    if(!value)continue;
    combined=value+(combined?'\\\\'+combined:'');
    if(winIsAbsolute(value))break;
  }
  return winNormalize(combined||'.');
}
function winDirname(value){
  const path=winNormalize(value).replace(/\\\\+$/,'');
  const {root}=winRoot(path);
  const index=path.lastIndexOf('\\\\');
  if(index<0)return '.';
  if(index<root.length)return root||'.';
  return path.slice(0,index)||root||'.';
}
function winBasename(value,suffix){
  const path=winNormalize(value).replace(/\\\\+$/,'');
  const index=Math.max(path.lastIndexOf('\\\\'),path.lastIndexOf(':'));
  let name=path.slice(index+1);
  if(suffix&&name.endsWith(suffix))name=name.slice(0,-suffix.length);
  return name;
}
function winExtname(value){
  const name=winBasename(value);
  const index=name.lastIndexOf('.');
  return index<=0?'':name.slice(index);
}
function winParse(value){
  const normalized=winNormalize(value);
  const {root}=winRoot(normalized);
  const dir=winDirname(normalized);
  const base=winBasename(normalized);
  const ext=winExtname(base);
  return {root,dir,base,ext,name:ext?base.slice(0,-ext.length):base};
}
function winFormat(value){
  const dir=value.dir||value.root||'';
  const base=value.base||String(value.name||'')+String(value.ext||'');
  return dir?winJoin(dir,base):base;
}
function winRelative(from,to){
  const left=winResolve(from).replace(/\\\\+$/,'').split('\\\\');
  const right=winResolve(to).replace(/\\\\+$/,'').split('\\\\');
  let index=0;
  while(index<left.length&&index<right.length&&left[index].toLowerCase()===right[index].toLowerCase())index++;
  return [...Array(left.length-index).fill('..'),...right.slice(index)].join('\\\\');
}
const win32Api={sep:'\\\\',delimiter:';',normalize:winNormalize,isAbsolute:winIsAbsolute,join:winJoin,resolve:winResolve,relative:winRelative,dirname:winDirname,basename:winBasename,extname:winExtname,parse:winParse,format:winFormat,toNamespacedPath:(path)=>winSlashes(path)};
win32Api.win32=win32Api;
const api={sep,delimiter,normalize,isAbsolute,join,resolve,relative,dirname,basename,extname,parse,format,toNamespacedPath};
api.posix=api;
api.win32=win32Api;
export const posix=api;
export const win32=win32Api;
export default api;
`;
}

function pathWin32Source() {
  return `
import path from 'node:path';
export const sep=path.win32.sep;
export const delimiter=path.win32.delimiter;
export const normalize=path.win32.normalize;
export const isAbsolute=path.win32.isAbsolute;
export const join=path.win32.join;
export const resolve=path.win32.resolve;
export const relative=path.win32.relative;
export const dirname=path.win32.dirname;
export const basename=path.win32.basename;
export const extname=path.win32.extname;
export const parse=path.win32.parse;
export const format=path.win32.format;
export const toNamespacedPath=path.win32.toNamespacedPath;
export default path.win32;
`;
}

function bufferSource() {
  return `
import { BufferCompat as Buffer } from '/packages/package-env/src/builtins/buffer.js';
globalThis.Buffer ??= Buffer;
export { Buffer };
export const SlowBuffer=Buffer;
export default {Buffer,SlowBuffer};
`;
}

function eventsSource() {
  return `
import { EventEmitter } from '/packages/package-env/src/builtins/events.js';
EventEmitter.EventEmitter=EventEmitter;
EventEmitter.once ??= (emitter,event)=>new Promise((resolve,reject)=>{
  const onEvent=(...args)=>{cleanup();resolve(args);};
  const onError=(error)=>{cleanup();reject(error);};
  const cleanup=()=>{emitter.removeListener(event,onEvent);if(event!=='error')emitter.removeListener('error',onError);};
  emitter.once(event,onEvent);
  if(event!=='error')emitter.once('error',onError);
});
export { EventEmitter };
export const once=EventEmitter.once;
export default EventEmitter;
`;
}

function processSource(env, argv, platform, arch) {
  return `
const call=(method,payload)=>globalThis.__opencontainer_sync_host_call__('node.process.'+method,payload);
function stream(fd,kind){
  return {
    fd,
    isTTY:false,
    columns:undefined,
    rows:undefined,
    readable:kind==='stdin',
    writable:kind!=='stdin',
    write(chunk,encoding,callback){
      if(typeof encoding==='function'){callback=encoding;}
      const text=typeof chunk==='string'?chunk:String(chunk??'');
      if(kind==='stderr')console.error(text);
      else if(kind==='stdout')console.log(text);
      if(typeof callback==='function')queueMicrotask(callback);
      return true;
    },
    on(){return this;},once(){return this;},off(){return this;},removeListener(){return this;},
    pause(){return this;},resume(){return this;},setEncoding(){return this;},
    ref(){return this;},unref(){return this;}
  };
}
const stdout=stream(1,'stdout');
const stderr=stream(2,'stderr');
const stdin=stream(0,'stdin');
const process={
  browser:true,
  platform:${JSON.stringify(platform)},
  arch:${JSON.stringify(arch)},
  version:'v24.21.0',
  versions:Object.freeze({node:'24.21.0',opencontainer:'0.1.0-alpha.1'}),
  argv:${JSON.stringify(argv)},
  execArgv:[],
  env:Object.assign(Object.create(null),${JSON.stringify(env)}),
  stdout,stderr,stdin,
  cwd:()=>call('cwd'),
  chdir:(directory)=>call('chdir',{directory}),
  nextTick:(callback,...args)=>queueMicrotask(()=>callback(...args)),
  hrtime:(previous)=>call('hrtime',{previous}),
  uptime:()=>call('uptime'),
  emitWarning:(warning)=>console.warn(warning)
};
process.hrtime.bigint=()=>BigInt(call('hrtime.bigint'));
// Keep the imported node:process module on the frozen Node compatibility
// profile, but do not make browser environment detectors believe this realm
// is a real Node process. Packages such as @emnapi/wasi-threads intentionally
// branch on global process.versions.node to choose Node Worker APIs.
const globalProcess={
  ...process,
  versions:Object.freeze({opencontainer:'0.1.0-alpha.1'})
};
globalThis.process ??= globalProcess;
export default process;
export const env=process.env;
export const argv=process.argv;
export const platform=process.platform;
export const arch=process.arch;
export const versions=process.versions;
export { stdout, stderr, stdin };
export const cwd=process.cwd;
export const chdir=process.chdir;
export const nextTick=process.nextTick;
export const hrtime=process.hrtime;
export const uptime=process.uptime;
`;
}

function urlSource() {
  return `
export const URL=globalThis.URL;
export const URLSearchParams=globalThis.URLSearchParams;
export function pathToFileURL(path){
  const resolved=globalThis.__opencontainer_sync_host_call__('node.url.pathToFileURL',{path:String(path)});
  return new URL(resolved);
}
export function fileURLToPath(value){
  return globalThis.__opencontainer_sync_host_call__('node.url.fileURLToPath',{value:String(value)});
}
export function urlToHttpOptions(value){
  return globalThis.__opencontainer_sync_host_call__('node.url.urlToHttpOptions',{value:String(value)});
}
export default {URL,URLSearchParams,pathToFileURL,fileURLToPath,urlToHttpOptions};
`;
}

function dnsSource() {
  return `
let defaultResultOrder='verbatim';
function ipFamily(value){
  const text=String(value);
  if(/^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(text)){
    const parts=text.split('.').map(Number);
    if(parts.every((part)=>part>=0&&part<=255))return 4;
  }
  if(text.includes(':'))return 6;
  return 0;
}
function resultFor(hostname,options={}){
  const host=String(hostname);
  const family=typeof options==='number'?options:(options?.family??0);
  if(host==='localhost'){
    const address=family===6?'::1':'127.0.0.1';
    return {address,family:family===6?6:4};
  }
  const literal=ipFamily(host);
  if(literal&&(family===0||family===literal))return {address:host,family:literal};
  const error=new Error('DNS lookup is restricted to loopback/literal IPs in OpenContainer browser runtime: '+host);
  error.code='ENOTFOUND';error.hostname=host;throw error;
}
export function lookup(hostname,options,callback){
  if(typeof options==='function'){callback=options;options={};}
  if(typeof callback!=='function')throw new TypeError('callback must be a function');
  queueMicrotask(()=>{
    try{
      const one=resultFor(hostname,options);
      if(options?.all)callback(null,[one]);
      else callback(null,one.address,one.family);
    }catch(error){callback(error);}
  });
}
export function getDefaultResultOrder(){return defaultResultOrder;}
export function setDefaultResultOrder(order){
  if(order!=='verbatim'&&order!=='ipv4first'&&order!=='ipv6first')throw new TypeError('invalid DNS result order');
  defaultResultOrder=order;
}
export function setServers(){const error=new Error('Custom DNS servers are unavailable in browser runtime');error.code='OC_BUILTIN_UNAVAILABLE';throw error;}
export const promises=Object.freeze({
  lookup:async(hostname,options={})=>{
    const one=resultFor(hostname,options);
    return options?.all?[one]:one;
  },
  getDefaultResultOrder,
  setDefaultResultOrder
});
const api={lookup,getDefaultResultOrder,setDefaultResultOrder,setServers,promises};
export default api;
`;
}

function osSource() {
  return `
const loopback=Object.freeze({
  lo:Object.freeze([
    Object.freeze({address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}),
    Object.freeze({address:'::1',netmask:'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',family:'IPv6',mac:'00:00:00:00:00:00',internal:true,scopeid:0,cidr:'::1/128'})
  ])
});
export const EOL='\\n';
export const devNull='/dev/null';
export const constants=Object.freeze({});
export const arch=()=> 'wasm32';
export const platform=()=> 'linux';
export const type=()=> 'Linux';
export const release=()=> 'opencontainer';
export const version=()=> 'OpenContainer browser runtime';
export const hostname=()=> 'opencontainer';
export const homedir=()=> '/workspace';
export const tmpdir=()=> '/workspace/.tmp';
export const endianness=()=> 'LE';
export const uptime=()=> globalThis.performance.now()/1000;
export const totalmem=()=>0;
export const freemem=()=>0;
export const loadavg=()=>[0,0,0];
export const cpus=()=>[];
export const userInfo=()=>Object.freeze({username:'opencontainer',uid:-1,gid:-1,shell:null,homedir:'/workspace'});
export const networkInterfaces=()=>loopback;
const api={EOL,devNull,constants,arch,platform,type,release,version,hostname,homedir,tmpdir,endianness,uptime,totalmem,freemem,loadavg,cpus,userInfo,networkInterfaces};
export default api;
`;
}

function netSource() {
  return `
function ipv4(value){
  const parts=String(value).split('.');
  return parts.length===4&&parts.every((part)=>/^\\d{1,3}$/.test(part)&&Number(part)>=0&&Number(part)<=255);
}
function ipv6(value){
  const text=String(value);
  if(!text.includes(':'))return false;
  try{new URL('http://['+text.replace(/%.*$/,'')+']/');return true;}catch{return false;}
}
export function isIPv4(value){return ipv4(value);}
export function isIPv6(value){return ipv6(value);}
export function isIP(value){return ipv4(value)?4:ipv6(value)?6:0;}
function denied(operation){
  const error=new Error('Raw TCP networking is unavailable in OpenContainer browser runtime: '+operation);
  error.code='OC_BUILTIN_UNAVAILABLE';throw error;
}
export class Socket{constructor(){denied('Socket');}}
export class Server{constructor(){denied('Server');}}
export function createServer(){return denied('createServer');}
export function connect(){return denied('connect');}
export const createConnection=connect;
const api={isIPv4,isIPv6,isIP,Socket,Server,createServer,connect,createConnection};
export default api;
`;
}


function streamSource() {
  return `
import { EventEmitter } from 'node:events';
function asError(error){return error instanceof Error?error:new Error(String(error));}
function onceSettled(stream,callback){
  let done=false;
  const finish=(error)=>{if(done)return;done=true;cleanup();callback?.(error);};
  const cleanup=()=>{stream?.off?.('error',onError);stream?.off?.('finish',onFinish);stream?.off?.('end',onFinish);stream?.off?.('close',onFinish);};
  const onError=(error)=>finish(error);
  const onFinish=()=>finish();
  stream?.once?.('error',onError);stream?.once?.('finish',onFinish);stream?.once?.('end',onFinish);stream?.once?.('close',onFinish);
  return finish;
}
export class Stream extends EventEmitter{
  pipe(destination){
    this.on('data',(chunk)=>{if(destination?.write)destination.write(chunk);});
    this.once('end',()=>destination?.end?.());
    this.once('error',(error)=>destination?.emit?.('error',error));
    destination?.emit?.('pipe',this);
    return destination;
  }
}
export class Readable extends Stream{
  constructor(options={}){
    super();this.readable=true;this.readableEnded=false;this.destroyed=false;this.readableEncoding=null;
    this._queue=[];this._paused=false;this._read=typeof options.read==='function'?options.read.bind(this):this._read;
  }
  _read(){}
  push(chunk){
    if(chunk===null){
      if(!this.readableEnded){this.readableEnded=true;this.readable=false;queueMicrotask(()=>this.emit('end'));}
      return false;
    }
    this._queue.push(chunk);
    if(!this._paused)queueMicrotask(()=>this.emit('data',this._queue.shift()));
    return !this._paused;
  }
  read(){return this._queue.length?this._queue.shift():null;}
  pause(){this._paused=true;return this;}
  resume(){this._paused=false;while(this._queue.length)this.emit('data',this._queue.shift());return this;}
  setEncoding(encoding){this.readableEncoding=encoding;return this;}
  destroy(error){this.destroyed=true;this.readable=false;if(error)queueMicrotask(()=>this.emit('error',asError(error)));queueMicrotask(()=>this.emit('close'));return this;}
  [Symbol.asyncIterator](){
    const self=this;return {async next(){const value=self.read();if(value!==null)return {value,done:false};if(self.readableEnded)return {value:undefined,done:true};return await new Promise((resolve,reject)=>{const onData=(chunk)=>{cleanup();resolve({value:chunk,done:false});};const onEnd=()=>{cleanup();resolve({value:undefined,done:true});};const onError=(error)=>{cleanup();reject(error);};const cleanup=()=>{self.off('data',onData);self.off('end',onEnd);self.off('error',onError);};self.once('data',onData);self.once('end',onEnd);self.once('error',onError);});}};
  }
  static from(iterable){
    const out=new Readable();
    queueMicrotask(async()=>{try{for await(const item of iterable)out.push(item);out.push(null);}catch(error){out.destroy(error);}});
    return out;
  }
}
export class Writable extends Stream{
  constructor(options={}){
    super();this.writable=true;this.writableEnded=false;this.writableFinished=false;this.destroyed=false;
    this._write=typeof options.write==='function'?options.write.bind(this):this._write;
    this._final=typeof options.final==='function'?options.final.bind(this):this._final;
  }
  _write(chunk,encoding,callback){callback();}
  _final(callback){callback();}
  write(chunk,encoding,callback){
    if(typeof encoding==='function'){callback=encoding;encoding=undefined;}
    if(this.writableEnded){const error=new Error('write after end');error.code='ERR_STREAM_WRITE_AFTER_END';if(callback)queueMicrotask(()=>callback(error));else queueMicrotask(()=>this.emit('error',error));return false;}
    try{this._write(chunk,encoding??'utf8',(error)=>{if(error){this.emit('error',asError(error));callback?.(asError(error));}else callback?.();});return true;}
    catch(error){this.emit('error',asError(error));callback?.(asError(error));return false;}
  }
  end(chunk,encoding,callback){
    if(typeof chunk==='function'){callback=chunk;chunk=undefined;}
    else if(typeof encoding==='function'){callback=encoding;encoding=undefined;}
    if(chunk!==undefined)this.write(chunk,encoding);
    if(this.writableEnded){callback?.();return this;}
    this.writableEnded=true;
    const finish=(error)=>{if(error){this.emit('error',asError(error));callback?.(asError(error));return;}this.writable=false;this.writableFinished=true;this.emit('finish');callback?.();};
    try{this._final(finish);}catch(error){finish(error);}
    return this;
  }
  destroy(error){this.destroyed=true;this.writable=false;if(error)queueMicrotask(()=>this.emit('error',asError(error)));queueMicrotask(()=>this.emit('close'));return this;}
}
export class Duplex extends Readable{
  constructor(options={}){
    super(options);this.writable=true;this.writableEnded=false;this.writableFinished=false;
    if(typeof options.write==='function')this._write=options.write.bind(this);
    if(typeof options.final==='function')this._final=options.final.bind(this);
  }
  _write(chunk,encoding,callback){callback();}
  _final(callback){callback();}
  write(...args){return Writable.prototype.write.apply(this,args);}
  end(...args){return Writable.prototype.end.apply(this,args);}
  destroy(error){Readable.prototype.destroy.call(this,error);this.writable=false;return this;}
}
export class Transform extends Duplex{
  constructor(options={}){
    super(options);this._transform=typeof options.transform==='function'?options.transform.bind(this):this._transform;
    this._flush=typeof options.flush==='function'?options.flush.bind(this):null;
  }
  _transform(chunk,encoding,callback){callback(null,chunk);}
  _write(chunk,encoding,callback){
    this._transform(chunk,encoding,(error,value)=>{
      if(error){callback(error);return;}
      if(value!==undefined&&value!==null)this.push(value);
      callback();
    });
  }
  _final(callback){
    if(!this._flush){this.push(null);callback();return;}
    this._flush((error,value)=>{if(!error&&value!==undefined&&value!==null)this.push(value);if(!error)this.push(null);callback(error);});
  }
}
export class PassThrough extends Transform{}
export function finished(stream,options,callback){
  if(typeof options==='function'){callback=options;options=undefined;}
  if(typeof callback!=='function')throw new TypeError('callback must be a function');
  return onceSettled(stream,callback);
}
export function pipeline(...args){
  const callback=typeof args[args.length-1]==='function'?args.pop():null;
  if(args.length<2){const error=new TypeError('pipeline requires at least two streams');callback?.(error);if(!callback)throw error;return args[0];}
  for(let index=0;index<args.length-1;index++)args[index].pipe(args[index+1]);
  if(callback)onceSettled(args[args.length-1],callback);
  return args[args.length-1];
}
let byteHighWaterMark=64*1024;
let objectHighWaterMark=16;
export function getDefaultHighWaterMark(objectMode=false){return objectMode?objectHighWaterMark:byteHighWaterMark;}
export function setDefaultHighWaterMark(objectMode,value){const next=Number(value);if(!Number.isFinite(next)||next<0)throw new RangeError('highWaterMark must be non-negative');if(objectMode)objectHighWaterMark=next;else byteHighWaterMark=next;}
export function isReadable(stream){return !!stream&&stream.readable!==false&&!stream.readableEnded&&!stream.destroyed;}
export function isWritable(stream){return !!stream&&stream.writable!==false&&!stream.writableEnded&&!stream.destroyed;}
export function isErrored(stream){return !!stream?.errored;}
export function isDestroyed(stream){return !!stream?.destroyed;}
export function addAbortSignal(signal,stream){if(signal?.aborted)stream.destroy?.(signal.reason??new Error('aborted'));else signal?.addEventListener?.('abort',()=>stream.destroy?.(signal.reason??new Error('aborted')),{once:true});return stream;}
Stream.Readable=Readable;Stream.Writable=Writable;Stream.Duplex=Duplex;Stream.Transform=Transform;Stream.PassThrough=PassThrough;Stream.pipeline=pipeline;Stream.finished=finished;
const api={Stream,Readable,Writable,Duplex,Transform,PassThrough,pipeline,finished,getDefaultHighWaterMark,setDefaultHighWaterMark,isReadable,isWritable,isErrored,isDestroyed,addAbortSignal};
export default Object.assign(Stream,api);
`;
}

function zlibSource() {
  return `
import { Buffer } from 'node:buffer';
function unavailable(operation){
  const error=new Error('zlib operation is unavailable in OpenContainer browser runtime: '+operation);
  error.code='OC_BUILTIN_UNAVAILABLE';
  error.operation=operation;
  return error;
}
function toBytes(value){
  if(typeof value==='string')return new TextEncoder().encode(value);
  if(value instanceof Uint8Array)return value;
  if(value instanceof ArrayBuffer)return new Uint8Array(value);
  if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  return new TextEncoder().encode(String(value??''));
}
async function codec(format,input,decompress){
  const Ctor=decompress?globalThis.DecompressionStream:globalThis.CompressionStream;
  if(typeof Ctor!=='function')throw unavailable((decompress?'decompress:':'compress:')+format);
  let stream;
  try{stream=new Ctor(format);}catch{throw unavailable((decompress?'decompress:':'compress:')+format);}
  const writer=stream.writable.getWriter();
  await writer.write(toBytes(input));
  await writer.close();
  const bytes=new Uint8Array(await new Response(stream.readable).arrayBuffer());
  return Buffer.from(bytes);
}
function callbackCodec(format,decompress,input,options,callback){
  if(typeof options==='function'){callback=options;options=undefined;}
  if(typeof callback!=='function')throw new TypeError('callback must be a function');
  codec(format,input,decompress).then(
    (value)=>callback(null,value),
    (error)=>callback(error)
  );
}
export const constants=Object.freeze({
  Z_NO_FLUSH:0,Z_PARTIAL_FLUSH:1,Z_SYNC_FLUSH:2,Z_FULL_FLUSH:3,Z_FINISH:4,
  Z_OK:0,Z_STREAM_END:1,Z_NEED_DICT:2,Z_ERRNO:-1,Z_STREAM_ERROR:-2,Z_DATA_ERROR:-3,Z_MEM_ERROR:-4,Z_BUF_ERROR:-5,Z_VERSION_ERROR:-6,
  Z_DEFAULT_COMPRESSION:-1,Z_DEFAULT_STRATEGY:0,Z_DEFLATED:8
});
export const codes=Object.freeze({
  Z_OK:0,Z_STREAM_END:1,Z_NEED_DICT:2,Z_ERRNO:-1,Z_STREAM_ERROR:-2,Z_DATA_ERROR:-3,Z_MEM_ERROR:-4,Z_BUF_ERROR:-5,Z_VERSION_ERROR:-6
});
export function gzip(input,options,callback){return callbackCodec('gzip',false,input,options,callback);}
export function gunzip(input,options,callback){return callbackCodec('gzip',true,input,options,callback);}
export function deflate(input,options,callback){return callbackCodec('deflate',false,input,options,callback);}
export function inflate(input,options,callback){return callbackCodec('deflate',true,input,options,callback);}
export function deflateRaw(input,options,callback){return callbackCodec('deflate-raw',false,input,options,callback);}
export function inflateRaw(input,options,callback){return callbackCodec('deflate-raw',true,input,options,callback);}
export function gzipSync(){throw unavailable('gzipSync');}
export function gunzipSync(){throw unavailable('gunzipSync');}
export function deflateSync(){throw unavailable('deflateSync');}
export function inflateSync(){throw unavailable('inflateSync');}
export function deflateRawSync(){throw unavailable('deflateRawSync');}
export function inflateRawSync(){throw unavailable('inflateRawSync');}
export function brotliCompress(input,options,callback){
  if(typeof options==='function')callback=options;
  const error=unavailable('brotliCompress');
  if(typeof callback==='function'){queueMicrotask(()=>callback(error));return;}
  throw error;
}
export function brotliDecompress(input,options,callback){
  if(typeof options==='function')callback=options;
  const error=unavailable('brotliDecompress');
  if(typeof callback==='function'){queueMicrotask(()=>callback(error));return;}
  throw error;
}
export function brotliCompressSync(){throw unavailable('brotliCompressSync');}
export function brotliDecompressSync(){throw unavailable('brotliDecompressSync');}
export function createGzip(){throw unavailable('createGzip');}
export function createGunzip(){throw unavailable('createGunzip');}
export function createDeflate(){throw unavailable('createDeflate');}
export function createInflate(){throw unavailable('createInflate');}
export function createDeflateRaw(){throw unavailable('createDeflateRaw');}
export function createInflateRaw(){throw unavailable('createInflateRaw');}
export function createBrotliCompress(){throw unavailable('createBrotliCompress');}
export function createBrotliDecompress(){throw unavailable('createBrotliDecompress');}
export class Deflate{constructor(){throw unavailable('Deflate');}}
export class Inflate{constructor(){throw unavailable('Inflate');}}
export class Gzip{constructor(){throw unavailable('Gzip');}}
export class Gunzip{constructor(){throw unavailable('Gunzip');}}
export class DeflateRaw{constructor(){throw unavailable('DeflateRaw');}}
export class InflateRaw{constructor(){throw unavailable('InflateRaw');}}
const api={constants,codes,gzip,gunzip,deflate,inflate,deflateRaw,inflateRaw,gzipSync,gunzipSync,deflateSync,inflateSync,deflateRawSync,inflateRawSync,brotliCompress,brotliDecompress,brotliCompressSync,brotliDecompressSync,createGzip,createGunzip,createDeflate,createInflate,createDeflateRaw,createInflateRaw,createBrotliCompress,createBrotliDecompress,Deflate,Inflate,Gzip,Gunzip,DeflateRaw,InflateRaw};
export default api;
`;
}

function querystringSource() {
  return `
import { Buffer } from 'node:buffer';
function primitive(value){
  if(value===null||value===undefined)return '';
  if(typeof value==='string'||typeof value==='number'||typeof value==='bigint'||typeof value==='boolean')return String(value);
  return '';
}
export function escape(value){
  return encodeURIComponent(primitive(value)).replace(/[!'()*]/g,(ch)=>'%'+ch.charCodeAt(0).toString(16).toUpperCase());
}
export function unescape(value){
  const text=String(value).replace(/\\+/g,' ');
  try{return decodeURIComponent(text);}catch{
    try{return decodeURIComponent(text.replace(/%(?![0-9A-Fa-f]{2})/g,'%25'));}catch{return text;}
  }
}
export function unescapeBuffer(value,decodeSpaces=false){
  const text=decodeSpaces?String(value).replace(/\\+/g,' '):String(value);
  return Buffer.from(unescape(text));
}
function append(target,key,value){
  if(!Object.prototype.hasOwnProperty.call(target,key)){target[key]=value;return;}
  if(Array.isArray(target[key]))target[key].push(value);
  else target[key]=[target[key],value];
}
export function parse(input,sep='&',eq='=',options={}){
  const result=Object.create(null);
  const text=String(input??'');
  if(!text)return result;
  const maxKeys=options?.maxKeys===undefined?1000:Number(options.maxKeys);
  let count=0;
  for(const part of text.split(sep)){
    if(maxKeys>0&&count>=maxKeys)break;
    count+=1;
    const index=part.indexOf(eq);
    const rawKey=index<0?part:part.slice(0,index);
    const rawValue=index<0?'':part.slice(index+eq.length);
    append(result,unescape(rawKey),unescape(rawValue));
  }
  return result;
}
export const decode=parse;
export function stringify(object,sep='&',eq='=',options={}){
  if(object===null||typeof object!=='object')return '';
  const encode=typeof options?.encodeURIComponent==='function'?options.encodeURIComponent:escape;
  const parts=[];
  for(const key of Object.keys(object)){
    const value=object[key];
    const encodedKey=encode(key);
    if(Array.isArray(value)){
      for(const entry of value)parts.push(encodedKey+eq+encode(primitive(entry)));
    }else{
      parts.push(encodedKey+eq+encode(primitive(value)));
    }
  }
  return parts.join(sep);
}
export const encode=stringify;
const api={escape,unescape,unescapeBuffer,parse,decode,stringify,encode};
export default api;
`;
}

function httpSource() {
  return `
import { EventEmitter } from 'node:events';
function denied(operation){
  const error=new Error('Raw HTTP socket authority is unavailable in OpenContainer browser runtime: '+operation);
  error.code='OC_BUILTIN_UNAVAILABLE';
  error.operation=operation;
  throw error;
}
export const METHODS=Object.freeze(['GET','HEAD','POST','PUT','DELETE','CONNECT','OPTIONS','TRACE','PATCH']);
export const STATUS_CODES=Object.freeze({
  100:'Continue',101:'Switching Protocols',200:'OK',201:'Created',202:'Accepted',204:'No Content',
  206:'Partial Content',301:'Moved Permanently',302:'Found',303:'See Other',304:'Not Modified',307:'Temporary Redirect',308:'Permanent Redirect',
  400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',405:'Method Not Allowed',408:'Request Timeout',
  409:'Conflict',410:'Gone',413:'Payload Too Large',414:'URI Too Long',415:'Unsupported Media Type',418:"I'm a Teapot",
  422:'Unprocessable Entity',426:'Upgrade Required',429:'Too Many Requests',500:'Internal Server Error',501:'Not Implemented',
  502:'Bad Gateway',503:'Service Unavailable',504:'Gateway Timeout'
});
export const maxHeaderSize=16*1024;
export class Agent{
  constructor(options={}){this.options=options;this.keepAlive=!!options.keepAlive;this.maxSockets=options.maxSockets??Infinity;}
  destroy(){}
}
export const globalAgent=new Agent();
export class IncomingMessage extends EventEmitter{
  constructor(){super();this.headers=Object.create(null);this.rawHeaders=[];this.method=null;this.url='';this.statusCode=null;this.statusMessage=null;this.complete=false;}
}
export class OutgoingMessage extends EventEmitter{
  constructor(){super();this.headersSent=false;this.finished=false;this.writableEnded=false;this._headers=new Map();}
  setHeader(name,value){this._headers.set(String(name).toLowerCase(),value);return this;}
  getHeader(name){return this._headers.get(String(name).toLowerCase());}
  getHeaders(){return Object.fromEntries(this._headers);}
  getHeaderNames(){return [...this._headers.keys()];}
  hasHeader(name){return this._headers.has(String(name).toLowerCase());}
  removeHeader(name){this._headers.delete(String(name).toLowerCase());}
  flushHeaders(){this.headersSent=true;}
  setTimeout(){return this;}
}
export class ServerResponse extends OutgoingMessage{
  constructor(){super();this.statusCode=200;this.statusMessage=STATUS_CODES[200];}
  writeHead(statusCode,statusMessage,headers){
    this.statusCode=statusCode;
    if(typeof statusMessage==='string')this.statusMessage=statusMessage;
    else if(statusMessage&&typeof statusMessage==='object')headers=statusMessage;
    if(headers)for(const [key,value] of Object.entries(headers))this.setHeader(key,value);
    this.headersSent=true;return this;
  }
  write(){return denied('ServerResponse.write');}
  end(){return denied('ServerResponse.end');}
}
export class ClientRequest extends OutgoingMessage{
  abort(){return denied('ClientRequest.abort');}
  end(){return denied('ClientRequest.end');}
}
export class Server extends EventEmitter{
  constructor(){super();this.listening=false;}
  listen(){return denied('Server.listen');}
  close(callback){this.listening=false;if(typeof callback==='function')queueMicrotask(callback);return this;}
  address(){return null;}
}
export function createServer(){return new Server();}
export function request(){return denied('request');}
export function get(){return denied('get');}
export function validateHeaderName(name){
  const value=String(name);
  const withoutBacktick=value.split(String.fromCharCode(96)).join('');
  if(!value||!/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/.test(withoutBacktick)){const error=new TypeError('Invalid HTTP header name');error.code='ERR_INVALID_HTTP_TOKEN';throw error;}
}
export function validateHeaderValue(name,value){
  if(/[\\r\\n]/.test(String(value))){const error=new TypeError('Invalid HTTP header value');error.code='ERR_INVALID_CHAR';throw error;}
}
export function setMaxIdleHTTPParsers(){}
const api={METHODS,STATUS_CODES,maxHeaderSize,Agent,globalAgent,IncomingMessage,OutgoingMessage,ServerResponse,ClientRequest,Server,createServer,request,get,validateHeaderName,validateHeaderValue,setMaxIdleHTTPParsers};
export default api;
`;
}

function httpsSource() {
  return `
import http from 'node:http';
export class Agent extends http.Agent{}
export const globalAgent=new Agent();
export class Server extends http.Server{}
export function createServer(){return new Server();}
export function request(){const error=new Error('Raw HTTPS socket authority is unavailable in OpenContainer browser runtime');error.code='OC_BUILTIN_UNAVAILABLE';throw error;}
export function get(){return request();}
export const METHODS=http.METHODS;
export const STATUS_CODES=http.STATUS_CODES;
const api={Agent,globalAgent,Server,createServer,request,get,METHODS,STATUS_CODES};
export default api;
`;
}

function http2Source() {
  return `
import { EventEmitter } from 'node:events';
function denied(operation){const error=new Error('HTTP/2 socket authority is unavailable in OpenContainer browser runtime: '+operation);error.code='OC_BUILTIN_UNAVAILABLE';throw error;}
export const constants=Object.freeze({});
export class Http2ServerRequest extends EventEmitter{}
export class Http2ServerResponse extends EventEmitter{}
export class Http2Server extends EventEmitter{listen(){return denied('Http2Server.listen');}}
export class Http2SecureServer extends Http2Server{}
export function createServer(){return new Http2Server();}
export function createSecureServer(){return new Http2SecureServer();}
export function connect(){return denied('connect');}
export function getDefaultSettings(){return Object.freeze({});}
export function getPackedSettings(){return new Uint8Array();}
export function getUnpackedSettings(){return Object.freeze({});}
const api={constants,Http2ServerRequest,Http2ServerResponse,Http2Server,Http2SecureServer,createServer,createSecureServer,connect,getDefaultSettings,getPackedSettings,getUnpackedSettings};
export default api;
`;
}

function tlsSource() {
  return `
import { EventEmitter } from 'node:events';
function denied(operation){const error=new Error('TLS socket authority is unavailable in OpenContainer browser runtime: '+operation);error.code='OC_BUILTIN_UNAVAILABLE';throw error;}
export const DEFAULT_MIN_VERSION='TLSv1.2';
export const DEFAULT_MAX_VERSION='TLSv1.3';
export class TLSSocket extends EventEmitter{constructor(){super();this.encrypted=true;this.authorized=false;}}
export class Server extends EventEmitter{listen(){return denied('tls.Server.listen');}}
export function createServer(){return new Server();}
export function connect(){return denied('tls.connect');}
export function createSecureContext(){return Object.freeze({context:null});}
export function getCiphers(){return [];}
export function rootCertificates(){return Object.freeze([]);}
const api={DEFAULT_MIN_VERSION,DEFAULT_MAX_VERSION,TLSSocket,Server,createServer,connect,createSecureContext,getCiphers,rootCertificates};
export default api;
`;
}

function timersSource() {
  return `
export const setTimeout=globalThis.setTimeout.bind(globalThis);
export const clearTimeout=globalThis.clearTimeout.bind(globalThis);
export const setInterval=globalThis.setInterval.bind(globalThis);
export const clearInterval=globalThis.clearInterval.bind(globalThis);
export const setImmediate=(callback,...args)=>globalThis.setTimeout(callback,0,...args);
export const clearImmediate=(handle)=>globalThis.clearTimeout(handle);
const api={setTimeout,clearTimeout,setInterval,clearInterval,setImmediate,clearImmediate};
export default api;
`;
}

function timersPromisesSource() {
  return `
function abortError(){
  const error=new Error('The operation was aborted');
  error.name='AbortError';
  error.code='ABORT_ERR';
  return error;
}
export function setTimeout(delay=1,value,options={}){
  return new Promise((resolve,reject)=>{
    const signal=options?.signal;
    if(signal?.aborted){reject(abortError());return;}
    const timer=globalThis.setTimeout(()=>{cleanup();resolve(value);},Math.max(0,Number(delay)||0));
    const onAbort=()=>{globalThis.clearTimeout(timer);cleanup();reject(abortError());};
    const cleanup=()=>signal?.removeEventListener?.('abort',onAbort);
    signal?.addEventListener?.('abort',onAbort,{once:true});
  });
}
export function setImmediate(value,options={}){return setTimeout(0,value,options);}
export async function* setInterval(delay=1,value,options={}){
  while(true){
    yield await setTimeout(delay,value,options);
  }
}
export const scheduler=Object.freeze({
  wait:(delay,options)=>setTimeout(delay,undefined,options),
  yield:()=>setImmediate()
});
export default {setTimeout,setImmediate,setInterval,scheduler};
`;
}

function readlineSource() {
  return `
function done(callback){if(typeof callback==='function')queueMicrotask(callback);return true;}
export function cursorTo(stream,x,y,callback){return done(typeof y==='function'?y:callback);}
export function moveCursor(stream,dx,dy,callback){return done(callback);}
export function clearLine(stream,dir,callback){return done(callback);}
export function clearScreenDown(stream,callback){return done(callback);}
export function emitKeypressEvents(){}
export class Interface{
  constructor(input,output){this.input=input;this.output=output;this.closed=false;}
  on(){return this;}once(){return this;}off(){return this;}removeListener(){return this;}
  pause(){return this;}resume(){return this;}
  close(){this.closed=true;return this;}
  question(query,options,callback){
    if(typeof options==='function')callback=options;
    const error=new Error('Interactive readline is unavailable in OpenContainer browser runtime');
    error.code='OC_BUILTIN_UNAVAILABLE';
    if(typeof callback==='function')queueMicrotask(()=>callback(''));
    else return Promise.reject(error);
  }
}
export function createInterface(optionsOrInput,output){
  const options=optionsOrInput&&typeof optionsOrInput==='object'&&'input' in optionsOrInput?optionsOrInput:{input:optionsOrInput,output};
  return new Interface(options.input,options.output);
}
const api={Interface,createInterface,cursorTo,moveCursor,clearLine,clearScreenDown,emitKeypressEvents};
export default api;
`;
}

function v8Source() {
  return `
function unavailable(operation){
  const error=new Error('V8 host introspection is unavailable in OpenContainer browser runtime: '+operation);
  error.code='OC_BUILTIN_UNAVAILABLE';
  throw error;
}
const logicalHeapLimit=256*1024*1024;
export function cachedDataVersionTag(){return 0;}
export function getHeapStatistics(){
  return Object.freeze({
    total_heap_size:0,
    total_heap_size_executable:0,
    total_physical_size:0,
    total_available_size:logicalHeapLimit,
    used_heap_size:0,
    heap_size_limit:logicalHeapLimit,
    malloced_memory:0,
    peak_malloced_memory:0,
    does_zap_garbage:0,
    number_of_native_contexts:1,
    number_of_detached_contexts:0,
    total_global_handles_size:0,
    used_global_handles_size:0,
    external_memory:0
  });
}
export function getHeapSpaceStatistics(){return [];}
export function getHeapCodeStatistics(){return Object.freeze({code_and_metadata_size:0,bytecode_and_metadata_size:0,external_script_source_size:0,cpu_profiler_metadata_size:0});}
export function getCppHeapStatistics(){return Object.freeze({committed_size_bytes:0,resident_size_bytes:0,used_size_bytes:0,space_statistics:[]});}
export function setFlagsFromString(){return unavailable('setFlagsFromString');}
export function writeHeapSnapshot(){return unavailable('writeHeapSnapshot');}
export function getHeapSnapshot(){return unavailable('getHeapSnapshot');}
export function serialize(){return unavailable('serialize');}
export function deserialize(){return unavailable('deserialize');}
function makeHook(){
  return Object.freeze({enable(){return this;},disable(){return this;}});
}
export const promiseHooks=Object.freeze({
  createHook(){return makeHook();},
  onInit(){return ()=>{};},
  onBefore(){return ()=>{};},
  onAfter(){return ()=>{};},
  onSettled(){return ()=>{};}
});
export const startupSnapshot=Object.freeze({
  isBuildingSnapshot(){return false;},
  addSerializeCallback(){return unavailable('startupSnapshot.addSerializeCallback');},
  addDeserializeCallback(){return unavailable('startupSnapshot.addDeserializeCallback');},
  setDeserializeMainFunction(){return unavailable('startupSnapshot.setDeserializeMainFunction');}
});
const api={cachedDataVersionTag,getHeapStatistics,getHeapSpaceStatistics,getHeapCodeStatistics,getCppHeapStatistics,setFlagsFromString,writeHeapSnapshot,getHeapSnapshot,serialize,deserialize,promiseHooks,startupSnapshot};
export default api;
`;
}

function assertSource() {
  return `
import { isDeepStrictEqual } from 'node:util';
export class AssertionError extends Error{
  constructor({message='Assertion failed',actual,expected,operator='fail'}={}){
    super(message);
    this.name='AssertionError';
    this.code='ERR_ASSERTION';
    this.actual=actual;
    this.expected=expected;
    this.operator=operator;
    this.generatedMessage=!message;
  }
}
function error(message,actual,expected,operator){
  return new AssertionError({message:message??('Expected values to satisfy '+operator),actual,expected,operator});
}
export function fail(message='Failed'){throw error(message,undefined,undefined,'fail');}
export function ok(value,message){if(!value)throw error(message,value,true,'==');}
export function equal(actual,expected,message){if(actual!=expected)throw error(message,actual,expected,'==');}
export function notEqual(actual,expected,message){if(actual==expected)throw error(message,actual,expected,'!=');}
export function strictEqual(actual,expected,message){if(!Object.is(actual,expected))throw error(message,actual,expected,'strictEqual');}
export function notStrictEqual(actual,expected,message){if(Object.is(actual,expected))throw error(message,actual,expected,'notStrictEqual');}
export function deepStrictEqual(actual,expected,message){if(!isDeepStrictEqual(actual,expected))throw error(message,actual,expected,'deepStrictEqual');}
export function notDeepStrictEqual(actual,expected,message){if(isDeepStrictEqual(actual,expected))throw error(message,actual,expected,'notDeepStrictEqual');}
export const deepEqual=deepStrictEqual;
export const notDeepEqual=notDeepStrictEqual;
export function match(value,regexp,message){if(!(regexp instanceof RegExp)||!regexp.test(String(value)))throw error(message,value,regexp,'match');}
export function doesNotMatch(value,regexp,message){if(regexp instanceof RegExp&&regexp.test(String(value)))throw error(message,value,regexp,'doesNotMatch');}
function expectedError(error,expected){
  if(expected==null)return true;
  if(typeof expected==='function'){
    if(expected.prototype instanceof Error||expected===Error)return error instanceof expected;
    return expected(error)===true;
  }
  if(expected instanceof RegExp)return expected.test(String(error?.message??error));
  if(typeof expected==='object'){
    return Object.entries(expected).every(([key,value])=>isDeepStrictEqual(error?.[key],value));
  }
  return false;
}
export function throws(fn,expected,message){
  try{fn();}catch(cause){if(expectedError(cause,expected))return cause;throw error(message??'Thrown error did not match expectation',cause,expected,'throws');}
  throw error(message??'Missing expected exception',undefined,expected,'throws');
}
export function doesNotThrow(fn,message){try{return fn();}catch(cause){throw error(message??'Got unwanted exception',cause,undefined,'doesNotThrow');}}
export async function rejects(value,expected,message){
  try{await (typeof value==='function'?value():value);}catch(cause){if(expectedError(cause,expected))return cause;throw error(message??'Rejected error did not match expectation',cause,expected,'rejects');}
  throw error(message??'Missing expected rejection',undefined,expected,'rejects');
}
export async function doesNotReject(value,message){
  try{return await (typeof value==='function'?value():value);}catch(cause){throw error(message??'Got unwanted rejection',cause,undefined,'doesNotReject');}
}
const assert=Object.assign(ok,{AssertionError,fail,ok,equal,notEqual,strictEqual,notStrictEqual,deepEqual,notDeepEqual,deepStrictEqual,notDeepStrictEqual,match,doesNotMatch,throws,doesNotThrow,rejects,doesNotReject});
assert.strict=assert;
export const strict=assert;
export default assert;
`;
}

function ttySource() {
  return `
export function isatty(){return false;}
export class ReadStream{
  constructor(fd=0){
    this.fd=fd;
    this.isTTY=false;
    this.isRaw=false;
  }
  setRawMode(mode){this.isRaw=!!mode;return this;}
  ref(){return this;}
  unref(){return this;}
}
export class WriteStream{
  constructor(fd=1){
    this.fd=fd;
    this.isTTY=false;
    this.columns=undefined;
    this.rows=undefined;
  }
  getColorDepth(){return 1;}
  hasColors(){return false;}
  getWindowSize(){return [0,0];}
  ref(){return this;}
  unref(){return this;}
}
const api={isatty,ReadStream,WriteStream};
export default api;
`;
}

function childProcessSource() {
  return `
function denied(operation){
  const error=new Error('Host child process execution is unavailable in OpenContainer browser runtime: '+operation);
  error.code='OC_BUILTIN_UNAVAILABLE';
  error.operation=operation;
  return error;
}
export class ChildProcess{
  constructor(){this.pid=undefined;this.exitCode=null;this.killed=false;}
  kill(){this.killed=true;return false;}
  ref(){return this;}
  unref(){return this;}
  on(){return this;}
  once(){return this;}
}
export function exec(command,options,callback){
  if(typeof options==='function'){callback=options;options=undefined;}
  const error=denied('exec');
  if(typeof callback==='function'){queueMicrotask(()=>callback(error,'',''));return new ChildProcess();}
  throw error;
}
export function execFile(file,args,options,callback){
  if(typeof args==='function'){callback=args;args=[];options=undefined;}
  else if(typeof options==='function'){callback=options;options=undefined;}
  const error=denied('execFile');
  if(typeof callback==='function'){queueMicrotask(()=>callback(error,'',''));return new ChildProcess();}
  throw error;
}
export function spawn(){throw denied('spawn');}
export function fork(){throw denied('fork');}
export function execSync(){throw denied('execSync');}
export function execFileSync(){throw denied('execFileSync');}
export function spawnSync(){throw denied('spawnSync');}
const api={ChildProcess,exec,execFile,spawn,fork,execSync,execFileSync,spawnSync};
export default api;
`;
}

function workerThreadsSource() {
  return `
const environmentData=new Map();
export const isMainThread=true;
export const parentPort=null;
export const workerData=null;
export const threadId=0;
export const SHARE_ENV=Symbol.for('opencontainer.worker_threads.SHARE_ENV');
export const BroadcastChannel=globalThis.BroadcastChannel;
export const MessageChannel=globalThis.MessageChannel;
export const MessagePort=globalThis.MessagePort;
export function markAsUntransferable(){}
export function isMarkedAsUntransferable(){return false;}
export function moveMessagePortToContext(port){return port;}
export function receiveMessageOnPort(){return undefined;}
export function setEnvironmentData(key,value){environmentData.set(key,value);}
export function getEnvironmentData(key){return environmentData.get(key);}
export class Worker{
  constructor(){
    const error=new Error('Nested Node worker_threads.Worker is not promoted in the browser C1 profile');
    error.code='OC_BUILTIN_UNAVAILABLE';
    throw error;
  }
}
const api={isMainThread,parentPort,workerData,threadId,SHARE_ENV,BroadcastChannel,MessageChannel,MessagePort,Worker,markAsUntransferable,isMarkedAsUntransferable,moveMessagePortToContext,receiveMessageOnPort,setEnvironmentData,getEnvironmentData};
export default api;
`;
}

function utilSource() {
  return `
const inspectCustom=Symbol.for('nodejs.util.inspect.custom');
const promisifyCustom=Symbol.for('nodejs.util.promisify.custom');

function primitive(value){
  if(typeof value==='string')return JSON.stringify(value);
  if(typeof value==='bigint')return String(value)+'n';
  if(typeof value==='symbol')return String(value);
  return String(value);
}
function inspectValue(value,depth,seen){
  if(value===null||typeof value!=='object')return primitive(value);
  if(value[inspectCustom]&&typeof value[inspectCustom]==='function'){
    try{return String(value[inspectCustom](depth,{depth}));}catch{}
  }
  if(value instanceof Error)return value.stack||value.name+': '+value.message;
  if(value instanceof Date)return value.toISOString();
  if(value instanceof RegExp)return String(value);
  if(seen.has(value))return '[Circular]';
  if(depth<0)return Array.isArray(value)?'[Array]':'[Object]';
  seen.add(value);
  let result;
  if(Array.isArray(value)){
    result='[ '+value.map((entry)=>inspectValue(entry,depth-1,seen)).join(', ')+' ]';
  }else if(value instanceof Map){
    result='Map('+value.size+') { '+[...value].map(([k,v])=>inspectValue(k,depth-1,seen)+' => '+inspectValue(v,depth-1,seen)).join(', ')+' }';
  }else if(value instanceof Set){
    result='Set('+value.size+') { '+[...value].map((entry)=>inspectValue(entry,depth-1,seen)).join(', ')+' }';
  }else{
    const entries=Object.keys(value).map((key)=>key+': '+inspectValue(value[key],depth-1,seen));
    result='{ '+entries.join(', ')+' }';
  }
  seen.delete(value);
  return result;
}
export function inspect(value,options={}){
  const depth=typeof options==='number'?options:(options?.depth??2);
  return inspectValue(value,depth,new Set());
}
inspect.custom=inspectCustom;

export function format(first,...args){
  if(typeof first!=='string')return [first,...args].map((value)=>inspect(value)).join(' ');
  let index=0;
  const text=first.replace(/%[sdijoO%]/g,(token)=>{
    if(token==='%%')return '%';
    if(index>=args.length)return token;
    const value=args[index++];
    if(token==='%s')return String(value);
    if(token==='%d'||token==='%i')return String(Number.parseInt(value,10));
    if(token==='%j'){try{return JSON.stringify(value);}catch{return '[Circular]';}}
    return inspect(value);
  });
  return text+(index<args.length?' '+args.slice(index).map((value)=>typeof value==='string'?value:inspect(value)).join(' '):'');
}
export function formatWithOptions(options,...args){return format(...args);}

const styleCodes=Object.freeze({
  bold:[1,22],italic:[3,23],underline:[4,24],inverse:[7,27],strikethrough:[9,29],
  white:[37,39],grey:[90,39],gray:[90,39],black:[30,39],blue:[34,39],cyan:[36,39],green:[32,39],magenta:[35,39],red:[31,39],yellow:[33,39],
  bgWhite:[47,49],bgGrey:[100,49],bgGray:[100,49],bgBlack:[40,49],bgBlue:[44,49],bgCyan:[46,49],bgGreen:[42,49],bgMagenta:[45,49],bgRed:[41,49],bgYellow:[43,49]
});
export function styleText(formatValue,text,options={}){
  const styles=Array.isArray(formatValue)?formatValue:[formatValue];
  if(options?.validateStream===true){
    const stream=options.stream??globalThis.process?.stdout;
    if(stream&&typeof stream.hasColors==='function'&&!stream.hasColors())return String(text);
  }
  let open='',close='';
  for(const style of styles){
    const codes=styleCodes[style];
    if(!codes){
      const error=new TypeError('Unknown style: '+String(style));
      error.code='ERR_INVALID_ARG_VALUE';
      throw error;
    }
    open+='\\u001b['+codes[0]+'m';
    close='\\u001b['+codes[1]+'m'+close;
  }
  return open+String(text)+close;
}

export function promisify(original){
  if(typeof original!=='function')throw new TypeError('original must be a function');
  if(typeof original[promisifyCustom]==='function')return original[promisifyCustom];
  const wrapped=(...args)=>new Promise((resolve,reject)=>{
    original(...args,(error,...values)=>{
      if(error){reject(error);return;}
      resolve(values.length>1?values:values[0]);
    });
  });
  Object.defineProperty(wrapped,promisifyCustom,{value:wrapped});
  return wrapped;
}
promisify.custom=promisifyCustom;

function deepEqual(a,b,seen){
  if(Object.is(a,b))return true;
  if(typeof a!==typeof b||a===null||b===null||typeof a!=='object')return false;
  let peers=seen.get(a);
  if(peers?.has(b))return true;
  if(!peers){peers=new Set();seen.set(a,peers);}
  peers.add(b);
  if(Object.getPrototypeOf(a)!==Object.getPrototypeOf(b))return false;
  if(a instanceof Date)return a.getTime()===b.getTime();
  if(a instanceof RegExp)return a.source===b.source&&a.flags===b.flags;
  if(ArrayBuffer.isView(a)){
    if(!ArrayBuffer.isView(b)||a.byteLength!==b.byteLength)return false;
    const left=new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
    const right=new Uint8Array(b.buffer,b.byteOffset,b.byteLength);
    for(let i=0;i<left.length;i++)if(left[i]!==right[i])return false;
    return true;
  }
  if(a instanceof ArrayBuffer){
    if(!(b instanceof ArrayBuffer)||a.byteLength!==b.byteLength)return false;
    return deepEqual(new Uint8Array(a),new Uint8Array(b),seen);
  }
  if(a instanceof Map){
    if(!(b instanceof Map)||a.size!==b.size)return false;
    for(const [key,value] of a)if(!b.has(key)||!deepEqual(value,b.get(key),seen))return false;
    return true;
  }
  if(a instanceof Set){
    if(!(b instanceof Set)||a.size!==b.size)return false;
    for(const value of a)if(!b.has(value))return false;
    return true;
  }
  const ka=Reflect.ownKeys(a),kb=Reflect.ownKeys(b);
  if(ka.length!==kb.length)return false;
  for(const key of ka){
    if(!Object.prototype.hasOwnProperty.call(b,key)||!deepEqual(a[key],b[key],seen))return false;
  }
  return true;
}
export function isDeepStrictEqual(a,b){return deepEqual(a,b,new WeakMap());}

const ansi=/[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*)?\\u0007)|(?:(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))/g;
export function stripVTControlCharacters(value){return String(value).replace(ansi,'');}

export function parseEnv(content){
  const result=Object.create(null);
  const lines=String(content).replace(/\\r\\n?/g,'\\n').split('\\n');
  for(let line of lines){
    line=line.trim();
    if(!line||line.startsWith('#'))continue;
    if(line.startsWith('export '))line=line.slice(7).trim();
    const match=/^([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*)$/.exec(line);
    if(!match)continue;
    let value=match[2].trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))){
      const quote=value[0];
      value=value.slice(1,-1);
      if(quote==='"')value=value.replace(/\\\\n/g,'\\n').replace(/\\\\r/g,'\\r').replace(/\\\\t/g,'\\t').replace(/\\\\\\\\/g,'\\\\');
    }else{
      const comment=value.search(/\\s+#/);
      if(comment>=0)value=value.slice(0,comment).trimEnd();
    }
    result[match[1]]=value;
  }
  return result;
}

export function deprecate(fn){return fn;}
export function inherits(ctor,superCtor){
  Object.setPrototypeOf(ctor.prototype,superCtor.prototype);
  Object.setPrototypeOf(ctor,superCtor);
}
export function callbackify(original){
  return (...args)=>{
    const callback=args.pop();
    Promise.resolve().then(()=>original(...args)).then(
      (value)=>queueMicrotask(()=>callback(null,value)),
      (error)=>queueMicrotask(()=>callback(error))
    );
  };
}
export const types=Object.freeze({
  isDate:(value)=>value instanceof Date,
  isRegExp:(value)=>value instanceof RegExp,
  isMap:(value)=>value instanceof Map,
  isSet:(value)=>value instanceof Set,
  isArrayBuffer:(value)=>value instanceof ArrayBuffer,
  isTypedArray:(value)=>ArrayBuffer.isView(value)&&!(value instanceof DataView)
});
export const TextEncoder=globalThis.TextEncoder;
export const TextDecoder=globalThis.TextDecoder;
const api={inspect,format,formatWithOptions,styleText,promisify,isDeepStrictEqual,stripVTControlCharacters,parseEnv,deprecate,inherits,callbackify,types,TextEncoder,TextDecoder};
export default api;
`;
}

function perfHooksSource() {
  return `
export const performance=globalThis.performance;
export const PerformanceObserver=globalThis.PerformanceObserver;
export const PerformanceEntry=globalThis.PerformanceEntry;
export const PerformanceMark=globalThis.PerformanceMark;
export const PerformanceMeasure=globalThis.PerformanceMeasure;
export const PerformanceResourceTiming=globalThis.PerformanceResourceTiming;
export const constants=Object.freeze({});
export function monitorEventLoopDelay(){
  const error=new Error('monitorEventLoopDelay is not promoted in the browser runtime profile');
  error.code='OC_BUILTIN_UNAVAILABLE';
  throw error;
}
export default {performance,PerformanceObserver,PerformanceEntry,PerformanceMark,PerformanceMeasure,PerformanceResourceTiming,constants,monitorEventLoopDelay};
`;
}

function cryptoSource() {
  return `
import { Buffer } from 'node:buffer';
const call=(method,payload)=>globalThis.__opencontainer_sync_host_call__('node.crypto.'+method,payload);
const bytes=(value)=>value&&value.__opencontainerBytes?Buffer.from(value.__opencontainerBytes):value;
const payload=(value,encoding)=>{
  if(typeof value==='string')return {text:value,encoding:encoding??'utf8'};
  if(value instanceof Uint8Array)return {bytes:[...value]};
  if(value instanceof ArrayBuffer)return {bytes:[...new Uint8Array(value)]};
  if(ArrayBuffer.isView(value))return {bytes:[...new Uint8Array(value.buffer,value.byteOffset,value.byteLength)]};
  return {text:String(value),encoding:encoding??'utf8'};
};
export const webcrypto=globalThis.crypto;
export const subtle=globalThis.crypto.subtle;
export const getRandomValues=globalThis.crypto.getRandomValues.bind(globalThis.crypto);
export const randomUUID=globalThis.crypto.randomUUID.bind(globalThis.crypto);
export function randomBytes(size,callback){
  if(!Number.isInteger(size)||size<0)throw new RangeError('size must be a non-negative integer');
  const out=Buffer.alloc(size);
  for(let offset=0;offset<size;offset+=65536){
    globalThis.crypto.getRandomValues(out.subarray(offset,Math.min(size,offset+65536)));
  }
  if(typeof callback==='function'){queueMicrotask(()=>callback(null,out));return;}
  return out;
}
export function timingSafeEqual(a,b){
  const left=Buffer.from(a),right=Buffer.from(b);
  if(left.length!==right.length)throw new RangeError('Input buffers must have the same byte length');
  let diff=0;
  for(let i=0;i<left.length;i++)diff|=left[i]^right[i];
  return diff===0;
}
export function hash(algorithm,data,outputEncoding){
  const digest=bytes(call('hash',{algorithm:String(algorithm),data:payload(data)}));
  return outputEncoding===undefined?digest:digest.toString(outputEncoding);
}
export function createHash(algorithm){
  const chunks=[];
  return {
    update(data,encoding){chunks.push(Buffer.from(typeof data==='string'?data:Buffer.from(data),encoding));return this;},
    digest(outputEncoding){
      const digest=hash(algorithm,Buffer.concat(chunks));
      return outputEncoding===undefined?digest:digest.toString(outputEncoding);
    }
  };
}
export class X509Certificate{
  constructor(){const error=new Error('X509Certificate is not promoted in the browser runtime profile');error.code='OC_BUILTIN_UNAVAILABLE';throw error;}
}
const api={webcrypto,subtle,getRandomValues,randomUUID,randomBytes,timingSafeEqual,hash,createHash,X509Certificate};
export default api;
`;
}

function moduleSource(builtinModules) {
  return `
import * as __oc_builtin_0 from "node:fs";\nimport * as __oc_builtin_1 from "node:fs/promises";\nimport * as __oc_builtin_2 from "node:path";\nimport * as __oc_builtin_3 from "node:path/posix";\nimport * as __oc_builtin_4 from "node:path/win32";\nimport * as __oc_builtin_5 from "node:buffer";\nimport * as __oc_builtin_6 from "node:events";\nimport * as __oc_builtin_7 from "node:process";\nimport * as __oc_builtin_8 from "node:url";\nimport * as __oc_builtin_9 from "node:crypto";\nimport * as __oc_builtin_10 from "node:perf_hooks";\nimport * as __oc_builtin_11 from "node:util";\nimport * as __oc_builtin_12 from "node:worker_threads";\nimport * as __oc_builtin_13 from "node:child_process";\nimport * as __oc_builtin_14 from "node:dns";\nimport * as __oc_builtin_15 from "node:dns/promises";\nimport * as __oc_builtin_16 from "node:os";\nimport * as __oc_builtin_17 from "node:net";\nimport * as __oc_builtin_18 from "node:tty";\nimport * as __oc_builtin_19 from "node:assert";\nimport * as __oc_builtin_20 from "node:assert/strict";\nimport * as __oc_builtin_21 from "node:v8";\nimport * as __oc_builtin_22 from "node:timers";\nimport * as __oc_builtin_23 from "node:timers/promises";\nimport * as __oc_builtin_24 from "node:readline";\nimport * as __oc_builtin_25 from "node:http";\nimport * as __oc_builtin_26 from "node:https";\nimport * as __oc_builtin_27 from "node:http2";\nimport * as __oc_builtin_28 from "node:tls";\nimport * as __oc_builtin_29 from "node:querystring";\nimport * as __oc_builtin_30 from "node:zlib";
import * as __oc_builtin_31 from "node:stream";
export const builtinModules=Object.freeze(${JSON.stringify(builtinModules)});
const requireBuiltins=new Map([["fs",__oc_builtin_0],["fs/promises",__oc_builtin_1],["path",__oc_builtin_2],["path/posix",__oc_builtin_3],["path/win32",__oc_builtin_4],["buffer",__oc_builtin_5],["events",__oc_builtin_6],["process",__oc_builtin_7],["url",__oc_builtin_8],["crypto",__oc_builtin_9],["perf_hooks",__oc_builtin_10],["util",__oc_builtin_11],["worker_threads",__oc_builtin_12],["child_process",__oc_builtin_13],["dns",__oc_builtin_14],["dns/promises",__oc_builtin_15],["os",__oc_builtin_16],["net",__oc_builtin_17],["tty",__oc_builtin_18],["assert",__oc_builtin_19],["assert/strict",__oc_builtin_20],["v8",__oc_builtin_21],["timers",__oc_builtin_22],["timers/promises",__oc_builtin_23],["readline",__oc_builtin_24],["http",__oc_builtin_25],["https",__oc_builtin_26],["http2",__oc_builtin_27],["tls",__oc_builtin_28],["querystring",__oc_builtin_29],["zlib",__oc_builtin_30],["stream",__oc_builtin_31]]);
function unwrapBuiltin(namespace){
  if(namespace&&Object.prototype.hasOwnProperty.call(namespace,'default'))return namespace.default;
  return namespace;
}
const builtinSet=new Set(builtinModules);
export function isBuiltin(specifier){
  const value=String(specifier);
  return builtinSet.has(value.startsWith('node:')?value.slice(5):value);
}
function unsupportedRequire(specifier){
  const error=new Error('Synchronous CommonJS require() is not promoted in the native browser ESM profile: '+String(specifier));
  error.code='OC_REQUIRE_ESM_UNSUPPORTED';
  throw error;
}
function unwrapPrelinked(namespace){
  if(namespace&&Object.prototype.hasOwnProperty.call(namespace,'__opencontainer_cjs_cell')){
    const cell=namespace.__opencontainer_cjs_cell;
    return Object.prototype.hasOwnProperty.call(cell,'current')?cell.current:cell;
  }
  if(namespace&&Object.prototype.hasOwnProperty.call(namespace,'__opencontainer_cjs_exports'))return namespace.__opencontainer_cjs_exports;
  if(namespace&&Object.prototype.hasOwnProperty.call(namespace,'default'))return namespace.default;
  return namespace;
}
export function createRequire(filename){
  const issuer=String(filename);
  const require=(specifier)=>{
    const value=String(specifier);
    const bare=value.startsWith('node:')?value.slice(5):value;
    if(requireBuiltins.has(bare))return unwrapBuiltin(requireBuiltins.get(bare));
    const prelinked=globalThis.__opencontainer_prelinked_require__;
    const keys=[JSON.stringify([issuer,value])];
    try{
      const normalized=new URL(issuer);
      normalized.search='';normalized.hash='';
      const normalizedKey=JSON.stringify([normalized.href,value]);
      if(normalizedKey!==keys[0])keys.push(normalizedKey);
    }catch{}
    for(const key of keys)if(prelinked?.has(key))return unwrapPrelinked(prelinked.get(key));
    return unsupportedRequire(specifier);
  };
  require.resolve=(specifier)=>globalThis.__opencontainer_sync_host_call__('node.module.resolve',{
    specifier:String(specifier),
    issuer
  });
  require.resolve.paths=()=>null;
  require.cache=Object.create(null);
  require.extensions=Object.create(null);
  require.main=null;
  return require;
}
export const createRequireFromPath=createRequire;
export function syncBuiltinESMExports(){}
function Module(id='',parent=null){
  this.id=id;this.path='';this.exports={};this.filename=null;this.loaded=false;this.children=[];this.parent=parent;
}
Module.builtinModules=builtinModules;
Module.isBuiltin=isBuiltin;
Module.createRequire=createRequire;
Module.createRequireFromPath=createRequire;
Module.syncBuiltinESMExports=syncBuiltinESMExports;
Module.Module=Module;
// CommonJS consumers legitimately use require('module') / require('node:module')
// to reach createRequire and builtin metadata. Keep this self-reference inside the
// synthetic builtin registry instead of widening synchronous require to packages.
requireBuiltins.set('module',Module);
export { Module };
export default Module;
`;
}

export function createBrowserNodeCompatBridge({
  fs,
  writableFs = fs,
  cwd = '/workspace',
  env = {},
  argv = ['opencontainer'],
  platform = 'linux',
  arch = 'wasm32',
  resolver = null
} = {}) {
  assertOc(fs && typeof fs.readFile === 'function', ErrorCodes.INVALID_ARGUMENT, 'Browser Node compatibility bridge requires filesystem authority');

  const core = createCoreBuiltinRegistry({ fs, writableFs, cwd, env, argv, platform });
  const virtualFileDescriptors = new Map();
  const virtualSystemFiles = new Map([
    ['/proc/version', Object.freeze({
      text: 'Linux version 6.6.0-opencontainer (OpenContainer browser runtime) #1 SMP\\n',
      mode: 0o100444
    })]
  ]);
  const textEncoder = new TextEncoder();
  let nextVirtualFd = 3;

  const virtualSystemFile = (pathValue) => virtualSystemFiles.get(String(pathValue)) ?? null;

  const readVirtualSystemFile = (pathValue, options = null) => {
    const file = virtualSystemFile(pathValue);
    if (!file) return null;
    const encoding = typeof options === 'string' ? options : options?.encoding ?? null;
    if (encoding === null || encoding === undefined) {
      return { __opencontainerBytes: [...textEncoder.encode(file.text)] };
    }
    const normalizedEncoding = String(encoding).toLowerCase();
    assertOc(
      normalizedEncoding === 'utf8' || normalizedEncoding === 'utf-8',
      ErrorCodes.INVALID_ARGUMENT,
      'Virtual system files currently support UTF-8 text reads only',
      { path: String(pathValue), encoding }
    );
    return file.text;
  };

  const statVirtualSystemFile = (pathValue) => {
    const file = virtualSystemFile(pathValue);
    if (!file) return null;
    return {
      size: textEncoder.encode(file.text).byteLength,
      mode: file.mode,
      file: true,
      directory: false,
      symlink: false
    };
  };

  const openVirtualFd = (pathValue, flags = 'r') => {
    const normalizedFlags = typeof flags === 'number' ? flags : String(flags ?? 'r');
    const readOnly = normalizedFlags === 0 || normalizedFlags === 'r' || normalizedFlags === 'rs' || normalizedFlags === 'sr';
    assertOc(
      readOnly,
      ErrorCodes.BUILTIN_UNAVAILABLE,
      'Browser virtual file descriptors currently support read-only opens only',
      { flags: normalizedFlags }
    );
    const systemStat = statVirtualSystemFile(pathValue);
    const stat = systemStat ?? core.fs.statSync(pathValue);
    const isDirectory = systemStat ? systemStat.directory : stat.isDirectory();
    assertOc(!isDirectory, ErrorCodes.INVALID_ARGUMENT, 'Cannot open a directory as a browser virtual file descriptor', {
      path: String(pathValue)
    });
    const fd = nextVirtualFd++;
    virtualFileDescriptors.set(fd, Object.freeze({ path: String(pathValue), flags: normalizedFlags }));
    return fd;
  };

  const closeVirtualFd = (fdValue) => {
    const fd = Number(fdValue);
    if (!Number.isInteger(fd) || !virtualFileDescriptors.has(fd)) {
      const error = new Error('EBADF: bad file descriptor, close');
      error.code = 'EBADF';
      error.errno = 'EBADF';
      error.syscall = 'close';
      throw error;
    }
    virtualFileDescriptors.delete(fd);
  };

  const builtinSource = async (specifier) => {
    switch (specifier) {
      case 'node:fs': return fsSource();
      case 'node:fs/promises': return fsPromisesSource();
      case 'node:path':
      case 'node:path/posix': return pathSource();
      case 'node:path/win32': return pathWin32Source();
      case 'node:buffer': return bufferSource();
      case 'node:events': return eventsSource();
      case 'node:process': return processSource(env, argv, platform, arch);
      case 'node:url': return urlSource();
      case 'node:module': return moduleSource(BUILTIN_MODULES);
      case 'node:crypto': return cryptoSource();
      case 'node:perf_hooks': return perfHooksSource();
      case 'node:util': return utilSource();
      case 'node:worker_threads': return workerThreadsSource();
      case 'node:child_process': return childProcessSource();
      case 'node:dns': return dnsSource();
      case 'node:dns/promises': return `import dns from 'node:dns'; export const lookup=dns.promises.lookup; export const getDefaultResultOrder=dns.promises.getDefaultResultOrder; export const setDefaultResultOrder=dns.promises.setDefaultResultOrder; export default dns.promises;`;
      case 'node:os': return osSource();
      case 'node:net': return netSource();
      case 'node:tty': return ttySource();
      case 'node:assert':
      case 'node:assert/strict': return assertSource();
      case 'node:v8': return v8Source();
      case 'node:timers': return timersSource();
      case 'node:timers/promises': return timersPromisesSource();
      case 'node:readline': return readlineSource();
      case 'node:http': return httpSource();
      case 'node:https': return httpsSource();
      case 'node:http2': return http2Source();
      case 'node:tls': return tlsSource();
      case 'node:querystring': return querystringSource();
      case 'node:zlib': return zlibSource();
      case 'node:stream': return streamSource();
      default:
        throw ocError(ErrorCodes.BUILTIN_UNAVAILABLE, 'Native browser ESM builtin is not implemented', { specifier });
    }
  };

  const syncRequestHandler = async (method, payload = {}) => {
    if (method.startsWith('node.path.')) {
      const name = method.slice('node.path.'.length);
      const fn = core.path[name];
      if (typeof fn !== 'function') throw ocError(ErrorCodes.BUILTIN_UNAVAILABLE, 'Path builtin method is unavailable', { method });
      return fn(...(payload.args ?? []));
    }

    if (method.startsWith('node.process.')) {
      const name = method.slice('node.process.'.length);
      if (name === 'cwd') return core.process.cwd();
      if (name === 'chdir') return core.process.chdir(payload.directory);
      if (name === 'hrtime') return core.process.hrtime(payload.previous);
      if (name === 'hrtime.bigint') return core.process.hrtime.bigint().toString();
      if (name === 'uptime') return core.process.uptime();
      throw ocError(ErrorCodes.BUILTIN_UNAVAILABLE, 'Process builtin method is unavailable', { method });
    }

    if (method.startsWith('node.url.')) {
      const name = method.slice('node.url.'.length);
      if (name === 'pathToFileURL') return core.url.pathToFileURL(payload.path).href;
      if (name === 'fileURLToPath') {
        const raw = String(payload.value);
        const url = new URL(raw);
        if (url.protocol === 'file:') return core.url.fileURLToPath(url);

        const publicationMarker = '/__opencontainer__/esm/';
        const publicationIndex = url.pathname.indexOf(publicationMarker);
        const fsMarker = '/fs/';
        const fsIndex = publicationIndex >= 0
          ? url.pathname.indexOf(fsMarker, publicationIndex + publicationMarker.length)
          : -1;

        if (fsIndex >= 0) {
          const mapped = '/' + url.pathname
            .slice(fsIndex + fsMarker.length)
            .split('/')
            .filter(Boolean)
            .map(decodeURIComponent)
            .join('/');
          assertOc(
            mapped === '/workspace' || mapped.startsWith('/workspace/'),
            ErrorCodes.PATH_ESCAPE,
            'Published module URL escaped /workspace',
            { value: raw, mapped }
          );
          return mapped;
        }

        return core.url.fileURLToPath(url);
      }
      if (name === 'urlToHttpOptions') return core.url.urlToHttpOptions(payload.value);
      throw ocError(ErrorCodes.BUILTIN_UNAVAILABLE, 'URL builtin method is unavailable', { method });
    }

    if (method.startsWith('node.crypto.')) {
      const name = method.slice('node.crypto.'.length);
      if (name !== 'hash') throw ocError(ErrorCodes.BUILTIN_UNAVAILABLE, 'Crypto builtin method is unavailable', { method });
      const algorithm = String(payload.algorithm ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
      const algorithms = {
        sha1: 'SHA-1',
        sha256: 'SHA-256',
        sha384: 'SHA-384',
        sha512: 'SHA-512'
      };
      const subtleName = algorithms[algorithm];
      assertOc(subtleName, ErrorCodes.INVALID_ARGUMENT, 'Unsupported browser crypto hash algorithm', { algorithm: payload.algorithm });
      let input;
      if (payload.data?.bytes) input = Uint8Array.from(payload.data.bytes);
      else {
        const encoding = String(payload.data?.encoding ?? 'utf8').toLowerCase();
        assertOc(encoding === 'utf8' || encoding === 'utf-8', ErrorCodes.INVALID_ARGUMENT, 'Only UTF-8 string hash input is promoted', { encoding });
        input = new TextEncoder().encode(String(payload.data?.text ?? ''));
      }
      const digest = new Uint8Array(await globalThis.crypto.subtle.digest(subtleName, input));
      return { __opencontainerBytes: [...digest] };
    }

    if (method.startsWith('node.module.')) {
      const name = method.slice('node.module.'.length);
      if (name !== 'resolve') throw ocError(ErrorCodes.BUILTIN_UNAVAILABLE, 'Module builtin method is unavailable', { method });
      assertOc(resolver && typeof resolver.resolve === 'function', ErrorCodes.INVALID_STATE, 'Browser node:module resolver authority is unavailable');

      const rawIssuer = String(payload.issuer ?? '');
      let issuer = rawIssuer;
      if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawIssuer)) {
        const url = new URL(rawIssuer);
        const marker = '/fs/';
        const index = url.pathname.indexOf(marker);
        if (index >= 0) {
          issuer = '/' + url.pathname
            .slice(index + marker.length)
            .split('/')
            .filter(Boolean)
            .map(decodeURIComponent)
            .join('/');
        } else if (url.protocol === 'file:') {
          issuer = core.url.fileURLToPath(url);
        } else {
          throw ocError(ErrorCodes.INVALID_MODULE_SPECIFIER, 'createRequire issuer is outside the OpenContainer publication namespace', { issuer: rawIssuer });
        }
      }

      const resolved = resolver.resolve(String(payload.specifier), issuer, { mode: 'cjs' });
      return resolved.kind === 'builtin' ? resolved.specifier : resolved.path;
    }

    if (method.startsWith('node.fs.')) {
      const name = method.slice('node.fs.'.length);
      if (name === 'openSync') return openVirtualFd(payload.path, payload.flags);
      if (name === 'closeSync') return closeVirtualFd(payload.fd);

      const systemFile = virtualSystemFile(payload.path);
      if (systemFile) {
        if (name === 'existsSync') return true;
        if (name === 'accessSync') return undefined;
        if (name === 'readFileSync') return readVirtualSystemFile(payload.path, payload.options);
        if (name === 'statSync' || name === 'lstatSync') return statVirtualSystemFile(payload.path);
        if (name === 'realpathSync') return String(payload.path);
        throw ocError(
          ErrorCodes.BUILTIN_UNAVAILABLE,
          'Virtual system file operation is read-only and not promoted',
          { method, path: String(payload.path) }
        );
      }

      const fn = core.fs[name];
      if (typeof fn !== 'function') throw ocError(ErrorCodes.BUILTIN_UNAVAILABLE, 'Filesystem builtin method is unavailable', { method });

      let value;
      if (name === 'renameSync') value = fn(payload.from, payload.to);
      else if (name === 'writeFileSync') {
        const data = payload.data?.__opencontainerBytes ? Uint8Array.from(payload.data.__opencontainerBytes) : payload.data;
        value = fn(payload.path, data, payload.options);
      } else if (['existsSync','accessSync','readFileSync','readdirSync','statSync','lstatSync','realpathSync','readlinkSync','mkdirSync','rmSync','unlinkSync'].includes(name)) {
        value = fn(payload.path, payload.options ?? payload.mode);
      } else {
        throw ocError(ErrorCodes.BUILTIN_UNAVAILABLE, 'Filesystem builtin method is not promoted', { method });
      }

      if (name === 'statSync' || name === 'lstatSync') return statRecord(value);
      return fsResult(value);
    }

    throw ocError(ErrorCodes.BUILTIN_UNAVAILABLE, 'Unknown browser Node compatibility sync method', { method });
  };

  return Object.freeze({ builtinSource, syncRequestHandler, core });
}
