# ADR-002 — Single mutable authority + generation-checked publication

**Status:** Accepted.

Canonical mutable facts have one owner. VFS and package graph publication use monotonically increasing generations and reject stale writers. Preview routes use session/port/authority epoch and owner identity.

This is the implementation baseline for later OPFS/Web Lock and Service Worker ports; physical persistence may change without weakening logical publication semantics.
