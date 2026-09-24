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
