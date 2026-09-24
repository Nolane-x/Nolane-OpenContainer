# Implementation Status

## Wave 1 — foundation runtime

Implemented:

- S1 lifecycle kernel, boot idempotence, teardown/draining, health.
- S2 generation-checked in-memory VFS with containment, symlinks, atomic logical rename, snapshots.
- S3 bounded virtual process/stream supervisor with resource leases and logical signals.
- S4 frozen package-lock v2/v3 compiler into content/instance/location identities and command index.
- S5 deny-by-default direct-CORS capability evaluator with canonical URL checks and local/loopback gates.
- S6 virtual HTTP/preview route authority with owner/epoch stale-route rejection.
- S7 snapshot/restore plus streaming OpenContainer NDJSON export/import prototype.
- S8 bounded resource governor.
- S9 stable runtime error envelopes, redaction, diagnostic journal.
- Internal protocol and frozen toolchain identity contracts.
- Browser-playground shell with COOP/COEP headers.
- Dependency-free Node contract/integration tests.

Still required before production closure:

1. Browser Worker execution authority for untrusted guest JS and sync-RPC profile.
2. OPFS-backed WorkspaceFS/PackageFS authority using the proven transaction/recovery model.
3. Artifact fetch/cache/install path with integrity and archive hardening.
4. Node 24 core compatibility, CJS/ESM resolver, VirtualNodeModulesFS.
5. Exact Lightning CSS 1.33.0 local artifact retention + differential.
6. Rolldown 1.2.9 exact runtime integration.
7. Vite 8.3 C1 production-build profile, then C2 dev/HMR profile.
8. Clean unmanaged Chromium PC-A/PC-B execution.
9. Weak-device/browser matrix, long-run reliability, security review, legal/FTO, release closure.

`production_closed = false` until those gates produce evidence.


## Wave 2 — browser execution authority

Started and contract-tested:

- internal Worker RPC authority with explicit session + epoch identity;
- bounded in-flight request queue;
- stale-response rejection across worker restart;
- deterministic rejection of in-flight work during restart/close;
- browser-Worker-compatible `postMessage` / message-event adapter shape.

Evidence boundary:

- this is protocol/authority implementation evidence;
- it is **not** a clean-browser execution PASS;
- arbitrary guest-JS Worker isolation, SharedArrayBuffer sync-RPC and PC-A/PC-B remain open.

OPFS advancement in this wave:

- dual-slot OPFS checkpoint authority implemented behind S7/S2;
- payload-first publication with SHA-256 identity;
- alternating manifest A/B commit points;
- recovery falls back from a corrupt/torn newest payload or manifest;
- stale-generation publication is rejected;
- current tests use a deterministic OPFS-handle model, so real-browser OPFS durability remains an open promotion gate.


## Package artifact authority advancement

Implemented behind S4/S2:

- network-authorized artifact fetch;
- hard maximum compressed artifact size;
- SHA-512/SHA-256 SRI verification before publication;
- tar header checksum validation;
- required npm-style `package/` prefix;
- path traversal / absolute path / backslash rejection;
- symlink, hardlink and special-device entries rejected in the initial profile;
- file-count and expanded-byte ceilings;
- one VFS transaction publishes a validated archive.

Evidence boundary:

- archive/security semantics are contract-tested;
- broad npm compatibility, PAX/GNU long-name profiles and registry corpus acceptance remain open;
- exact `lightningcss-wasm@1.33.0` local bytes remain open because this execution environment could not resolve the npm registry.


## ResolverIndex / VirtualNodeModulesFS advancement

Implemented behind S4/S2:

- memory-backed VirtualNodeModulesFS composed over WorkspaceFS;
- readFile/readdir/stat/lstat/readlink/realpath projection;
- package and .bin/workspace-style symlink projection;
- Node-style nearest nested node_modules lookup;
- package self-reference and package imports;
- package exports exact/pattern/conditional targets;
- separate CommonJS and ESM relative-resolution behavior;
- CommonJS .js/.json extension and folder/index fallback;
- ESM mandatory exact relative filenames and directory-import rejection;
- no-addons profile rejects native .node targets;
- default no-addons condition sets: node+import for ESM, node+require+module-sync for CJS;
- CommonJS cache identity by canonical filename;
- ESM cache identity by canonical file URL including query/fragment;
- resolver cache is generation-keyed so workspace mutation cannot silently reuse an older result.

Evidence boundary:

- the selected semantic court is contract-tested in OpenContainer and follows the frozen Node 24 profile;
- this does not yet claim the full Node 24 resolver court;
- syntax detection, JSON import attributes, Wasm modules, custom conditions fuzzing, Windows/path edge cases, preserve-symlinks-main and full Node error parity remain open;
- module resolution is now implemented, but full CJS/ESM module execution/loading remains a separate gate.


### Exact Node 24.21.0 differential receipt

CI now builds the same selected package graph twice:

- a physical Node/npm-style tree consumed by the exact Node `v24.21.0` oracle;
- an OpenContainer RuntimePackageGraph/VirtualNodeModulesFS projection.

The court compares selected CommonJS and ESM results for relative extension fallback, conditional exports, root/nested dependency lookup, package imports, package self-reference, default symlink realpath behavior and ESM query URL identity.

This is a selected differential receipt, not full Node compatibility closure.


## CommonJS execution advancement

Implemented behind S4/S3:

- CommonJS wrapper execution with `exports`, `require`, `module`, `__filename`, and `__dirname`;
- JSON loading;
- canonical-filename module cache;
- cycle behavior through cache-before-execute;
- failed-module cache eviction;
- injected Node-builtin compatibility table;
- `require.resolve()` over the OpenContainer ResolverIndex;
- explicit rejection of unimplemented synchronous `require(ESM)`.

Security boundary:

- dynamic CommonJS source execution is **disabled by default**;
- the built-in evaluator must be explicitly enabled and is intended only for a hardened guest worker;
- trusted UI/main-thread code must not enable guest dynamic execution;
- browser guest-worker isolation and CSP evidence remain open.


## Frozen install / immutable PackageContent advancement

Implemented behind S4:

- verified package artifacts can now be ingested against compiled lockfile locations;
- SRI/archive validation completes before immutable PackageContent publication;
- artifact package name/version is checked against the lockfile before content enters the store;
- identical immutable content is stored once and reused by multiple logical PackageInstances;
- RuntimePackageGraph publication fails closed if any non-link package content is missing;
- workspace lockfile links are projected as virtual symlinks;
- a complete frozen graph mounts directly into VirtualNodeModulesFS without a physical node_modules tree;
- recompiling the lockfile invalidates the prior mounted package projection/resolver.

This materially connects the previously separate LockfileCompiler, package artifact hardening, PackageContent identity, VirtualNodeModulesFS and ResolverIndex paths.

Still open: real npm corpus breadth, peer/optional/script policy, content persistence in OPFS PAFS, concurrent immutable-cache dedupe and streaming browser installation.


## Node core compatibility advancement

The first builtins are now implemented rather than merely resolvable:

- `node:path` / `path` POSIX profile with normalize, resolve, join, relative, dirname, basename, extname, parse, format and standard constants;
- `node:events` / `events` EventEmitter profile with synchronous emit ordering, once/prepend/remove semantics, listener inspection and unhandled-error behavior;
- CommonJS loaders receive these builtins automatically, while callers can explicitly override entries.

A selected POSIX path differential runs against the exact Node CI oracle. This is not a claim of full `path` or `events` API closure; win32 path, advanced EventEmitter helpers/captureRejections and broader error parity remain open.


## Toolchain-facing runtime builtins

The compatibility layer now exposes additional browser-native Node surfaces needed by real tooling:

- a bounded `Buffer` subset for UTF-8/hex/base64, allocation, concatenation and byte identity;
- `node:url` file URL conversion and WHATWG URL classes;
- a logical `process` context with isolated explicit env, cwd/chdir, argv, nextTick, hrtime and a POSIX compatibility platform;
- VFS-backed `node:fs` synchronous read/stat/readdir/realpath/readlink plus controlled workspace mutations;
- `node:fs/promises` over the same authority;
- CommonJS wrapper globals now receive the compatibility `Buffer` and `process` objects instead of depending on accidental host globals.

Authority/security rules:

- fs reads use the composite WorkspaceFS + VirtualNodeModulesFS view;
- fs writes are sent only to mutable WorkspaceFS, never immutable PackageContent;
- process.env begins empty unless variables are explicitly supplied by the runtime;
- the logical `linux` platform identifies the V1 POSIX compatibility profile, not the browser host OS;
- these are selected compatibility subsets, not full Node API claims.

Selected `node:url` and `node:fs` behavior is differentially checked against the exact Node CI oracle.


## CommandIndex execution advancement

The package command path is no longer metadata-only:

- `node:module` / `module` now provides a loader-bound `createRequire()`, `isBuiltin()` and builtin-module inventory;
- CommonJS shebangs are stripped before wrapper execution;
- logical process stdout/stderr and `process.exit()` semantics are bridged into ProcessSupervisor;
- package CommandIndex entries can be registered as virtual runtime commands;
- command execution receives isolated argv/env/cwd plus captured console/stdout/stderr;
- command disposal unregisters the virtual bins;
- ESM bins remain fail-closed until the ESM execution gate is implemented.

This connects S4 package metadata to S3 process execution without creating a new product surface. Native host process execution is still not used.
