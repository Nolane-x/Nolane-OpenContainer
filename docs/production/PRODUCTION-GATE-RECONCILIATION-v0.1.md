# OpenContainer Production Gate Reconciliation v0.1

**Source of truth:** `OPENCONTAINER-PRODUCTION-GATES-v0.9.json` from W5 v1.33 research bundle.

**Rule:** an unreconciled gate remains open. Evidence level never auto-satisfies a stronger minimum closure. Aggregate percentages never override a critical open gate.

## Inventory

- Gates: **304**
- Domains: **19**
- Seed-reconciled against implementation evidence: **58**
- Production closed: **false**

## Domain reconciliation state

| Domain | Seed evidence/partial | Unreconciled | Total |
|---|---:|---:|---:|
| P0 Product scope & production profile | 2 | 10 | 12 |
| P1 Browser deployment, origin & lifecycle | 7 | 9 | 16 |
| P2 Kernel, RPC, process & stream semantics | 6 | 8 | 14 |
| P3 VFS, OPFS, persistence & data safety | 9 | 11 | 20 |
| P4 Packages, resolver, archive & installer | 6 | 12 | 18 |
| P5 Network, secrets & preview edge | 0 | 18 | 18 |
| P6 Toolchain, BCR, Vite & framework integration | 8 | 8 | 16 |
| P7 Resources, performance & weak-device behavior | 2 | 12 | 14 |
| P8 Diagnostics, supportability & privacy | 0 | 14 | 14 |
| P9 UI/UX, accessibility & human safety | 0 | 18 | 18 |
| P10 AI consumer, authority & data egress | 0 | 18 | 18 |
| P11 Compatibility corpus & certification | 10 | 4 | 14 |
| P12 Product security engineering | 2 | 18 | 20 |
| P13 Build, supply chain & publication | 0 | 20 | 20 |
| P14 Release, update, migration & rollback | 0 | 18 | 18 |
| P15 SDK, API, documentation & developer experience | 6 | 8 | 14 |
| P16 License, FTO, governance & contribution policy | 0 | 14 | 14 |
| P17 Operations, vulnerability response & long-term maintenance | 0 | 14 | 14 |
| P18 Evidence, assurance & research integrity | 0 | 12 | 12 |

## Immediate implementation gaps confirmed during reconciliation

- The real-repository corpus is now frozen and machine-verified; broader repository execution, repeated-browser progression and release compatibility certification remain open.
- 4/8 GiB reference-device campaign, 8-hour plateau and cross-browser release matrix remain open.
- Release trust chain (SBOM/provenance/publication/rollback) and license/FTO closure remain open.

## Newly reconciled in this wave

- **P0-02** now has a canonical machine-readable runtime/filesystem/network/snapshot/protocol identity, with a public JSON artifact drift-checked against the SDK and verified in Chrome. Its required `RELEASE-READY` closure is still open.

- **P3-16** now has Chrome evidence that public SDK export pins one committed generation; minimum production closure is still not claimed.
- **P15-07** now has explicit storage/checkpoint/export semantics documentation.
- **P15-11** now has a minimal public SDK lifecycle example covering mount/spawn/preview/snapshot/export/teardown.
- **P15-12** now has CI execution of that repository example; published-package sample testing remains open.

- **P1-13 / P1-16 / P15-04** now have an executable hosting self-check and exact header diagnostics, plus published secure-hosting guidance. Production CDN/reverse-proxy validation remains open.

- **P11-01 / 02 / 03 / 04 / 06 / 09 / 10** now meet their integration-level minimum closure: the 13-repository corpus is frozen before tuning, required case classes/package strata and unsupported classes are CI-enforced, six compatibility axes are reported separately, a machine-readable baseline is generated from the tested corpus, and adapter semantics are explicit.
- **P11-05** remains partial: commits, lockfiles, licenses and selected source blobs are pinned; supported npm lockfiles verified 219 + 8 graph nodes with zero missing integrity entries, but package-tarball digest coverage is not closed for every corpus class.
- **P11-07** remains partial despite the first real-repository Chrome pass: primitive -> package -> framework -> real repository is evidenced, but repeated-browser progression is still open.
- **P11-14** remains partial: known limitations are published with the baseline, but "every release compatibility report" cannot close before release certification exists.
- Pinned `sindresorhus/yoctocolors@a85b98a90e5731914567d8c209e7ec45ac2d24e2` executed through Workspace VFS -> native ESM publication -> bounded `node:tty` -> isolated Dedicated Worker in CI #286.

## Update discipline

Every substantive PR should update the JSON ledger only for gate IDs it directly produces evidence for. A gate remains `closure_met=false` until its exact `minimum_closure` is satisfied.
