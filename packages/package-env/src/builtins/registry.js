import { createPosixPath } from './path.js';
import { createEventsBuiltin } from './events.js';
import { createBufferBuiltin } from './buffer.js';
import { createUrlBuiltin } from './url.js';
import { createProcessBuiltin } from './process.js';
import { createFsBuiltins } from './fs.js';
import { createModuleBuiltin } from './module.js';

export function createCoreBuiltinRegistry({
  fs = null,
  writableFs = fs,
  cwd = '/workspace',
  env = {},
  argv = ['opencontainer'],
  platform = 'linux',
  stdout = () => {},
  stderr = () => {},
  createRequire = () => { throw new Error('createRequire is not bound'); }
} = {}) {
  const events = createEventsBuiltin();
  const process = createProcessBuiltin({ fs, cwd, env, argv, platform, stdout, stderr });
  const path = createPosixPath({ cwd: () => process.cwd() });
  const url = createUrlBuiltin({ path });
  const buffer = createBufferBuiltin();
  const fileSystem = createFsBuiltins({ fs, writableFs, path, url });
  const module = createModuleBuiltin({ createRequire });

  return Object.freeze({
    path,
    'path/posix': path,
    events,
    buffer,
    process,
    url,
    fs: fileSystem.fs,
    'fs/promises': fileSystem.promises,
    module
  });
}
