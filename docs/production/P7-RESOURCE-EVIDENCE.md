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


## Wave 3 — declared-profile performance courts

CI #937 / PR #70 implementation head `7101bae81a258e6a60c4ebb1642f8085aa11a63b` closes **P7-02, P7-03, P7-04 and P7-05** for the declared Chrome 153 / Ubuntu x64 profile.

### P7-02 — boot bytes and module startup path

A dedicated browser page performs a fresh dynamic import of Core SDK/process/resource modules, records the browser Resource Timing set, and measures the complete import/parse/compile/evaluate path before runtime boot. Both retained runs observed **49 module resources / 576,636 bytes**, with import/parse/compile/evaluate-path time **203.28 ms / 191.82 ms** and runtime boot **2.97 ms / 3.28 ms**.

This is browser-observed end-to-end module startup evidence. It is **not** represented as isolated V8 parser/compiler timing.

### P7-03 — first command, warm open, package graph and VFS

The same dedicated court measures:
- warm runtime open: **0.245 / 0.230 ms**
- first registered virtual command: **1.445 / 2.785 ms**
- frozen package-graph compile/load: **14.460 / 9.385 ms**, **63** locations
- VFS operations over **128 × 4 KiB** files: batched write, full read, readdir, 32 renames and recursive removal

Every iteration verifies the expected byte and entry counts rather than accepting timing alone.

### P7-04 — worker lifecycle and sustained transfer contention

Each iteration runs **4 WorkerRpcAuthority lanes** under one ResourceGovernor for **16 rounds / 64 RPCs**. Every RPC round-trips a **256 KiB ArrayBuffer**, for **16 MiB transferred per iteration**.

Observed:
- worker spawn→ready: **24.835 / 26.970 ms**
- sustained transfer: **30.255 / 28.145 ms**
- measured throughput: **528.838 / 568.485 MiB/s**
- teardown: **1.665 / 1.530 ms**

The court rejects checksum/size drift and requires every ResourceGovernor counter to return to zero after teardown.

### P7-05 — Vite/HMR and toolchain memory on a larger fixture

The same-head P6 browser court now expands the Vite fixture to **128 generated TypeScript modules, 130 TypeScript modules total, 84,372 source bytes, one CSS file, one SVG asset and nanoid**.

The repeated installed-product browser path measured:
- Vite build: **1752 / 1620 ms**
- Vite dev→HMR: **752 / 786 ms**

The dedicated P6 court additionally retains cold/warm Vite module execution and four `performance.memory.usedJSHeapSize` samples. These are measured profile values, not a performance floor or memory-plateau claim.

### Retained artifacts and remaining boundaries

- P7 dedicated browser evidence: artifact **#11080919293**, digest `sha256:43d9619cd8a57450aa35cae62a443459dc5383bbcba3f496f15c07c5a5952730`
- same-head P6/Vite evidence: artifact **#11081561859**, digest `sha256:44287de98406350585c2145acd015e73c7b35838f767f6266f26b6946ecf9c9e`
- resource measurement evidence: artifact **#11081543001**
- critical browser flake evidence: artifact **#11082055401**

**P7-01, P7-06, P7-09, P7-10, P7-11 and P7-12 remain open.** Wave 3 does not manufacture 4/8 GiB hardware evidence, an 8-hour plateau, whole-product shared-governor coexistence, visibility/sleep/CPU-contention evidence, storage-amplification measurement or weak-device regression budgets.
