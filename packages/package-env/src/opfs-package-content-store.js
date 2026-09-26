import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';
import { PackageContentStore } from './frozen-install.js';

const MANIFEST = 'manifest.json';
const ARTIFACT = 'artifact.tgz';

function safeDirectoryName(contentId) {
  return encodeURIComponent(contentId);
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

async function readBytes(directory, name) {
  try {
    const handle = await directory.getFileHandle(name);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    if (error?.name === 'NotFoundError') return null;
    throw error;
  }
}

async function writeValue(directory, name, value) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(value);
    await writable.close();
  } catch (error) {
    try { await writable.abort?.(); } catch {}
    throw error;
  }
}

function parseManifest(text, directoryName) {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    if (
      value?.version !== 1 ||
      typeof value.contentId !== 'string' ||
      typeof value.integrity !== 'string' ||
      !Number.isInteger(value.byteLength) ||
      value.byteLength < 0 ||
      safeDirectoryName(value.contentId) !== directoryName
    ) return null;
    return Object.freeze({
      version: 1,
      contentId: value.contentId,
      integrity: value.integrity,
      byteLength: value.byteLength,
      packageName: typeof value.packageName === 'string' ? value.packageName : null,
      packageVersion: typeof value.packageVersion === 'string' ? value.packageVersion : null
    });
  } catch {
    return null;
  }
}

export class OpfsPackageContentStore {
  #root;
  #directoryName;
  #directory = null;
  #memory = new PackageContentStore();
  #lockManager;
  #lockPrefix;
  #hydrated = new Set();
  #corrupt = new Set();

  constructor({
    root,
    directoryName = 'opencontainer-package-content',
    lockManager = globalThis.navigator?.locks ?? null,
    lockPrefix = null
  } = {}) {
    assertOc(root && typeof root.getDirectoryHandle === 'function', ErrorCodes.INVALID_ARGUMENT, 'OPFS root directory handle is required');
    if (lockManager !== null) {
      assertOc(typeof lockManager?.request === 'function', ErrorCodes.INVALID_ARGUMENT, 'Package content lock manager must expose request()');
    }
    this.#root = root;
    this.#directoryName = directoryName;
    this.#lockManager = lockManager;
    this.#lockPrefix = lockPrefix ?? 'opencontainer:package-content:' + directoryName + ':';
  }

  get size() { return this.#memory.size; }
  get hydratedCount() { return this.#hydrated.size; }
  get corruptCount() { return this.#corrupt.size; }
  get crossContextLocking() { return this.#lockManager !== null; }
  has(contentId) { return this.#memory.has(contentId); }
  get(contentId) { return this.#memory.get(contentId); }

  async open() {
    this.#directory = await this.#root.getDirectoryHandle(this.#directoryName, { create: true });
    this.#memory = new PackageContentStore();
    this.#hydrated.clear();
    this.#corrupt.clear();
    return this;
  }

  async hydrate({
    contentId,
    integrity,
    expectedName = null,
    expectedVersion = null
  }) {
    this.#assertOpen();
    assertOc(typeof contentId === 'string' && contentId.length > 0, ErrorCodes.INVALID_ARGUMENT, 'contentId is required');
    assertOc(typeof integrity === 'string' && integrity.length > 0, ErrorCodes.INVALID_ARGUMENT, 'integrity is required');

    const existing = this.#memory.get(contentId);
    if (existing) {
      if (existing.integrity !== integrity) {
        throw ocError(ErrorCodes.ARTIFACT_INTEGRITY, 'Hydrated content identity disagrees with lockfile integrity', { contentId });
      }
      return true;
    }

    return this.#withContentLock(contentId, async () => {
      const lockedExisting = this.#memory.get(contentId);
      if (lockedExisting) {
        if (lockedExisting.integrity !== integrity) {
          throw ocError(ErrorCodes.ARTIFACT_INTEGRITY, 'Hydrated content identity disagrees with lockfile integrity', { contentId });
        }
        return true;
      }

      const cached = await this.#readVerifiedPersisted(contentId, {
        expectedIntegrity: integrity,
        expectedName,
        expectedVersion
      });
      if (cached.status === 'missing') return false;
      if (cached.status !== 'verified') {
        this.#corrupt.add(contentId);
        return false;
      }

      await this.#memory.ingest({
        contentId,
        integrity,
        bytes: cached.bytes,
        expectedName,
        expectedVersion
      });
      this.#hydrated.add(contentId);
      this.#corrupt.delete(contentId);
      return true;
    });
  }

  async ingest({ contentId, integrity, bytes, expectedName = null, expectedVersion = null }) {
    this.#assertOpen();

    // Preserve PackageContentStore semantics: caller bytes are verified even
    // when another context already persisted the same immutable content.
    const verified = await this.#memory.ingest({
      contentId,
      integrity,
      bytes,
      expectedName,
      expectedVersion
    });

    return this.#withContentLock(contentId, async () => {
      const cached = await this.#readVerifiedPersisted(contentId, {
        expectedIntegrity: integrity,
        expectedName,
        expectedVersion
      });
      if (cached.status === 'verified') {
        this.#corrupt.delete(contentId);
        return Object.freeze({
          ...verified,
          reused: true,
          persisted: true,
          persistentReused: true
        });
      }
      if (cached.status === 'corrupt') this.#corrupt.add(contentId);

      const contentDirectory = await this.#directory.getDirectoryHandle(safeDirectoryName(contentId), { create: true });
      const record = this.#memory.get(contentId);
      assertOc(record, ErrorCodes.PACKAGE_CONTENT_MISSING, 'Verified package content disappeared before persistence', { contentId });

      const manifest = Object.freeze({
        version: 1,
        contentId,
        integrity,
        byteLength: bytes.byteLength,
        packageName: record.packageJson?.name ?? expectedName ?? null,
        packageVersion: record.packageJson?.version ?? expectedVersion ?? null
      });

      // Artifact first, manifest last. An interrupted write is never trusted
      // because hydration requires lockfile-authoritative integrity plus a
      // valid manifest and a freshly verified artifact.
      await writeValue(contentDirectory, ARTIFACT, bytes);
      await writeValue(contentDirectory, MANIFEST, JSON.stringify(manifest));
      this.#corrupt.delete(contentId);

      return Object.freeze({
        ...verified,
        persisted: true,
        persistentReused: false
      });
    });
  }

  async #readVerifiedPersisted(contentId, {
    expectedIntegrity,
    expectedName,
    expectedVersion
  }) {
    const directoryName = safeDirectoryName(contentId);
    let directory;
    try {
      directory = await this.#directory.getDirectoryHandle(directoryName);
    } catch (error) {
      if (error?.name === 'NotFoundError') return Object.freeze({ status: 'missing' });
      throw error;
    }

    const manifest = parseManifest(await readText(directory, MANIFEST), directoryName);
    if (
      !manifest ||
      manifest.contentId !== contentId ||
      manifest.integrity !== expectedIntegrity
    ) return Object.freeze({ status: 'corrupt' });

    const bytes = await readBytes(directory, ARTIFACT);
    if (!bytes || bytes.byteLength !== manifest.byteLength) return Object.freeze({ status: 'corrupt' });

    // The manifest is cache metadata, never the trust root. Verification is
    // always anchored to integrity/name/version supplied by the frozen graph.
    const verifier = new PackageContentStore();
    try {
      await verifier.ingest({
        contentId,
        integrity: expectedIntegrity,
        bytes,
        expectedName: expectedName ?? manifest.packageName,
        expectedVersion: expectedVersion ?? manifest.packageVersion
      });
    } catch {
      return Object.freeze({ status: 'corrupt' });
    }

    return Object.freeze({ status: 'verified', manifest, bytes });
  }

  async #withContentLock(contentId, callback) {
    if (!this.#lockManager) return callback();
    return this.#lockManager.request(this.#lockPrefix + contentId, { mode: 'exclusive' }, callback);
  }

  #assertOpen() {
    assertOc(this.#directory, ErrorCodes.INVALID_STATE, 'OPFS package content store is not open');
  }
}
