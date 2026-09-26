# Security Model and Secret Handling

OpenContainer assumes guest/application code may be buggy or untrusted relative to the host page. Browser isolation is part of the trust boundary, not an implementation detail.

## Authority model

Guest execution runs in isolated Workers and receives only capabilities explicitly exposed by the active runtime/publication. The default guest path denies direct access to arbitrary external fetch, raw sockets, origin-wide OPFS/storage, Web Locks, IndexedDB, CacheStorage and unrelated communication channels.

Toolchain Workers are a separate, broader profile because retained browser toolchains may require capabilities such as dynamic code generation. Do not reuse the toolchain profile for ordinary guest code.

## Secrets

Do not place long-lived secrets in:

- Workspace VFS;
- browser bundle constants;
- environment objects passed to guest processes;
- guest Worker globals;
- exported snapshots;
- diagnostics/support bundles;
- package metadata.

Anything delivered to browser JavaScript must be treated as visible to the local user and potentially to compromised application code.

For privileged credentials, prefer a trusted server that exchanges narrowly scoped, short-lived tokens. If a browser-only product must hold a token, keep scope/lifetime minimal and never grant it to guest code by default.

## Network capabilities

Network access should be allowlisted by destination and method. Do not treat "same origin" as blanket authority. A consumer adapter should reject unknown targets and must not silently fall back to unrestricted browser fetch.

## Persistence

OPFS/checkpoint/package stores are origin-scoped browser storage. Guest code must not receive origin-wide storage handles. Exported archives should be treated as user data and protected according to the product's own confidentiality policy.

## Service Worker updates

A new Service Worker remains waiting until the runtime proves the versioned compatibility profile. Activation and client claim are separately authorized. Never reintroduce unconditional `skipWaiting()` or `clients.claim()`.

## Consumer responsibilities

A product embedding OpenContainer remains responsible for:

- authentication and account/session handling;
- server-side authorization;
- secret issuance/rotation/revocation;
- CSP/COOP/COEP deployment correctness;
- abuse/rate controls outside Core;
- vulnerability response and dependency update policy;
- user-visible backup/export UX where durability matters.

OpenContainer's sandbox reduces authority; it does not make arbitrary third-party code safe.
