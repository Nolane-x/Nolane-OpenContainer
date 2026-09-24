import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';
import { inspectTarArchive } from '../../package-env/src/artifact-authority.js';
import { WasmArtifactManager, RolldownWasi129Profile } from './wasm-artifact-manager.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const RolldownBrowser129Profile = Object.freeze({
  id: 'rolldown-browser-package-1.2.9',
  name: '@rolldown/browser',
  version: '1.2.9',
  tarballByteLength: 3809446,
  tarballSha256: '9accf3cdfe3d2287ad7d5f49cd2cfcddbc9c112abfcbc295863e401ef44b8576',
  officialArtifactId: 10447416443,
  officialArtifactZipSha256: '44ab2d4a313065c8fb448433877a4a50628aca0a4a972a6f11660ca8f5002ac7',
  distFileCount: 63,
  distManifestSha256: '75492b477ad45162d0f92543ddb3fb0ae9b3a727ff652ef251b8532cb53f1308',
  wasmPath: 'package/dist/rolldown-binding.wasm32-wasi.wasm',
  browserEntry: 'package/dist/index.browser.mjs',
  keyFiles: Object.freeze({
    'package/dist/index.browser.mjs': '3738a5cb942733b5fb9bbacdc5502e060a3e48f5edc86378531dc502ed53f9ed',
    'package/dist/rolldown-binding.wasi-browser.js': '4970cc8275950b4a6a7bc16803a48f0462c5ccad02e65f568d2300662e40fd84',
    'package/dist/rolldown-binding.wasi.cjs': '5f4ad0a90dd97b1e5d96517c31068575a6e7b6163a54172a8d39b9753d2b2457',
    'package/dist/rolldown-binding.wasm32-wasi.wasm': '629aa10c37a9920cd5729a35af148983c881f4ff9edd6368a7d63b5acbf89dc2',
    'package/dist/wasi-worker-browser.mjs': 'c75b826181d93cfa9df7a5e5212a353ad965be363149db634478c618196fe30c'
  }),
  dependencies: Object.freeze({
    '@emnapi/core': '2.0.0-alpha.5',
    '@emnapi/runtime': '2.0.0-alpha.5',
    '@napi-rs/wasm-runtime': '~1.2.2'
  })
});

export async function verifyRetainedRolldownBrowserPackage(
  tarball,
  {
    profile = RolldownBrowser129Profile,
    wasmManager = new WasmArtifactManager()
  } = {}
) {
  assertOc(tarball instanceof Uint8Array, ErrorCodes.INVALID_ARGUMENT, 'Rolldown browser tarball must be Uint8Array');

  if (tarball.byteLength !== profile.tarballByteLength) {
    throw ocError(ErrorCodes.DIGEST_MISMATCH, 'Rolldown browser tarball byte length mismatch', {
      expected: profile.tarballByteLength,
      actual: tarball.byteLength
    });
  }

  const tarballSha256 = await sha256Hex(tarball);
  if (tarballSha256 !== profile.tarballSha256) {
    throw ocError(ErrorCodes.DIGEST_MISMATCH, 'Rolldown browser tarball digest mismatch', {
      expected: profile.tarballSha256,
      actual: tarballSha256
    });
  }

  const archive = await inspectTarArchive(tarball, {
    requiredPrefix: 'package/',
    maxFiles: 5000,
    maxUnpackedBytes: 96 * 1024 * 1024
  });
  const files = new Map(
    archive.entries
      .filter((entry) => entry.type === 'file')
      .map((entry) => [entry.path, new Uint8Array(entry.data)])
  );

  const packageJsonBytes = files.get('package/package.json');
  assertOc(packageJsonBytes, ErrorCodes.INVALID_PACKAGE_CONFIG, 'Rolldown browser package.json is missing');
  let packageJson;
  try {
    packageJson = JSON.parse(decoder.decode(packageJsonBytes));
  } catch {
    throw ocError(ErrorCodes.INVALID_PACKAGE_CONFIG, 'Rolldown browser package.json is invalid');
  }

  assertOc(packageJson.name === profile.name, ErrorCodes.INVALID_PACKAGE_CONFIG, 'Rolldown browser package name mismatch');
  assertOc(packageJson.version === profile.version, ErrorCodes.INVALID_PACKAGE_CONFIG, 'Rolldown browser package version mismatch');

  for (const [name, expected] of Object.entries(profile.dependencies)) {
    assertOc(packageJson.dependencies?.[name] === expected, ErrorCodes.INVALID_PACKAGE_CONFIG, 'Rolldown browser dependency profile mismatch', {
      dependency: name,
      expected,
      actual: packageJson.dependencies?.[name]
    });
  }

  const distPaths = [...files.keys()]
    .filter((path) => path.startsWith('package/dist/'))
    .sort();

  assertOc(distPaths.length === profile.distFileCount, ErrorCodes.DIGEST_MISMATCH, 'Rolldown browser dist file count mismatch', {
    expected: profile.distFileCount,
    actual: distPaths.length
  });

  const manifestLines = [];
  for (const path of distPaths) {
    const relative = path.slice('package/dist/'.length);
    manifestLines.push((await sha256Hex(files.get(path))) + '  ' + relative);
  }
  const manifestSha256 = await sha256Hex(encoder.encode(manifestLines.join('\n') + '\n'));
  if (manifestSha256 !== profile.distManifestSha256) {
    throw ocError(ErrorCodes.DIGEST_MISMATCH, 'Rolldown browser normalized dist manifest mismatch', {
      expected: profile.distManifestSha256,
      actual: manifestSha256
    });
  }

  for (const [path, expected] of Object.entries(profile.keyFiles)) {
    const bytes = files.get(path);
    assertOc(bytes, ErrorCodes.INVALID_PACKAGE_CONFIG, 'Rolldown browser key file missing', { path });
    const actual = await sha256Hex(bytes);
    if (actual !== expected) {
      throw ocError(ErrorCodes.DIGEST_MISMATCH, 'Rolldown browser key file digest mismatch', { path, expected, actual });
    }
  }

  const wasmReceipt = await wasmManager.compile(files.get(profile.wasmPath), RolldownWasi129Profile.id);

  return Object.freeze({
    status: 'VERIFIED_OFFICIAL_DIST',
    profile,
    tarballSha256,
    distManifestSha256: manifestSha256,
    packageJson: Object.freeze(packageJson),
    distFileCount: distPaths.length,
    wasmReceipt,
    hasFile: (path) => files.has(path),
    getFile: (path) => {
      const value = files.get(path);
      return value ? new Uint8Array(value) : null;
    }
  });
}
