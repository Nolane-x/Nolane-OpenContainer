# P7 Resource Evidence — Wave 1

This wave separates **resource-governance evidence** from **weak-device performance claims**.

## Worker-count invariant

`navigator.hardwareConcurrency` is accepted only as a scheduling hint. When no explicit worker limit is configured, OpenContainer derives the guest-worker budget as `ceil(hint / 2)`, clamps it to a hard cap of 8, and records that the value is not a direct hardware mapping. Explicit application limits remain explicit policy inputs.

The existing real-browser worker quota court remains authoritative: a one-worker governor permits the first Dedicated Worker, rejects the second with `OC_RESOURCE_EXHAUSTED`, releases the lease on close, and permits reuse afterward.

## Bounded task/in-flight foundation

`ResourceGovernor` now carries explicit task and in-flight byte budgets. `WorkerRpcAuthority` holds a task + in-flight-byte lease from request publication until response, timeout, restart or close. Diagnostics/terminal history were already bounded. Retained source-map cache is disabled by default with a zero-byte budget; P7-08 remains partial until every future/source-map retention path is globally audited against that budget.

## Measurement validity

The browser job emits a P7 measurement receipt bound to the declared Chrome/Ubuntu profile. It records the two full-product-path wall-clock durations together with browser, OS, logical CPU count, total memory and all benchmark-validity threats required by P18: warmup, cache, CPU throttling, GC, thermal state, network and DevTools attachment.

These durations are evidence that measurement metadata is retained, **not** a latency floor. This wave makes no 4/8 GiB, thermal, cross-browser, 8-hour plateau or weak-device regression claim.


## Wave 2 — retained-resource audit and pressure cancellation

CI #432 / PR #48 implementation head `0f71f7492ae0175d929c98c6e032dd4cf522d728` passed contract, CodeQL and the installed-distribution Chrome product path.

### P7-08 — bounded retained state

The production-source audit scans `packages/` and `apps/playground/public/` and fails closed on an ungoverned source-map retention path. The only permitted source-map references are the explicit `ResourceGovernor.sourceMapBytes` retained-byte budget and transient Vite build/output validation in the browser acceptance court. The retained source-map cache budget remains zero by default.

Together with existing bounded task/in-flight bytes, process/output, diagnostics and terminal-history budgets, this closes P7-08 for the declared Chrome profile.

### P7-13 — pressure pause, cancellation and fresh resume

`ResourceGovernor` now maintains a pressure state and pressure epoch. Entering `serious` or `critical` pressure pauses new background admission. A background task that began before that transition cannot publish afterward: `assertPublish()` rejects it with `OC_WORKER_STALE`. Returning to `normal` admits a fresh background task.

The real Chrome court exercises the whole sequence:

```text
background request starts
→ critical pressure
→ late result rejected as OC_WORKER_STALE
→ new background admission rejected as OC_RESOURCE_EXHAUSTED
→ pressure returns to normal
→ fresh background request publishes successfully
```

This closes P7-13 for the declared Chrome profile.

### Stage measurements are evidence, not automatic closure

The resource receipt now retains per-iteration and aggregate timing for runtime boot, authority worker startup/execution, package install, Vite closure install, publication graph, Vite C1 build, Vite C2-to-HMR and the pressure court.

These measurements strengthen P7-02 through P7-05 but do **not** close them. Their source requirements still demand stronger controlled-contention, realistic-project/toolchain-memory or regression-baseline evidence.

No weak-device floor, 4/8 GiB campaign, 8-hour plateau, thermal floor, cross-browser floor or latency floor is claimed.
