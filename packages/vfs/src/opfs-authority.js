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

  constructor({ root, directoryName = 'opencontainer-workspace' } = {}) {
    assertOc(root && typeof root.getDirectoryHandle === 'function', ErrorCodes.INVALID_ARGUMENT, 'OPFS root directory handle is required');
    this.#root = root;
    this.#directoryName = directoryName;
  }

  get current() {
    return this.#current;
  }

  async open() {
    this.#directory = await this.#root.getDirectoryHandle(this.#directoryName, { create: true });
    this.#payloads = await this.#directory.getDirectoryHandle(PAYLOAD_DIR, { create: true });
    this.#current = await this.recover();
    return this;
  }

  async checkpoint(fsOrSnapshot) {
    this.#assertOpen();
    const snapshot = typeof fsOrSnapshot?.snapshot === 'function' ? fsOrSnapshot.snapshot() : fsOrSnapshot;
    assertOc(snapshot?.version === 1 && Number.isInteger(snapshot.generation) && Array.isArray(snapshot.entries), ErrorCodes.INVALID_ARGUMENT, 'Invalid VFS checkpoint snapshot');

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
  }

  async recover() {
    this.#assertOpen();

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

  async restoreInto(fs) {
    this.#assertOpen();
    const current = this.#current ?? await this.recover();
    if (!current) return null;

    const text = await readText(this.#payloads, current.payload);
    if (text === null || await sha256Hex(text) !== current.sha256) {
      this.#current = await this.recover();
      if (!this.#current) throw ocError(ErrorCodes.IMPORT_INVALID, 'No valid OPFS checkpoint remains');
      return this.restoreInto(fs);
    }

    const snapshot = JSON.parse(text);
    return fs.restore(snapshot);
  }

  #assertOpen() {
    if (!this.#directory || !this.#payloads) {
      throw ocError(ErrorCodes.INVALID_STATE, 'OPFS checkpoint authority is not open');
    }
  }
}
