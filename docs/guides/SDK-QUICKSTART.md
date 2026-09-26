# SDK Quickstart

This example uses only the public OpenContainer SDK surface. It intentionally does not expose Worker layout or internal authorities.

```js
import { OpenContainer } from './packages/sdk/src/index.js';

const runtime = await OpenContainer.boot();

runtime.mount({
  'package.json': '{"name":"hello-opencontainer"}',
  'src/index.js': 'export const answer = 42;'
});

runtime.registerCommand('echo', ({ args, stdout }) => {
  stdout(args.join(' '));
  return 0;
});

const process = runtime.spawn('echo', ['hello']);
await process.exit;

const route = runtime.listen(3000, () => new Response('ok'));
const snapshot = runtime.snapshot('before-edit');

const archive = runtime.export(snapshot); // ReadableStream<Uint8Array>

const copy = await OpenContainer.boot();
await copy.import(archive);

console.log(runtime.status());

await copy.teardown();
await runtime.teardown();
```

The repository keeps an executable version at `examples/sdk-lifecycle.mjs`; CI executes it so the sample cannot silently drift away from the SDK.

## Failure paths

- invalid snapshot references fail with stable machine-readable errors;
- import rejects malformed or unsupported NDJSON instead of silently creating an empty workspace;
- OPFS persistence is opt-in through `workspacePersistence`; an in-memory snapshot is not a durability promise;
- browser-native limitations such as arbitrary host shell, raw TCP/UDP and native `.node` addons remain explicit unsupported boundaries.
