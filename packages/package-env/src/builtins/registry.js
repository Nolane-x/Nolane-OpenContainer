import { createPosixPath } from './path.js';
import { createEventsBuiltin } from './events.js';

export function createCoreBuiltinRegistry({ cwd = () => '/workspace' } = {}) {
  const path = createPosixPath({ cwd });
  const events = createEventsBuiltin();
  return Object.freeze({ path, 'path/posix': path, events });
}
