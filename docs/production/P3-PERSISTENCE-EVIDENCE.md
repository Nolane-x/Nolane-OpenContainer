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


## Wave 2 — WriterEpoch fencing and quota fault matrix

**Implementation evidence:** CI #459 / PR #50 / `4c8d5b1fc88ad2db49e0431dbdbd86786f50552a`  
**Tested checkout:** `e525f2be2671f81b3d416bee23f4aa15afee1e70`  
**Closure:** `P3-03 P3-08`

### WriterEpoch + StorageGeneration

Writer ownership now has a persistent monotonic fencing token separate from canonical storage generation. A writer claims an epoch only when it needs to publish a new generation. Canonical manifests bind both identities. A successor can therefore acquire a newer WriterEpoch even if a failed publication leaves StorageGeneration unchanged.

The real Chrome OPFS court proves epoch 1 → 2 takeover, successful generation advance by the successor, and rejection of the prior writer with `OC_STALE_GENERATION`. Web Lock `steal:true` remains forbidden.

### Quota failure at every publication boundary

The canonical WorkspaceFS path now injects quota exhaustion after:

```text
0 bytes
1 byte
header prefix
mid payload
full payload / pre-commit
post-payload / pre-manifest
```

Every arm fails as `OC_RESOURCE_EXHAUSTED`. Reopening real Chrome OPFS returns the previously committed sequence and generation. A fully written payload that never receives a manifest remains unreachable garbage and can be collected; it cannot become canonical.

CI #459 passed 33 critical files × 5 iterations = 165 file executions, CodeQL and 2/2 installed-distribution Chrome product paths with zero unexplained failures. Closure CI additionally generates a P3-specific browser receipt from the raw browser iteration logs and fails if either invariant disappears.

### Still open after Wave 2

- P3-07 — explicit canonical flush/durability boundary.
- P3-09 — frozen/background-tab failover and resume re-handshake.
- P3-13 — separate corruption-class matrix.
- P3-14 — global low-storage cleanup priority.
- P3-15 — restore versus unrelated newer work.
- P3-17 — imported-copy / linked-folder / read-only-source modes.
- P3-18 — external permission revocation and edit conflict.
- P3-20 — destructive delete / tombstone / permanent purge recovery.

`production_closed=false` remains mandatory.


## Wave 3 — corruption classification

**Implementation evidence:** CI #475 / PR #51 / `edb93487724046443c73b98cad397ee43ec36f94`  
**Tested checkout:** `36ee07d1a92e1a6e9a6f1140fce0f1eb17f7e7c1`  
**Closure:** `P3-13`

P3-13 requires corruption to be classified separately rather than treated as one generic error. The declared-profile court now exercises all five required classes with different recovery semantics:

```text
canonical source → fail closed
recovery draft   → discard draft/orphan
checkpoint       → fallback to prior valid checkpoint
package cache    → discard corrupt bytes and refetch verified content
derived index    → discard and rebuild from canonical source generation
```

Canonical-source corruption with no valid recovery root returns `OC_IMPORT_INVALID` and never silently creates an empty project. A corrupt pre-manifest recovery draft remains unreachable and is garbage-collected. Corrupting the newest committed checkpoint causes A/B recovery to select the older valid root. Corrupt package-cache bytes fail integrity hydration, trigger exactly one authoritative refetch and are republished verified. The new digest-bound OPFS derived-index store rejects corrupted index bytes and rebuilds from the canonical source generation.

CI #475 passed 375/375 unit tests, 34 critical files × 5 = 170 repeated file executions, CodeQL and 2/2 installed-distribution Chrome product paths. The dedicated corruption receipt independently verifies 5 classes and 5 distinct actions in both browser iterations.

### Still open after Wave 3

- P3-07 — explicit canonical flush/durability boundary.
- P3-09 — frozen/background-tab writer failover and stale resume publication.
- P3-14 — low-storage cleanup must prove rebuildable data is removed before canonical source/checkpoints.
- P3-15 — restore must protect unrelated newer work.
- P3-17 — imported-copy / linked-folder / read-only-source semantics.
- P3-18 — external permission revocation and edit conflict.
- P3-20 — destructive delete / tombstone / permanent purge recovery.

`production_closed=false` remains mandatory.


## Wave 4 — low-storage cleanup priority

**Implementation evidence:** CI #491 / PR #52 / `3debec759ac83f5fd5582a211659bb1be623de68`  
**Tested checkout:** `55a15f97f7ba7e5b31f508f865c1d659aa397fab`  
**Closure:** `P3-14`

The production cleanup coordinator freezes the low-storage order:

```text
temporary
→ derived / rebuildable
→ public cache
→ checkpoint garbage
→ canonical source [protected]
→ canonical checkpoint [protected]
```

Canonical tiers are not simply lower priority: they are hard-protected and cannot be registered with protection disabled. If reclaimable bytes are insufficient, cleanup reports `targetSatisfied=false`; it does not delete canonical state to make an uncommitted replacement fit.

The real Chrome OPFS court persists temporary scratch, a digest-bound derived index, immutable package-cache bytes, a checkpoint orphan, a current checkpoint and a fallback checkpoint. It forces an impossible target so every reclaimable tier executes. The receipt proves the exact four-tier reclaim order, both canonical callbacks remain uncalled, package/derived bytes are rebuildable, the checkpoint orphan is removed, and reopen still restores the current acknowledged workspace while retaining its fallback checkpoint.

CI #491 passed 383/383 unit tests, 35 critical files × 5 = 175 repeated file executions, CodeQL and 2/2 installed-distribution Chrome product paths. Dedicated artifact #10935380632 verifies the low-storage invariants in both browser iterations.

### Still open after Wave 4

- P3-07 — explicit canonical flush/durability boundary.
- P3-09 — frozen/background-tab writer failover and stale resume publication.
- P3-15 — restore safety point and unrelated newer-work protection.
- P3-17 — imported-copy / linked-folder / read-only-source semantics.
- P3-18 — external permission revocation and edit conflict.
- P3-20 — destructive delete / tombstone / permanent purge recovery.

`production_closed=false` remains mandatory.
