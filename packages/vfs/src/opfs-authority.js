import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

const MANIFEST_A = 'manifest-a.json';
const MANIFEST_B = 'manifest-b.json';
const PAYLOAD_DIR = 'generations';
const WRITER_DIR = 'writer-epochs';
const WRITER_PREFIX = 'writer-epoch-';
const encoder = new TextEncoder();

async function sha256Hex(text) {
  const bytes = encoder.encode(text);
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
  #writerClaims = null;
  #current = null;
  #writerEpoch = 0;
  #lockManager;
  #lockName;
  #storagePolicy;
  #lastStorageGuard = null;

  constructor({
    root,
    directoryName = 'opencontainer-workspace',
    lockManager = globalThis.navigator?.locks ?? null,
    lockName = null,
    storagePolicy = null
  } = {}) {
    assertOc(root && typeof root.getDirectoryHandle === 'function', ErrorCodes.INVALID_ARGUMENT, 'OPFS root directory handle is required');
    if (lockManager !== null) {
      assertOc(typeof lockManager?.request === 'function', ErrorCodes.INVALID_ARGUMENT, 'OPFS lock manager must expose request()');
    }
    if (storagePolicy !== null) {
      assertOc(
        typeof storagePolicy?.inspect === 'function' && typeof storagePolicy?.assertCanWrite === 'function',
        ErrorCodes.INVALID_ARGUMENT,
        'OPFS storage policy must expose inspect() and assertCanWrite()'
      );
    }
    this.#root = root;
    this.#directoryName = directoryName;
    this.#lockManager = lockManager;
    this.#lockName = lockName ?? 'opencontainer:opfs-checkpoint:' + directoryName;
    this.#storagePolicy = storagePolicy;
  }

  get current() {
    return this.#current;
  }

  get writerEpoch() {
    return this.#writerEpoch;
  }

  get writerState() {
    return Object.freeze({
      writerEpoch: this.#writerEpoch,
      storageGeneration: this.#current?.generation ?? 0,
      manifestWriterEpoch: this.#current?.writerEpoch ?? null
    });
  }

  get crossContextLocking() {
    return this.#lockManager !== null;
  }

  get lockName() {
    return this.#lockName;
  }

  get storagePolicyEnabled() {
    return this.#storagePolicy !== null;
  }

  get lastStorageGuard() {
    return this.#lastStorageGuard;
  }

  async open() {
    this.#directory = await this.#root.getDirectoryHandle(this.#directoryName, { create: true });
    this.#payloads = await this.#directory.getDirectoryHandle(PAYLOAD_DIR, { create: true });
    this.#writerClaims = await this.#directory.getDirectoryHandle(WRITER_DIR, { create: true });
    this.#current = await this.#withExclusiveLock(() => this.#recoverUnlocked());
    return this;
  }

  async checkpoint(fsOrSnapshot,{crashAt=null,quotaFaultAt=null}={}) {
    this.#assertOpen();
    const crashPhases=['after-preflight','after-payload','after-manifest'];
    const quotaFaultPhases=['after-0-bytes','after-1-byte','after-header','mid-payload','pre-commit','post-payload-pre-manifest'];
    assertOc(
      crashAt===null||crashPhases.includes(crashAt),
      ErrorCodes.INVALID_ARGUMENT,
      'Unknown OPFS checkpoint crash phase',
      {crashAt,crashPhases}
    );
    assertOc(
      quotaFaultAt===null||quotaFaultPhases.includes(quotaFaultAt),
      ErrorCodes.INVALID_ARGUMENT,
      'Unknown OPFS checkpoint quota fault phase',
      {quotaFaultAt,quotaFaultPhases}
    );
    const snapshot = typeof fsOrSnapshot?.snapshot === 'function' ? fsOrSnapshot.snapshot() : fsOrSnapshot;
    assertOc(snapshot?.version === 1 && Number.isInteger(snapshot.generation) && Array.isArray(snapshot.entries), ErrorCodes.INVALID_ARGUMENT, 'Invalid VFS checkpoint snapshot');

    return this.#withExclusiveLock(async () => {
      // A different tab/worker may have published after this authority opened.
      // Refresh the shared manifest state under the origin-wide Web Lock before
      // deciding whether this writer is stale or selecting the next sequence.
      await this.#recoverUnlocked();

      if (this.#writerEpoch > 0) {
        await this.#assertWriterEpochCurrentUnlocked();
      }

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

      if (this.#writerEpoch === 0) {
        this.#writerEpoch = await this.#claimWriterEpochUnlocked();
      }

      const sequence = (this.#current?.sequence ?? 0) + 1;
      const payload = 'generation-' + snapshot.generation + '-' + digest.slice(0, 16) + '.json';
      const manifest = {
        version: 1,
        sequence,
        writerEpoch: this.#writerEpoch,
        generation: snapshot.generation,
        payload,
        sha256: digest
      };

      // Alternate slots. The older valid slot remains a recovery point.
      const slot = this.#current?.slot === 'a' ? 'b' : 'a';
      const manifestName = slot === 'a' ? MANIFEST_A : MANIFEST_B;
      const manifestText = JSON.stringify(manifest);

      if (this.#storagePolicy) {
        await this.#guardStorageWriteUnlocked(
          encoder.encode(payloadText).byteLength + encoder.encode(manifestText).byteLength
        );
      }
      this.#injectCrash(crashAt,'after-preflight',{generation:snapshot.generation,sequence,payload,slot});

      // Payload first. A crash here can only leave an unreachable orphan.
      await this.#writeCheckpointText(this.#payloads, payload, payloadText, 'payload', { quotaFaultAt });
      this.#injectCrash(crashAt,'after-payload',{generation:snapshot.generation,sequence,payload,slot});
      if (quotaFaultAt === 'post-payload-pre-manifest') {
        await this.#throwInjectedQuotaFault('post-payload-pre-manifest', manifestName);
      }

      // Canonical identity is switched only by publishing the validated manifest.
      await this.#writeCheckpointText(this.#directory, manifestName, manifestText, 'manifest');
      this.#injectCrash(crashAt,'after-manifest',{generation:snapshot.generation,sequence,payload,slot});

      this.#current = Object.freeze({ ...manifest, slot });
      return this.#current;
    });
  }

  async recover() {
    this.#assertOpen();
    return this.#withExclusiveLock(() => this.#recoverUnlocked());
  }

  async collectGarbage({ dryRun = false } = {}) {
    this.#assertOpen();
    assertOc(typeof dryRun === 'boolean', ErrorCodes.INVALID_ARGUMENT, 'OPFS garbage collection dryRun must be boolean');

    return this.#withExclusiveLock(async () => {
      // Synchronize with any writer before examining reachability. The two
      // manifest slots are the complete crash-recovery root set: keep every
      // payload named by a structurally valid manifest, even if its payload is
      // currently corrupt, so collection never weakens fallback semantics.
      await this.#recoverUnlocked();
      return this.#collectGarbageUnlocked({ dryRun });
    });
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

  async #maxWriterEpochUnlocked() {
    assertOc(
      this.#writerClaims && typeof this.#writerClaims.entries === 'function',
      ErrorCodes.INVALID_STATE,
      'OPFS writer epoch directory does not support enumeration'
    );
    let maximum = 0;
    for await (const [name, handle] of this.#writerClaims.entries()) {
      if (handle?.kind && handle.kind !== 'file') continue;
      const match = String(name).match(/^writer-epoch-(\d+)\.json$/);
      if (!match) continue;
      const epoch = Number(match[1]);
      if (Number.isSafeInteger(epoch) && epoch > maximum) maximum = epoch;
    }
    return maximum;
  }

  async #claimWriterEpochUnlocked() {
    const previous = await this.#maxWriterEpochUnlocked();
    const writerEpoch = previous + 1;
    assertOc(Number.isSafeInteger(writerEpoch), ErrorCodes.INVALID_STATE, 'Writer epoch overflow');
    const name = WRITER_PREFIX + writerEpoch + '.json';
    const claim = JSON.stringify({
      version: 1,
      writerEpoch,
      storageGeneration: this.#current?.generation ?? 0,
      manifestSequence: this.#current?.sequence ?? 0
    });
    await this.#writeCheckpointText(this.#writerClaims, name, claim, 'writer-epoch');

    // Claims are immutable monotonic fencing tokens. Keep the newest two names:
    // their filenames alone preserve the monotonic fence even if claim contents
    // are unreadable after a crash.
    if (typeof this.#writerClaims.removeEntry === 'function') {
      for await (const [entryName, handle] of this.#writerClaims.entries()) {
        if (handle?.kind && handle.kind !== 'file') continue;
        const match = String(entryName).match(/^writer-epoch-(\d+)\.json$/);
        if (!match) continue;
        const epoch = Number(match[1]);
        if (Number.isSafeInteger(epoch) && epoch < writerEpoch - 1) {
          try { await this.#writerClaims.removeEntry(entryName); } catch {}
        }
      }
    }
    return writerEpoch;
  }

  async #assertWriterEpochCurrentUnlocked() {
    const currentWriterEpoch = await this.#maxWriterEpochUnlocked();
    if (currentWriterEpoch !== this.#writerEpoch) {
      throw ocError(ErrorCodes.STALE_GENERATION, 'OPFS writer epoch is stale', {
        expectedWriterEpoch: this.#writerEpoch,
        currentWriterEpoch,
        storageGeneration: this.#current?.generation ?? 0
      });
    }
    return true;
  }

  async #guardStorageWriteUnlocked(additionalBytes) {
    try {
      const status = await this.#storagePolicy.assertCanWrite(additionalBytes);
      this.#lastStorageGuard = Object.freeze({
        ...status,
        gcAttempted: false,
        gcRemoved: Object.freeze([])
      });
      return this.#lastStorageGuard;
    } catch (error) {
      if (error?.code !== ErrorCodes.RESOURCE_EXHAUSTED) throw error;
    }

    const collected = await this.#collectGarbageUnlocked({ dryRun: false });
    try {
      const status = await this.#storagePolicy.assertCanWrite(additionalBytes);
      this.#lastStorageGuard = Object.freeze({
        ...status,
        gcAttempted: true,
        gcRemoved: collected.removed
      });
      return this.#lastStorageGuard;
    } catch (error) {
      if (error?.code !== ErrorCodes.RESOURCE_EXHAUSTED) throw error;
      this.#lastStorageGuard = Object.freeze({
        supported: true,
        additionalBytes,
        gcAttempted: true,
        gcRemoved: collected.removed,
        rejected: true,
        details: error?.details ?? null
      });
      throw ocError(ErrorCodes.RESOURCE_EXHAUSTED, 'OPFS checkpoint blocked by browser storage policy after garbage collection', {
        ...(error?.details ?? {}),
        additionalBytes,
        gcRemoved: collected.removed,
        gcRetained: collected.retained
      });
    }
  }

  async #collectGarbageUnlocked({ dryRun = false } = {}) {
    const manifests = [
      parseManifest(await readText(this.#directory, MANIFEST_A), 'a'),
      parseManifest(await readText(this.#directory, MANIFEST_B), 'b')
    ].filter(Boolean);
    const reachable = new Set(manifests.map((manifest) => manifest.payload));

    assertOc(
      typeof this.#payloads.entries === 'function' && typeof this.#payloads.removeEntry === 'function',
      ErrorCodes.INVALID_STATE,
      'OPFS generations directory does not support enumeration/removal'
    );

    const removed = [];
    const retained = [];
    const skipped = [];
    let reclaimedBytes = 0;
    for await (const [name, handle] of this.#payloads.entries()) {
      if (handle?.kind && handle.kind !== 'file') {
        skipped.push(String(name));
        continue;
      }
      if (reachable.has(name)) {
        retained.push(String(name));
        continue;
      }
      const text = await readText(this.#payloads, name);
      if (text !== null) reclaimedBytes += encoder.encode(text).byteLength;
      removed.push(String(name));
      if (!dryRun) await this.#payloads.removeEntry(name);
    }

    removed.sort();
    retained.sort();
    skipped.sort();
    return Object.freeze({
      dryRun,
      removed: Object.freeze(removed),
      retained: Object.freeze(retained),
      skipped: Object.freeze(skipped),
      reclaimedBytes,
      canonicalRootsProtected: true,
      currentSequence: this.#current?.sequence ?? null,
      currentGeneration: this.#current?.generation ?? null
    });
  }

  async #recoverUnlocked() {
    const manifestAText=await readText(this.#directory,MANIFEST_A);
    const manifestBText=await readText(this.#directory,MANIFEST_B);
    const hasCanonicalMetadata=manifestAText!==null||manifestBText!==null;
    const candidates = [
      parseManifest(manifestAText, 'a'),
      parseManifest(manifestBText, 'b')
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
    if(hasCanonicalMetadata){
      throw ocError(
        ErrorCodes.IMPORT_INVALID,
        'Canonical OPFS workspace metadata exists but no fully valid checkpoint can be opened',
        {
          manifestA:manifestAText===null?'missing':'present',
          manifestB:manifestBText===null?'missing':'present',
          structurallyValidCandidates:candidates.length,
          silentEmptyFallback:false
        }
      );
    }
    return null;
  }

  #injectCrash(crashAt,phase,details){
    if(crashAt!==phase)return;
    throw ocError(ErrorCodes.INVALID_STATE,'Injected OPFS checkpoint crash at '+phase,{
      injectedCrash:true,
      phase,
      ...details
    });
  }

  async #throwInjectedQuotaFault(phase,name) {
    let storage = null;
    if (this.#storagePolicy) {
      try { storage = await this.#storagePolicy.inspect(); } catch {}
    }
    throw ocError(ErrorCodes.RESOURCE_EXHAUSTED, 'Injected OPFS storage quota exhausted during checkpoint', {
      phase,
      name,
      storage,
      injectedQuota: true
    });
  }

  async #writeCheckpointText(directory, name, content, phase, { quotaFaultAt = null } = {}) {
    const payloadFaults = new Set(['after-0-bytes','after-1-byte','after-header','mid-payload','pre-commit']);
    if (phase === 'payload' && quotaFaultAt && payloadFaults.has(quotaFaultAt)) {
      const handle = await directory.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      try {
        const text = String(content);
        if (quotaFaultAt === 'after-1-byte') await writable.write(text.slice(0, 1));
        if (quotaFaultAt === 'after-header') await writable.write(text.slice(0, Math.min(32, text.length)));
        if (quotaFaultAt === 'mid-payload') await writable.write(text.slice(0, Math.max(1, Math.floor(text.length / 2))));
        if (quotaFaultAt === 'pre-commit') await writable.write(text);
        const error = new Error('Injected quota exhaustion');
        error.name = 'QuotaExceededError';
        throw error;
      } catch (error) {
        try { await writable.abort?.(); } catch {}
        if (error?.name !== 'QuotaExceededError') throw error;
        let storage = null;
        if (this.#storagePolicy) {
          try { storage = await this.#storagePolicy.inspect(); } catch {}
        }
        throw ocError(ErrorCodes.RESOURCE_EXHAUSTED, 'OPFS storage quota exhausted during checkpoint', {
          phase: quotaFaultAt,
          name,
          storage,
          injectedQuota: true
        });
      }
    }

    try {
      await writeText(directory, name, content);
    } catch (error) {
      if (error?.name !== 'QuotaExceededError') throw error;
      let storage = null;
      if (this.#storagePolicy) {
        try { storage = await this.#storagePolicy.inspect(); } catch {}
      }
      throw ocError(ErrorCodes.RESOURCE_EXHAUSTED, 'OPFS storage quota exhausted during checkpoint', {
        phase,
        name,
        storage
      });
    }
  }

  async #withExclusiveLock(callback) {
    if (!this.#lockManager) return callback();
    return this.#lockManager.request(this.#lockName, { mode: 'exclusive' }, callback);
  }

  #assertOpen() {
    if (!this.#directory || !this.#payloads || !this.#writerClaims) {
      throw ocError(ErrorCodes.INVALID_STATE, 'OPFS checkpoint authority is not open');
    }
  }
}
