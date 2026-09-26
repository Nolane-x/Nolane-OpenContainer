# ADR-005 — Service Worker promotion requires compatibility proof

**Status:** Accepted.

A newly installed OpenContainer Service Worker remains waiting. The client queries its versioned compatibility ID, explicitly authorizes activation, waits for activation, queries again, then explicitly authorizes client claim.

The install handler does not unconditionally call `skipWaiting()`. The activate handler does not unconditionally call `clients.claim()`.

**Reason:** Service Worker global memory is not durable across lifecycle events, and a forced update can put a new edge protocol in control of an old runtime/page.

**Consequence:** runtime and Service Worker release identities are coupled by an explicit profile. An incompatible worker remains unpromoted instead of silently taking control.
