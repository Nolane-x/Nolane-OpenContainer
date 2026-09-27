# P13 Supply-Chain Security Review

OpenContainer treats supply-chain evidence as a release court, not as a marketing score. The review is fail-closed and runs after the publish-equivalent distribution has been certified and the release-evidence bundle has been rebuilt and independently verified.

## What the court proves

The court mechanically verifies:

- all remote GitHub Actions in CI/maintenance are pinned to full commit SHAs;
- PR/main CI remains least-privilege and contains no npm publication token, trusted-publishing permission or release command;
- the release artifact carries independent SHA-256/SHA-512 checksums;
- SPDX 2.3 SBOM is bound to the exact artifact digest;
- in-toto/SLSA provenance binds the source commit and package-lock digest;
- the release manifest records exact Node/npm plus frozen toolchain identity;
- the exact tarball digest is the same artifact previously exercised by distribution certification;
- dependency/license inventory separates runtime direct/transitive, optional adapters and source dev/test-only dependencies;
- Core currently ships zero separately packaged optional-adapter bundles, and that zero is explicit policy rather than an omitted category;
- two independent staging builds are byte-identical;
- the distribution content policy rejects test/secret/private-corpus namespaces, secret patterns and host-local paths;
- the P17 compromised-publishing-credential drill includes suspension, credential revocation/rotation, release invalidation, clean provenance rebuild, user warning and post-incident review.

## Gates intentionally left open

This review does **not** manufacture external trust. P13-03 OIDC/trusted publishing, P13-04 provenance for an actually published OpenContainer identity, P13-07 immutable release-tag build, P13-09/10 signing and verification, P13-16 registry canary/staging publication, P13-17 repository protection settings, P13-18 OpenSSF/OSPS evidence and P13-20 long-term historical archive remain open.

The root project remains `UNLICENSED`; P16 legal/FTO is independent. `production_closed=false`.
