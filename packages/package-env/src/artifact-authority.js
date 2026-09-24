import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function digest(algorithm, bytes) {
  return new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, bytes));
}

export async function verifySri(bytes, integrity) {
  assertOc(bytes instanceof Uint8Array, ErrorCodes.INVALID_ARGUMENT, 'Artifact bytes must be Uint8Array');
  assertOc(typeof integrity === 'string' && integrity.length > 0, ErrorCodes.INVALID_ARGUMENT, 'Integrity is required');

  const candidates = integrity.trim().split(/\s+/).map((token) => {
    const index = token.indexOf('-');
    return index > 0 ? { algorithm: token.slice(0, index).toLowerCase(), expected: token.slice(index + 1) } : null;
  }).filter(Boolean);

  const supported = candidates.filter((candidate) => candidate.algorithm === 'sha512' || candidate.algorithm === 'sha256');
  assertOc(supported.length > 0, ErrorCodes.INVALID_ARGUMENT, 'No supported SRI digest');

  for (const candidate of supported) {
    const algorithm = candidate.algorithm === 'sha512' ? 'SHA-512' : 'SHA-256';
    if (base64(await digest(algorithm, bytes)) === candidate.expected) {
      return Object.freeze({ algorithm: candidate.algorithm, integrity: candidate.algorithm + '-' + candidate.expected });
    }
  }

  throw ocError(ErrorCodes.ARTIFACT_INTEGRITY, 'Artifact integrity mismatch');
}

function readNullTerminated(bytes, start, length) {
  const end = Math.min(start + length, bytes.length);
  let stop = start;
  while (stop < end && bytes[stop] !== 0) stop++;
  return decoder.decode(bytes.subarray(start, stop));
}

function parseOctal(text, field) {
  const normalized = text.replace(/\0/g, '').trim();
  if (!normalized) return 0;
  if (!/^[0-7]+$/.test(normalized)) throw ocError(ErrorCodes.ARCHIVE_UNSAFE, 'Invalid tar ' + field);
  return Number.parseInt(normalized, 8);
}

function headerChecksum(bytes, offset) {
  let sum = 0;
  for (let index = 0; index < 512; index++) {
    const absolute = offset + index;
    sum += index >= 148 && index < 156 ? 32 : bytes[absolute];
  }
  return sum;
}

function safeRelativePath(path) {
  if (!path || path.includes('\\') || path.startsWith('/') || path.includes('\0')) {
    throw ocError(ErrorCodes.ARCHIVE_UNSAFE, 'Unsafe archive path', { path });
  }
  const parts = path.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw ocError(ErrorCodes.ARCHIVE_UNSAFE, 'Archive path traversal rejected', { path });
  }
  return parts.join('/');
}

async function gunzipIfNeeded(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream !== 'function') {
    throw ocError(ErrorCodes.INVALID_STATE, 'gzip artifact requires DecompressionStream');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function inspectTarArchive(input, {
  maxFiles = 20_000,
  maxUnpackedBytes = 256 * 1024 * 1024,
  requiredPrefix = 'package/'
} = {}) {
  const bytes = await gunzipIfNeeded(input);
  const entries = [];
  let offset = 0;
  let totalBytes = 0;

  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const storedChecksum = parseOctal(readNullTerminated(bytes, offset + 148, 8), 'checksum');
    if (storedChecksum !== headerChecksum(bytes, offset)) {
      throw ocError(ErrorCodes.ARCHIVE_UNSAFE, 'Tar header checksum mismatch', { offset });
    }

    const name = readNullTerminated(bytes, offset, 100);
    const prefix = readNullTerminated(bytes, offset + 345, 155);
    const path = safeRelativePath(prefix ? prefix + '/' + name : name);
    const type = String.fromCharCode(bytes[offset + 156] || 48);
    const size = parseOctal(readNullTerminated(bytes, offset + 124, 12), 'size');

    if (requiredPrefix && !path.startsWith(requiredPrefix)) {
      throw ocError(ErrorCodes.ARCHIVE_UNSAFE, 'Archive entry is outside required prefix', { path, requiredPrefix });
    }
    if (!['0', '5'].includes(type)) {
      throw ocError(ErrorCodes.ARCHIVE_UNSAFE, 'Unsupported archive entry type', { path, type });
    }
    if (type === '5' && size !== 0) {
      throw ocError(ErrorCodes.ARCHIVE_UNSAFE, 'Directory entry carries payload bytes', { path, size });
    }

    totalBytes += size;
    if (entries.length + 1 > maxFiles || totalBytes > maxUnpackedBytes) {
      throw ocError(ErrorCodes.ARTIFACT_TOO_LARGE, 'Archive expansion limit exceeded', {
        files: entries.length + 1,
        bytes: totalBytes,
        maxFiles,
        maxUnpackedBytes
      });
    }

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) throw ocError(ErrorCodes.ARCHIVE_UNSAFE, 'Truncated tar entry', { path });

    entries.push(Object.freeze({
      path,
      type: type === '5' ? 'directory' : 'file',
      size,
      data: type === '5' ? null : new Uint8Array(bytes.slice(dataStart, dataEnd))
    }));

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return Object.freeze({ entries: Object.freeze(entries), totalBytes });
}

export class PackageArtifactAuthority {
  #fs;
  #network;
  #fetch;
  #maxArtifactBytes;
  #archiveLimits;

  constructor({
    fs,
    network,
    fetchImpl = globalThis.fetch,
    maxArtifactBytes = 64 * 1024 * 1024,
    maxFiles = 20_000,
    maxUnpackedBytes = 256 * 1024 * 1024
  } = {}) {
    assertOc(fs && typeof fs.beginTransaction === 'function', ErrorCodes.INVALID_ARGUMENT, 'VFS authority is required');
    assertOc(network && typeof network.authorize === 'function', ErrorCodes.INVALID_ARGUMENT, 'Network authority is required');
    assertOc(typeof fetchImpl === 'function', ErrorCodes.INVALID_ARGUMENT, 'fetch implementation is required');
    this.#fs = fs;
    this.#network = network;
    this.#fetch = fetchImpl;
    this.#maxArtifactBytes = maxArtifactBytes;
    this.#archiveLimits = { maxFiles, maxUnpackedBytes };
  }

  async fetchArtifact({ url, integrity }) {
    const authorized = this.#network.authorize(url, { method: 'GET' });
    const response = await this.#fetch(authorized.url, { method: 'GET', credentials: 'omit', redirect: 'follow' });
    if (!response.ok) throw ocError(ErrorCodes.NOT_FOUND, 'Artifact fetch failed', { url: authorized.url, status: response.status });

    const declared = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > this.#maxArtifactBytes) {
      throw ocError(ErrorCodes.ARTIFACT_TOO_LARGE, 'Artifact Content-Length exceeds limit', { declared, limit: this.#maxArtifactBytes });
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.#maxArtifactBytes) {
      throw ocError(ErrorCodes.ARTIFACT_TOO_LARGE, 'Artifact bytes exceed limit', { bytes: bytes.byteLength, limit: this.#maxArtifactBytes });
    }

    const verified = await verifySri(bytes, integrity);
    return Object.freeze({ url: authorized.url, bytes, verified });
  }

  async installTarball({ bytes, destination, stripPrefix = 'package/' }) {
    const archive = await inspectTarArchive(bytes, { ...this.#archiveLimits, requiredPrefix: stripPrefix });
    const tx = this.#fs.beginTransaction();

    for (const entry of archive.entries) {
      const relative = entry.path.slice(stripPrefix.length);
      if (!relative) continue;
      const target = destination.replace(/\/$/, '') + '/' + relative;
      if (entry.type === 'directory') tx.mkdir(target);
      else tx.writeFile(target, entry.data);
    }

    const generation = tx.commit();
    return Object.freeze({ generation, files: archive.entries.filter((entry) => entry.type === 'file').length, bytes: archive.totalBytes });
  }
}
