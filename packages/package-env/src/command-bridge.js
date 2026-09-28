import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

function binPath(location, relative) {
  const cleanLocation = String(location).replace(/^\/+|\/+$/g, '');
  const cleanRelative = String(relative).replace(/^\.\//, '').replace(/^\/+/, '');
  if (!cleanRelative || cleanRelative.split('/').some((part) => part === '..')) {
    throw ocError(ErrorCodes.INVALID_ARGUMENT, 'Unsafe package bin path', { location, relative });
  }
  return '/workspace/' + cleanLocation + '/' + cleanRelative;
}

export class PackageCommandBridge {
  #packages;
  #process;
  #options;
  #unregister = [];

  constructor({ packages, process, options = {} } = {}) {
    assertOc(packages?.graph && packages?.resolver, ErrorCodes.INVALID_STATE, 'Mounted package graph is required');
    assertOc(process && typeof process.register === 'function', ErrorCodes.INVALID_ARGUMENT, 'ProcessSupervisor is required');
    this.#packages = packages;
    this.#process = process;
    this.#options = options;
  }

  registerAll() {
    const bins = this.#packages.graph.bins ?? {};
    const commands = [];

    for (const [command, candidates] of Object.entries(bins)) {
      assertOc(Array.isArray(candidates)&&candidates.length>0,ErrorCodes.INVALID_PACKAGE_CONFIG,'Package command must retain graph candidates',{command});
      const unregister = this.#process.register(command, async ({ args, cwd, env, stdout, stderr }) => {
        const descriptor=this.#packages.resolveBin(command,{cwd});
        const executable = binPath(descriptor.location, descriptor.path);
        const loader = this.#packages.createCommonJsLoader({
          allowDynamicCode: this.#options.allowDynamicCode ?? true,
          evaluator: this.#options.evaluator,
          cwd,
          env,
          argv: ['opencontainer', executable, ...args],
          stdout,
          stderr,
          builtins: this.#options.builtins,
          globals: this.#options.globals
        });

        try {
          loader.require(executable, '/workspace/__opencontainer_bin_launcher.cjs');
          return loader.getBuiltin('process')?.exitCode ?? 0;
        } catch (error) {
          if (error?.code === 'OC_PROCESS_EXIT') return error.exitCode ?? 0;
          throw error;
        }
      });
      this.#unregister.push(unregister);
      commands.push(Object.freeze({
        command,
        contextual:true,
        candidateCount:candidates.length,
        packages:Object.freeze(candidates.map(item=>item.package)),
        locations:Object.freeze(candidates.map(item=>item.location))
      }));
    }

    return Object.freeze(commands);
  }

  dispose() {
    for (const unregister of this.#unregister.splice(0)) unregister();
  }
}
