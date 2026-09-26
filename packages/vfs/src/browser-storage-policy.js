import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

function ratio(value, name) {
  const number = Number(value);
  assertOc(Number.isFinite(number) && number > 0 && number <= 1, ErrorCodes.INVALID_ARGUMENT, name + ' must be in (0, 1]');
  return number;
}

function bytes(value, name) {
  const number = Number(value);
  assertOc(Number.isFinite(number) && number >= 0, ErrorCodes.INVALID_ARGUMENT, name + ' must be a non-negative number');
  return number;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export class BrowserStoragePolicy {
  #storage;
  #warningRatio;
  #criticalRatio;
  #minFreeBytes;

  constructor({
    storageManager = globalThis.navigator?.storage ?? null,
    warningRatio = 0.8,
    criticalRatio = 0.95,
    minFreeBytes = 0
  } = {}) {
    if (storageManager !== null) {
      assertOc(typeof storageManager?.estimate === 'function', ErrorCodes.INVALID_ARGUMENT, 'Browser storage manager must expose estimate()');
    }
    this.#warningRatio = ratio(warningRatio, 'warningRatio');
    this.#criticalRatio = ratio(criticalRatio, 'criticalRatio');
    assertOc(this.#warningRatio <= this.#criticalRatio, ErrorCodes.INVALID_ARGUMENT, 'warningRatio must not exceed criticalRatio');
    this.#minFreeBytes = bytes(minFreeBytes, 'minFreeBytes');
    this.#storage = storageManager;
  }

  get supported() {
    return this.#storage !== null;
  }

  async inspect() {
    if (!this.#storage) {
      return Object.freeze({
        supported: false,
        usageBytes: null,
        quotaBytes: null,
        freeBytes: null,
        usageRatio: null,
        persisted: null,
        pressure: 'unavailable'
      });
    }

    const estimate = await this.#storage.estimate();
    const usageBytes = finiteOrNull(estimate?.usage);
    const quotaBytes = finiteOrNull(estimate?.quota);
    const freeBytes = usageBytes !== null && quotaBytes !== null
      ? Math.max(0, quotaBytes - usageBytes)
      : null;
    const usageRatio = usageBytes !== null && quotaBytes !== null && quotaBytes > 0
      ? usageBytes / quotaBytes
      : null;
    const persisted = typeof this.#storage.persisted === 'function'
      ? Boolean(await this.#storage.persisted())
      : null;

    let pressure = 'unknown';
    if (usageRatio !== null && freeBytes !== null) {
      if (usageBytes >= quotaBytes) pressure = 'exhausted';
      else if (usageRatio >= this.#criticalRatio || freeBytes < this.#minFreeBytes) pressure = 'critical';
      else if (usageRatio >= this.#warningRatio) pressure = 'warning';
      else pressure = 'normal';
    }

    return Object.freeze({
      supported: true,
      usageBytes,
      quotaBytes,
      freeBytes,
      usageRatio,
      persisted,
      pressure
    });
  }

  async requestPersistence() {
    const before = await this.inspect();
    if (!this.#storage || typeof this.#storage.persist !== 'function') {
      return Object.freeze({
        supported: false,
        requested: false,
        granted: before.persisted === true,
        before,
        after: before
      });
    }
    if (before.persisted === true) {
      return Object.freeze({
        supported: true,
        requested: false,
        granted: true,
        before,
        after: before
      });
    }

    const granted = Boolean(await this.#storage.persist());
    const after = await this.inspect();
    return Object.freeze({
      supported: true,
      requested: true,
      granted: granted || after.persisted === true,
      before,
      after
    });
  }

  async assertCanWrite(additionalBytes = 0, {
    maxUsageRatio = this.#criticalRatio,
    minFreeBytes = this.#minFreeBytes
  } = {}) {
    const additional = bytes(additionalBytes, 'additionalBytes');
    const maximumRatio = ratio(maxUsageRatio, 'maxUsageRatio');
    const minimumFree = bytes(minFreeBytes, 'minFreeBytes');
    const status = await this.inspect();

    if (!status.supported || status.usageBytes === null || status.quotaBytes === null || status.quotaBytes === 0) {
      return Object.freeze({
        ...status,
        additionalBytes: additional,
        projectedUsageBytes: null,
        projectedFreeBytes: null,
        projectedUsageRatio: null
      });
    }

    const projectedUsageBytes = status.usageBytes + additional;
    const projectedFreeBytes = Math.max(0, status.quotaBytes - projectedUsageBytes);
    const projectedUsageRatio = projectedUsageBytes / status.quotaBytes;

    if (projectedUsageBytes > status.quotaBytes || projectedUsageRatio > maximumRatio || projectedFreeBytes < minimumFree) {
      throw ocError(ErrorCodes.RESOURCE_EXHAUSTED, 'Browser storage policy rejected projected write', {
        usageBytes: status.usageBytes,
        quotaBytes: status.quotaBytes,
        additionalBytes: additional,
        projectedUsageBytes,
        projectedFreeBytes,
        projectedUsageRatio,
        maxUsageRatio: maximumRatio,
        minFreeBytes: minimumFree,
        persisted: status.persisted
      });
    }

    return Object.freeze({
      ...status,
      additionalBytes: additional,
      projectedUsageBytes,
      projectedFreeBytes,
      projectedUsageRatio
    });
  }
}
