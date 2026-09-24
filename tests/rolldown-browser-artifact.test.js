import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  verifyRetainedRolldownBrowserPackage,
  RolldownBrowser129Profile,
  RolldownWasi129Profile
} from '../packages/toolchain/src/index.js';

test('retained Rolldown browser 1.2.9 package stays byte-concordant with official release artifact', async () => {
  const tarball = new Uint8Array(await readFile(new URL('../toolchain/vendor/rolldown-browser-1.2.9.tgz', import.meta.url)));
  const receipt = await verifyRetainedRolldownBrowserPackage(tarball);

  assert.equal(receipt.status, 'VERIFIED_OFFICIAL_DIST');
  assert.equal(receipt.tarballSha256, RolldownBrowser129Profile.tarballSha256);
  assert.equal(receipt.distManifestSha256, RolldownBrowser129Profile.distManifestSha256);
  assert.equal(receipt.distFileCount, 63);
  assert.equal(receipt.packageJson.name, '@rolldown/browser');
  assert.equal(receipt.packageJson.version, '1.2.9');
  assert.equal(receipt.wasmReceipt.sha256, RolldownWasi129Profile.sha256);
  assert.equal(receipt.wasmReceipt.imports, 118);
  assert.equal(receipt.wasmReceipt.exports, 130);
  assert.ok(receipt.hasFile('package/dist/index.browser.mjs'));
  assert.ok(receipt.hasFile('package/dist/rolldown-binding.wasi-browser.js'));
  assert.ok(receipt.hasFile('package/dist/wasi-worker-browser.mjs'));
});
