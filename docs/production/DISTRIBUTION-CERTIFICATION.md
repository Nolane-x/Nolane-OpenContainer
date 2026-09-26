# Distribution Certification

OpenContainer compatibility courts now distinguish **source-checkout evidence** from **installed distribution evidence**.

The release-equivalent distribution builder stages `@nolane/opencontainer` into an npm tarball containing the runtime package graph, public SDK, browser playground/bootstraps, retained toolchain artifacts, compatibility/production metadata, guides and executable examples. The artifact is then installed into a clean consumer project before certification.

## Current certification

CI #314 on branch head `76681847318201aaf942bd1376a95c090fb9070d` proved:

- the clean consumer resolves `@nolane/opencontainer` from its own `node_modules`, not the repository checkout;
- public SDK boot/mount/process/preview/snapshot/restore/export/import/status/teardown works from the installed artifact;
- `examples/sdk-lifecycle.mjs` executes from the installed package;
- the complete Chrome browser-product-path executes after changing cwd into the installed package;
- the distribution still reports `productionClosed=false`.

The certified artifact at that evidence point contained 88 files, was 7,765,186 bytes compressed and 8,249,558 bytes unpacked. Its CI receipt recorded SHA-256 `e33d2703fd2ea647651b07b685d01df87f6b7eca46cb8d4ac8b06ef03422ebf9`.

## Evidence boundary

This is **publish-equivalent artifact certification**, not proof that version `0.1.0-alpha.1` was uploaded to npm or attached to a public GitHub Release. P11-12 therefore remains partial until the actual promoted publication artifact is traceably identical to a certified artifact.

Likewise, documentation samples are now tested from the installed tarball, but P15-12 remains partial until those samples are tied to an externally published release package.

A final release pipeline must retain provenance, SBOM, checksums, publication identity and release-channel evidence separately from human-written release notes.
