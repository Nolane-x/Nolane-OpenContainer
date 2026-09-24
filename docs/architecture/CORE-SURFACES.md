# OpenContainer Core 1.x — Surface Constitution

OpenContainer owns exactly nine semantic surfaces. Internal packages may grow; the public product surface must not.

| Surface | Public namespace | Authority in this implementation wave |
|---|---|---|
| S1 Runtime Kernel & Lifecycle | `runtime` | `OpenContainerKernel` |
| S2 Virtual Filesystem | `runtime.fs` | `MemoryVFS` transaction authority |
| S3 Processes & Streams | `runtime.process` / `runtime.spawn()` | `ProcessSupervisor` |
| S4 Package / Module Environment | `runtime.packages` | `PackageGraphAuthority` |
| S5 External Network Capability | `runtime.net` | `NetworkAuthority` |
| S6 Virtual HTTP / Preview | `runtime.preview` / `runtime.listen()` | `PreviewAuthority` |
| S7 Persistence / Snapshot / Export | `runtime.snapshots` | `MemoryPersistenceAuthority` |
| S8 Resource Governance | `runtime.resources` | `ResourceGovernor` |
| S9 Diagnostics / Evidence | `runtime.diagnostics` | `DiagnosticJournal` |

Security, testing, compatibility, benchmarks, protocol, and toolchain identity are cross-cutting assurance/internal packages. They are not an additional Core surface.

## Constitutional invariants implemented now

- Kernel lifecycle is monotonic: `NEW -> BOOTING -> READY -> DRAINING -> TERMINATED`, with explicit `FAILED` handling.
- One runtime object has one boot promise.
- VFS writes publish by generation; stale transactions fail instead of overwriting newer state.
- Guest paths are contained under `/workspace`; trusted `/opencontainer/internal` is not guest-visible.
- Processes reserve resources before execution and output is bounded.
- Frozen package-lock input is compiled into runtime graph identities instead of becoming live mutable truth.
- External networking is deny-by-default and URL policy uses canonical WHATWG parsing.
- Preview route replacement is authority-epoch and owner aware.
- Snapshots refer to committed VFS generations.
- Errors have stable codes and diagnostic detail is redacted before journaling.

## Intentionally not claimed yet

This wave does not claim complete Node 24 compatibility, OPFS durability, Worker isolation for arbitrary guest code, npm artifact installation, Vite C1/C2, clean-browser PC-A/PC-B closure, device matrix closure, security/FTO closure, or release readiness.
