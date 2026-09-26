import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';
import { inspectTarArchive, verifySri } from './artifact-authority.js';

function cloneFiles(files) {
  const out = {};
  for (const [path, value] of Object.entries(files)) out[path] = value instanceof Uint8Array ? new Uint8Array(value) : value;
  return out;
}

export class PackageContentStore {
  #contents = new Map();

  get size() { return this.#contents.size; }
  has(contentId) { return this.#contents.has(contentId); }

  async ingest({ contentId, integrity, bytes, expectedName = null, expectedVersion = null }) {
    assertOc(typeof contentId === 'string' && contentId.length > 0, ErrorCodes.INVALID_ARGUMENT, 'contentId is required');
    assertOc(bytes instanceof Uint8Array, ErrorCodes.INVALID_ARGUMENT, 'artifact bytes must be Uint8Array');
    await verifySri(bytes, integrity);

    const existing = this.#contents.get(contentId);
    if (existing) {
      if (existing.integrity !== integrity) throw ocError(ErrorCodes.ARTIFACT_INTEGRITY, 'Content identity reused with different integrity', { contentId });
      return Object.freeze({ contentId, reused: true, packageJson: existing.packageJson, fileCount: Object.keys(existing.files).length });
    }

    const archive = await inspectTarArchive(bytes, { requiredPrefix: 'package/' });
    const files = {};
    for (const entry of archive.entries) {
      if (entry.type !== 'file') continue;
      const relative = entry.path.slice('package/'.length);
      if (!relative) continue;
      files[relative] = new Uint8Array(entry.data);
    }

    assertOc(files['package.json'], ErrorCodes.INVALID_PACKAGE_CONFIG, 'Package artifact is missing package.json', { contentId });
    let packageJson;
    try {
      packageJson = JSON.parse(new TextDecoder().decode(files['package.json']));
    } catch {
      throw ocError(ErrorCodes.INVALID_PACKAGE_CONFIG, 'Package artifact has invalid package.json', { contentId });
    }

    if (expectedName && packageJson.name && packageJson.name !== expectedName) {
      throw ocError(ErrorCodes.INVALID_PACKAGE_CONFIG, 'Artifact package name disagrees with lockfile', { expected: expectedName, actual: packageJson.name });
    }
    if (expectedVersion && packageJson.version && packageJson.version !== expectedVersion) {
      throw ocError(ErrorCodes.INVALID_PACKAGE_CONFIG, 'Artifact package version disagrees with lockfile', { expected: expectedVersion, actual: packageJson.version });
    }

    const record = Object.freeze({
      contentId,
      integrity,
      packageJson: Object.freeze(structuredClone(packageJson)),
      files: Object.freeze(files),
      unpackedBytes: archive.totalBytes
    });
    this.#contents.set(contentId, record);
    return Object.freeze({ contentId, reused: false, packageJson: record.packageJson, fileCount: Object.keys(files).length });
  }

  get(contentId) {
    const record = this.#contents.get(contentId);
    if (!record) return null;
    return Object.freeze({
      contentId: record.contentId,
      integrity: record.integrity,
      packageJson: record.packageJson,
      files: cloneFiles(record.files),
      unpackedBytes: record.unpackedBytes
    });
  }
}

export class FrozenInstallAuthority {
  #packages;
  #store;

  constructor({ packages, contentStore = new PackageContentStore() } = {}) {
    assertOc(packages && typeof packages.mountCatalog === 'function', ErrorCodes.INVALID_ARGUMENT, 'PackageGraphAuthority is required');
    this.#packages = packages;
    this.#store = contentStore;
  }

  get contentStore() { return this.#store; }

  async installAll({
    artifactAuthority,
    concurrency = 4,
    signal = null,
    onProgress = null,
    locations = null,
    artifactUrlResolver = null
  } = {}) {
    const graph = this.#packages.graph;
    assertOc(graph, ErrorCodes.INVALID_STATE, 'Compile a lockfile before installing artifacts');
    assertOc(artifactAuthority && typeof artifactAuthority.fetchArtifact === 'function', ErrorCodes.INVALID_ARGUMENT, 'PackageArtifactAuthority is required');

    const selected = locations ? new Set(locations) : null;
    const unique = new Map();
    let packageInstances = 0;
    let embeddedInstances = 0;
    for (const node of graph.nodes) {
      if (selected && !selected.has(node.location)) continue;
      if (node.link) continue;
      if (node.inBundle) { embeddedInstances++; continue; }
      packageInstances++;
      assertOc(node.resolved, ErrorCodes.INVALID_PACKAGE_CONFIG, 'Frozen package is missing resolved artifact URL', { location: node.location });
      assertOc(node.integrity, ErrorCodes.ARTIFACT_INTEGRITY, 'Frozen package is missing integrity', { location: node.location });
      if (!this.#store.has(node.contentId) && typeof this.#store.hydrate === 'function') {
        await this.#store.hydrate({
          contentId: node.contentId,
          integrity: node.integrity,
          expectedName: node.name,
          expectedVersion: node.version && node.version !== '0.0.0-link' ? node.version : null
        });
      }
      if (!this.#store.has(node.contentId) && !unique.has(node.contentId)) unique.set(node.contentId, node);
    }

    const queue = [...unique.values()];
    const workerCount = Math.min(queue.length || 1, Math.max(1, Number(concurrency) || 1));
    let cursor = 0;
    let fetchedContents = 0;
    let bytes = 0;
    let redirects = 0;

    const assertNotAborted = () => {
      if (signal?.aborted) {
        throw ocError(ErrorCodes.INVALID_STATE, 'Frozen package installation aborted', {
          reason: signal.reason ? String(signal.reason) : undefined
        });
      }
    };

    const worker = async () => {
      while (true) {
        assertNotAborted();
        const index = cursor++;
        if (index >= queue.length) return;
        const node = queue[index];

        const artifactUrl = artifactUrlResolver ? await artifactUrlResolver(node) : node.resolved;
        assertOc(artifactUrl, ErrorCodes.INVALID_PACKAGE_CONFIG, 'Artifact URL resolver returned no URL', { location: node.location });
        const artifact = await artifactAuthority.fetchArtifact({
          url: artifactUrl,
          integrity: node.integrity,
          signal
        });
        assertNotAborted();

        const receipt = await this.ingestLocation(node.location, artifact.bytes);
        fetchedContents++;
        bytes += artifact.bytes.byteLength;
        redirects += artifact.redirects ?? 0;
        onProgress?.(Object.freeze({
          completed: fetchedContents,
          total: queue.length,
          location: node.location,
          contentId: node.contentId,
          bytes: artifact.bytes.byteLength,
          reused: receipt.reused
        }));
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return Object.freeze({
      packageInstances,
      embeddedInstances,
      requestedContents: queue.length,
      fetchedContents,
      contentCount: this.#store.size,
      bytes,
      redirects
    });
  }

  async ingestLocation(location, bytes) {
    const graph = this.#packages.graph;
    assertOc(graph, ErrorCodes.INVALID_STATE, 'Compile a lockfile before ingesting artifacts');
    const node = graph.nodes.find((candidate) => candidate.location === location);
    assertOc(node, ErrorCodes.NOT_FOUND, 'Lockfile location not found', { location });
    assertOc(!node.link, ErrorCodes.INVALID_ARGUMENT, 'Linked workspace package does not accept an artifact', { location });
    assertOc(node.integrity, ErrorCodes.ARTIFACT_INTEGRITY, 'Frozen artifact requires lockfile integrity', { location });

    return this.#store.ingest({
      contentId: node.contentId,
      integrity: node.integrity,
      bytes,
      expectedName: node.name,
      expectedVersion: node.version && node.version !== '0.0.0-link' ? node.version : null
    });
  }

  mountFrozenGraph({ locations = null } = {}) {
    const graph = this.#packages.graph;
    assertOc(graph, ErrorCodes.INVALID_STATE, 'Compile a lockfile before mounting packages');

    const selected = locations ? new Set(locations) : null;
    const packages = [];
    const symlinks = [];
    let embeddedCount = 0;
    for (const node of graph.nodes) {
      if (selected && !selected.has(node.location)) continue;
      if (node.inBundle) { embeddedCount++; continue; }
      if (node.link) {
        assertOc(typeof node.resolved === 'string' && node.resolved.length > 0, ErrorCodes.INVALID_PACKAGE_CONFIG, 'Linked package is missing resolved workspace path', { location: node.location });
        const target = node.resolved.startsWith('/') ? node.resolved : '/workspace/' + node.resolved.replace(/^\.\//, '');
        symlinks.push({ path: '/workspace/' + node.location, target });
        continue;
      }
      const content = this.#store.get(node.contentId);
      if (!content) throw ocError(ErrorCodes.PACKAGE_CONTENT_MISSING, 'Verified package content is missing', { location: node.location, contentId: node.contentId });
      packages.push({ location: node.location, packageJson: content.packageJson, files: content.files });
    }

    const mounted = this.#packages.mountCatalog({ packages, symlinks });
    return Object.freeze({ ...mounted, packageCount: packages.length, linkCount: symlinks.length, embeddedCount, contentCount: this.#store.size });
  }
}
