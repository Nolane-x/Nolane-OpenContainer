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
const api={constants,existsSync,accessSync,readFileSync,writeFileSync,readdirSync,statSync,lstatSync,realpathSync,readlinkSync,mkdirSync,renameSync,rmSync,unlinkSync,promises};
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
