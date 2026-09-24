import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';
import { inspectTarArchive } from '../../package-env/src/artifact-authority.js';
import { WasmArtifactManager, LightningCssWasm133Profile } from './wasm-artifact-manager.js';

const decoder = new TextDecoder();

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const LightningCssPackage133Profile = Object.freeze({
  id: 'lightningcss-wasm-package-1.33.0',
  name: 'lightningcss-wasm',
  version: '1.33.0',
  tarballByteLength: 3826518,
  tarballSha256: '266866c1b0efd7ca5307fe312411e4f1895b997086fb76f392ec5b60aadf31c8',
  packageJsonPath: 'package/package.json',
  browserEntry: 'package/index.mjs',
  nodeEntry: 'package/wasm-node.mjs',
  wasmPath: 'package/lightningcss_node.wasm'
});

export async function verifyRetainedLightningCssPackage(
  tarball,
  {
    profile = LightningCssPackage133Profile,
    wasmManager = new WasmArtifactManager()
  } = {}
) {
  assertOc(tarball instanceof Uint8Array, ErrorCodes.INVALID_ARGUMENT, 'Lightning CSS tarball must be Uint8Array');

  if (tarball.byteLength !== profile.tarballByteLength) {
    throw ocError(ErrorCodes.DIGEST_MISMATCH, 'Lightning CSS tarball byte length mismatch', {
      expected: profile.tarballByteLength,
      actual: tarball.byteLength
    });
  }

  const tarballSha256 = await sha256Hex(tarball);
  if (tarballSha256 !== profile.tarballSha256) {
    throw ocError(ErrorCodes.DIGEST_MISMATCH, 'Lightning CSS tarball digest mismatch', {
      expected: profile.tarballSha256,
      actual: tarballSha256
    });
  }

  const archive = await inspectTarArchive(tarball, {
    requiredPrefix: 'package/',
    maxFiles: 2000,
    maxUnpackedBytes: 64 * 1024 * 1024
  });

  const files = new Map(
    archive.entries
      .filter((entry) => entry.type === 'file')
      .map((entry) => [entry.path, new Uint8Array(entry.data)])
  );

  const packageJsonBytes = files.get(profile.packageJsonPath);
  assertOc(packageJsonBytes, ErrorCodes.INVALID_PACKAGE_CONFIG, 'Retained Lightning CSS package is missing package.json');

  let packageJson;
  try {
    packageJson = JSON.parse(decoder.decode(packageJsonBytes));
  } catch {
    throw ocError(ErrorCodes.INVALID_PACKAGE_CONFIG, 'Retained Lightning CSS package has invalid package.json');
  }

  assertOc(packageJson.name === profile.name, ErrorCodes.INVALID_PACKAGE_CONFIG, 'Retained Lightning CSS package name mismatch', {
    expected: profile.name,
    actual: packageJson.name
  });
  assertOc(packageJson.version === profile.version, ErrorCodes.INVALID_PACKAGE_CONFIG, 'Retained Lightning CSS package version mismatch', {
    expected: profile.version,
    actual: packageJson.version
  });

  for (const path of [profile.browserEntry, profile.nodeEntry, profile.wasmPath, 'package/async.mjs']) {
    assertOc(files.has(path), ErrorCodes.INVALID_PACKAGE_CONFIG, 'Retained Lightning CSS package is missing required runtime file', { path });
  }

  const wasmBytes = files.get(profile.wasmPath);
  const wasmReceipt = await wasmManager.compile(wasmBytes, LightningCssWasm133Profile.id);

  return Object.freeze({
    status: 'VERIFIED_PACKAGE',
    profile,
    tarballSha256,
    packageJson: Object.freeze(packageJson),
    fileCount: files.size,
    unpackedBytes: archive.totalBytes,
    wasmReceipt,
    hasFile: (path) => files.has(path),
    getFile: (path) => {
      const value = files.get(path);
      return value ? new Uint8Array(value) : null;
    }
  });
}
