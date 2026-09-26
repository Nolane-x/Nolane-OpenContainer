# Nolane OpenContainer

**OpenContainer** is an open, self-hostable, browser-native development runtime being built to execute useful Node.js/web-development workloads without requiring a per-user cloud VM.

This repository is now the **implementation repository**. The research phase produced the contracts and falsification gates; code here must earn its own evidence.

## Current implementation

OpenContainer is now an executable alpha runtime rather than a specification repository. The constitutional S1–S9 foundation is implemented, and the implementation has advanced into package/module compatibility and frozen toolchain execution gates:

```js
import { OpenContainer } from './packages/sdk/src/index.js';

const runtime = await OpenContainer.boot();

runtime.mount({
  'package.json': '{"name":"hello-opencontainer"}',
  'src/index.js': 'export default "hello";'
});

runtime.registerCommand('echo', ({ argv, stdout }) => {
  stdout(argv.slice(1).join(' '));
  return 0;
});

const process = runtime.spawn('echo', ['hello']);
await process.exit;
```

The public mental model stays deliberately small:

```text
runtime
runtime.fs
runtime.process
runtime.packages
runtime.net
runtime.preview
runtime.snapshots
runtime.resources
runtime.diagnostics
```

Internal protocol/toolchain packages do not create extra product surfaces.

## What is already enforced

- monotonic runtime lifecycle and one-boot-per-runtime semantics;
- generation-checked VFS transactions, stale-writer rejection and workspace containment;
- restart-safe Worker RPC authority with session/epoch stale-response rejection and bounded RPC timeouts;
- real Chrome Dedicated Worker + disposable Service Worker native-ESM execution with generation restart and stale-session rejection;
- recoverable dual-slot OPFS checkpoint publication with SHA-256 payload identity, now exercised against real browser OPFS recovery;
- bounded virtual processes, captured stdout/stderr and package CommandIndex execution;
- frozen package-lock compilation into content, instance and logical-location identities;
- verified package tarball ingestion with SRI, traversal/link rejection, expansion ceilings and capability-checked redirect hops;
- real-browser retained-package fetch → immutable PackageContent → VNFS → resolver acceptance;
- immutable PackageContent deduplication plus VirtualNodeModulesFS projection;
- Node-style CJS/ESM resolution with selected exact Node 24.21.0 differential receipts;
- guarded CommonJS execution with cache/cycle/JSON semantics and logical Node builtins;
- VFS-backed `fs`/`fs/promises`, `path`, `url`, `events`, `buffer`, `process` and `module` compatibility subsets;
- deny-by-default external networking with canonical URL authorization;
- authority-epoch preview routing with stale-route rejection;
- committed-generation snapshots and streaming export prototype;
- public snapshot/restore plus pinned streaming NDJSON export/import through the SDK;\n- stable machine-readable errors, secret redaction and bounded resource governance;
- exact toolchain profile checks that reject silent Rolldown binding skew;
- a verified WasmArtifactManager that gates bytes, digest and compiled module shape;
- retained exact `lightningcss-wasm@1.33.0` npm tarball with CI-reverified inner WASM identity;
- reverified official Rolldown 1.2.9 WASI artifact provenance and executable profile.

## Run the contract suite

The frozen research oracle is Node `24.21.0` / npm `11.19.0` and CI is configured for that exact pair.

```bash
npm ci
npm run ci
```

The repository has no runtime npm dependencies in this wave.

## Playground

```bash
npm run playground
```

Open `http://localhost:4173`. The local server emits COOP/COEP headers required by the promoted SharedArrayBuffer/Worker browser execution path.

## Production status

**Not production-closed.** The implementation is real and CI-green, but browser/runtime promotion remains evidence-gated.

The exact browser toolchain path is now promoted through clean Chrome CI: retained Lightning CSS executes through its verified WASM, retained Rolldown 1.2.9 executes through the browser WASI/N-API path, and Vite 8.3.0 passes both C1 production-build and C2 dev/HMR courts. C2 also proves virtual HTTP, safe HMR failure/reconnect/recovery, same-port preview epoch restart, Service Worker route rehydration and real dependency optimization into `.vite/deps`.

The major remaining gates are broader Node compatibility/isolation, deeper OPFS persistence/quota/eviction/multi-tab integration, broad npm package-policy compatibility, PC-A/PC-B target-device/browser campaigns, weak-device/resource-budget and long-run/fault/security/release testing, plus dependency/test-corpus licensing and FTO/legal closure.

See:

- [`docs/architecture/CORE-SURFACES.md`](docs/architecture/CORE-SURFACES.md)
- [`docs/implementation/STATUS.md`](docs/implementation/STATUS.md)\n- [`docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.md`](docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.md)\n- [`docs/guides/SDK-QUICKSTART.md`](docs/guides/SDK-QUICKSTART.md)\n- [`docs/guides/STORAGE-AND-EXPORT.md`](docs/guides/STORAGE-AND-EXPORT.md)
- [`docs/guides/HOSTING-HEADERS.md`](docs/guides/HOSTING-HEADERS.md)
- [`docs/compatibility/REAL-REPOSITORY-CORPUS.md`](docs/compatibility/REAL-REPOSITORY-CORPUS.md)
- [`docs/compatibility/COMPATIBILITY-BASELINE.v0.1.json`](docs/compatibility/COMPATIBILITY-BASELINE.v0.1.json)
- [`docs/compatibility/PROMOTION-GOVERNANCE.md`](docs/compatibility/PROMOTION-GOVERNANCE.md)
- [`docs/production/DISTRIBUTION-CERTIFICATION.md`](docs/production/DISTRIBUTION-CERTIFICATION.md)
- [`docs/production/RELEASE-EVIDENCE.md`](docs/production/RELEASE-EVIDENCE.md)
- [`docs/production/RELEASE-PROMOTION.md`](docs/production/RELEASE-PROMOTION.md)
- [`docs/production/SERVICE-WORKER-RELEASE-COMPATIBILITY.md`](docs/production/SERVICE-WORKER-RELEASE-COMPATIBILITY.md)
- [`research/reference/W5-HANDOFF-v1.33.md`](research/reference/W5-HANDOFF-v1.33.md)

## License

The research program identified Apache-2.0 as a reasonable candidate, but the public project license is intentionally **not frozen yet** pending dependency/test-corpus licensing and FTO review. Do not infer a license grant from repository visibility.
