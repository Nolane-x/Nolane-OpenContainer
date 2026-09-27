# P3 Persistence & Data-Safety Evidence — Wave 1

**Source gate set:** `OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P3`  
**Implementation evidence:** CI #444 / PR #49 / `1cbc9df096759d4cc4b108c25add5ba0359d7a58`  
**Declared profile:** Chrome 153 / Ubuntu 24.04 x64  
**Production closed:** false

## Closed in this wave

`P3-01 P3-02 P3-04 P3-05 P3-06 P3-10 P3-11 P3-12 P3-16 P3-19`

### Canonical OPFS and writer discipline

Workspace persistence uses real OPFS and origin-wide exclusive Web Locks. The source audit rejects `steal:true` and any rename/move dependency in canonical publication. A real Chrome contention court starts two authorities at the same generation with different content: exactly one publisher succeeds, the other fails stale, and reopen exposes one canonical sequence.

### Workspace crash atomicity

The checkpoint protocol is explicitly:

```text
preflight
→ write immutable payload
→ publish alternate A/B manifest
```

Fault injection at `after-preflight`, `after-payload` and `after-manifest` is executed against real browser OPFS. Before manifest publication, reopen returns the old generation. After manifest publication, reopen returns the new generation. No half-generation is admitted.

### Recovery roots and no silent empty fallback

A/B manifests choose the highest fully valid payload. Corrupting the newest payload falls back to the older valid root. If canonical metadata exists but **all** recovery payloads are invalid, recovery now fails with `OC_IMPORT_INVALID`; SDK boot propagates that failure instead of constructing an empty workspace.

### Release-storage migration and rollback

The existing release-storage court proves that dry-run transforms and validates the target before canonical publication, payload verification precedes manifest switch, and crash injection covers `after-preflight`, `after-payload`, `after-verify`, and `after-publish`.

Rollback never performs a destructive downgrade. A runtime that can read newer storage is forced read-only; a runtime that cannot read it refuses open.

### Pinned export

The public SDK export court pins one committed VFS generation. A workspace mutation made after export invocation is not mixed into the imported copy.

## Explicitly still open

- P3-03 — persistent WriterEpoch + StorageGeneration stale-writer protocol.
- P3-07 — exact flush semantics and browser durability boundary.
- P3-08 — quota refusal before/during/after every data-write phase.
- P3-09 — real frozen-tab resume and stale publication.
- P3-13 — separate corruption classes for canonical source, recovery draft, checkpoint, package cache and derived index.
- P3-14 — low-storage cleanup priority across rebuildable versus canonical data.
- P3-15 — restore creates a safe recovery point and does not overwrite unrelated newer work.
- P3-17 — imported-copy / linked-folder / read-only-source mode semantics.
- P3-18 — external permission revocation and edit conflict.
- P3-20 — destructive delete / tombstone / permanent purge recoverability.

No open item above is inferred closed from adjacent evidence.
