# Storage, Checkpoints and Export Semantics

OpenContainer distinguishes **live VFS state**, **in-memory snapshots**, **OPFS checkpoints**, **persistent package content**, and **portable exports**. They are not interchangeable durability claims.

## Live VFS and snapshots

`runtime.snapshot(label)` captures one committed VFS generation. `runtime.restore(ref)` restores that captured generation into the live VFS. In-memory snapshots are runtime-local recovery objects; they are not a browser-durable backup by themselves.

## OPFS workspace persistence

When booted with `workspacePersistence`, OpenContainer opens the OPFS checkpoint authority before the runtime becomes ready. `persistWorkspace()` publishes a generation through the existing dual-slot / Web-Lock-coordinated authority. Browser storage remains quota- and eviction-sensitive; browser-managed data may be evicted by the browser or removed by a user action. OpenContainer does not promise infinite or permanent local storage.

## Safe OPFS checkpoint restore

In-memory `runtime.restore(ref)` and persistent checkpoint rollback are intentionally different operations. For an OPFS-backed workspace, consumers should use the two-step persistent restore flow:

```js
const plan = await runtime.prepareWorkspaceRestore(checkpointReceipt);
// Show/confirm the restore intent while this plan is still current.
const receipt = await runtime.restoreWorkspaceCheckpoint(plan);
```

A restore plan binds both the live VFS generation and the canonical OPFS checkpoint sequence. The commit phase acquires an exclusive working-tree mutation lease, persists or reuses a recovery point for the current state, then republishes the selected older checkpoint as a **new** canonical generation. It never moves canonical generation identity backward.

If local work or another browser context publishes after planning, restore fails with `OC_STALE_GENERATION` instead of overwriting it. If storage pressure prevents creation of the pre-restore recovery point, restore fails with `OC_RESOURCE_EXHAUSTED` and declares that risk in the error details; it does not mutate the working tree. Restore targets must still be retained canonical/fallback recovery roots, not arbitrary leftover payload files.

## Portable export

`runtime.export(ref?)` returns a `ReadableStream<Uint8Array>` containing OpenContainer NDJSON.

- with a snapshot reference, the export is pinned to that snapshot;
- without a reference, the export captures the committed VFS generation at invocation time;
- later edits to the live workspace do not get mixed into that stream.

`await runtime.import(source)` accepts NDJSON text/bytes/ArrayBuffer/ReadableStream and restores the encoded generation. Invalid headers/rows fail explicitly.

Export is the portable escape hatch for best-effort browser storage. Consumers should offer export/backup appropriate to their product rather than claiming browser storage cannot be lost.

## Current evidence boundary

Chrome CI proves the public SDK snapshot/restore/export/import path, including a mutation after export begins with the imported copy still matching the pinned generation. This does not close external-folder permission semantics, full storage migration/downgrade, multi-browser durability, or long-session device campaigns.


## Release migration and rollback

Canonical release-storage migration is adjacent-version only and uses dry-run, payload-first publication and dual recovery roots. Derived caches are versioned and lazy-rebuildable.

Rollback does not destructively downgrade canonical storage. A rolled-back runtime that can read but must not write newer storage enters read-only mode; one that cannot safely read it refuses open. See `docs/production/STORAGE-MIGRATION-ROLLBACK.md` for the release court and crash phases.
