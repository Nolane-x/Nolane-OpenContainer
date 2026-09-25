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
export function mkdirSync(path,options=null){return call('mkdirSync',{path:String(path),options});}
export function renameSync(from,to){return call('renameSync',{from:String(from),to:String(to)});}
export function rmSync(path,options=null){return call('rmSync',{path:String(path),options});}
export function unlinkSync(path){return call('unlinkSync',{path:String(path)});}
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
const api={constants,existsSync,accessSync,readFileSync,writeFileSync,readdirSync,statSync,lstatSync,realpathSync,realpath,readlinkSync,mkdirSync,renameSync,rmSync,unlinkSync,promises};
export default api;
`;
}

function fsPromisesSource() {
  return `
import fs from 'node:fs';
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
export default fs.promises;
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
const api={sep,delimiter,normalize,isAbsolute,join,resolve,relative,dirname,basename,extname,parse,format,toNamespacedPath};
api.posix=api;
export const posix=api;
export default api;
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
export { EventEmitter };
export default EventEmitter;
`;
}

function processSource(env, argv, platform, arch) {
  return `
const call=(method,payload)=>globalThis.__opencontainer_sync_host_call__('node.process.'+method,payload);
const process={
  browser:true,
  platform:${JSON.stringify(platform)},
  arch:${JSON.stringify(arch)},
  version:'v24.21.0',
  versions:Object.freeze({node:'24.21.0',opencontainer:'0.1.0-alpha.1'}),
  argv:${JSON.stringify(argv)},
  execArgv:[],
  env:Object.assign(Object.create(null),${JSON.stringify(env)}),
  cwd:()=>call('cwd'),
  chdir:(directory)=>call('chdir',{directory}),
  nextTick:(callback,...args)=>queueMicrotask(()=>callback(...args)),
  hrtime:(previous)=>call('hrtime',{previous}),
  uptime:()=>call('uptime'),
  emitWarning:(warning)=>console.warn(warning)
};
process.hrtime.bigint=()=>BigInt(call('hrtime.bigint'));
globalThis.process ??= process;
export default process;
export const env=process.env;
export const argv=process.argv;
export const platform=process.platform;
export const arch=process.arch;
export const versions=process.versions;
export const cwd=process.cwd;
export const chdir=process.chdir;
export const nextTick=process.nextTick;
export const hrtime=process.hrtime;
export const uptime=process.uptime;
`;
}

function urlSource() {
  return `
export { URL, URLSearchParams };
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
const api={inspect,format,formatWithOptions,promisify,isDeepStrictEqual,stripVTControlCharacters,parseEnv,deprecate,inherits,callbackify,types,TextEncoder,TextDecoder};
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
export const builtinModules=Object.freeze(${JSON.stringify(builtinModules)});
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
export function createRequire(filename){
  const issuer=String(filename);
  const require=(specifier)=>unsupportedRequire(specifier);
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

  const builtinSource = async (specifier) => {
    switch (specifier) {
      case 'node:fs': return fsSource();
      case 'node:fs/promises': return fsPromisesSource();
      case 'node:path':
      case 'node:path/posix': return pathSource();
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
      if (name === 'fileURLToPath') return core.url.fileURLToPath(payload.value);
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
