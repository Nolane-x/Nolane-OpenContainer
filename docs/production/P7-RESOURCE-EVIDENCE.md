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
