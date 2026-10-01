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


## OpenSSF hygiene court

P13-18 now has a retained official OpenSSF Scorecard run. The workflow pins Scorecard Action v2.4.4 to `2d1146689b8cda280b9bc96326124645441f03bc`, keeps permissions read-only, disables public result publication, retains raw JSON and verifies a normalized receipt. The promoted run used Scorecard v5.5.0 and scored **6.9/10 across 11 checks**.

This result is intentionally not treated as a release score. Low findings remain visible, including License 0 while P16 remains legally open, Dependency-Update-Tool 0, Packaging unavailable (-1) and Fuzzing 0. P13-18 is supplemental hygiene evidence only; external publication, signing, branch protection and long-term archive gates remain independent.


## Historical release verification archive

P13-20 now has a **RELEASE-VERIFIED** source-controlled historical verification record generated from the real post-merge `main` commit.

Every release-evidence build now emits `third-party-notices.json` from the installed production dependency inventory. The historical archive candidate embeds seven exact verification files: release manifest, SHA-256/SHA-512 checksums, SPDX 2.3 SBOM, in-toto/SLSA provenance, dependency/license inventory, third-party notices and reproducibility evidence. Each payload is base64-retained with byte count and SHA-256.

The archive policy uses `git-source-history`, has no automated expiry, specifies at least ten years of retention, requires retention while any historical version may need verification, and forbids deletion without a superseding archive. Artifact binary bytes are deliberately not claimed as archived; the record preserves the cryptographic identity and verification evidence needed to authenticate a historical artifact obtained through its distribution channel.

PR #74 completed the first stage and merged at `974fa1032c0d95c98889ca6f9bfaaa696c95fe9e`. Post-merge main CI #988 generated record SHA-256 `b10283f7c456c2a9f2af7713e23e37aaa37139e91d8fd0e91fd8472a76803375`; those exact bytes are now committed under the canonical `release/history/0.1.0-alpha.1/974fa1032c0d95c98889ca6f9bfaaa696c95fe9e/record.json` path and must pass `--require-repository` verification. This closes P13-20 only; external publication, signing, OIDC, repository protections and legal/FTO remain independent.


## Repository-protection state capture

P13-17 requires external repository-administration evidence rather than repository-file inference. The manual `repository-trust-state` court therefore reads main branch protection and repository rulesets using a dedicated admin-read token. The token is never archived.

The court records raw protection state and may report that protection exists, but it deliberately does not declare the settings sufficient for P13-17. A separate human/policy review remains mandatory before any ledger promotion. Public ruleset discovery returning an empty list and an integration being unable to read branch protection are not treated as closure evidence.
