# Release Storage Migration and Rollback

OpenContainer release storage migration uses an explicit adjacent-version authority rather than mutating canonical data in place.

## Migration model

A migration is allowed only from storage version `N` to `N+1`.

Before canonical publication, `dryRun()`:

- verifies the current canonical storage version;
- transforms data into a candidate envelope without publishing it;
- validates the candidate;
- computes payload + manifest bytes;
- checks available browser storage with a safety reserve;
- assigns a new derived-cache namespace;
- declares derived caches `lazy-rebuild`, `criticalOpenPath=false`, and `migrateBytes=0`;
- leaves the canonical release identity unchanged.

If capacity is insufficient, migration fails before publication with `OC_RESOURCE_EXHAUSTED`.

## Crash safety

Release storage uses payload-first publication plus two alternating manifest slots.

The tested phases are:

1. after preflight;
2. after payload write;
3. after payload verification;
4. after canonical manifest publication.

Before the manifest publish, the old canonical generation remains authoritative. After publish, the new generation is authoritative while the older manifest/payload remains a valid recovery root.

No migration phase deletes the previous canonical payload as part of the critical switch.

## Derived cache policy

Derived caches are not migrated through the canonical storage path. They receive versioned namespaces:

`opencontainer-derived-<runtime>-storage-v<storage>-cache-v<cache-schema>`

Changing runtime/storage/cache profile changes the namespace. Rebuild is lazy and outside the critical open path.

## Rollback

Release rollback never downgrades canonical storage destructively.

When an older runtime can still read the newer canonical storage but is not allowed to write it, compatibility mode is:

`read-only`

The VFS itself enforces this state. Direct public filesystem transactions fail with `OC_STORAGE_READ_ONLY`, so callers cannot bypass rollback safety through `runtime.fs.beginTransaction()`.

When the rolled-back runtime cannot safely read the newer canonical storage, open is refused rather than downgrading or rewriting data.

## Browser evidence

CI #345 at head `11ee7759ca055a8ccddebd0957f2946979ffc084` passed contract and the full installed-distribution Chrome path using real OPFS.

The Chrome receipt recorded:

- dry-run required bytes: 1,515;
- source cache namespace: `opencontainer-derived-0.1.0-alpha.1-storage-v1-cache-v1`;
- target cache namespace: `opencontainer-derived-0.2.0-beta.1-storage-v2-cache-v1`;
- published storage version: 2;
- valid recovery roots after publish: 2;
- rollback mode: `read-only`;
- destructive storage downgrade: `false`;
- rollback write result: `OC_STORAGE_READ_ONLY`;
- after-preflight crash → storage v1, 1 valid root;
- after-payload crash → storage v1, 1 valid root;
- after-verify crash → storage v1, 1 valid root;
- after-publish crash → storage v2, 2 valid roots.

Every previous persistence/package/Vite/browser court remained green.

## Adjacent-release boundary

The migration mechanism is ready for adjacent-release certification, but P14-04 is not closed by a synthetic v1→v2 profile alone. It remains partial until real supported adjacent OpenContainer release artifacts are executed backward and forward through this court.
