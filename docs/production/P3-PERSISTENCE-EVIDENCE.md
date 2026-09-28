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


## Wave 5 — safe checkpoint restore

**Implementation evidence:** CI #509 / PR #53 / `3c347dc131817c9f4f2ca67b5bed228f7b5d80f4`  
**Dedicated browser verification:** CI #512 / artifact `10944841419`  
**Closure:** `P3-15`

Persistent checkpoint restore is now a planned, guarded operation rather than a direct in-place rewind.

The plan binds:

```text
working VFS generation
canonical OPFS sequence
canonical OPFS generation
retained target recovery root
```

The commit phase acquires an exclusive VFS mutation lease, persists or reuses a recovery point for the current working state, and then publishes the selected older checkpoint contents as a **new** canonical generation. A canonical-sequence compare-and-swap executes under the origin-wide Web Lock, so another context cannot race between validation and publication.

The real Chrome OPFS court proves four paths:

```text
normal restore:
  recovery point first
  -> restored generation second
  -> recovery point remains fallback after reopen

local edit after restore planning:
  -> OC_STALE_GENERATION
  -> no working-tree overwrite

cross-context publication after restore planning:
  -> OC_STALE_GENERATION
  -> newer remote canonical state survives

quota prevents safety point:
  -> OC_RESOURCE_EXHAUSTED
  -> riskDeclared=true
  -> no working-tree mutation
```

CI #509 passed 394/394 unit tests, 37 critical files × 5 = 185 repeated executions, CodeQL and 2/2 installed-distribution Chrome paths. CI #512 independently reran the same product path and the dedicated safe-restore receipt passed both browser iterations.

### Still open after Wave 5

- P3-07 — explicit canonical flush/durability boundary.
- P3-09 — frozen/background-tab writer failover and stale resume publication.
- P3-17 — imported-copy / linked-folder / read-only-source semantics.
- P3-18 — external permission revocation and edit conflict.
- P3-20 — destructive delete / tombstone / permanent purge recovery.

`production_closed=false` remains mandatory.


## Wave 6 — destructive workspace lifecycle

**Implementation evidence:** CI #529 / PR #54 / `e89f16bf2a164ea812e2dd8793559816ad5d8757`  
**Dedicated browser artifact:** `10952810664`  
**Closure:** `P3-20`

Workspace deletion now has explicit persistent lifecycle state rather than being represented as an unqualified VFS remove.

```text
active
  -> tombstoned  [D2, recoverable]
       -> active [explicit restore]
       -> purging
            -> purged [D4, unrecoverable]
```

Recoverable delete acquires a local VFS mutation lease, publishes/verifies the current working state as the canonical recovery checkpoint and writes an integrity-bound tombstone outside the workspace directory. The recovery point must still be the current canonical root; a newer cross-context publication makes the delete stale instead of allowing an old fallback to become the declared recovery point. While tombstoned, both boot and further canonical checkpoint publication fail closed.

Permanent purge is a separate D4 operation. It requires explicit confirmation of the exact workspace target and `none-after-purge` recoverability, removes the workspace OPFS directory, leaves only non-content lifecycle/mutation truth, and reports `recoverable=false`. Repeating the same purge mutation is idempotent. If commit succeeds but acknowledgement is lost, the operation reports an unknown outcome and requires authoritative reconciliation rather than blind retry.

Lifecycle records are SHA-256 integrity-bound. Invalid JSON, invalid shape, missing integrity identity or digest mismatch returns `OC_IMPORT_INVALID` with no silent active-workspace fallback.

CI #529 passed 406/406 unit tests, 38 critical files × 5 = 190 repeated file executions, CodeQL and 2/2 installed-distribution Chrome product paths. Dedicated artifact #10952810664 verifies recoverable delete, late-local-mutation fencing, tombstone boot refusal, restore, D4 purge, duplicate-submit idempotency and acknowledgement-loss reconciliation in both Chrome iterations. Closure CI retains both the lifecycle implementation court and evidence invariant court in a 40-file × 5 repeated campaign.

### Still open after Wave 6

- P3-07 — explicit canonical flush/durability boundary.
- P3-09 — frozen/background-tab writer failover and stale resume publication.
- P3-17 — imported-copy / linked-folder / read-only-source semantics.
- P3-18 — external permission revocation and edit conflict before privileged writes.

`production_closed=false` remains mandatory.


## Wave 7 — external source mode semantics

**Implementation evidence:** CI #547 / PR #55 / `1f5a9f0ddfc814193658a9f36117a6f088d93ce8`  
**Tested checkout:** `615e6c714ae0df00e1cd5ae84a204b055fa68869`  
**Dedicated browser artifact:** `10953546693`  
**Closure:** `P3-17`

External filesystem authority is now a separate durability domain from the local canonical browser workspace. The VFS authority exposes three explicit immutable modes:

```text
imported-copy
linked-folder
read-only-source
```

Imported-copy scans the source before publication, commits the imported bytes through one local VFS transaction, then detaches from the external handle. Later external edits cannot silently keep the project linked. Read-only-source permits reads but rejects privileged writes with `OC_STORAGE_READ_ONLY`, even if the backing handle could technically write. Linked-folder retains its mode across `granted`, `prompt` and `denied` permission states.

Every privileged linked-folder write re-checks `readwrite` permission and requires a previously observed content revision. If the external file changed after OpenContainer read it, publication fails with `OC_STALE_GENERATION` / `external-change-detected` before overwrite and exposes compare, reload-external-version, save-as-copy and merge recovery choices.

CI #547 passed 415/415 unit tests, 40 critical files × 5 = 200 repeated executions, CodeQL and 2/2 installed-distribution Chrome paths. Dedicated artifact #10953546693 verifies the mode invariants in both browser iterations.

### Explicit evidence boundary for P3-18

The browser court uses real Chrome + real OPFS bytes behind a File-System-Access-compatible permission adapter. It proves that permission is rechecked immediately before privileged write, denied/prompt states block the write, external revision conflicts block overwrite, and local canonical recovery state survives permission loss.

It **does not** claim native picker permission revocation. The machine receipt explicitly records:

```text
nativePickerPermissionRevocationExercised = false
```

P3-18 therefore remains open until the declared profile exercises a real user-selected `FileSystemDirectoryHandle` from `showDirectoryPicker()`, browser/user revocation after selection, and the resulting native `queryPermission()` transition.

### Still open after Wave 7

- P3-07 — explicit canonical flush/durability boundary.
- P3-09 — frozen/background-tab writer failover and stale resume publication.
- P3-18 — native external file permission revocation plus external edit conflict on the real selected handle.

`production_closed=false` remains mandatory.


## Wave 8 — frozen-tab writer failover

**Implementation evidence:** CI #565 / PR #56 / `74b1fb598e652f2650b0c37e28e67deab3db6d8b`  
**Tested checkout:** `64749c2c1e20427c9cfabd4ef4b5979ada6bb144`  
**Dedicated browser artifact:** `10954814739`  
**Closure:** `P3-09`

P3-09 is now exercised as one combined browser lifecycle and writer-fencing court rather than separate freeze and failover pieces.

Each of two independent iterations creates two same-origin Chrome page targets against one real OPFS workspace:

```text
Writer A:
  publish sequence 1 / WriterEpoch 1
  -> Chrome Page.setWebLifecycleState(frozen)

Writer B:
  restore same OPFS workspace
  -> claim WriterEpoch 2
  -> publish sequence 2 while A is frozen

Writer A:
  Chrome Page.setWebLifecycleState(active)
  -> receives resume lifecycle event
  -> keeps local A-stale edit
  -> attempts publication through original epoch-1 authority
  -> OC_STALE_GENERATION
```

The stale rejection is explicitly bound to writer fencing, not an incidental payload mismatch:

```text
expectedWriterEpoch = 1
currentWriterEpoch  = 2
localWriterEpoch    = 1
observed manifest writer epoch = 2
```

A fresh canonical read after the rejected publication remains Writer B value `B1`, sequence 2, generation 2 and WriterEpoch 2. Both iterations observed one real `freeze` event and one real `resume` event.

CI #565 passed 419/419 unit tests, 42 critical files × 5 = 210 repeated executions, CodeQL and the installed-distribution Chrome product path. Dedicated artifact #10954814739 passed 2/2 two-target freeze/resume iterations. Closure CI additionally retains the P3-09 evidence invariant in the repeated critical campaign.

### Still open after Wave 8

- P3-07 — exact flush/durability boundary the browser can actually guarantee.
- P3-18 — native `showDirectoryPicker()` permission revocation on a real selected external handle.

`production_closed=false` remains mandatory.
