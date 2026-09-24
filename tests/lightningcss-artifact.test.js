import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectTarArchive } from '../packages/package-env/src/index.js';
import { WasmArtifactManager, LightningCssWasm133Profile, FrozenToolchains } from '../packages/toolchain/src/index.js';

test('retained Lightning CSS 1.33.0 tarball and WASM match frozen executable identity', async () => {
  const tarball = new Uint8Array(await readFile(new URL('../toolchain/vendor/lightningcss-wasm-1.33.0.tgz', import.meta.url)));
  assert.equal(tarball.byteLength, LightningCssWasm133Profile.tarballByteLength);
  assert.equal(createHash('sha256').update(tarball).digest('hex'), LightningCssWasm133Profile.tarballSha256);
  assert.equal(LightningCssWasm133Profile.tarballSha256, FrozenToolchains.vite830.lightningcssTarballSha256);

  const archive = await inspectTarArchive(tarball, {
    requiredPrefix: 'package/',
    maxFiles: 1000,
    maxUnpackedBytes: 64 * 1024 * 1024
  });
  const wasmEntry = archive.entries.find((entry) => entry.path === 'package/lightningcss_node.wasm');
  assert.ok(wasmEntry);
  assert.equal(wasmEntry.size, LightningCssWasm133Profile.byteLength);
  assert.equal(createHash('sha256').update(wasmEntry.data).digest('hex'), LightningCssWasm133Profile.sha256);
  assert.equal(LightningCssWasm133Profile.sha256, FrozenToolchains.vite830.lightningcssWasmSha256);

  const manager = new WasmArtifactManager();
  const receipt = await manager.compile(wasmEntry.data, LightningCssWasm133Profile.id);
  assert.equal(receipt.status, 'VERIFIED_COMPILED');
  assert.equal(receipt.imports, 48);
  assert.equal(receipt.exports, 13);
  assert.deepEqual(receipt.importNamespaces, { env: 48 });
});
