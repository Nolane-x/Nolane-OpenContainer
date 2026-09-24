const BUILTIN_MODULES = Object.freeze([
  'assert','assert/strict','async_hooks','buffer','child_process','cluster','console','constants','crypto','dgram','diagnostics_channel',
  'dns','dns/promises','domain','events','fs','fs/promises','http','http2','https','module','net','os','path','path/posix','path/win32',
  'perf_hooks','process','punycode','querystring','readline','readline/promises','repl','stream','stream/consumers','stream/promises','stream/web',
  'string_decoder','sys','test','test/reporters','timers','timers/promises','tls','trace_events','tty','url','util','util/types','v8','vm','wasi',
  'worker_threads','zlib'
]);

const BUILTIN_SET = new Set(BUILTIN_MODULES);

export function createModuleBuiltin({ createRequire }) {
  function Module(id = '', parent = null) {
    this.id = id;
    this.path = '';
    this.exports = {};
    this.filename = null;
    this.loaded = false;
    this.children = [];
    this.parent = parent;
  }

  Module.builtinModules = [...BUILTIN_MODULES];
  Module.isBuiltin = (specifier) => {
    const bare = typeof specifier === 'string' && specifier.startsWith('node:') ? specifier.slice(5) : specifier;
    return BUILTIN_SET.has(bare);
  };
  Module.createRequire = (filename) => createRequire(filename);
  Module.createRequireFromPath = Module.createRequire;
  Module.syncBuiltinESMExports = () => {};
  Module.Module = Module;

  return Module;
}

export { BUILTIN_MODULES };
