# Nolane OpenContainer

**OpenContainer** is an open, self-hostable, browser-native development runtime being built to execute useful Node.js/web-development workloads without requiring a per-user cloud VM.

This repository is now the **implementation repository**. The research phase produced the contracts and falsification gates; code here must earn its own evidence.

## Current implementation

The first runtime wave is live in source form and implements the constitutional S1–S9 skeleton end to end:

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
- generation-checked VFS transactions and stale-writer rejection;
- `/workspace` guest containment and trusted internal namespace separation;
- bounded process output and pre-execution resource reservations;
- frozen package-lock compilation into distinct content, instance, and logical-location identities;
- deny-by-default external networking with canonical URL authorization;
- authority-epoch preview routing with stale-route rejection;
- committed-generation snapshots and streaming export prototype;
- stable machine-readable errors and secret redaction;
- exact toolchain profile checks that reject silent Rolldown binding skew.

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

Open `http://localhost:4173`. The local server emits COOP/COEP headers so future SharedArrayBuffer/Worker work can be integrated without changing the development topology.

## Production status

**Not production-closed.** The implementation is now real, but browser/runtime promotion remains evidence-gated. Exact Lightning CSS bytes/differential, Vite C1/C2, clean-browser PC-A/PC-B, OPFS durability, Node compatibility, security/device/release and FTO gates are still open.

See:

- [`docs/architecture/CORE-SURFACES.md`](docs/architecture/CORE-SURFACES.md)
- [`docs/implementation/STATUS.md`](docs/implementation/STATUS.md)
- [`research/reference/W5-HANDOFF-v1.33.md`](research/reference/W5-HANDOFF-v1.33.md)

## License

The research program identified Apache-2.0 as a reasonable candidate, but the public project license is intentionally **not frozen yet** pending dependency/test-corpus licensing and FTO review. Do not infer a license grant from repository visibility.
