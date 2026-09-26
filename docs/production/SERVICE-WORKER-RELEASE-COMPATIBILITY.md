# Service Worker Release Compatibility

OpenContainer Service Worker updates are fail-closed against an explicit release compatibility identity:

`opencontainer-sw-edge-v1:rpc1:snapshot1:opfs1`.

That identity is published in the canonical production profile and must agree with the Service Worker implementation.

## Activation protocol

A newly installed Service Worker does not call `skipWaiting()` by itself and the `activate` handler never calls `clients.claim()`.

The client-side lifecycle is:

1. register the candidate;
2. wait until the candidate is installed/waiting;
3. query its compatibility identity over a MessageChannel;
4. reject promotion if the identity differs;
5. send an explicit compatibility-bound activation command;
6. wait until the candidate reaches `activated`;
7. query the activated worker again;
8. send a separate compatibility-bound claim command;
9. wait for `controllerchange`;
10. query the resulting controller again before using it.

An already controlling compatible worker is queried and reused without a promotion cycle.

This two-phase activation/claim protocol deliberately avoids relying on in-memory Service Worker global state. Browser engines may terminate and recreate a Service Worker execution context between lifecycle events.

## Failure behavior

- incompatible workers fail with `OC_SERVICE_WORKER_INCOMPATIBLE`;
- activation, messaging, lifecycle-state and controller timeouts fail with `OC_ESM_EDGE_UNAVAILABLE`;
- an incompatible waiting worker is left unpromoted;
- no compatibility mismatch is normalized into a successful update.

## Evidence

CI #331 at head `7f5f28395c3d533e2b9df2f70edd6cb693106ef0` passed contract and the complete installed-distribution Chrome path.

The real Chrome first-install receipt recorded:

- compatibility ID `opencontainer-sw-edge-v1:rpc1:snapshot1:opfs1`;
- first bridge activation: `compatibility-authorized`;
- page controlled after the explicit claim phase;
- second bridge activation: `existing-compatible`.

The remainder of the browser court, including stale-session rejection, OPFS, package install, Vite C1 and Vite C2, remained green.

## Boundary

This closes the Service Worker compatibility-handshake requirement itself. It does not prove release cache migration, adjacent-version storage migration, browser-floor matrices, production CDN validation, weak-device release budgets or complete release readiness.
