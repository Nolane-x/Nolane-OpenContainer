# Historical Release Verification Archive

This directory is the long-term verification store for OpenContainer release metadata.

A promoted record lives at:

`release/history/<version>/<sourceCommit>/record.json`

Each record embeds, with byte counts and SHA-256 digests:

- release manifest
- independent checksum file
- SPDX 2.3 SBOM
- in-toto/SLSA provenance
- dependency/license inventory
- generated third-party notices
- reproducibility evidence

The archive medium is Git source history. Records have no automated expiry, a minimum ten-year retention policy, remain required while any historical version may need verification, and may be deleted only when a superseding archive preserves equivalent or stronger verification evidence.

The archive is verification metadata, not a binary mirror. It retains the historical artifact filename, size, SHA-256 and SHA-512, while the artifact bytes themselves remain a separate distribution/publication concern.

## Promotion rule

A pull-request candidate is never enough to close P13-20 because GitHub may test a synthetic merge commit. The archive machinery must first land on `main`. Post-merge `main` CI then generates the candidate for the real source commit. Only those exact bytes may be committed to `release/history/`.

The repository verifier must subsequently pass with `--require-repository`, proving that the record is tracked in Git at the canonical archive path and that all embedded verification material remains internally concordant.

This archive does not establish public package publication, signing, legal/FTO closure, or overall production closure.
