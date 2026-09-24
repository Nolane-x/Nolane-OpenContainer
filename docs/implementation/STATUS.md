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
