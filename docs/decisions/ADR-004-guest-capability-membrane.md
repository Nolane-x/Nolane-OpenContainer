# ADR-004 — Guest browser capabilities are deny-by-default

**Status:** Accepted.

OpenContainer guest Workers do not inherit the page's ambient browser authority.

The default guest membrane permits only capabilities intentionally exposed by the active publication/runtime. Direct external fetch, unrelated same-origin fetch, origin-wide OPFS/storage, Web Locks, IndexedDB, CacheStorage and unrelated communication channels remain denied unless a separate reviewed adapter grants them.

The toolchain Worker is a different profile because retained build tooling may require broader execution features. That profile must not become the default guest profile.

**Reason:** browser same-origin authority is broader than OpenContainer's runtime authority model. Reusing ambient page capabilities would make the sandbox depend on application-page privilege rather than explicit runtime policy.

**Consequence:** some Node/browser packages require adapters or remain unsupported. This is an intentional compatibility boundary, not a fallback to unrestricted browser APIs.
