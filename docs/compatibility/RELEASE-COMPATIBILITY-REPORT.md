# Release Compatibility Report — 0.1.0-alpha.1 Canary

This report is the human-readable companion to `release/RELEASE-COMPATIBILITY-REPORT.v1.0.json`. It is generated for the current canary candidate and the declared evidence profile **desktop-chrome153-ubuntu2404-x64-ci**.

It is **not** a cross-browser support matrix, proof of an externally published OpenContainer package, or a production-closure claim. Its only browser-floor declaration is the evidence-backed Chrome 153.0.8010.52 minimum for the named Ubuntu 24.04 x64 profile.

## Compatibility surfaces

The compatibility baseline reports filesystem, module, process, HTTP, package and watch surfaces independently. No synthetic “Node compatibility percentage” is published.

## Known limitations

- pnpm and yarn lockfiles are not accepted by the promoted frozen package graph parser.
- native .node addons and arbitrary node-gyp/native binary execution are unsupported.
- generic fs.watch/chokidar parity is not promoted.
- raw guest TCP/UDP and arbitrary host process creation are unsupported.
- browser minimum is frozen only for the declared Chrome/Ubuntu evidence profile; other browser/OS profiles remain unverified.

## Unsupported Core classes

- **native-addons** — Native .node addons, node-gyp and arbitrary host-native binaries are unsupported in Core 1.x.
- **raw-tcp-tls** — Arbitrary raw TCP/UDP/TLS socket semantics are unsupported in Core 1.x.
- **full-linux** — Full Linux/POSIX process, device and host-filesystem semantics are unsupported in Core 1.x.
- **undeclared-browser-profiles** — Browser/OS/device profiles without retained evidence are unsupported and must not be marketed as supported.

## Current known issues / evidence gaps

- **KI-001 browser matrix:** Chrome 153.0.8010.52 is now the minimum only for the declared Ubuntu 24.04 x64 evidence profile; cross-browser and other-OS rows remain unverified.
- **KI-002 weak-device:** 4/8 GiB weak-device floor, long-run plateau and memory-pressure evidence remain open.
- **KI-003 publication:** no external npm publication/GitHub Release identity is certified yet.
- **KI-004 security reporting:** a verified private vulnerability disclosure channel is not yet recorded.

## Browser / OS / profile matrix

The per-release browser/OS/profile matrix is published separately in `docs/compatibility/RELEASE-COMPATIBILITY-MATRIX.md`. It freezes Chrome 153.0.8010.52 only for the evidence-backed Ubuntu 24.04 x64 row and keeps broader profiles explicit and unverified.

## Release boundaries

P11-12 remains open until the actual published OpenContainer package/bundle is exercised. P11-13's floor is profile-scoped to Chrome 153+ on Ubuntu 24.04 x64 and does not imply cross-browser support. Weak-device/resource, private disclosure, public publication and full production closure remain separate gates.

`production_closed=false`.
