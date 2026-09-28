# Release Compatibility Report — 0.1.0-alpha.1 Canary

This report is the human-readable companion to `release/RELEASE-COMPATIBILITY-REPORT.v1.0.json`. It is generated for the current canary candidate and the declared evidence profile **desktop-chrome153-ubuntu2404-x64-ci**.

It is **not** a cross-browser support matrix, a browser-floor declaration, proof of an externally published OpenContainer package, or a production-closure claim.

## Compatibility surfaces

The compatibility baseline reports filesystem, module, process, HTTP, package and watch surfaces independently. No synthetic “Node compatibility percentage” is published.

## Known limitations

- pnpm and yarn lockfiles are not accepted by the promoted frozen package graph parser.
- native .node addons and arbitrary node-gyp/native binary execution are unsupported.
- generic fs.watch/chokidar parity is not promoted.
- raw guest TCP/UDP and arbitrary host process creation are unsupported.
- minimum cross-browser versions are intentionally not frozen before browser matrix evidence.

## Unsupported Core classes

- **native-addons** — Native .node addons, node-gyp and arbitrary host-native binaries are unsupported in Core 1.x.
- **raw-tcp-tls** — Arbitrary raw TCP/UDP/TLS socket semantics are unsupported in Core 1.x.
- **full-linux** — Full Linux/POSIX process, device and host-filesystem semantics are unsupported in Core 1.x.
- **undeclared-browser-profiles** — Browser/OS/device profiles without retained evidence are unsupported and must not be marketed as supported.

## Current known issues / evidence gaps

- **KI-001 browser matrix:** minimum browser floors and cross-browser matrix are not frozen.
- **KI-002 weak-device:** 4/8 GiB weak-device floor, long-run plateau and memory-pressure evidence remain open.
- **KI-003 publication:** no external npm publication/GitHub Release identity is certified yet.
- **KI-004 security reporting:** a verified private vulnerability disclosure channel is not yet recorded.

## Browser / OS / profile matrix

The per-release browser/OS/profile matrix is published separately in `docs/compatibility/RELEASE-COMPATIBILITY-MATRIX.md`. It carries one evidence-backed Chrome/Ubuntu row and explicit unverified rows for broader profiles; it does not freeze browser minimums.

## Release boundaries

P11-12 remains open until the actual published OpenContainer package/bundle is exercised. P11-13 remains open until real browser-matrix evidence exists and minimum versions can be frozen. Weak-device/resource, private disclosure, public publication and full production closure remain separate gates.

`production_closed=false`.
