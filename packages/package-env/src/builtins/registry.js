import { createPosixPath } from './path.js';
import { createEventsBuiltin } from './events.js';
import { createBufferBuiltin } from './buffer.js';
import { createUrlBuiltin } from './url.js';
import { createProcessBuiltin } from './process.js';
import { createFsBuiltins } from './fs.js';

export function createCoreBuiltinRegistry({
  fs = null,
  writableFs = fs,
  cwd = '/workspace',
  env = {},
  argv = ['opencontainer'],
  platform = 'linux'
} = {}) {
  const events = createEventsBuiltin();
  const process = createProcessBuiltin({ fs, cwd, env, argv, platform });
  const path = createPosixPath({ cwd: () => process.cwd() });
  const url = createUrlBuiltin({ path });
  const buffer = createBufferBuiltin();
  const fileSystem = createFsBuiltins({ fs, writableFs, path, url });

  return Object.freeze({
    path,
    'path/posix': path,
    events,
    buffer,
    process,
    url,
    fs: fileSystem.fs,
    'fs/promises': fileSystem.promises
  });
}
