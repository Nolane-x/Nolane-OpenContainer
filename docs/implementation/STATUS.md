# Implementation Status

## Current promotion ledger — 2026-09-26

This section is the authoritative current-state ledger. Later sections preserve incremental promotion history; an older `OPEN` statement is historical when this ledger explicitly supersedes it.

Promoted in the clean Chrome product/browser path:

- SharedArrayBuffer synchronous guest RPC transport with bounded mailbox/timeout semantics;
- browser-native Node builtin bridge sufficient for the promoted Vite court;
- exact retained `lightningcss-wasm@1.33.0` JS/WASM execution;
- exact `@rolldown/browser@1.2.9` WASI/N-API/Worker execution;
- Vite `8.3.0` C1 production-build court, including config loading/plugins, TypeScript, Lightning CSS, assets, source maps, rebuild/config reload, failure atomicity and deterministic normalized output;
- Vite C2 dev/HMR court, including transformed index/TypeScript/`/@vite/client`, virtual HTTP, HMR update/failure/reconnect/recovery, same-port epoch restart, Service Worker preview rehydration and explicit dependency optimization;
- dependency optimization materializes an actual `.vite/deps` artifact through the Rolldown browser memfs ↔ OpenContainer VFS bridge rather than faking metadata.
- OPFS persistence safety now includes dual-slot fallback, origin-wide Web Locks, unreachable-payload GC, browser quota/persistence telemetry, projected-write preflight, one lock-coordinated GC retry under storage pressure, and fail-closed quota rejection before publication.
- immutable PackageContent can now persist in OPFS as verified source tarballs, hydrate only against frozen-lockfile authority, reopen with zero network refetch, recover from a forced content-entry eviction via exactly one authoritative refetch and repersist, reject self-authorized cache replacement, and collapse concurrent publication through per-content Web Locks.
- mutable WorkspaceFS now has a public SDK OPFS product profile: `OpenContainer.boot({ workspacePersistence })` restores before ready, explicit `persistWorkspace()` / `collectWorkspaceGarbage()` preserve authority boundaries, and restored VFS generations remain monotonic so a reopened runtime can continue checkpointing without generation divergence.
- persistent PackageContent now has a public SDK OPFS product profile: `OpenContainer.boot({ packagePersistence })` opens `OpfsPackageContentStore`, binds it as the default package content authority, and lets `createFrozenInstaller()` hydrate frozen-lockfile-authorized content after reopen without manual store wiring while preserving explicit per-installer overrides.
- browser package policy now resolves required peers into the frozen closure, keeps optional peers explicit, rejects missing required peers, and denies lifecycle install scripts by default; explicit skip/ignore policies remain auditable and never execute host lifecycle scripts.
- the browser package corpus now also includes an independent `es-module-lexer@3.0.2` court: frozen-lockfile fetch/SRI, immutable install, VNFS mount, native ESM publication and real `init()` + `parse()` execution in a cross-origin-isolated Dedicated Worker.
- the browser package corpus now also exercises exact `nanoid@3.3.19` conditional exports: the same frozen install resolves `nanoid/non-secure` to distinct ESM/CJS targets and executes the ESM subpath in a cross-origin-isolated Dedicated Worker.
- the Dedicated Worker guest now installs a deny-by-default browser capability membrane: direct external/same-origin non-publication fetch, WebSocket/EventSource/WebTransport/XMLHttpRequest, SharedWorker/BroadcastChannel, origin OPFS/StorageManager, Web Locks, IndexedDB, CacheStorage/CookieStore and arbitrary nested Workers are denied; direct fetch remains scoped to the active publication session, and only the retained Rolldown WASI helper is admitted as a nested Worker.
- guest execution deadlines are now destructive resource boundaries: an `OC_WORKER_TIMEOUT` hard-terminates the timed-out Dedicated Worker so runaway CPU code cannot survive behind a rejected RPC; the authority can subsequently create a fresh isolated realm for later work.

Evidence anchors:

- C1 merged to `main` at `47f089e020b5b412f6a4f0880718b8b64963410a`;
- C2 merged to `main` at `118c84660aa5bae7a7d8d991559cad9ce07a068b`;
- final C2 head browser court `f4fed415405dde5434a99f9f5f425290c3a335e2` passed both contract and browser-product-path in CI run #197.
- browser storage policy merged to `main` at `5f3e12aa536e15e6dfc5ae8e8bf874fe2ef740e4` after CI run #205;
- OPFS quota-GC retry court `74bdbab8270e6928f31834fbc9ca453b9bfaf3f0` passed contract + Chrome browser-product-path in CI run #207, including GC-assisted retry, persistent-pressure rejection without manifest advance, and fallback recovery.
- immutable PackageContent court `6800b6742378fecc1152978471b300a0d28c7d04` passed contract + Chrome browser-product-path in CI run #216: 3,826,518-byte Lightning CSS artifact persisted, reopened with `persistentHydrated=1`, `persistentNetworkRefetches=0`, concurrent publication produced exactly one persistent reuse, and C1/C2 remained green.
- package policy court `419a343845ca0c4ff5f41fb5530cf94cb3e73ce6` passed contract + Chrome browser-product-path in CI run #220: Vite closure selected 20 locations, resolved 2 peer edges, recorded 13 optional peer skips, selected no install-script packages, skipped 0 lifecycle scripts, and kept C1/C2 green.
- standalone package corpus court `7bba2e88ef134e0eda815bf66a22d2c3948e5b27` passed contract + Chrome browser-product-path in CI run #225: exact `es-module-lexer@3.0.2` fetched 84,612 bytes, mounted as one package, parsed one static `dep` import plus one `marker` export in a cross-origin-isolated Dedicated Worker, and the following Vite C1/C2 courts remained green.
- PackageContent forced-eviction court `901b027962cf84e47d6e586baca6dd20d5c94572` passed contract + Chrome browser-product-path in CI run #228: deleting the persisted Lightning CSS content entry forced exactly 1 refetch/1 republish, the next reopen hydrated 1 entry with 0 network fetches, package identity remained intact, and C1/C2 stayed green.
- SDK WorkspaceFS persistence court `e08e61383dad7a53f573b79ada3fef799099e7e8` passed contract + Chrome browser-product-path in CI run #232: sequence 1 -> 2 -> reopen -> 3, restored generation remained 3, cross-context Web Locks stayed enabled, GC removed 1 superseded payload while retaining both recovery roots, and all existing C1/C2/package courts remained green.
- SDK PackageContent persistence court `4584eed9b7da6f8a437af3f2dc1890544fc853d1` passed contract + Chrome browser-product-path in CI run #235: default installer hydration after reopen required 0 network fetches and 0 requested contents, hydrated 1 persisted content, mounted 1 exact package, preserved cross-context Web Locks, and left all existing workspace/package/C1/C2 courts green.
- SDK WorkspaceFS corruption-recovery court `78e2435a975bd5d758012237e59c31528a0dd08b` passed contract + Chrome browser-product-path in CI run #238: corrupting sequence 3 forced fallback to sequence/generation 2, the recovered runtime safely republished sequence/generation 3 with a new payload identity, GC collected the corrupt payload, and the republished state survived another reopen.
- conditional package corpus court `9391f61ef6602fcfe059605c0b8ac4c2f3abf3ac` passed contract + Chrome browser-product-path in CI run #241: exact `nanoid@3.3.19` fetched 5,694 bytes, ESM resolved to `/workspace/node_modules/nanoid/non-secure/index.js`, CJS resolved to `/workspace/node_modules/nanoid/non-secure/index.cjs`, and the ESM subpath generated valid IDs inside an isolated worker.
- guest browser-capability isolation court `e97d0a4eebca5f6482afabf500f59771f6f6164b` passed contract + Chrome browser-product-path in CI run #244: page realm stayed hidden; child_process/raw TCP/TLS/HTTPS/unknown host RPC/OPFS/Web Locks/IndexedDB/CacheStorage failed with explicit unavailable errors; external fetch, same-origin bypass, WebSocket, BroadcastChannel and arbitrary nested Worker failed with `OC_NETWORK_DENIED`; active-publication fetch still returned 200 through the Service Worker; all persistence/package/Vite C1/C2 courts remained green.
- runaway guest resource-abuse court `114a416682e03bca90fc2eee6d7e14aacca0f5f4` passed contract + Chrome browser-product-path in CI run #247: a top-level infinite loop hit `OC_WORKER_TIMEOUT`, the timed-out realm was hard-terminated, and the same authority successfully executed a safe module on a fresh Worker while all persistence/package/Vite regression courts remained green.

Still required before production closure:

1. Remaining guest-isolation hardening beyond the promoted direct browser-capability membrane and runaway-CPU deadline kill: CSP/origin separation, memory/side-channel abuse controls, and broader Node 24 compatibility.
2. Extended WorkspaceFS/PackageFS durability campaigns beyond the promoted public SDK persistence profiles; WorkspaceFS restore/checkpoint/GC plus corrupt-newest fallback-and-continuation, persistent PackageContent hydration/forced-eviction recovery, policy/GC/quota preflight and multi-tab/Web Locks are promoted.
3. Broader browser package-install corpus beyond the promoted Vite/Rolldown/Lightning CSS + standalone `es-module-lexer` and conditional-export `nanoid` courts; peer/optional/script policy, persistent immutable PackageContent, lockfile-authoritative hydration and concurrent cache dedupe are promoted.
4. PC-A/PC-B target-device and browser matrix beyond CI Chrome.
5. Weak-device/resource-budget, long-run/plateau, fault/security and release-packaging campaigns.
6. Dependency/test-corpus licensing plus FTO/legal closure before a commercial production claim.

`production_closed = false` until those remaining gates produce evidence.


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

Historical Wave 1 closure list (superseded by the current promotion ledger above): the original list included SAB sync RPC, Lightning CSS browser execution, Rolldown browser execution and Vite C1/C2. Those compatibility gates are now promoted; the unresolved production campaigns are tracked in the current ledger.


## Wave 2 — browser execution authority

Started and contract-tested:

- internal Worker RPC authority with explicit session + epoch identity;
- bounded in-flight request queue;
- stale-response rejection across worker restart;
- deterministic rejection of in-flight work during restart/close;
- browser-Worker-compatible `postMessage` / message-event adapter shape.

Evidence boundary:

- protocol/authority implementation remains contract-tested;
- Dedicated Worker + disposable Service Worker native-ESM execution now has a clean Chrome CI PASS;
- generation restart and stale-session rejection are exercised in-browser;
- SharedArrayBuffer synchronous RPC, broader Node builtin execution and PC-A/PC-B target-device campaigns remain open.

OPFS advancement in this wave:

- dual-slot OPFS checkpoint authority implemented behind S7/S2;
- payload-first publication with SHA-256 identity;
- alternating manifest A/B commit points;
- recovery falls back from a corrupt/torn newest payload or manifest;
- stale-generation publication is rejected;
- deterministic OPFS-handle model tests remain;
- Chrome CI now also executes real OPFS dual-slot checkpoint/reopen recovery, corrupts the newest payload and verifies fallback to the older valid generation;
- long-run persistence, quota/eviction and multi-tab/Web Locks campaigns remain open.


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
- exact `lightningcss-wasm@1.33.0` npm tarball is now retained under `toolchain/vendor/`, with tarball identity and inner WASM compile/shape re-verified on every CI run; browser execution remains open.


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
- direct browser-capability guest isolation is promoted; CSP/origin-separation evidence remains open.


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


## Exact Rolldown artifact / WasmArtifactManager advancement

The exact Rolldown v1.2.9 official GitHub Actions WASI artifact was re-downloaded during implementation and independently re-verified:

- GitHub Actions artifact ID `10446514923`;
- ZIP SHA-256 `277fb9d391a2a48763b70d5ec297a1c9a10e9ee4eb9619e797e68cd4cfc852c7`;
- release payload `rolldown-binding.wasm32-wasi.wasm`;
- payload size `10,845,151` bytes;
- payload SHA-256 `629aa10c37a9920cd5729a35af148983c881f4ff9edd6368a7d63b5acbf89dc2`;
- WebAssembly compile PASS;
- 118 imports / 130 exports;
- import namespace counts `env=93, emnapi=1, napi=2, wasi_snapshot_preview1=21, wasi=1`.

Implementation now includes a WasmArtifactManager that verifies byte length + SHA-256 before compilation, validates compiled module shape, deduplicates concurrent compile work and caches only verified compiled modules.

The exact binary is not committed into the source tree in this wave. The machine-readable provenance receipt is committed under `toolchain/artifacts/`.

Evidence boundary remains strict: exact-byte local compile is now reverified, but browser execution, WASI/N-API instantiation, Rolldown JS-binding integration and VITE-C1 remain OPEN.


## Lightning CSS retained-artifact promotion

P6-02 has materially advanced from external identity only to retained local executable artifact evidence:

- exact npm package `lightningcss-wasm@1.33.0` retained as `toolchain/vendor/lightningcss-wasm-1.33.0.tgz`;
- tarball bytes `3,826,518`;
- tarball SHA-256 `266866c1b0efd7ca5307fe312411e4f1895b997086fb76f392ec5b60aadf31c8`;
- inner `lightningcss_node.wasm` bytes `15,844,785`;
- inner WASM SHA-256 `479c64bb651164b6fd9a834055e65ab507d3e39f8d8a8b683b7e83787a69e7b1`;
- WebAssembly compile PASS;
- 48 imports / 13 exports / `env=48`.

CI now reopens the retained tarball, validates its exact digest, extracts the WASM through OpenContainer's hardened tar reader, revalidates the inner digest and compiles it through WasmArtifactManager.

This closes the local-byte/compile portion only. Lightning CSS JS glue execution, browser execution and VITE-C1 remain OPEN.


## Lightning CSS JS-glue differential

The retained exact `lightningcss-wasm@1.33.0` package is now promoted beyond raw WASM compilation:

- a production verifier opens the retained npm tarball, rechecks tarball identity, validates package name/version and required runtime files, and recompiles the inner WASM through WasmArtifactManager;
- CI materializes only files from those verified retained bytes;
- the package's bundled exact `napi-wasm` dependency is used rather than a repository-installed substitute;
- exact `wasm-node.mjs` and browser/default `index.mjs` are both executed;
- multiple CSS transform fixtures compare minified code, source maps and warnings between the Node and browser/default glue paths;
- `transformStyleAttribute` is also compared.

This establishes local JS-glue + WASM execution/differential evidence for Lightning CSS 1.33.0. It is still not an unmanaged-browser receipt, and VITE-C1 remains open.


## Rolldown browser artifact promotion

The exact `@rolldown/browser@1.2.9` npm package is now retained and permanently tied to the official v1.2.9 GitHub Actions browser artifact:

- retained npm tarball bytes `3,809,446`;
- retained npm tarball SHA-256 `9accf3cdfe3d2287ad7d5f49cd2cfcddbc9c112abfcbc295863e401ef44b8576`;
- official GitHub Actions artifact ID `10447416443`;
- official artifact ZIP SHA-256 `44ab2d4a313065c8fb448433877a4a50628aca0a4a972a6f11660ca8f5002ac7`;
- all 63 published `dist/` files are byte-identical to the official artifact via normalized manifest SHA-256 `75492b477ad45162d0f92543ddb3fb0ae9b3a727ff652ef251b8532cb53f1308`;
- inner WASI payload remains exact SHA-256 `629aa10c37a9920cd5729a35af148983c881f4ff9edd6368a7d63b5acbf89dc2`.

Permanent CI now verifies package identity, exact dependency declarations, complete dist-tree concordance, key-file hashes and WASM compile/shape through WasmArtifactManager.

Still open: retaining/proving the exact emnapi/@napi-rs runtime dependency closure, executing the browser binding, browser Worker/thread integration and VITE-C1.


## Rolldown WASI/browser execution court

The exact retained Rolldown browser artifact is now exercised rather than only hashed/compiled.

Dependency closure is pinned in `package-lock.json` and recorded in `toolchain/artifacts/rolldown-runtime-deps-1.2.9.json`:

- `@emnapi/core@2.0.0-alpha.5`;
- `@emnapi/runtime@2.0.0-alpha.5`;
- `@napi-rs/wasm-runtime@1.2.4`;
- transitive `@emnapi/wasi-threads@2.1.0`, `@tybys/wasm-util@0.10.4`, and `tslib@2.8.1` are integrity-pinned by npm lock.

The execution court materializes only the retained `@rolldown/browser@1.2.9` bytes, imports `dist/index.browser.mjs`, forces the WASI browser binding, supplies a browser-Worker compatibility adapter backed by Node worker_threads only for the exact-Node oracle, and bundles an in-memory multi-module fixture with dynamic import and source maps.

The court requires:

- binding target `wasm32-wasi`;
- successful programmatic Rolldown bundle;
- dynamic code splitting;
- source map emission;
- deterministic normalized output across two identical builds;
- explicit WASI binding disposal.

This is strong local integration evidence for Rolldown JS glue + WASI/N-API/thread runtime. It is not yet a clean unmanaged-browser PC-B receipt and does not by itself close VITE-C1.


## VITE-C1 exact native-oracle court

The exact C1 root composition is now lock-pinned:

- `vite@8.3.0`;
- `rolldown@1.2.9`;
- `lightningcss -> npm:lightningcss-wasm@1.33.0`.

The C1 oracle intentionally uses no native Rolldown fallback. Before importing Vite it sets the generated N-API loader to strict `wasm32-wasi`, re-hashes the installed Rolldown WASI loader/payload against the retained official artifact, and re-hashes the installed Lightning CSS WASM against the retained exact package.

The production-build court then requires:

- a TypeScript `vite.config.ts` loaded through Vite's default config-loader path;
- a local transform plugin that materially changes output;
- default client CSS minification remains enabled, does not select literal `'esbuild'`, and the exact `lightningcss-wasm@1.33.0` alias is the installed Lightning CSS implementation;
- TypeScript application transform;
- emitted asset;
- emitted JS source map;
- minified CSS;
- manifest generation;
- rebuild after source edit;
- config reload after config edit;
- byte-deterministic normalized dist output across two identical final builds;
- observed Rolldown binding target `wasm32-wasi`.

Passing this court closes the exact-Node/native-oracle composition of VITE-C1. A separate OpenContainer guest/browser execution court remains required before VITE-C1 is promoted at product level.


## Browser-native ESM publication authority

The first product-path ESM layer is implemented behind S4/S3 without embedding another JavaScript engine:

- `es-module-lexer@3.0.2` is exact-lock-pinned only for import-syntax discovery;
- OpenContainer ResolverIndex remains the single authority for relative, bare-package, package-import, self-reference and builtin resolution;
- canonical VFS paths are mapped to stable per-session publication URLs;
- static imports, reexports and statically-analyzable dynamic imports are rewritten to those stable URLs;
- nonliteral dynamic imports are routed to an explicit `__opencontainer_dynamic_import__` helper contract instead of guessing a path;
- query/fragment identities are preserved in publication URLs and therefore in the native module cache;
- source/defer phase imports fail closed until independently promoted;
- builtin modules are synthetic publication routes supplied by an internal builtin-source provider;
- publication caches are keyed by authoritative filesystem generation;
- `response()` emits Service-Worker-ready JavaScript responses, but the edge never owns VFS truth.

The exact-Node oracle materializes the same published graph to `file:` URLs and lets the native ESM engine prove cycles, live bindings, top-level await, dynamic import and query-separated module identities. Product browser execution still requires wiring this authority to the Dedicated Worker + disposable Service Worker edge.


## Browser product-path execution harness

Implementation now includes the product-path composition needed to promote the native ESM authority into a real browser realm:

- a disposable Service Worker module edge that retains no VFS/package truth;
- authority requests are broadcast back to live Window clients and only the matching publication session may answer;
- a page-side bridge converts NativeEsmPublicationAuthority responses into same-origin JavaScript responses;
- a Dedicated Worker guest executor imports the published native ESM graph;
- nonliteral dynamic imports round-trip to the authoritative page resolver before native import();
- WorkerRpcAuthority supplies bounded host -> guest request semantics while a separate guest -> host resolve channel preserves resolver authority;
- stale/unowned publication sessions fail closed at the Service Worker edge;
- the playground server exposes only required source/dependency routes with COOP/COEP/CORP and no-store semantics.

The dedicated browser CI now has a clean Chrome 153 PASS using a fresh browser profile and real-time DevTools Protocol harness. The promoted receipt proves:

- page and Dedicated Worker are cross-origin isolated;
- first native ESM guest execution returns the expected result;
- Service Worker edge serves the publication with session proof;
- a VFS edit followed by a new publication/Worker observes the new generation;
- the older closed session returns 504 rather than stale code;
- real OPFS checkpoint/recovery falls back after deliberate newest-payload corruption;
- exact retained Lightning CSS tarball is fetched through network capability checks, SRI-verified, ingested into immutable PackageContent, mounted into VirtualNodeModulesFS and resolved in-browser.

The browser harness itself was corrected to use real-time Chrome DevTools Protocol rather than virtual-time DOM dumping, because Service Worker lifecycle did not reliably progress under the old harness.

This is product-path Chrome CI evidence. It does not silently close PC-A/PC-B target-device campaigns, SharedArrayBuffer sync-RPC, VITE-C1 guest/browser execution or C2/HMR.


## Browser package installer promotion

The retained-package installation path now has a real-browser receipt rather than Node-only evidence.

Chrome CI performs the following through OpenContainer authorities:

- enables loopback only for the explicit acceptance runtime;
- grants a GET capability only to the retained toolchain vendor path;
- fetches the exact retained `lightningcss-wasm@1.33.0` tarball through PackageArtifactAuthority;
- uses manual redirect handling so every redirect hop must independently pass NetworkAuthority before it is fetched;
- verifies exact npm SRI;
- compiles the frozen lockfile graph;
- ingests the tarball into immutable PackageContent;
- mounts the graph into VirtualNodeModulesFS;
- resolves the installed package through ResolverIndex.

Observed browser receipt:

```text
tarball bytes   3,826,518
package files   19
contentCount    1
resolved path   /workspace/node_modules/lightningcss-wasm/wasm-node.mjs
```

The redirect-capability bypass present in the earlier fetch implementation is closed: automatic redirect following has been replaced by fail-closed manual hop authorization.

This does not yet prove broad npm corpus compatibility, lifecycle scripts, peer/optional policy or persistent PackageContent in OPFS.


## SharedArrayBuffer synchronous guest RPC

The browser guest path now includes a bounded synchronous Worker -> host RPC primitive intended for Node-style synchronous compatibility APIs:

- Dedicated Worker allocates a bounded SharedArrayBuffer mailbox;
- guest posts the mailbox plus method/payload to the page-side BrowserGuestWorkerAuthority;
- page authority executes an explicit sync host handler, serializes a bounded JSON response and commits it with Atomics.store/notify;
- guest blocks with Atomics.wait and a hard timeout, then decodes success/error;
- oversized responses fail with `OC_OUTPUT_LIMIT`;
- missing/unsupported host handlers fail closed;
- async WorkerRpcAuthority remains separately bounded and timeout-protected.

The Chrome product-path court reads `/workspace/src/sync.txt` synchronously from native guest ESM through this SAB path, edits the VFS, restarts publication/Worker and proves the second generation returns the new value.

This primitive does not by itself claim complete Node synchronous builtin coverage. It is the transport needed to implement those APIs without embedding a second JS engine.


## Native browser Node builtin bridge

The native ESM product path now promotes an initial Node builtin subset rather than merely resolving `node:` specifiers:

- `node:fs` and `node:fs/promises` project read/stat/readdir/realpath/readlink and controlled WorkspaceFS mutation through bounded SharedArrayBuffer RPC;
- `node:path` / `node:path/posix` use the same logical process cwd as the host compatibility profile;
- `node:process` exposes isolated env/argv/platform plus host-authoritative cwd/chdir/hrtime/uptime;
- `node:buffer` and `node:events` reuse trusted browser-native compatibility implementations;
- `node:url` exposes WHATWG URL plus file-path conversion through the host compatibility profile;
- unsupported builtins such as `node:crypto` remain fail-closed.

The Chrome acceptance fixture now imports `node:fs` and `node:path` from native guest ESM and performs the generation-sensitive synchronous read through those public compatibility surfaces rather than calling an internal RPC helper directly.

This is an initial builtin court, not full Node 24 API closure. `node:module/createRequire`, streams, crypto, os, util, timers, child_process policy and broader error parity remain open.


## Frozen graph bulk installer

FrozenInstallAuthority now installs a compiled lock graph as a bounded operation rather than requiring one manual ingest call per package:

- deduplicates fetches by immutable contentId even when the lockfile contains multiple logical PackageInstances;
- requires each non-link node to have a frozen resolved URL and integrity;
- uses PackageArtifactAuthority for capability-checked, SRI-verified fetches;
- supports bounded fetch concurrency;
- supports AbortSignal cancellation;
- emits progress receipts without publishing a partial VNFS graph;
- mountFrozenGraph still fails closed until all required immutable content exists.

The real-browser retained-package acceptance now uses `installAll()`, so the promoted Chrome path covers the product installer API rather than a test-only manual ingestion sequence.


## Browser-target dependency closure

PackageGraphAuthority now retains lockfile dependency/optional/peer metadata and can select a physical dependency closure for explicit roots.

The browser profile defaults to required dependencies only:

- Node-style nested/hoisted lockfile locations are resolved from each package location;
- optionalDependencies are omitted unless explicitly requested;
- `inBundle` lockfile nodes are retained as logical dependency locations but are not fetched/published as separate PackageContent because their bytes live inside the parent artifact;
- FrozenInstallAuthority accepts a selected location set and an artifact URL resolver, enabling deterministic self-hosted/vendor mirrors without weakening SRI;
- the current Vite 8.3.0 closure court includes Vite/Rolldown/Lightning CSS/PostCSS/Tinyglobby dependencies while excluding Rolldown's platform-native optional bindings and fsevents.

This is the package-selection substrate for the upcoming VITE-C1 browser guest court.


## Vite browser dependency installation court

The clean Chrome acceptance now advances beyond a single retained package and attempts the exact frozen Vite 8.3.0 required-dependency closure:

- browser reads the repository's frozen package-lock;
- PackageGraphAuthority selects the `vite` required closure with optional native packages excluded;
- NetworkAuthority explicitly grants GET only to the npm registry origin for this court;
- PackageArtifactAuthority fetches every selected external tarball with manual redirect authorization and exact lockfile SRI;
- FrozenInstallAuthority performs bounded concurrent content installation;
- `inBundle` content is not fetched twice;
- the selected graph is mounted into VirtualNodeModulesFS and Vite must resolve as exact 8.3.0.

This court is intentionally before Vite execution: it separates package acquisition/corpus compatibility failures from Node-builtin/module-execution failures in the subsequent VITE-C1 guest court.


### Dynamic optional dependency semantics

Native ESM publication no longer promotes every statically-analyzable dynamic import into an eager required graph edge.

If a literal dynamic import resolves, it is still rewritten to the stable publication URL and included in graph evidence. If it is a missing package, publication rewrites the call through the authoritative runtime dynamic-import helper instead of failing graph construction. The same dependency will still fail with `OC_MODULE_NOT_FOUND` if that branch is actually executed.

This is required for packages such as Vite that contain optional feature loaders (for example optional config-loader peers) in code paths that are not used by the selected runtime profile.


## Native browser node:module bridge

The native ESM compatibility profile now publishes an initial `node:module` surface required by Vite:

- `builtinModules` and `isBuiltin()`;
- `Module` compatibility constructor metadata;
- `createRequire()` / `createRequireFromPath()`;
- synchronous `require.resolve()` routed through the authoritative OpenContainer ResolverIndex;
- publication URLs are mapped back to their canonical VFS issuer paths before resolution;
- `require.cache`, `require.extensions` and `require.main` compatibility shapes are exposed.

Security boundary: browser-native `require()` execution itself still fails closed. OpenContainer does not execute guest CommonJS on the trusted page realm merely to satisfy `createRequire`. The next execution court will promote only the CJS behavior actually required by the selected Vite path.


## Native browser crypto compatibility

The Vite browser graph now has a bounded `node:crypto` profile backed by browser primitives:

- `getRandomValues()`, `randomUUID()` and `randomBytes()` use Web Crypto entropy;
- `hash()` and a bounded `createHash()` use the page authority's Web Crypto digest through synchronous guest RPC;
- SHA-1/SHA-256/SHA-384/SHA-512 digest names are accepted;
- `timingSafeEqual()` uses a full-length byte comparison after enforcing equal lengths;
- `webcrypto` and `subtle` expose the browser-native Web Crypto objects;
- Buffer compatibility now includes Node-style base64url encode/decode required by Vite's websocket-token construction;
- `X509Certificate` remains explicit fail-closed because HTTPS certificate parsing is outside the current C1 browser profile.

This promotes the crypto operations required by Vite without pretending to implement the full Node crypto module.


## Native browser perf_hooks

The native browser compatibility layer now publishes `node:perf_hooks` with browser-native `performance` and available Performance API constructors. Vite's selected C1 graph uses `performance.now()`, so no host RPC or synthetic clock is required. Node-only event-loop histogram APIs remain explicit fail-closed.


## Native browser util compatibility

The Vite browser profile now publishes the selected `node:util` behaviors exercised by Vite:

- `promisify()` including the standard custom symbol contract;
- `isDeepStrictEqual()` for structured configuration values;
- `inspect()`, `format()` and `formatWithOptions()` for diagnostics;
- `stripVTControlCharacters()`;
- `parseEnv()` for the selected dotenv-style configuration path;
- bounded `types`, `deprecate`, `inherits` and `callbackify` helpers;
- browser-native TextEncoder/TextDecoder exports.

The browser `node:fs` façade also now exposes callback-style `realpath()`, so Vite's `promisify(fs.realpath)` path is structurally executable rather than graph-only.


## Native browser worker_threads compatibility

The browser C1 realm now exposes a deliberately narrow `node:worker_threads` surface:

- the Dedicated Worker guest is treated as the logical Node main thread (`isMainThread=true`, `threadId=0`);
- browser-native BroadcastChannel/MessageChannel/MessagePort are exposed where available;
- environment-data helpers are realm-local;
- `parentPort` and `workerData` are null in the logical main realm;
- constructing a Node-style nested `Worker` remains explicit fail-closed.

This is sufficient for capability/static graph paths without falsely claiming Node worker_threads execution parity.


## Browser child_process policy

The native browser graph now publishes `node:child_process` API shape without granting host-process authority. `exec`, `execFile`, `spawn`, `fork` and synchronous variants never invoke the runner/host OS; they fail closed with `OC_BUILTIN_UNAVAILABLE` (callback forms receive the error asynchronously). This lets optional platform/server code remain statically publishable while preserving the browser runtime security boundary.


## Browser DNS/OS/net privacy profile

Vite's browser graph now receives deterministic, privacy-preserving networking/OS metadata:

- `node:dns` and `node:dns/promises` resolve only localhost and literal IP addresses; arbitrary hostname lookup fails with `ENOTFOUND` instead of leaking host resolver/network state;
- DNS result-order APIs are supported as logical runtime state;
- `node:os.networkInterfaces()` exposes loopback only, never the user's LAN/WAN interfaces;
- OS identity is the logical POSIX compatibility profile (`linux/wasm32`), not the user's real host OS;
- `node:net` promotes IP classification helpers used by Vite, while raw TCP sockets/server creation remain fail-closed.

This lets build/config code reason about addresses without expanding OpenContainer's network authority.
