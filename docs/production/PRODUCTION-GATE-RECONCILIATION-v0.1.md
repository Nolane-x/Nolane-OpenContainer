# OpenContainer Production Gate Reconciliation v0.1

**Source of truth:** `OPENCONTAINER-PRODUCTION-GATES-v0.9.json` from W5 v1.33 research bundle.

**Rule:** an unreconciled gate remains open. Evidence level never auto-satisfies a stronger minimum closure. Aggregate percentages never override a critical open gate.

## Inventory

- Gates: **304**
- Domains: **19**
- Seed-reconciled against implementation evidence: **74**
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
| P11 Compatibility corpus & certification | 13 | 1 | 14 |
| P12 Product security engineering | 2 | 18 | 20 |
| P13 Build, supply chain & publication | 13 | 7 | 20 |
| P14 Release, update, migration & rollback | 0 | 18 | 18 |
| P15 SDK, API, documentation & developer experience | 6 | 8 | 14 |
| P16 License, FTO, governance & contribution policy | 0 | 14 | 14 |
| P17 Operations, vulnerability response & long-term maintenance | 0 | 14 | 14 |
| P18 Evidence, assurance & research integrity | 0 | 12 | 12 |

## Immediate implementation gaps confirmed during reconciliation

- The real-repository corpus is now frozen and machine-verified; broader repository execution, repeated-browser progression and release compatibility certification remain open.
- 4/8 GiB reference-device campaign, 8-hour plateau and cross-browser release matrix remain open.
- Release trust chain now has reproducible artifact/checksum/SBOM/provenance/inventory evidence, but authenticated attestation, public publication, rollback and license/FTO closure remain open.

## Newly reconciled in this wave

- **P0-02** now has a canonical machine-readable runtime/filesystem/network/snapshot/protocol identity, with a public JSON artifact drift-checked against the SDK and verified in Chrome. Its required `RELEASE-READY` closure is still open.

- **P3-16** now has Chrome evidence that public SDK export pins one committed generation; minimum production closure is still not claimed.
- **P15-07** now has explicit storage/checkpoint/export semantics documentation.
- **P15-11** now has a minimal public SDK lifecycle example covering mount/spawn/preview/snapshot/export/teardown.
- **P15-12** now executes the bundled SDK lifecycle example from an installed OpenContainer tarball in a clean consumer. It remains partial until the example is tied to an externally published release package.

- **P1-13 / P1-16 / P15-04** now have an executable hosting self-check and exact header diagnostics, plus published secure-hosting guidance. Production CDN/reverse-proxy validation remains open.

- **P11-01 / 02 / 03 / 04 / 06 / 09 / 10** now meet their integration-level minimum closure: the 13-repository corpus is frozen before tuning, required case classes/package strata and unsupported classes are CI-enforced, six compatibility axes are reported separately, a machine-readable baseline is generated from the tested corpus, and adapter semantics are explicit.
- **P11-05** now meets its integration-level minimum closure: every corpus repository retains commit/license/lockfile identity where applicable; all 9 npm-published frozen package cases pin exact registry tarball URL + SHA-512 + SHA-1, and CI #300 re-downloads every tarball and verifies the bytes. The remaining 4 repository-only cases explicitly record no publication at their frozen root version or a versionless root.
- **P11-07** now meets its minimum closure for the declared Chrome profile: primitive/package/framework evidence already existed, and CI #300 runs two different real repositories (`yoctocolors`, `clsx`) twice each on fresh publication + Dedicated Worker realms, then proves all four stale sessions fail closed with HTTP 504.
- **P11-12** is now substantially stronger but remains partial: CI #314 builds a publish-equivalent `@nolane/opencontainer@0.1.0-alpha.1` tarball, installs it into a clean consumer, runs the public SDK and bundled SDK example from `node_modules`, then runs the entire Chrome browser-product-path from the installed package. External npm/GitHub Release publication identity is still absent, so the gate is not closed.
- **P11-14** remains partial: known limitations are published with the baseline, but "every release compatibility report" cannot close before release certification exists.
- CI #300 promoted repeated real-repository progression: exact `yoctocolors@a85b98a...` and `clsx@925494c...` each execute twice on fresh isolated realms; a separate published-package court fetches and executes the exact npm `clsx@2.1.1` tarball.

- **P11-08** now meets minimum closure: selected Node 24.21.0 differential cases have stable IDs and a fail-closed exception registry; unlisted mismatches and stale exceptions fail CI. The current selected court has zero active hidden discrepancies.
- **P11-11** now meets minimum closure: Alpha/Beta/RC/1.0 thresholds are frozen against the measured baseline before final tuning. CI #309 computes the current level as **Alpha** and refuses to qualify Beta while P11-12/P11-14 remain open/partial.

- **P13-01 / P13-02** now have implementation evidence for immutable GitHub Action refs and least-privilege CI (`contents: read`), but release-credential separation and security review are not yet closed.
- **P13-04 / P13-05 / P13-06** now have a machine-readable in-toto/SLSA provenance statement, SPDX 2.3 SBOM, source commit, package-lock digest, Node/npm/platform identity and artifact digest bound into one release-evidence manifest. The provenance is intentionally unsigned, so authenticated release provenance remains open.
- **P13-07 / P13-08** now have ephemeral CI build plus exact installed-artifact contract/Chrome testing; a tagged immutable release build/promotion receipt is still absent.
- **P13-11** now emits SHA-256 and SHA-512 checksums as an independent artifact rather than release-note prose.
- **P13-12 / P13-13** now emit categorized dependency/license inventory for runtime, optional-adapter and source dev/test-only components. The root project remains explicitly `UNLICENSED`, so this is inventory evidence, not legal closure.
- **P13-14** now fail-closes distribution staging on forbidden test/secrets/private-corpus namespaces, selected secret patterns and host-local paths.
- **P13-15** now requires two independent distribution staging builds to be byte-identical before release evidence is accepted.
- **P13-20** now archives seven release-evidence files as a CI artifact for 90 days. A long-term historical release archive policy remains open.
- CI #319 verified a 7,766,106-byte artifact with SHA-256 `47675569cf0b5c2dd69fdd295ce4dc5ad2df54e87b5f98dfb39941efd5190c7a`, 38 SPDX packages / 37 runtime components, reproducibility=true and zero content-policy violations; the complete installed-distribution Chrome product path remained green.

## Update discipline

Every substantive PR should update the JSON ledger only for gate IDs it directly produces evidence for. A gate remains `closure_met=false` until its exact `minimum_closure` is satisfied.
