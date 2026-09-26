# Storage, Checkpoints and Export Semantics

OpenContainer distinguishes **live VFS state**, **in-memory snapshots**, **OPFS checkpoints**, **persistent package content**, and **portable exports**. They are not interchangeable durability claims.

## Live VFS and snapshots

`runtime.snapshot(label)` captures one committed VFS generation. `runtime.restore(ref)` restores that captured generation into the live VFS. In-memory snapshots are runtime-local recovery objects; they are not a browser-durable backup by themselves.

## OPFS workspace persistence

When booted with `workspacePersistence`, OpenContainer opens the OPFS checkpoint authority before the runtime becomes ready. `persistWorkspace()` publishes a generation through the existing dual-slot / Web-Lock-coordinated authority. Browser storage remains quota- and eviction-sensitive; OpenContainer does not promise infinite or permanent local storage.

## Portable export

`runtime.export(ref?)` returns a `ReadableStream<Uint8Array>` containing OpenContainer NDJSON.

- with a snapshot reference, the export is pinned to that snapshot;
- without a reference, the export captures the committed VFS generation at invocation time;
- later edits to the live workspace do not get mixed into that stream.

`await runtime.import(source)` accepts NDJSON text/bytes/ArrayBuffer/ReadableStream and restores the encoded generation. Invalid headers/rows fail explicitly.

Export is the portable escape hatch for best-effort browser storage. Consumers should offer export/backup appropriate to their product rather than claiming browser storage cannot be lost.

## Current evidence boundary

Chrome CI proves the public SDK snapshot/restore/export/import path, including a mutation after export begins with the imported copy still matching the pinned generation. This does not close external-folder permission semantics, full storage migration/downgrade, multi-browser durability, or long-session device campaigns.
