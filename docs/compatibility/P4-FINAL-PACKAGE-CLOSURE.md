# P4 Final Package Closure Boundary

This document freezes the intended boundary for the four remaining P4 package gates. It does not expand OpenContainer into a host shell, generic filesystem watcher, vulnerability scanner, or performance guarantee.

## P4-07 — parser fuzzing

The retained corpus in `compat/p4/PARSER-FUZZ-CORPUS.v1.0.json` covers TAR, gzip, package manifest and package-lock parsing. Minimized failure inputs are retained as regression fixtures and may only be removed when the parser contract changes intentionally with replacement evidence.

Seeded mutation campaigns must never leak raw parser exceptions such as untyped `TypeError`, DOM decompression failures or `RangeError` across the package parser boundary. Invalid inputs fail through stable `OC_*` errors.

## P4-13 — lifecycle scripts

Lifecycle scripts are denied by default. `skip` remains explicit and auditable.

Execution requires possession of a `PackageScriptCapability` that grants the exact package location, lifecycle event and exact command string. A changed command does not inherit an old grant. The executor context contains an empty environment and zero secret/network-secret handles. Package installation itself continues to reject ambient secret handles.

This capability is an explicit embedding hook, not host-shell authority and not generic npm lifecycle parity.

## P4-15 — package layout lifecycle

`watchPackageLayout()` is a dedicated package-catalog generation watcher. It reports package layout publication/removal/invalidation events across install, direct reinstall, remove and graph invalidation.

The court verifies `readdir()` and `realpath()` against the virtual package layout at each relevant generation, including workspace links.

This does **not** claim generic Node `fs.watch`, chokidar or host-filesystem watcher parity.

## P4-16 — measurement scope

The release court records:

- packed and unpacked bytes for the retained published npm tarball corpus;
- aggregate package-storage amplification;
- startup raw-package-lock-text → JSON parse → package-graph construction cost for the frozen 219-node Vite tree and 8-node Chokidar tree;
- Node and Chrome timing receipts with warmup and repeated iterations.

These are measurements for the declared evidence profile, not universal performance guarantees. No production performance threshold is frozen by this gate alone.

`production_closed=false`.
