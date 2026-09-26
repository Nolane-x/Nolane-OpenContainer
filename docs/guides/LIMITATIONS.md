# Runtime Limitations and Safe Alternatives

OpenContainer is a browser-native runtime, not a browser escape hatch. Compatibility claims are bounded by browser security and the promoted runtime profile.

## Native addons

Native `.node` addons, node-gyp builds and arbitrary host-native binaries are unsupported.

Use one of these instead:

- a WASM build with pinned bytes and an explicit browser execution path;
- a pure-JavaScript package;
- a browser-native API exposed through a reviewed OpenContainer adapter;
- a separate trusted backend/service when the capability fundamentally requires host-native access.

Do not hide a native requirement behind install scripts. Lifecycle scripts are denied by default.

## Host filesystem and shell

Guest code cannot access arbitrary host paths or spawn the host shell.

Use Workspace VFS, OPFS-backed checkpoints, portable export/import and registered virtual commands. External-folder access requires a separate product integration with explicit user permission; it is not part of Core.

## Raw sockets

Raw TCP/UDP sockets are unavailable. Arbitrary Node `net`/`tls` semantics are not claimed.

Use capability-authorized `fetch()`, virtual HTTP/preview routes, WebSocket only through an explicitly supported consumer policy, or move raw-socket work to a trusted backend.

## Browser network policy

Guest fetch is denied unless it belongs to the active publication/session or is explicitly authorized by the consumer's network policy. Same-origin does not automatically mean trusted.

Use the public network authority or a consumer adapter that grants the narrow destination/method policy required by the task.

## Package managers

The promoted frozen installer accepts npm `package-lock` v2/v3 with integrity metadata. pnpm and Yarn lockfiles remain compatibility-corpus boundaries, not install authorities.

Convert/freeze the dependency graph through a supported npm lockfile or add a separately reviewed lockfile adapter. Do not silently reinterpret another package manager's lockfile.

## Filesystem watch

Vite's promoted HMR path is supported. Generic Node `fs.watch` / chokidar parity is not a production claim.

For application UX, subscribe to OpenContainer-owned generation/HMR events. For tools requiring full host filesystem watcher semantics, use a different execution environment or add a dedicated browser-safe adapter.

## Process model

OpenContainer virtual processes are supervised commands/Workers, not OS processes. `child_process`, fork, signals and PID semantics are intentionally bounded.

Use `runtime.registerCommand()` and `runtime.spawn()` for supported commands. If a tool fundamentally requires process-tree/TTY/OS semantics, run it outside Core.

## Storage durability

OPFS is browser-managed storage and may be quota constrained or evicted. In-memory snapshots are not durable backups.

Use `workspacePersistence` for local checkpointing and offer portable `runtime.export()` as the escape hatch. Products that require stronger durability should additionally sync/export to storage they control.

## Compatibility rule

A package or framework is not considered supported merely because one import succeeds. Support requires the relevant package, module, process, HTTP, watch and browser courts for the promoted profile.
