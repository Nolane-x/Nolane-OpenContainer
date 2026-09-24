import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function countNamespaces(imports) {
  const counts = {};
  for (const entry of imports) counts[entry.module] = (counts[entry.module] ?? 0) + 1;
  return counts;
}

function sameCounts(actual, expected) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected ?? {})]);
  for (const key of keys) if ((actual[key] ?? 0) !== (expected?.[key] ?? 0)) return false;
  return true;
}

export const RolldownWasi129Profile = Object.freeze({
  id: 'rolldown-wasi-1.2.9',
  package: '@rolldown/binding-wasm32-wasi',
  version: '1.2.9',
  artifactId: 10446514923,
  zipSha256: '277fb9d391a2a48763b70d5ec297a1c9a10e9ee4eb9619e797e68cd4cfc852c7',
  fileName: 'rolldown-binding.wasm32-wasi.wasm',
  byteLength: 10845151,
  sha256: '629aa10c37a9920cd5729a35af148983c881f4ff9edd6368a7d63b5acbf89dc2',
  imports: 118,
  exports: 130,
  importNamespaces: Object.freeze({
    env: 93,
    emnapi: 1,
    napi: 2,
    wasi_snapshot_preview1: 21,
    wasi: 1
  })
});

export class WasmArtifactManager {
  #profiles = new Map();
  #cache = new Map();
  #inflight = new Map();
  #compiler;

  constructor({ profiles = [RolldownWasi129Profile], compiler = WebAssembly.compile } = {}) {
    assertOc(typeof compiler === 'function', ErrorCodes.INVALID_ARGUMENT, 'WASM compiler function is required');
    this.#compiler = compiler;
    for (const profile of profiles) this.register(profile);
  }

  register(profile) {
    assertOc(profile && typeof profile.id === 'string' && profile.id, ErrorCodes.INVALID_ARGUMENT, 'WASM profile id is required');
    assertOc(typeof profile.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(profile.sha256), ErrorCodes.INVALID_ARGUMENT, 'WASM profile SHA-256 is required');
    assertOc(Number.isInteger(profile.byteLength) && profile.byteLength >= 8, ErrorCodes.INVALID_ARGUMENT, 'WASM profile byteLength is required');
    this.#profiles.set(profile.id, Object.freeze({ ...profile }));
    return this;
  }

  profile(id) {
    return this.#profiles.get(id) ?? null;
  }

  cached(id) {
    const profile = this.#profiles.get(id);
    return profile ? this.#cache.get(profile.sha256) ?? null : null;
  }

  async verify(bytes, profileOrId) {
    const profile = typeof profileOrId === 'string' ? this.#profiles.get(profileOrId) : profileOrId;
    assertOc(profile, ErrorCodes.TOOLCHAIN_UNSUPPORTED, 'Unknown WASM artifact profile', { profile: profileOrId });
    assertOc(bytes instanceof Uint8Array, ErrorCodes.INVALID_ARGUMENT, 'WASM bytes must be Uint8Array');

    if (bytes.byteLength !== profile.byteLength) {
      throw ocError(ErrorCodes.DIGEST_MISMATCH, 'WASM artifact byte length mismatch', {
        profile: profile.id,
        expected: profile.byteLength,
        actual: bytes.byteLength
      });
    }

    const digest = await sha256Hex(bytes);
    if (digest !== profile.sha256) {
      throw ocError(ErrorCodes.DIGEST_MISMATCH, 'WASM artifact SHA-256 mismatch', {
        profile: profile.id,
        expected: profile.sha256,
        actual: digest
      });
    }

    return Object.freeze({ profile, sha256: digest, byteLength: bytes.byteLength });
  }

  async compile(bytes, profileOrId) {
    const verified = await this.verify(bytes, profileOrId);
    const { profile, sha256 } = verified;

    const cached = this.#cache.get(sha256);
    if (cached) return cached;

    const pending = this.#inflight.get(sha256);
    if (pending) return pending;

    const promise = this.#compileVerified(bytes, verified);
    this.#inflight.set(sha256, promise);
    try {
      const receipt = await promise;
      this.#cache.set(sha256, receipt);
      return receipt;
    } finally {
      this.#inflight.delete(sha256);
    }
  }

  clear(profileOrId = null) {
    if (profileOrId === null) {
      this.#cache.clear();
      this.#inflight.clear();
      return;
    }
    const profile = typeof profileOrId === 'string' ? this.#profiles.get(profileOrId) : profileOrId;
    if (profile) {
      this.#cache.delete(profile.sha256);
      this.#inflight.delete(profile.sha256);
    }
  }

  async #compileVerified(bytes, verified) {
    let module;
    try {
      module = await this.#compiler(bytes);
    } catch (error) {
      throw ocError(ErrorCodes.TOOLCHAIN_UNSUPPORTED, 'WASM artifact failed compilation', {
        profile: verified.profile.id,
        cause: error?.message
      });
    }

    const imports = WebAssembly.Module.imports(module);
    const exports = WebAssembly.Module.exports(module);
    const importNamespaces = countNamespaces(imports);
    const profile = verified.profile;

    if (profile.imports !== undefined && imports.length !== profile.imports) {
      throw ocError(ErrorCodes.TOOLCHAIN_UNSUPPORTED, 'WASM import count mismatch', {
        profile: profile.id,
        expected: profile.imports,
        actual: imports.length
      });
    }
    if (profile.exports !== undefined && exports.length !== profile.exports) {
      throw ocError(ErrorCodes.TOOLCHAIN_UNSUPPORTED, 'WASM export count mismatch', {
        profile: profile.id,
        expected: profile.exports,
        actual: exports.length
      });
    }
    if (profile.importNamespaces && !sameCounts(importNamespaces, profile.importNamespaces)) {
      throw ocError(ErrorCodes.TOOLCHAIN_UNSUPPORTED, 'WASM import namespace shape mismatch', {
        profile: profile.id,
        expected: profile.importNamespaces,
        actual: importNamespaces
      });
    }

    return Object.freeze({
      status: 'VERIFIED_COMPILED',
      profileId: profile.id,
      sha256: verified.sha256,
      byteLength: verified.byteLength,
      imports: imports.length,
      exports: exports.length,
      importNamespaces: Object.freeze(importNamespaces),
      module
    });
  }
}
