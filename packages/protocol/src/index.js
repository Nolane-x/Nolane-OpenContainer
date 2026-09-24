export const ErrorCodes = Object.freeze({
  INVALID_STATE: 'OC_INVALID_STATE',
  INVALID_ARGUMENT: 'OC_INVALID_ARGUMENT',
  PATH_ESCAPE: 'OC_PATH_ESCAPE',
  INTERNAL_PATH: 'OC_INTERNAL_PATH',
  STALE_GENERATION: 'OC_STALE_GENERATION',
  NOT_FOUND: 'OC_NOT_FOUND',
  NOT_DIRECTORY: 'OC_NOT_DIRECTORY',
  IS_DIRECTORY: 'OC_IS_DIRECTORY',
  RESOURCE_EXHAUSTED: 'OC_RESOURCE_EXHAUSTED',
  OUTPUT_LIMIT: 'OC_OUTPUT_LIMIT',
  COMMAND_NOT_FOUND: 'OC_COMMAND_NOT_FOUND',
  NETWORK_DENIED: 'OC_NETWORK_DENIED',
  PREVIEW_STALE: 'OC_PREVIEW_STALE',
  TOOLCHAIN_UNSUPPORTED: 'OC_TOOLCHAIN_UNSUPPORTED',
  TOOLCHAIN_SKEW: 'OC_TOOLCHAIN_SKEW',
  DIGEST_MISMATCH: 'OC_DIGEST_MISMATCH',
  BUILTIN_UNAVAILABLE: 'OC_BUILTIN_UNAVAILABLE',
  REQUIRE_ESM_UNSUPPORTED: 'OC_REQUIRE_ESM_UNSUPPORTED',
  MODULE_EXECUTION_DISABLED: 'OC_MODULE_EXECUTION_DISABLED',
  MODULE_NOT_FOUND: 'OC_MODULE_NOT_FOUND',
  INVALID_MODULE_SPECIFIER: 'OC_INVALID_MODULE_SPECIFIER',
  INVALID_PACKAGE_CONFIG: 'OC_INVALID_PACKAGE_CONFIG',
  INVALID_PACKAGE_TARGET: 'OC_INVALID_PACKAGE_TARGET',
  PACKAGE_PATH_NOT_EXPORTED: 'OC_PACKAGE_PATH_NOT_EXPORTED',
  PACKAGE_IMPORT_NOT_DEFINED: 'OC_PACKAGE_IMPORT_NOT_DEFINED',
  UNSUPPORTED_DIRECTORY_IMPORT: 'OC_UNSUPPORTED_DIRECTORY_IMPORT',
  NATIVE_ADDON_UNSUPPORTED: 'OC_NATIVE_ADDON_UNSUPPORTED',
  ARTIFACT_INTEGRITY: 'OC_ARTIFACT_INTEGRITY',
  ARTIFACT_TOO_LARGE: 'OC_ARTIFACT_TOO_LARGE',
  ARCHIVE_UNSAFE: 'OC_ARCHIVE_UNSAFE',
  WORKER_STALE: 'OC_WORKER_STALE',
  WORKER_CLOSED: 'OC_WORKER_CLOSED',
  IMPORT_INVALID: 'OC_IMPORT_INVALID'
});

export class OpenContainerError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'OpenContainerError';
    this.code = code;
    this.details = details;
  }
  toJSON() { return { name: this.name, code: this.code, message: this.message, details: this.details }; }
}

export function ocError(code, message, details) { return new OpenContainerError(code, message, details); }
export function assertOc(condition, code, message, details) { if (!condition) throw ocError(code, message, details); }
export function asErrorEnvelope(error) {
  if (error instanceof OpenContainerError) return error.toJSON();
  return { name: 'Error', code: 'OC_INTERNAL', message: error && error.message ? error.message : String(error) };
}
