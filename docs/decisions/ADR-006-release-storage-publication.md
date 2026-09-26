# ADR-006 — Release storage migration is payload-first and rollback is non-destructive

**Status:** Accepted.

Canonical release storage migration is adjacent-version only. The target payload is produced and verified before the alternate manifest publishes the new canonical identity. The previous manifest/payload remains a recovery root.

Derived caches are versioned and lazy-rebuildable rather than migrated on the critical open path.

Rollback never rewrites newer canonical storage into an older format. If an older runtime can read but not safely write the newer format, the VFS enters read-only mode. If it cannot safely read it, open is refused.

**Reason:** in-place migration and destructive downgrade combine release rollback with irreversible data mutation.

**Consequence:** release engineering must carry explicit storage-version compatibility and may need an emergency read-only/export path.
