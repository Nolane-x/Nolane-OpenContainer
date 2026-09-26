import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

const MANIFEST_A = 'manifest-a.json';
const MANIFEST_B = 'manifest-b.json';
const PAYLOAD_DIR = 'generations';

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readText(directory, name) {
  try {
    const handle = await directory.getFileHandle(name);
    const file = await handle.getFile();
    return await file.text();
  } catch (error) {
    if (error?.name === 'NotFoundError') return null;
    throw error;
  }
}

async function writeText(directory, name, content) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(content);
    await writable.close();
  } catch (error) {
    try { await writable.abort?.(); } catch {}
    throw error;
  }
}

function parseManifest(text, slot) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (
      parsed?.version !== 1 ||
      !Number.isInteger(parsed.sequence) ||
      !Number.isInteger(parsed.generation) ||
      typeof parsed.payload !== 'string' ||
      typeof parsed.sha256 !== 'string'
    ) return null;
    return Object.freeze({ ...parsed, slot });
  } catch {
    return null;
  }
}

export class OpfsCheckpointAuthority {
  #root;
  #directoryName;
  #directory = null;
  #payloads = null;
  #current = null;
  #lockManager;
  #lockName;

  constructor({
    root,
    directoryName = 'opencontainer-workspace',
    lockManager = globalThis.navigator?.locks ?? null,
    lockName = null
  } = {}) {
    assertOc(root && typeof root.getDirectoryHandle === 'function', ErrorCodes.INVALID_ARGUMENT, 'OPFS root directory handle is required');
    if (lockManager !== null) {
      assertOc(typeof lockManager?.request === 'function', ErrorCodes.INVALID_ARGUMENT, 'OPFS lock manager must expose request()');
    }
    this.#root = root;
    this.#directoryName = directoryName;
    this.#lockManager = lockManager;
    this.#lockName = lockName ?? 'opencontainer:opfs-checkpoint:' + directoryName;
  }

  get current() {
    return this.#current;
  }

  get crossContextLocking() {
    return this.#lockManager !== null;
  }

  get lockName() {
    return this.#lockName;
  }

  async open() {
    this.#directory = await this.#root.getDirectoryHandle(this.#directoryName, { create: true });
    this.#payloads = await this.#directory.getDirectoryHandle(PAYLOAD_DIR, { create: true });
    this.#current = await this.#withExclusiveLock(() => this.#recoverUnlocked());
    return this;
  }

  async checkpoint(fsOrSnapshot) {
    this.#assertOpen();
    const snapshot = typeof fsOrSnapshot?.snapshot === 'function' ? fsOrSnapshot.snapshot() : fsOrSnapshot;
    assertOc(snapshot?.version === 1 && Number.isInteger(snapshot.generation) && Array.isArray(snapshot.entries), ErrorCodes.INVALID_ARGUMENT, 'Invalid VFS checkpoint snapshot');

    return this.#withExclusiveLock(async () => {
      // A different tab/worker may have published after this authority opened.
      // Refresh the shared manifest state under the origin-wide Web Lock before
      // deciding whether this writer is stale or selecting the next sequence.
      await this.#recoverUnlocked();

      if (this.#current && snapshot.generation < this.#current.generation) {
        throw ocError(ErrorCodes.STALE_GENERATION, 'OPFS checkpoint generation is stale', {
          current: this.#current.generation,
          incoming: snapshot.generation
        });
      }

      const payloadText = JSON.stringify(snapshot);
      const digest = await sha256Hex(payloadText);

      if (this.#current && snapshot.generation === this.#current.generation) {
        if (digest === this.#current.sha256) return this.#current;
        throw ocError(ErrorCodes.STALE_GENERATION, 'Same generation has different checkpoint content', {
          generation: snapshot.generation
        });
      }

      const sequence = (this.#current?.sequence ?? 0) + 1;
      const payload = 'generation-' + snapshot.generation + '-' + digest.slice(0, 16) + '.json';

      // Payload first. A crash here can only leave an unreachable orphan.
      await writeText(this.#payloads, payload, payloadText);

      const manifest = {
        version: 1,
        sequence,
        generation: snapshot.generation,
        payload,
        sha256: digest
      };

      // Alternate slots. The older valid slot remains a recovery point.
      const slot = this.#current?.slot === 'a' ? 'b' : 'a';
      await writeText(this.#directory, slot === 'a' ? MANIFEST_A : MANIFEST_B, JSON.stringify(manifest));

      this.#current = Object.freeze({ ...manifest, slot });
      return this.#current;
    });
  }

  async recover() {
    this.#assertOpen();
    return this.#withExclusiveLock(() => this.#recoverUnlocked());
  }

  async restoreInto(fs) {
    this.#assertOpen();
    return this.#withExclusiveLock(async () => {
      // Restore observes the latest valid shared checkpoint, not merely the
      // receipt cached by the authority when it first opened.
      let current = await this.#recoverUnlocked();
      if (!current) return null;

      let text = await readText(this.#payloads, current.payload);
      if (text === null || await sha256Hex(text) !== current.sha256) {
        current = await this.#recoverUnlocked();
        if (!current) throw ocError(ErrorCodes.IMPORT_INVALID, 'No valid OPFS checkpoint remains');
        text = await readText(this.#payloads, current.payload);
        if (text === null || await sha256Hex(text) !== current.sha256) {
          throw ocError(ErrorCodes.IMPORT_INVALID, 'Recovered OPFS checkpoint payload is invalid');
        }
      }

      const snapshot = JSON.parse(text);
      return fs.restore(snapshot);
    });
  }

  async #recoverUnlocked() {
    const candidates = [
      parseManifest(await readText(this.#directory, MANIFEST_A), 'a'),
      parseManifest(await readText(this.#directory, MANIFEST_B), 'b')
    ]
      .filter(Boolean)
      .sort((a, b) => b.sequence - a.sequence);

    for (const candidate of candidates) {
      const text = await readText(this.#payloads, candidate.payload);
      if (text === null) continue;
      const digest = await sha256Hex(text);
      if (digest !== candidate.sha256) continue;

      try {
        const snapshot = JSON.parse(text);
        if (snapshot?.version !== 1 || snapshot.generation !== candidate.generation || !Array.isArray(snapshot.entries)) continue;
        this.#current = Object.freeze(candidate);
        return this.#current;
      } catch {
        // Try the older manifest slot.
      }
    }

    this.#current = null;
    return null;
  }

  async #withExclusiveLock(callback) {
    if (!this.#lockManager) return callback();
    return this.#lockManager.request(this.#lockName, { mode: 'exclusive' }, callback);
  }

  #assertOpen() {
    if (!this.#directory || !this.#payloads) {
      throw ocError(ErrorCodes.INVALID_STATE, 'OPFS checkpoint authority is not open');
    }
  }
}
