# Release Evidence Bundle

OpenContainer release evidence is generated from the same publish-equivalent npm tarball used by distribution certification.

`npm run release:evidence` builds the distribution twice in independent staging directories. The command fails unless the two outputs are byte-identical by SHA-256, SHA-512 and byte size. It then writes a release-evidence directory containing:

- the exact `@nolane/opencontainer` tarball;
- `checksums.txt`, separate from human-written release notes;
- an SPDX 2.3 JSON SBOM bound to the tarball digest;
- an in-toto Statement using the SLSA provenance v1 predicate, bound to the source commit, package-lock digest and build environment;
- a dependency/license inventory separating runtime, optional-adapter and source dev/test-only categories;
- a reproducibility receipt;
- a machine-readable release manifest binding the evidence together.

`npm run release:verify` independently re-hashes the artifact and verifies those bindings.

## CI evidence

CI #319 on implementation head `144299359225975dc8cf54a10c7704c992ff2215` passed the contract and installed-distribution Chrome product path.

The release-evidence verifier reported:

- artifact SHA-256: `47675569cf0b5c2dd69fdd295ce4dc5ad2df54e87b5f98dfb39941efd5190c7a`;
- 38 SPDX packages, including the OpenContainer root package;
- 37 runtime dependency components;
- byte-for-byte reproducibility across two independent staging builds;
- zero distribution content-policy violations;
- `productionClosed=false`.

The CI workflow archived seven release-evidence files for 90 days. GitHub Actions used immutable action commit references and the workflow retained `contents: read` permissions.

## Distribution-content policy

Before npm packing, the staged distribution rejects:

- test/test-fixture directory namespaces;
- `.env`, `.git`, `.github`, secrets and private-corpus paths;
- private-key material and selected API-key patterns;
- build-runner/macOS/Windows host-local user paths.

The frozen source lock is packaged under `metadata/source-package-lock.json`, not a fixture namespace.

## Evidence boundary

This bundle is **not** a signed release attestation. The provenance statement is machine-verifiable for internal consistency, but it is not cryptographically authenticated to a trusted release identity.

The following remain separate release gates:

- OIDC/trusted publishing;
- signature or keyless attestation production and verification policy;
- build from an immutable release tag;
- public npm/GitHub Release publication;
- branch/tag/release protection;
- compromised-release revocation/yank procedure;
- long-term historical archive policy;
- project license/FTO closure.

Accordingly, current P13 evidence improves release readiness but does not satisfy SECURITY-REVIEWED / RELEASE-VERIFIED minimum closure by itself.
