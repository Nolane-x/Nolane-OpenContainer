import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserStoragePolicy } from '../packages/vfs/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

test('browser storage policy reports quota pressure and persistence denial without failing', async () => {
  let persistCalls = 0;
  const storageManager = {
    async estimate() { return { usage: 800, quota: 1000 }; },
    async persisted() { return false; },
    async persist() { persistCalls++; return false; }
  };
  const policy = new BrowserStoragePolicy({
    storageManager,
    warningRatio: 0.8,
    criticalRatio: 0.95
  });

  const status = await policy.inspect();
  assert.equal(status.supported, true);
  assert.equal(status.usageBytes, 800);
  assert.equal(status.quotaBytes, 1000);
  assert.equal(status.freeBytes, 200);
  assert.equal(status.usageRatio, 0.8);
  assert.equal(status.pressure, 'warning');
  assert.equal(status.persisted, false);

  const persistence = await policy.requestPersistence();
  assert.equal(persistence.requested, true);
  assert.equal(persistence.granted, false);
  assert.equal(persistCalls, 1);
});

test('browser storage policy rejects only explicitly configured projected pressure', async () => {
  const storageManager = {
    async estimate() { return { usage: 700, quota: 1000 }; },
    async persisted() { return true; }
  };
  const policy = new BrowserStoragePolicy({ storageManager });

  const allowed = await policy.assertCanWrite(100, { maxUsageRatio: 0.9 });
  assert.equal(allowed.projectedUsageBytes, 800);
  assert.equal(allowed.projectedFreeBytes, 200);
  assert.equal(allowed.projectedUsageRatio, 0.8);

  await assert.rejects(
    () => policy.assertCanWrite(250, { maxUsageRatio: 0.9 }),
    (error) => {
      assert.equal(error.code, ErrorCodes.RESOURCE_EXHAUSTED);
      assert.equal(error.details.projectedUsageBytes, 950);
      assert.equal(error.details.maxUsageRatio, 0.9);
      return true;
    }
  );
});

test('browser storage policy degrades safely when StorageManager is unavailable', async () => {
  const policy = new BrowserStoragePolicy({ storageManager: null });
  const status = await policy.inspect();
  assert.equal(status.supported, false);
  assert.equal(status.pressure, 'unavailable');

  const guard = await policy.assertCanWrite(1024);
  assert.equal(guard.projectedUsageBytes, null);

  const persistence = await policy.requestPersistence();
  assert.equal(persistence.supported, false);
  assert.equal(persistence.requested, false);
});
