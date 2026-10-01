# Implementation Status

## Current promotion ledger — 2026-09-27

This section is the authoritative current-state ledger. Later sections preserve incremental promotion history; an older `OPEN` statement is historical when this ledger explicitly supersedes it.

Promoted in the clean Chrome product/browser path:

- P18 evidence/assurance is now an executable release authority: typed evidence levels prevent source/docs/local confidence from closing critical gates; decisive contract/browser courts emit SHA-256-manifested environment/raw/summary/log/failure/corpus/negative-result bundles; harness exclusions are reason-coded; the compatibility corpus is content-locked; benchmark validity threats stay explicit; and stable release independently requires the exact 304/304 source gate ledger rather than aggregate percentages.

- P5 network/secrets/preview is now release-ready for the declared Chrome profile: external networking is capability-checked after hardened URL canonicalization; four named network profiles downgrade monotonically; policy version/hash is retained; secret plaintext stays authority-side behind scheme/host/method/path/expiry/session/process/task-scoped opaque handles; decoded response bytes and cancellation are bounded; package install receives no secret handles; preview remains independent of external-network permission; the trusted Service Worker edge strips host credentials; preview routes bind owner+epoch+workspace/session/version and the v2 Service Worker compatibility ID prevents legacy-protocol reuse; hostile sandboxed preview code cannot read trusted parent/browser storage.

- P0 product scope is now release-ready and machine-enforced: 1.0 remains exactly nine Core surfaces; the Node/npm oracle is frozen; the current evidence claim is explicitly limited to Chrome 153 on Ubuntu 24.04 x64; unsupported/out-of-Core classes, scope debt, production severity, public claims and critical-gate waivers are governed by versioned registries. Broader browser/device support is still unclaimed.

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
- browser guest concurrency is now governed by `ResourceGovernor.workers`: each Dedicated Worker holds one lease, over-budget spawns fail with `OC_RESOURCE_EXHAUSTED`, and close/timeout destruction returns the lease for reuse.
- guest Worker CSP now uses explicit privilege profiles instead of globally enabling dynamic code generation: the default `strict` profile keeps JavaScript `eval`/Function blocked while permitting self modules + WASM compilation, and the opt-in `toolchain` profile admits `unsafe-eval` only for the Vite 8 execution authority that requires it; both profiles retain the capability membrane, execution deadlines and Worker resource leases.
- guest-to-host execution results now carry a bounded export budget before `postMessage`: selected exports are cloned and size-accounted inside the Worker, oversized strings/buffers/collections fail with `OC_OUTPUT_LIMIT`, and successful receipts report their bounded export byte usage; the default tracks the ResourceGovernor output budget when present.
- S7 persistence is now exposed through the public SDK: `snapshot()` / `restore()` plus pinned-generation streaming `export()` / stream-capable `import()`, `status()` and `teardown()`; Chrome proves a live workspace can mutate after export invocation without contaminating the exported generation.
- the SDK now publishes one canonical machine-readable production profile identity covering runtime version, Node/npm oracle, filesystem/OPFS snapshot versions, network capability profile, protocol envelope version, browser evidence scope and exact toolchain identity; the public JSON is drift-tested against the SDK and explicitly keeps `productionClosed=false`.
- hosting/header setup now has an executable self-check: it validates COOP/COEP/CORP, strict/toolchain Worker CSP profiles, Service Worker scope and the public production-profile identity, and returns exact per-header diagnostics rather than a generic deployment failure.
- P11 now has a frozen 13-repository compatibility corpus selected before further tuning, with exact repository/lockfile/license/source pins, explicit unsupported classes, separate FS/module/process/HTTP/package/watch reporting and a machine-readable baseline generated from the tested corpus. All 9 npm-published frozen package cases pin registry URL + SHA-512 + SHA-1 and CI re-downloads/hash-verifies their tarballs; `yoctocolors` and `clsx` each run twice on fresh isolated browser realms with stale-session rejection; exact npm-published `clsx@2.1.1` also passes FrozenInstaller/VNFS/exports/native-ESM execution rather than source checkout.
- P11 compatibility governance is now fail-closed and machine-evaluated: selected Node 24.21.0 differential mismatches require an explicit oracle-exception entry, stale exceptions fail CI, and frozen Alpha/Beta/RC/1.0 thresholds are evaluated from the live reconciliation ledger and compatibility baseline; current qualification is Alpha only.
- distribution certification now runs from a packed `@nolane/opencontainer` artifact instead of repository source: CI installs the tarball into a clean consumer, executes public SDK + bundled SDK example from `node_modules`, and the Chrome job runs the entire existing browser-product-path from the installed package. This is publish-equivalent evidence only; external release publication is not claimed.
- release-evidence generation now treats that packed artifact as a supply-chain subject: CI requires byte-for-byte reproducibility across two independent staging builds, emits independent SHA-256/SHA-512 checksums, an SPDX 2.3 SBOM, in-toto/SLSA provenance, categorized dependency/license inventory and a release manifest, verifies all bindings, rejects staged secret/test/local-path leakage, and archives the seven-file evidence bundle separately. Signing/OIDC/public release identity remain explicitly unpromoted.
- Service Worker release promotion is now compatibility-gated rather than lifecycle-forced: a versioned profile is queried before waiting-worker activation, queried again after activation, and a separate compatibility-bound claim command controls the page; incompatible workers fail closed and the install/activate handlers no longer perform unconditional `skipWaiting()` / `clients.claim()`.
- release promotion now has a fail-closed preflight court: a frozen canary→beta→rc→stable policy validates SemVer/profile coherence, reviewed-change API/storage/security implications, prior GO receipts, live gate-ledger evidence, unresolved risks and stable-only production/flakiness requirements; CI archives both the machine-readable decision and generated changelog.
- release storage migration/rollback is now an executable OPFS product authority: adjacent migration must dry-run capacity/version validity before publication, payload-first dual-manifest publication preserves recovery roots across crash phases, derived caches use lazy versioned namespaces, and rolled-back runtimes never destructively downgrade storage—readable newer data becomes VFS-enforced read-only while incompatible data refuses open.
- P15 developer experience is now contract-driven: a machine-readable public SDK/export privacy surface and complete stable error catalog generate drift-checked API/error references; installed-tarball certification runs happy/failure SDK examples, the hosting self-check and a privacy-minimized `supportBundle()`, while limitations/storage/security/AI/migration/troubleshooting guides and security ADRs ship with the artifact. Breaking reviewed changes are rejected by release preflight unless they name a migration guide.
- P8 diagnostics/supportability/privacy is now production-integrated: diagnostics have independent entry/raw-byte/duplicate-fingerprint/terminal-metadata bounds; support bundles provide deterministic failure fingerprints, previewed categories, browser/header/package/storage/profile/recovery-migration-update metadata, default-out AI content and zero-remote-telemetry behavior while excluding workspace/private-source/HTTP-body/raw-terminal/secret content. A receipt-first issue template and installed deterministic `opencontainer-diagnostic` command complete the support workflow.

Evidence anchors:

- P18 evidence-assurance court `bc283647ee9ab04a5ee645eb0a41c8236e97fb40` passed CI #401 contract + Chrome product path: 5/5 critical contract iterations over 13 files (65 executions) passed with zero failures and a verified 12-file SHA-256 assurance bundle; Chrome `153.0.8010.52` passed 2/2 installed-distribution product paths with zero unexplained failures and a verified 9-file browser assurance bundle. The registry reports no BLOCKED-HARNESS evidence, preserves 3 negative/harness-history records and a 13-case content-addressed corpus lock, while stable preflight still refuses incomplete 304-gate ledgers. P18-01 through P18-12 are reconciled closed; `production_closed=false` remains explicit.

- P5 network/secret/preview court `fb9e45ac36f17a42c01b1769b37a968d1ed0944a` passed contract + full browser product path in CI run #398: Chrome `153.0.8010.52` / Ubuntu 24.04 x64 passed the declared profile probe; the critical browser campaign passed **2/2** installed-distribution paths with **0 unexplained failures**. Evidence covers real CORS allow/deny/opaque and LNA behavior, canonical URL/redirect controls, decoded-byte/cancellation bounds, authority-side scoped secrets, provider failure state invariance, secret-free diagnostics, virtual HTTP semantics, preview/external-network separation, hostile-frame isolation, four frozen network profiles, policy hashes, and Service Worker owner+epoch+workspace/session/version tamper rejection. P5-01 through P5-18 are reconciled closed by `release/P5-NETWORK-PREVIEW-EVIDENCE.v1.0.json`; `production_closed=false` remains explicit.

- P0 product-scope court `6f560a5d96521f0ec2071e8ae0dea3673cdab571` passed contract + full browser product path in CI run #385: the scope verifier returned `ok=true`, 9 Core surfaces, 6 scope debts, 6 approved public claims and 0 critical-gate waivers; Chrome profile verification passed on `153.0.8010.52` / Ubuntu 24.04 x64, and the browser flake campaign passed 2/2 with zero unexplained failures. P0-01 through P0-12 are reconciled closed while `production_closed=false` remains explicit.

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
- browser guest worker-budget court `71d52b90c8e169b94cdca90c67b3f02755a4c12f` passed contract + Chrome browser-product-path in CI run #250: worker limit 1 admitted the first realm, rejected the second with `OC_RESOURCE_EXHAUSTED`, released usage to zero on close, then allowed the waiting authority to acquire the returned lease and execute successfully.
- guest CSP profile court `766baf790775a2511fef8e334600b35997de3eda` passed contract + Chrome browser-product-path in CI run #263: strict profile returned `EvalError` for both direct eval and Function construction; the toolchain profile remained self/connect/worker scoped while explicitly admitting Vite's required dynamic codegen; Vite 8.3 C1/C2 and dependency optimization returned green. A separate non-merged diagnostic CI #257 proved the same dependency-optimizer court fails without JavaScript `unsafe-eval` and passes when it is admitted, motivating the isolated profile rather than weakening all guests.
- guest export-budget court `fafd4e43b66d74ebcb3898451b647a6c4ac313bb` passed contract + Chrome browser-product-path in CI run #267: a 64 KiB authority rejected both a 256 KiB text export and a 96 KiB typed-array export with `OC_OUTPUT_LIMIT`, then returned a 23-byte bounded export on the same live realm; all CSP/runaway/quota, persistence/package and Vite C1/C2 courts remained green.
- public S7 SDK court `ce5b2bf496700a1f91971a665eb69ed5efdbac9e` passed contract + Chrome browser-product-path in CI run #270: snapshot/restore stayed exact, streaming export pinned generation 3 before a later live edit, a second runtime imported generation 3 unchanged, and public teardown completed while every prior browser court remained green.
- production-profile identity court `aca2d12ddb729b90bd196731aebb8e54a8a68dbb` passed contract + Chrome browser-product-path in CI run #277: profile `opencontainer-alpha-chromium-node24-v1` exposed runtime `0.1.0-alpha.1`, Worker RPC envelope v1, snapshot format v1 and the 304-gate closure source while retaining `productionClosed=false`; browser-fetched JSON matched the SDK object exactly.
- hosting self-check court `09abff58f289758f06c7b75842cdb1331dc2a28a` passed contract + Chrome regression in CI run #281: the checker accepted the promoted playground topology, retained profile `opencontainer-alpha-chromium-node24-v1`, and a deliberately misconfigured server produced explicit missing-header diagnostics for COOP and Service Worker scope instead of a generic failure.
- frozen real-repository corpus court `fd8474f3cafe636864253c50d4a9b863266b6d09` passed contract + Chrome browser-product-path in CI run #286: all 13 repository pins verified online; supported npm lockfiles compiled to 219 nodes for the tiny Vite React case and 8 nodes for Chokidar with zero missing integrity entries; exact `yoctocolors@a85b98a...` source executed in a cross-origin-isolated Dedicated Worker and returned the conservative no-color result required by the bounded tty adapter.
- repeated corpus + tarball/published-package court `a3dea9b9948eea49d077261ebaef1478a275ae6c` passed contract + Chrome browser-product-path in CI run #300: 9 npm tarballs were fetched and byte-verified against pinned SHA-512/SHA-1; `yoctocolors` and `clsx` each executed twice across 4 fresh publication/Worker sessions with all stale sessions returning 504; published `clsx@2.1.1` fetched 3,936 bytes, mounted one package, resolved `/workspace/node_modules/clsx/dist/clsx.mjs`, and executed both default and named exports inside an isolated Worker.
- compatibility-governance court `ba352ff4b1588d06130afe2d06f4dc834334ef8f` passed contract + Chrome browser-product-path in CI run #309: the selected Node 24 resolver differential retained zero unlisted/stale exceptions, the frozen evaluator qualified Alpha and rejected Beta, and all browser product-path courts remained green.
- installed-distribution court `76681847318201aaf942bd1376a95c090fb9070d` passed contract + Chrome distribution browser path in CI run #314: clean consumer resolution came from `node_modules/@nolane/opencontainer`, the packed SDK lifecycle example passed, and the full Chrome acceptance suite ran from the installed 7,765,186-byte tarball while `productionClosed=false` remained explicit.
- release-evidence court `144299359225975dc8cf54a10c7704c992ff2215` passed contract + installed-distribution Chrome path in CI run #319: two independent builds produced identical SHA-256 `47675569cf0b5c2dd69fdd295ce4dc5ad2df54e87b5f98dfb39941efd5190c7a`; the verifier found 38 SPDX packages / 37 runtime components, zero content-policy violations, reproducibility=true, and GitHub Actions archived seven evidence files for 90 days.
- Service Worker release-handshake court `7f5f28395c3d533e2b9df2f70edd6cb693106ef0` passed contract + installed-distribution Chrome path in CI run #331: first ESM bridge reported `compatibility-authorized` with `opencontainer-sw-edge-v1:rpc1:snapshot1:opfs1`, the second bridge reused the `existing-compatible` controller, and the full stale-session/OPFS/package/Vite C1/C2 browser court remained green.
- release-promotion preflight court `522f6501cd355e96c5642dfe8f1544ec46e98fac` passed contract + installed-distribution Chrome path in CI run #338: current `0.1.0-alpha.1` received canary `GO`, version/profile coherence and reviewed-change completeness were true, channel/prior-chain evidence was satisfied, the decision/changelog were archived separately, and the generated changelog SHA-256 was `41e85619ebe27a8f16bb903e8e08f362ea2525878d841341c4cd710f14aaf310`.
- release-storage migration/rollback court `11ee7759ca055a8ccddebd0957f2946979ffc084` passed contract + installed-distribution Chrome path in CI run #345: real OPFS dry-run required 1,515 bytes, v1/v2 cache namespaces were distinct, v2 publication retained two valid recovery roots, rollback mode was `read-only` with `destructiveStorageDowngrade=false`, direct writes failed with `OC_STORAGE_READ_ONLY`, and all four injected crash phases recovered a valid canonical generation.
- P15 developer-contract court `d75449a0df9a33ea8f422526b74d29c8dfe7d1f4` passed contract + 2/2 installed-distribution Chrome product paths in CI run #368: generated API/error docs reported zero drift; the 114-file 7,801,724-byte tarball exposed only the frozen public export map, ran success/failure examples with exact stable error codes, passed the installed hosting self-check, and returned `supportBundle` evidence with `workspaceContentsIncluded=false`, `diagnosticDetailsIncluded=false`, `secretsIncluded=false`, `leakedSecret=false`; browser flake evidence reported zero unexplained failures.
- P8 production-diagnostics court `503988b4eaa3d73644fa98726548a314f92b4060` passed 243/243 contract tests + 2/2 complete installed-distribution Chrome product paths in CI run #379: browser capability/header probes were clean; package/storage/profile fingerprints and exact recovery/migration/Service Worker update outcomes were present; remote telemetry stayed disabled; generated/custom secret sentinels, signed URL values, HTTP bodies, private source, AI prompt/transcript and raw terminal content were absent from support export; the browser campaign reported zero unexplained failures.

Still required before production closure:

1. Remaining guest-isolation hardening beyond the promoted capability membrane, destructive CPU deadline, Worker quota, split CSP profiles and bounded guest-result transfer: stronger origin separation, browser-heap/side-channel controls beyond transferable output bounds, and broader Node 24 compatibility.
2. Extended WorkspaceFS/PackageFS durability campaigns beyond the promoted public SDK persistence profiles; WorkspaceFS restore/checkpoint/GC plus corrupt-newest fallback-and-continuation, persistent PackageContent hydration/forced-eviction recovery, policy/GC/quota preflight and multi-tab/Web Locks are promoted.
3. External release publication identity still remains beyond the promoted installed-tarball certification; P15 documentation samples are certified against the publish-equivalent tarball but not an externally published package. pnpm/yarn, native-addon, generic watcher and public npm/GitHub Release traceability remain open.
4. PC-A/PC-B target-device and per-release browser/OS/profile matrix beyond CI Chrome; P15-05 remains open until that matrix exists.
5. Weak-device/resource-budget campaigns beyond the promoted concurrent Worker lease limit, plus long-run/plateau, memory-pressure/fault-security and remaining release campaigns. Storage migration/rollback mechanisms are promoted, but real adjacent-release artifact certification is still open.
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
- S7 public snapshot/restore plus pinned streaming OpenContainer NDJSON export/import.
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


## P12 product security technical closure

P12 now has an executable product-security court on PR #42. CI #409 at implementation head `4e05b3cf1ca27d6bb5f3e33fda69ebc6411d67af` passed contract, pinned CodeQL and the installed-distribution Chrome product path. The court retains OWASP ASVS 5.0.0 identity, zero-vulnerability npm audit, zero-finding/zero-waiver CodeQL SARIF, an 11-case malicious-package corpus, a 12-entry critical/high regression registry and explicit resource-DoS residual risks for source maps/WASM heap behavior.

The production ledger closes P12-01..P12-16 and P12-19 only. P12-17 (verified private disclosure channel), P12-18 (independent/second-party review) and P12-20 (human product-security review) remain PARTIAL and non-machine-closable. This does not close P7 weak-device/resource-floor work, cross-browser evidence, legal/FTO or operations. `production_closed=false`.


## P17 operations and maintenance closure

PR #43 implementation head `631ce3608424a901f74c67e83666f6d14bb87a73` passed CI #413 across contract, CodeQL and the installed-distribution Chrome product path. The operations drill exercised all 14 P17 process areas, four disaster scenarios, four version/profile/browser known issues, 12 retained critical/high regressions, telemetry-free health with zero remote requests, support-bundle v0.1/v0.2 backward parsing and a real VFS mutation block for a known-bad runtime. The repeated critical court ran 100 test-file executions with zero unexplained failures; Chrome passed 2/2 full paths.

P17 is process-closed for the current pre-1.0 scope, not a claim of a staffed hosted operations organization. P12-17 private intake, public package/release identity, cross-browser/browser-floor, weak-device and production-topology evidence remain open. `production_closed=false`.


## P11 release compatibility reporting closure

PR #44 implementation head `676fcec1b4b8b1fad108c28ab7d71595d5b368db` passed CI #417. The canary release compatibility report is machine-verified against the exact five baseline limitations, four product-scope unsupported classes and four version/profile/browser known issues; seven source files are SHA-256 bound and the receipt is archived for 90 days. The critical contract campaign ran 110 test-file executions with zero unexplained failures and Chrome passed 2/2 installed-distribution product paths.

P11-14 is closed. P11-12 remains PARTIAL until the actual externally published OpenContainer package/bundle is exercised, and P11-13 remains unreconciled until real browser-matrix evidence exists. `production_closed=false`.


## P15 per-release browser/OS/profile matrix closure

PR #45 implementation head `51142c03da23bee52dd85c1beeba40a8184ca00e` passed CI #421 across contract, CodeQL and the installed-distribution Chrome product path. The release matrix publishes seven rows: exactly one evidence-backed profile (Chrome 153.0.8010.52 / Ubuntu 24.04 x64 / `desktop-chrome153-ubuntu2404-x64-ci`) and six explicit unverified rows for broader browser/OS/mobile/weak-device profiles. The matrix receipt binds six source artifacts by SHA-256, the repeated critical court ran 120 test-file executions with zero unexplained failures, and Chrome passed 2/2 full product paths.

P15-05 is closed without freezing browser minimums or claiming Windows/macOS/Firefox/Safari/mobile/weak-device support. P15-12 remains the only open P15 row because documentation samples are not yet tested against an externally published OpenContainer package. `production_closed=false`.


## P13 supply-chain security closure wave

PR #46 implementation head `57a20790c64619ede9a55fe7a76a8424bf62d311` passed CI #424 across contract, CodeQL and the installed-distribution Chrome product path. The supply-chain court reached SECURITY-REVIEWED maturity and proved that the exact distribution artifact exercised by certification is the same SHA-256/SHA-512 artifact represented by release evidence; SPDX 2.3 SBOM, in-toto/SLSA provenance, exact source/lock/toolchain/environment identity, independent checksums, explicit dependency categories, zero shipped optional-adapter bundles, content-policy negatives, reproducible builds, immutable action pins, least-privilege workflow permissions and compromised-release revocation/user warning all passed.

This closes P13-01, 02, 05, 06, 08, 11, 12, 13, 14, 15 and 19 at RELEASE-VERIFIED evidence. P13-03/04/07/09/10/16/17/18/20 remain open for real external/publication/tag/signing/repository-hygiene/archive conditions. `production_closed=false`.


## P7 resource evidence wave 1

PR #47 implementation head `506afe66d65c1df71d9fd9e585e1a82bda428ce1` passed CI #428 across contract, CodeQL and the installed-distribution Chrome path. The repeated contract court ran 140/140 test-file executions with zero failures; Chrome passed 2/2 full product paths. The archived P7 measurement receipt identifies Chrome 153.0.8010.52 / Ubuntu 24.04.5 x64, 4 logical CPUs and 16,766,414,848 bytes of runner memory, and retains two full-path durations (45,200 ms and 35,285 ms) together with warmup/cache/CPU-throttling/GC/thermal/network/DevTools validity threats.

P7-07 and P7-14 are closed for the declared CI profile. P7-08 stays PARTIAL pending a global audit of every source-map retention path. No 4/8 GiB device floor, 8-hour plateau, weak-device regression budget, cross-browser floor, thermal floor or latency floor is claimed. `production_closed=false`.


## P7 resource evidence wave 2

PR #48 implementation head `0f71f7492ae0175d929c98c6e032dd4cf522d728` passed CI #432 across contract, CodeQL and the installed-distribution Chrome product path. The repeated critical contract court covered 30 files × 5 iterations = 150 file executions. Chrome passed 2/2 full product paths with zero unexplained failures, including the new pressure pause/cancel/resume court and the extended per-stage resource measurement receipt.

P7-08 is closed for the declared Chrome profile by a repo-wide production-source retention audit plus the existing bounded task/in-flight/process/output/diagnostic/terminal budgets. P7-13 is closed by browser evidence that serious/critical pressure pauses background admission, makes a pre-pressure result stale, and permits only fresh publication after resume.

P7-02 through P7-05 receive stage-level measurement evidence only and remain unclosed. P7-01, P7-06, P7-09, P7-10, P7-11 and P7-12 remain open/partial for the stronger device, coexistence, soak, lifecycle/contention, storage-amplification and regression-budget obligations. `production_closed=false`.


## P3 persistence/data-safety wave 1

CI #444 on PR #49 implementation head `1cbc9df096759d4cc4b108c25add5ba0359d7a58` passed contract, CodeQL and 2/2 full installed-distribution Chrome paths with zero failures. Real browser evidence now closes P3-01, P3-02, P3-04, P3-05, P3-06, P3-10, P3-11, P3-12, P3-16 and P3-19.

The most material behavior change is fatal canonical recovery: OPFS metadata that exists but has no fully valid recovery payload now raises `OC_IMPORT_INVALID`; public SDK boot cannot reinterpret it as a never-initialized empty workspace. Workspace persistence also exposes deterministic crash-injection boundaries so the browser court can prove payload-before-manifest atomicity.

P3-03, P3-07, P3-08, P3-09, P3-13, P3-14, P3-15, P3-17, P3-18 and P3-20 remain open/partial. `production_closed=false`.


## P3 persistence/data-safety wave 2

CI #459 on PR #50 implementation head `4c8d5b1fc88ad2db49e0431dbdbd86786f50552a` passed contract, CodeQL and 2/2 full installed-distribution Chrome product paths with zero unexplained failures. The repeated critical contract court executed 33 files × 5 iterations = 165 file executions.

P3-03 is now closed for the declared Chrome profile: persistent monotonic WriterEpoch fencing is separate from StorageGeneration, canonical manifests bind both identities, successor epoch takeover is explicit, and an older writer cannot publish after failover.

P3-08 is now closed for the declared Chrome profile: deterministic quota faults cover six write boundaries from zero bytes through post-payload/pre-manifest; every arm preserves the previous committed OPFS generation after reopen.

P3-07, P3-09, P3-13, P3-14, P3-15, P3-17, P3-18 and P3-20 remain open/partial. The production ledger is now 153/304 minimum-closure satisfied; `production_closed=false`.


## P3 persistence/data-safety wave 3

CI #475 on PR #51 implementation head `edb93487724046443c73b98cad397ee43ec36f94` passed 375/375 unit tests, CodeQL, 34 critical files × 5 iterations = 170 repeated executions, and 2/2 installed-distribution Chrome product paths with zero unexplained failures.

P3-13 is now closed for the declared Chrome profile. Corruption is classified separately across all five source-gate classes: canonical source fails closed; corrupt recovery drafts are discardable noncanonical state; corrupt checkpoints fall back to an older valid recovery root; corrupt package-cache bytes are rejected/refetched/reverified; and corrupt derived indexes are discarded/rebuilt from canonical source generation. The dedicated browser receipt proves five distinct classes and five distinct recovery actions in both Chrome iterations.

P3-07, P3-09, P3-14, P3-15, P3-17, P3-18 and P3-20 remain open/partial. The production ledger is now 154/304 minimum-closure satisfied; `production_closed=false`.


## P3 persistence/data-safety wave 4

CI #491 on PR #52 implementation head `3debec759ac83f5fd5582a211659bb1be623de68` passed 383/383 unit tests, CodeQL, 35 critical files × 5 iterations = 175 repeated executions, and 2/2 installed-distribution Chrome product paths with zero unexplained failures.

P3-14 is now closed for the declared Chrome profile. Low-storage cleanup is explicitly ordered across temporary, derived/rebuildable, public cache and checkpoint-garbage tiers; canonical source and canonical checkpoints are hard-protected. An impossible reclaim target remains unsatisfied instead of authorizing deletion of last-known-good state. The browser court reopens the workspace after cleanup and verifies the current acknowledged generation plus fallback checkpoint remain valid.

All 14 currently reconciled P3 rows are now closed. P3-07, P3-09, P3-15, P3-17, P3-18 and P3-20 remain unreconciled/open, so the domain is not complete. The production ledger is now 155/304 minimum-closure satisfied; `production_closed=false`.


## P3 persistence/data-safety wave 5

PR #53 safe-checkpoint-restore implementation passed CI #509 with 394/394 unit tests, CodeQL, 37 critical files × 5 = 185 repeated executions, and 2/2 installed-distribution Chrome product paths. Dedicated CI #512 repeated the product path and produced artifact #10944841419 with safe-restore verification PASS in both iterations.

P3-15 is now reconciled and closed for the declared Chrome profile. Restore planning binds working generation + canonical sequence/generation; commit locks local mutation, creates/reuses a pre-restore recovery point, uses canonical-sequence CAS under Web Locks, republishes older checkpoint contents as a new generation, and fails closed on local conflict, cross-context conflict or inability to create the safety point.

P3-07, P3-09, P3-17, P3-18 and P3-20 remain unreconciled/open. The production ledger is now 156/304 minimum-closure satisfied; `production_closed=false`.


## P3 persistence/data-safety wave 6

PR #54 implementation head `e89f16bf2a164ea812e2dd8793559816ad5d8757` passed CI #529 with 406/406 unit tests, CodeQL, 38 critical files × 5 = 190 repeated executions and 2/2 installed-distribution Chrome paths. Dedicated destructive-lifecycle artifact #10952810664 passed both browser iterations.

P3-20 is now reconciled and closed for the declared Chrome profile. Normal delete is D2 recoverable destructive: OpenContainer fences late local mutation, verifies the current canonical checkpoint as the recovery root, writes an integrity-bound tombstone and blocks boot/publication until explicit restore. Permanent purge is a separate D4 action requiring target-specific irreversible confirmation; it physically removes workspace storage, reports no remaining recovery, is idempotent by mutation identity and reconciles acknowledgement loss before retry. Corrupt lifecycle metadata fails closed rather than silently reactivating the workspace.

The production ledger is now 157/304 minimum-closure satisfied with 193 reconciliation rows. P3-07, P3-09, P3-17 and P3-18 remain unreconciled/open; `production_closed=false`.


## P3 persistence/data-safety wave 7

PR #55 implementation head `1f5a9f0ddfc814193658a9f36117a6f088d93ce8` passed CI #547 with 415/415 unit tests, CodeQL, 40 critical files × 5 = 200 repeated executions, and 2/2 installed-distribution Chrome product paths. Dedicated external-source artifact #10953546693 passed both browser iterations.

P3-17 is now reconciled and closed for the declared Chrome profile. Imported-copy, linked-folder and read-only-source are explicit immutable authority modes: imported-copy detaches after atomic local publication, read-only-source never grants external write authority, and linked-folder preserves mode across permission/conflict states. Privileged linked writes re-check permission and require a content-revision precondition so detected external edits cannot be silently overwritten.

P3-18 remains open. Current browser evidence uses real Chrome/OPFS bytes plus a File-System-Access-compatible permission adapter and explicitly records `nativePickerPermissionRevocationExercised=false`. A real user-selected `showDirectoryPicker()` handle and subsequent native permission-revocation transition are still required.

The production ledger is now 158/304 minimum-closure satisfied with 194 reconciliation rows. P3-07, P3-09 and P3-18 remain open; `production_closed=false`.


## P3 persistence/data-safety wave 8

PR #56 implementation head `74b1fb598e652f2650b0c37e28e67deab3db6d8b` passed CI #565 with 419/419 unit tests, CodeQL, 42 critical files × 5 = 210 repeated executions and the installed-distribution Chrome product path. Dedicated browser artifact #10954814739 passed 2/2 real two-target freeze/resume iterations.

P3-09 is now reconciled and closed for the declared Chrome profile. Writer A publishes at WriterEpoch 1, Chrome freezes its real page target, Writer B claims WriterEpoch 2 and publishes while A is frozen, then Chrome resumes A. A's original authority re-handshakes shared state and its stale publication fails `OC_STALE_GENERATION` with expected epoch 1/current epoch 2. Canonical sequence/value remain Writer B's acknowledged state.

The production ledger candidate is now 159/304 minimum-closure satisfied with 195 reconciliation rows. P3-07 and P3-18 remain open; `production_closed=false`.


## P3 persistence/data-safety wave 9

PR #57 implementation head `57e7ee4b9733cfbbceff582160a284999124f2ff` passed CI #586 with 427/427 unit tests, CodeQL, 43 critical files × 5 = 215 repeated executions, and 2/2 installed-distribution Chrome product paths. Dedicated durability artifact #10956533718 passed both browser iterations.

P3-07 is now reconciled and closed for the declared Chrome profile. Canonical checkpoint payload and manifest writes use a dedicated-worker `FileSystemSyncAccessHandle` path with explicit `flush()` before `close()`; a fresh authority then reopens and verifies the same canonical sequence, digest and full bytes. The claim is intentionally limited to that browser-visible API boundary and excludes stronger power-loss/hardware-cache/eviction guarantees not exposed by the Web API.

The production ledger candidate is now 160/304 minimum-closure satisfied with 196 reconciliation rows. P3 has 19/20 gates closed; only P3-18 native `showDirectoryPicker()` permission revocation remains open. `production_closed=false`.


## P3 persistence/data-safety wave 10

PR #58 implementation head `0c1a6334cbae8ea3ac4389db76713e20bbccfe96` passed CI #616 with 431/431 unit tests, CodeQL, 45 critical files × 5 = 225 repeated executions, 2/2 installed-distribution Chrome product paths and 2/2 dedicated native File System Access iterations. Native artifact #10959309888 retains the picker/revocation receipt and UI screenshots.

P3-18 is now reconciled and closed for the declared Chrome profile. The court uses real `showDirectoryPicker({mode:'readwrite'})` rather than the prior adapter, obtains a native `FileSystemDirectoryHandle`, fences an external OS edit with `OC_STALE_GENERATION` before overwrite, rechecks permission before the reconciled write, then removes the selected directory through the native handle and observes read/readwrite permission transition from `granted` to `denied`. A later privileged write fails closed while the local canonical recovery state remains unchanged.

The production ledger candidate is now **161/304** minimum-closure satisfied with **197** reconciliation rows. **P3 is 20/20 closed for the declared profile.** Overall `production_closed=false` remains unchanged because open gates still exist outside P3.


## P4 package artifact boundary wave 1

PR #59 implementation head `0c9bbed9efd24d6c0700d744b05881515c6c6893` passed CI #633 with 440/440 unit tests, CodeQL, 47 critical files × 5 = 235 repeated executions and 2/2 installed-distribution Chrome product paths. Dedicated P4 artifact #10964252846 passed both browser iterations.

P4-05, P4-08, P4-09, P4-10 and P4-12 are now reconciled at RELEASE-READY minimum closure for the declared Chrome profile. Two retained npm tarballs execute through the production streaming gzip/TAR path; truncation/decompression/path/link/extension attacks fail closed; special TAR features remain denied by default; and a byte-level integrity mismatch cannot publish package content or change package graph generation. The wave also hardened the production TAR parser so incomplete two-block trailers and non-zero trailing bytes are rejected rather than silently accepted.

The production ledger candidate is now **166/304** minimum-closure satisfied with **199** reconciliation rows. P4 remains incomplete: P4-01/02/03/04/06/07/11/13/14/15/16/17/18 remain open or partial. `production_closed=false` remains unchanged.


## P4 package publication atomicity wave 2

PR #60 implementation head `b710d7f2415a72f706ae73c5b0bb12a6d159d615` passed CI #677 with 458/458 unit tests, CodeQL, 52 critical files × 5 = 260 repeated executions, 2/2 installed-distribution Chrome product paths and a dedicated 2/2 Chrome publication-atomicity court (artifact #10970556878).

P4-04 and P4-11 are now reconciled at RELEASE-READY minimum closure for the declared Chrome profile. Package persistence now includes a real OPFS package-graph authority coordinated by Web Locks. Graph publication is based on an explicit persistent generation; exactly one concurrent base-generation writer wins, the loser fails `OC_STALE_GENERATION`, and a successor generation fences an installer that still holds the older graph so PackageFS publication also fails `OC_STALE_GENERATION`.

The same court proves failure atomicity under cancellation, real OPFS quota exhaustion and real installer Worker termination. Verified immutable cache objects may remain as recoverable orphans, but incomplete installs do not expose `node_modules`; PackageFS remains unpublished until a complete successful rerun. The install publication barrier is fail-closed from the start of every attempt, including persistent-graph binding and preflight.

The production ledger candidate is now **168/304** minimum-closure satisfied with **201** reconciliation rows. P4 now has **7/18** gates closed; P4-01/02/03/06/07/13/14/15/16/17/18 remain open or partial. `production_closed=false` remains unchanged.


## P4 ecosystem resolver and layout wave 3

PR #61 implementation head `54334c52e1a73d992dbd0ea46006016089e9afcd` passed CI #693 with **472/472** contract tests, CodeQL, **57 critical files × 5 = 285** repeated executions with zero unexplained failures, **2/2** installed-distribution Chrome product paths and a dedicated **2/2** P4 ecosystem/layout court (artifact #10974148519).

P4-01, P4-02, P4-03 and P4-06 now meet RELEASE-READY minimum closure for the declared Chrome profile. The exact Node oracle is pinned to `v24.21.0` and covers exports/imports, nested resolution, realpath/symlink and preserveSymlinks behavior without skipped cases. Two byte-pinned package-lock v3 graphs from frozen real repositories execute in Chrome: `vite-react-tiny` compiles to **219 nodes** and `chokidar-watch` to **8 nodes**.

Package graph layout identity is now a production-visible contract derived from physical package-lock locations. It exposes top-level, hoisted-transitive, nested, linked and shallow structure plus maximum node_modules depth and a deterministic layout fingerprint; hoisted and nested forms cannot silently collapse to one identity.

The wider compatibility corpus retains **13 frozen repositories**. CI performs online source/license/lockfile verification and downloads/verifies **9 published npm tarballs**, binding registry URL, exact bytes, SHA-512 integrity, SHA-1 shasum, source commit and license provenance.

The production ledger candidate is now **172/304** minimum-closure satisfied with **204** reconciliation rows. P4 is **11/18** closed. P4-07 and P4-13 through P4-18 remain open; `production_closed=false` remains unchanged.


## P4 command diagnostics and native-boundary wave 4

PR #62 implementation head `dd199a16e921770789e8308cae15922bec89a384` passed CI #729 with **485/485** contract tests, CodeQL, **62 critical files × 5 = 310** repeated executions with zero unexplained failures, **2/2** installed-distribution Chrome product paths and a dedicated **2/2** P4 command/diagnostics/native-boundary court (artifact #10979651177).

P4-14, P4-17 and P4-18 now meet RELEASE-READY minimum closure for the declared Chrome profile.

For P4-14, package `.bin` ownership is no longer compiled into a last-writer-wins global descriptor. The package graph retains all command candidates; invocation resolves the nearest candidate from `cwd`/package ancestry, including linked-workspace context, and same-scope ambiguity fails closed with `OC_INVALID_PACKAGE_CONFIG`.

For P4-17, support bundles emit package name/version/location, content/instance identity, lockfile integrity, physical layout identity and install-script metadata. HTTP(S) provenance removes username/password/query/fragment before export and fingerprints only the sanitized URL. Raw workspace/opaque source strings are not fingerprinted into the bundle. The machine surface declares `analysisScope=package-provenance-metadata-only` and `scaAssessmentPerformed=false`; it does not claim SCA, vulnerability, malware, license-compliance, exploitability or package-trust verdicts.

For P4-18, native `.node` execution remains denied by default with `OC_NATIVE_ADDON_UNSUPPORTED`. Generic package/path aliases cannot authorize a fallback. Only an exact `nativeAddonAdapters` mapping from a specific absolute `.node` source to an existing non-`.node` target is accepted; the mapping participates in resolver cache identity and emits an explicit source→target receipt. No host-native execution is introduced. The boundary is documented in both the dedicated P4 compatibility note and the public limitations guide.

The production ledger candidate is now **175/304** minimum-closure satisfied with **206** reconciliation rows. P4 is **14/18** closed. Source gates P4-07, P4-13, P4-15 and P4-16 remain open; `production_closed=false` remains unchanged.


## P4 final package closure wave 5

PR #63 implementation head `db400b8fd53213dbefc36dbb02418508d5ef9724` passed CI #789 with **503/503** contract tests, CodeQL, **66 critical files × 5 = 330** repeated executions with zero unexplained failures, **2/2** installed-distribution Chrome product paths and a dedicated **2/2** final P4 package court (artifact #11004449702).

P4-07, P4-13, P4-15 and P4-16 now meet RELEASE-READY minimum closure for the declared Chrome profile. This closes **P4 18/18**.

For P4-07, the retained parser-fuzz corpus contains **8 minimized failure inputs** spanning TAR, gzip, package manifest and package-lock parsing. CI runs **512 Node mutation campaigns** plus **256 Chrome mutation campaigns**; malformed input remains inside typed OpenContainer failures with **0 raw parser exceptions**.

For P4-13, package lifecycle scripts require a dedicated `PackageScriptCapability` grant bound to package location, lifecycle event, exact command and frozen content identity. The Chrome court executes an authorized script with **0 ambient environment keys** and **0 secret handles**; secret-bearing attempts fail closed and keep the PackageFS publication barrier armed.

For P4-15, `PackageGraphAuthority.watchPackageLayout()` is a dedicated package-layout generation watcher, not a claim of generic `fs.watch` compatibility. The court observes unmounted/install/reinstall/remove/install transitions and checks `readdir()` plus linked-workspace `realpath()` coherence at each relevant generation.

For P4-16, measurements are retained rather than converted into marketing thresholds. Two retained production toolchain tarballs total **7,635,964 packed bytes** and **28,364,367 unique verified logical bytes**. Real Chrome OPFS persistence stores **7,636,456 payload bytes**, giving a measured amplification of **0.2692270904547244×** under the frozen formula `physical-persistent-bytes / unique-verified-logical-content-bytes`. Filesystem metadata overhead is explicitly outside this measurement. Real graph-load measurements are also retained for the 219-node Vite graph and 8-node Chokidar graph in both Node and Chrome; no pass/fail performance threshold is claimed.

The production ledger candidate is now **179/304** minimum-closure satisfied with **209** reconciliation rows. **P4 is 18/18 closed for the declared profile.** Overall `production_closed=false` remains unchanged because other production domains still contain open gates.


## P6 toolchain and Vite declared-profile closure wave

PR #64 implementation head `eaf3386f9d4a39e837243feb71f63c8673b98ca0` passed CI #814 with **515/515** contract tests, CodeQL, **74 critical files × 5 = 370** repeated executions with zero unexplained failures, **2/2** installed-distribution Chrome product paths and a dedicated P6 toolchain/Vite browser court (artifact #11015178902, digest `sha256:0f87f7b66acfec78eaf03fe7c541f298fd26bf9c001ef91b831d63ca301addad`).

This promotes **15/16 P6 gates** to their minimum `PASS-INTEGRATION + declared-profile evidence`: P6-01 through P6-09 and P6-11 through P6-16. **P6-10 remains OPEN/UNRECONCILED** because the frozen Vitest monorepo case is still an explicit pnpm/monorepo unsupported boundary; no real promoted Vitest execution exists yet.

The court keeps exact Rolldown 1.2.9 and Lightning CSS WASM 1.33.0 artifact identities, rejects version skew/digest substitution/unsupported versions, and versions every BCR entry by package + tool version + artifact digest + semantic profile. A global `ToolchainAuthority` enforces a shared worker budget across agents instead of per-agent runtime pools. Generic WASI/Linux expansion is rejected as a separate unsupported semantic profile rather than silently widening the browser adapter.

Actual Chrome evidence compiles one WebAssembly module and structured-clones it into two bounded workers, then grows shared WebAssembly memory twice and proves stale typed-array views are rebound without data loss. Vite 8.3 C1 retains production build, TypeScript config/plugin reload, Lightning CSS, assets, source maps, deterministic output and failure atomicity. The failed-build court proves both workspace source and package graph/layout canonical identity remain unchanged. C2 retains virtual HTTP, HMR failure/recovery/reconnect/stale-client rejection, same-port epoch restart, preview rehydration and real dependency optimization into `.vite/deps/nanoid.js`.

The retained measurement receipt records a **643.55 ms** cold module start and **1.235 ms** warm module start for this CI observation, one compiled module reused by two workers, and four Chrome heap samples. These are measurements, not performance floors or product claims; `performanceThresholdClaimed=false` and `plateauThresholdClaimed=false`.

The production ledger candidate is now **194/304** minimum-closure satisfied with **216** reconciliation rows. P6 is **15/16**; `production_closed=false` remains mandatory.


## P2 runtime/process closure

PR #65 implementation head `b2182f11cc03222da96568e06ac9951b7fe3b3fb` passed CI #851 with **538/538** contract tests, CodeQL, **81 critical files × 5 = 405** repeated executions with zero unexplained failures, the full installed-distribution browser path, and a dedicated **2/2** P2 Chrome court (artifact #11016743685).

P2-01 through P2-14 now meet RELEASE-READY minimum closure for the declared Chrome profile.

The browser court uses real Dedicated Workers and proves:
- one request id publishes one terminal RPC result even when the Worker emits a duplicate response;
- a timeout is reconciled as an unknown mutation outcome rather than assumed absence;
- stale worker epochs fail closed after authority restart;
- three staged Worker failures, including after a transferable and after a mutation, reject pending RPCs and leave task/in-flight usage at zero;
- 8 MiB transferable traffic succeeds while the page holds a bounded heap-pressure allocation and the sender buffer is actually detached by Chromium;
- caller → broker → producer → consumer cancellation aborts all descendants and leaves no pending reader;
- synchronous RPC is allowlisted and reentrancy fails immediately;
- virtual-process exit waits for bounded stdout/stderr drain, kill/natural/throw races publish exactly one terminal receipt, parent/child teardown follows explicit orphan policy, stdout retention is bounded, and 200 repeated spawn/kill cycles retain zero active processes/resource leases;
- virtual ports reject stale pid/epoch proof;
- public failures retain stable `OC_*` codes without exposing Worker/MessagePort topology.

The P2 boundary remains browser-native and virtual: this does not claim host OS process creation, raw TCP/UDP parity, or complete Node stream parity.

The production ledger candidate is now **208/304** minimum-closure satisfied with **224** reconciliation rows. **P2 is 14/14 closed.** Overall `production_closed=false` remains unchanged because other production domains still contain open gates.


## P1 browser substrate declared-profile closure wave

PR #66 implementation head `d4a08451b78f7891aafb4cd1d10caf04075c50d2` passed CI #863 with **545/545** contract tests, CodeQL, **84 critical files × 5 = 420** repeated executions with zero unexplained failures, **2/2** installed-distribution Chrome product paths and a dedicated P1 Chrome/CDP court (artifact #11028266315, digest `sha256:e584c8f6f95a29d9ff1c1005f2e4139bdb445775fad15e02007845e43bb6b705`).

This promotes **13/16 P1 gates** for the declared Chrome profile: P1-01 through P1-12 plus P1-16. P1-13, P1-14 and P1-15 remain intentionally open.

The court proves the baseline shipping topology with COOP `same-origin` + COEP `require-corp`, real `crossOriginIsolated`, SharedArrayBuffer/Atomics and module Worker execution. Document Isolation Policy is exercised only on a separate optional Chromium profile; the baseline page has no DIP header and remains isolated, so DIP is not a required product dependency.

Host CSP, strict/toolchain Worker CSP and the frozen Permissions Policy are checked against live responses. An embedded frame observes camera/microphone/geolocation/display-capture/USB/serial/HID/payment as denied. Existing installed-distribution preview evidence additionally proves opaque sandbox origin, denied parent/storage access and no forwarded host credential headers.

Lifecycle evidence is real-browser evidence: Chrome freeze/resume events are observed; a history restore returns through BFCache with `pageshow.persisted=true`; full page reload reopens previously committed OPFS bytes without any unload-final-save dependency.

Canonical-writer evidence uses two actual browser targets. Web Locks prevent simultaneous writer acquisition and permit failover only after release; a separate two-tab OPFS writer court rejects the stale writer with `OC_STALE_GENERATION` while preserving the canonical value.

Storage evidence distinguishes classes. The best-effort OPFS path is explicitly evicted through Chrome CDP `Storage.clearDataForOrigin(file_systems)` and reopens as missing state. The declared Chrome automation profile grants persistent storage, writes OPFS state, closes the page target and verifies the state survives a fresh target reopen.

P1-13 remains open because CI is not a real public CDN/reverse-proxy deployment. P1-14 remains open because a single Chrome 153 profile is not the required frozen-floor + newest-stable RC matrix. P1-15 remains open because internal emergency modeling is not field browser-regression incident evidence.

The production ledger candidate is now **221/304** minimum-closure satisfied with **231** reconciliation rows. P1 is **13/16**; `production_closed=false` remains mandatory.


## P10 optional AI consumer authority closure

PR #67 implementation head `41069da8f77e2ba6ad0c1ceab5f12d1711f84ea4` passed CI #874 with **571/571** contract tests, CodeQL, **87 critical files × 5 = 435** repeated executions with zero unexplained failures, **2/2** complete installed-distribution Chrome product paths and a dedicated **2/2** P10 AI-consumer Chrome court (artifact #11031678345, digest `sha256:5372a9aaf563c4819bc8af6c95c1d26b459e2408d70c186da17f4aab71216a8c`).

P10-01 through P10-18 now meet the frozen minimum closure **PASS-INTEGRATION + declared-profile evidence**. The implementation lives in the optional `@nolane/opencontainer-ai-consumer` package and does not add a tenth Core runtime surface.

The court proves session-memory BYOK custody with no plaintext in workspace/localStorage/sessionStorage/support receipts; provider switch advances an epoch and clears credential/context scope. Context egress uses an explicit manifest with file/category/range metadata, and sensitive files remain excluded until an exact override is granted.

Repository text, web pages and tool output remain untrusted data. Discuss/Plan/Build are separate authority modes and canonical mutation requires Build plus an explicit one-use approval. The approval rendering court treats prompt-injection markup as text and proves it cannot alter action/scope or execute event handlers.

Canonical AI writes use a generation-preconditioned ChangeSet, validation, one VFS transaction, a commit receipt and explicit acknowledgement. Broad destructive changes retain a local recovery point. Idempotency identity prevents retry replay after acknowledgement loss, and Undo is path/version-aware so newer user edits are never overwritten by a blind workspace rollback.

Child-agent results are epoch-bound; cancelled/stale results remain reviewable evidence only. Provider rate-limit failure leaves the local workspace generation unchanged. Shared agent/tool concurrency is bounded through `ResourceGovernor`, including resource-pressure admission control. Cancellation is exercised at pre-tool, in-tool, post-commit and acknowledgement-lost phases.

Cost/token UI stays hidden unless provider metadata is marked authoritative; the reference layer does not fabricate estimates. CI uses fake provider adapters only to exercise authority/failure/switch/metadata semantics and makes **no model/provider quality claim**.

The production ledger candidate is now **239/304** minimum-closure satisfied with **249** reconciliation rows. **P10 is 18/18 closed.** `production_closed=false` remains mandatory because other production domains still contain external/manual/resource/compatibility blockers.

## P6-10 real Vitest compatibility closure

PR #68 implementation head `fbeadbdba914230edfbcc1ca0192631084065b07` passed CI #896 with **585/585** contract tests, CodeQL, **90 critical files × 5 = 450** repeated executions with zero unexplained failures, the same-exact-head declared-profile P6 Chrome court and the full installed-distribution browser product path.

P6-10 now has real test-runner/CLI execution evidence. The court reads the exact `vitest@3.0.8` entry already frozen in `compat/p4/vite-react-tiny.package-lock.json`, verifies the live npm registry tarball URL and SHA-512 SRI against that frozen lockfile, executes the real Vitest CLI twice against `compat/p6/vitest-smoke.test.ts`, and records **3/3 TypeScript tests PASS on each run (6/6 total)** on exact Node v24.21.0 / npm 11.19.0.

Dedicated artifact **#11036952101** has digest `sha256:593565a62183990836985b1adbbbad486be17b5a54b7cf9b77384683e39cec14`. The Vitest job is workflow-gated on the existing `p6-toolchain-vite` job, so real Vitest execution is accepted only when the declared-profile Chrome court passes on the same exact head; it does not redundantly rerun that browser court.

This closure is deliberately narrower than the frozen `vitest-dev/vitest` root repository boundary. It does **not** claim pnpm-lock parsing, Vitest root-monorepo workspace installation, browser-native Vitest execution or cross-browser compatibility.

The production ledger candidate is now **240/304** minimum-closure satisfied with **250** reconciliation rows. **P6 is 16/16 closed.** Overall `production_closed=false` remains mandatory because independent external/manual/release-history gates remain open.


## P7 Wave 4 global governor + storage amplification

PR #71 promotes P7-06/P7-11 only after declared-profile browser evidence. Product UI, Core process, preview dispatch, toolchain workers and AI shared-concurrency now bind into one owner-attributed `runtime.resources` authority. The browser coexistence court held all five live simultaneously, verified pressure rejection, then observed zero leaked usage.

The storage court uses real Chrome OPFS and production authorities. Across two identical iterations it retained 262,144 logical source bytes, a 353,438-byte source snapshot, 3,826,763 persistent package bytes for a retained 3,826,518-byte tarball / 16,232,340 logical package bytes, 252 checkpoint-metadata bytes, a 397,191-byte interrupted temporary transaction reclaimed by GC, and a 4,005-byte derived cache. Total amplification was 0.253688× steady and 0.277769× at transient peak.

P7 closure is now 10/14 in the promotion candidate. The remaining device/long-run/system-lifecycle/regression-budget gates are intentionally not claimed.


## P14-13 frozen-floor + newest-Stable regression

PR #72 implementation head `2f67306726e4d5ded6b60ee7d2483f502638e7b7` passed CI #960 with **618/618 contract tests**, **98 critical files × 5 = 490 executions**, CodeQL and the complete historical regression suite.

The release-regression court is deliberately dual-lane. Frozen floor Chrome **153.0.8010.52** passed 2/2 full installed-distribution paths; live Chrome for Testing Stable resolved to **154.0.8037.92** and also passed 2/2. Stable installation records the live manifest source plus manifest/archive SHA-256 identities instead of trusting the runner's preinstalled browser.

The prior CI #959 P9 timeout is retained as NEG-004 and was fixed as a harness activation race without changing the product recovery handler. P9 rendered passed on CI #960.

P14-13 is promoted; P14 is now **15/18** in the promotion candidate. P14-04 adjacent-release certification, P14-12 production CDN topology and P14-14 weak-device performance budget remain open. Overall ledger: **261/304**; `production_closed=false`.


## P13-18 OpenSSF hygiene

P13-18 is now promoted from an external evidence gap to retained RELEASE-VERIFIED hygiene evidence. Official Scorecard v5.5.0, invoked through pinned Scorecard Action v2.4.4, recorded 6.9/10 across 11 checks without a project-defined pass threshold. The raw result and normalized receipt are archived, and CI #969 keeps the promotion bound to full OpenContainer regression coverage.

This moves the whole-product ledger to **262/304 closed** and P13 to **12/20**. OIDC/trusted publication, public provenance identity, tagged release builds, signing/verification, registry staging, branch/tag/release protections and long-term historical archive evidence remain open.


## P13-20 historical archive closure

PR #74 merged the non-expiring Git-history archive machinery and generated third-party notices. Post-merge **main CI #988** on commit `974fa1032c0d95c98889ca6f9bfaaa696c95fe9e` passed **630/630** tests and **102 critical files × 5 = 510** repeated executions with zero unexplained failures, plus CodeQL and the full browser regression suite.

CI #988 generated historical record SHA-256 `b10283f7c456c2a9f2af7713e23e37aaa37139e91d8fd0e91fd8472a76803375`. The exact bytes are retained at `release/history/0.1.0-alpha.1/974fa1032c0d95c98889ca6f9bfaaa696c95fe9e/record.json` and are re-verified with the repository-tracked court.

P13-20 is now RELEASE-VERIFIED. P13 is **13/20 closed**, the whole-product ledger is **263/304**, and `production_closed=false` remains unchanged.


## P11-13 declared browser floor closure

PR #76 freezes a browser minimum only after real retained matrix evidence existed. The supported evidence profile is **Google Chrome 153.0.8010.52 minimum on Ubuntu 24.04 x64**, profile `desktop-chrome153-ubuntu2404-x64-ci`. P14-13 CI #960 independently ran Chrome 153 and live Stable Chrome 154.0.8037.92 twice each through the full installed-distribution product path, with 4/4 passes and zero unexplained failures.

Implementation CI #995 passed **639/639** tests and **520/520** repeated critical-file executions. P11-13 is promoted without claiming Firefox, Safari, Windows, macOS, Android/mobile or weak-device support. P11 is **13/14 closed**, the whole-product ledger is **264/304**, P11-12 remains publication-blocked, and `production_closed=false`.


## P9-03 280-scenario failure registry

PR #77 retains the original W5 v0.4 UI/UX failure matrix byte-for-byte and uses its SHA-locked rows as executable test input. The corpus contains **280 scenarios**, **55 evidence-court classes**, and deliberately uses round-qualified keys because 46 raw IDs are reused across research sections.

Implementation CI #1011 passed **648/648** tests and **530/530** repeated critical-file executions. The dedicated failure-scenario court and same-head P9 rendered court both passed. P9-03 is promoted to PASS-INTEGRATION.

This moves P9 to **15/18** and the whole-product ledger to **265/304**. P9-05, P9-11 and P9-12 remain external/manual/device blockers; `production_closed=false`.


## P16 legal/governance machine closure

PR #78 implementation head `aef779d7b3ba1cc1346bbdbb89dd5ec43c472720` passed CI #1034 with **659/659** tests and **540/540** repeated critical-file executions, zero unexplained failures, CodeQL, the complete browser regression fan-out and Scorecard #67.

The P16 court validates the installed release's dependency/license inventory and notices, all 13 frozen corpus license-provenance records, both retained BCR artifacts and redistribution notices, clean-room provenance, contribution/governance/trademark policy, AI-provider data-egress wording and jurisdiction boundaries. Artifact #11145241386 is retained with digest `sha256:a68bf140bf1ff56026312f4829f3520fa89e1817de09ca408eb4c1010e4617c5`.

Exactly **12/14 P16 gates** are promoted at PASS-INTEGRATION. **P16-01 final project license** and **P16-05 FTO/counsel** remain OPEN_EXTERNAL and cannot be self-closed by CI or AI. Overall ledger is **277/304**, with **27 gates still open** and `production_closed=false`.


## P7 Wave 5 external-device evidence staging

A fail-closed self-hosted evidence harness is now staged for the four remaining P7 resource gates. It does not change the ledger.

The workflow is manual-only, main-only, and requires labeled Linux x64 self-hosted reference-device runners. It records actual 4/8 GiB memory identity, persistent-browser weak-device samples, an >=8-hour soak path, and a real suspend/resume + CPU-contention lifecycle path. Synthetic cgroup down-capping, shortened soak runs, visibility-only lifecycle simulation and a single calibration campaign are explicitly non-qualifying.

The same receipts are designed to become input evidence for P9-12 and P14-14, but neither gate is promoted by this infrastructure commit. Overall closure remains **277/304** and `production_closed=false`.


The Wave 5 aggregator refuses mixed-commit evidence and requires four retained receipt classes (4 GiB, 8 GiB, >=8-hour soak, lifecycle). Its output is candidate-only; it cannot mutate the production ledger. Even a fully valid aggregate leaves the weak-device budget gates blocked for a separately preregistered validation campaign.


## Weak-device UI budget preregistration

The real product shell now has a self-hosted weak-device UI sampler plus a deterministic budget freeze/validation protocol. Calibration requires 2 runs per 4/8 GiB class. Validation devices must be disjoint from calibration, product-source fingerprint must match, and P9-12 requires an >=8-hour UI soak.

No gate is promoted by this infrastructure. P7-12, P9-12 and P14-14 remain open; overall closure stays **277/304** with `production_closed=false`.

The calibration/validation receipts are additionally bound to a separate **measurement-protocol fingerprint** covering the UI sampler, UI court, budget implementation and frozen protocol. This prevents reusing old calibration after changing how measurements or thresholds are computed.


## External release evidence verifier

A read-only external-release court is now staged for future real npm/GitHub Release identities. It accepts no publishing token and has only `contents: read`.

When a real canary/beta/RC exists, the court checks out its immutable tag, downloads the npm registry tarball, rebuilds the tagged source deterministically, and requires byte identity between the deterministic build, npm tarball and GitHub Release asset. It then verifies npm registry signatures/provenance, GitHub Release asset attestation, repository-scoped GitHub artifact attestation, clean registry installation, published lifecycle/failure documentation examples and the complete installed browser product path.

An RC dispatch additionally reruns the frozen-floor and newest-Stable browser lanes on that exact tag. The core verifier intentionally leaves P1-14 blocked until those RC matrix receipts are reviewed together.

This infrastructure does not publish anything and does not alter the ledger. P13-03 trusted-publisher configuration, P13-17 repository protection, P14-04 adjacent real-release compatibility and P14-12 production CDN topology remain separate external obligations. Overall closure remains **277/304** and `production_closed=false`.


## External runtime evidence staging

A new read-only evidence wave stages two real-world courts without changing the production ledger.

The public deployment court is bound to an exact release tag/version, requires a public HTTPS DNS hostname, rejects private/loopback resolution, verifies an authorized TLS certificate and HSTS, requires an edge-injected marker that equals the declared topology ID, reruns the full hosting self-check through the public edge, checks the deployed production profile version and then opens the real product shell in Chrome to prove readiness plus cross-origin isolation/storage/Web Locks. Passing evidence can only mark P1-13 and P14-12 as READY_FOR_REVIEW.

The adjacent published-release court requires two directly adjacent npm versions, verifies npm package signatures for both, and runs the actual installed artifacts on one browser origin with one persistent Chrome profile/OPFS. The previous release seeds canonical storage, the current release reuses or migrates it, the previous release then reopens safely (read-write only for identical schema, otherwise read-only or refuse-open), and the current release finally proves canonical state survived the rollback attempt. Passing evidence can only mark P14-04 READY_FOR_REVIEW.

Neither workflow publishes, deploys or writes repository state. Overall closure remains **277/304** and `production_closed=false`.


## External trust-state and human-review intake

A new read-only evidence wave stages the remaining P12/P13 external review inputs without changing the production ledger.

`.github/workflows/repository-trust-state.yml` requires a separately configured `OPENCONTAINER_REPO_ADMIN_READ_TOKEN` inside the `external-trust-state` environment. The token is used only to read GitHub private-vulnerability-reporting, main-branch protection and repository ruleset state. The receipt never retains the token. A verified enabled private-vulnerability channel may mark P12-17 `READY_FOR_REVIEW`; repository protection state is captured for P13-17 but still requires policy/human review and cannot self-close the gate.

`.github/workflows/external-security-review-evidence.yml` verifies an external public HTTPS JSON review artifact by exact SHA-256 and source commit. P12-18 evidence must come from a human independent reviewer and cover isolation, storage and network. P12-20 evidence must explicitly be a human product-security review. Critical/high findings must be resolved or accepted in the artifact.

Both P12 review gates remain non-machine-closable. Overall closure remains **277/304** and `production_closed=false`.
