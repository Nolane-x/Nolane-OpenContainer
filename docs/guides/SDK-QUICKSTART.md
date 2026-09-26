# SDK Quickstart

This example uses only the public OpenContainer SDK surface. It intentionally does not expose Worker layout or internal authorities.

```js
import { OpenContainer } from '@nolane/opencontainer';

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

The installed distribution includes executable examples at `examples/sdk-lifecycle.mjs` and `examples/sdk-failure-paths.mjs`. Distribution certification installs the tarball into a clean consumer and executes both files, so success and failure-path samples cannot silently drift away from the published package shape.

## Failure paths

- invalid snapshot references fail with stable machine-readable errors;
- import rejects malformed or unsupported NDJSON instead of silently creating an empty workspace;
- OPFS persistence is opt-in through `workspacePersistence`; an in-memory snapshot is not a durability promise;
- browser-native limitations such as arbitrary host shell, raw TCP/UDP and native `.node` addons remain explicit unsupported boundaries.


## Failure-path receipt

The failure example exercises the same public lifecycle and verifies these stable codes:

| Operation | Expected code |
| --- | --- |
| mount path escape | `OC_PATH_ESCAPE` |
| unknown command spawn | `OC_COMMAND_NOT_FOUND` |
| invalid preview port | `OC_INVALID_ARGUMENT` |
| missing snapshot restore | `OC_NOT_FOUND` |
| missing snapshot export | `OC_NOT_FOUND` |
| use after teardown | `OC_INVALID_STATE` |

Consumer logic should branch on the code, not parse the English message.
