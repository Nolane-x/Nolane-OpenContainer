# P2 Runtime, RPC, Process, and Stream Boundary

This document freezes the P2 production boundary for the declared OpenContainer browser profile.

## RPC and mutation outcomes

Worker RPC uses session + epoch + request identity. A timeout is an unknown outcome, not proof that a mutation did not happen. Mutating operations that can outlive the caller must carry a mutation identity/receipt that can later be reconciled to PENDING, APPLIED, or FAILED.

Worker transport `error` and `messageerror` fail the session closed, reject pending requests, cancel request timers, and release task/in-flight resource leases. A later worker must be attached through an explicit restart that advances the epoch.

## Cancellation and transfer streams

Cancellation lineage is explicit across caller → broker → producer → consumer. A cancellation aborts downstream consumers and removes pending waiters.

`BoundedTransferChannel` is a bounded browser-runtime transfer primitive. It enforces a byte budget, explicit backpressure failure, close/abort state, and abortable consumers. The browser court separately exercises an actual multi-megabyte transferable `ArrayBuffer` under bounded Chromium heap pressure.

This does **not** claim complete Node stream implementation or arbitrary host IPC compatibility.

## Synchronous RPC

Synchronous RPC is limited to an explicit allowlist. Only one synchronous call may be active at a time. A nested/reentrant synchronous call fails immediately instead of waiting and risking module-loader deadlock.

## Virtual processes

`ProcessSupervisor` provides bounded **virtual** processes. It does not create host OS processes.

- public terminal state is published exactly once;
- required stdout/stderr drain is awaited before exit publication, with a bounded timeout;
- kill/natural-exit/throw races converge to one terminal receipt;
- parent/child relations have explicit `terminate` or `detach` orphan policy;
- repeated process cycles release process/output resource leases;
- stdout/stderr retention is byte-bounded.

The host environment is never inherited implicitly.

## Virtual ports

`ProcessPortAuthority` binds a virtual port to exact `pid + epoch` proof. Reusing a port for a later process invalidates the old proof. This is virtual routing only and does **not** claim raw TCP/UDP socket parity.

## Public errors

Consumer-visible failures use stable `OC_*` codes and bounded public details. They do not expose Dedicated Worker / MessagePort topology as part of the API contract.

## Closure boundary

P2 requires RELEASE-READY executable evidence on the declared Chrome profile. Local model tests alone do not close P2.

`production_closed=false`.
