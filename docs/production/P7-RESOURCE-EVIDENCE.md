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


## Wave 4 — global-governor coexistence + storage amplification

P7 Wave 4 closes **P7-06** and **P7-11** for the declared Chrome 153 / Ubuntu x64 evidence profile. The implementation is retained by PR #71, implementation CI #950 and dedicated artifact **#11085189245** (`sha256:64b2aaf99453b33391a7a153efa75c4befad5ecc9da3854bb55a6138ef09c7dc`).

### P7-06 — one global resource governor

The production resource path now gives active leases explicit lane ownership. Core virtual processes, product UI tasks, preview dispatch, ToolchainAuthority workers and AI shared-concurrency tasks all consume the same `runtime.resources` authority. The dedicated browser court held all five lanes live simultaneously:

- `ui`: 1 task / 1,024 in-flight bytes
- `core:process`: 1 process / 1,048,576 output-budget bytes
- `preview`: 1 task
- `toolchain`: 1 worker
- `ai-consumer`: 1 task / 2,048 in-flight bytes

Critical pressure rejected a new AI background admission with `OC_RESOURCE_EXHAUSTED`; after teardown every resource counter returned to zero. Both Chrome iterations produced the same authority result.

### P7-11 — retained physical storage accounting

The court uses production OPFS authorities and exact browser `File.size` payload accounting:

- source corpus: **64 × 4,096 = 262,144 logical source bytes**
- serialized source snapshot: **353,438 bytes**
- package fixture: Lightning CSS retained tarball **3,826,518 packed bytes**, **16,232,340 unique verified logical bytes**, **3,826,763 persistent bytes**
- checkpoint metadata: **252 bytes**
- interrupted after-payload temporary transaction: **397,191 transient bytes**
- temporary workspace peak: **750,881 bytes**, returning to **353,690 bytes** after GC
- derived cache: **3,895 logical bytes → 4,005 persistent bytes**

Using the frozen formula `physical-persistent-bytes / primary-logical-content-bytes`, both iterations measured **0.253688× steady** and **0.277769× transient peak**. These are retained measurements, not performance thresholds. Filesystem allocation metadata outside exposed file payload size is explicitly excluded.

Implementation CI #950 passed **611/611 contract tests**, **96 critical files × 5 = 480 executions**, CodeQL, the full installed-distribution browser product path, the older P7 declared-profile court, P9 rendered regression and P6 toolchain regression.

P7 remains intentionally open for **P7-01** (4/8 GiB reference-device campaign), **P7-09** (8-hour plateau), **P7-10** (real system sleep/resume plus CPU-contention coverage) and **P7-12** (weak-device regression budgets). Wave 4 does not substitute Chrome automation for those obligations.


## Wave 5 — external reference-device evidence harness

Wave 5 adds the collection machinery for the remaining device/long-run gates without promoting any of them.

The manual workflow `.github/workflows/p7-external-device-evidence.yml` is `workflow_dispatch`-only and targets labeled self-hosted Linux x64 reference devices. Normal GitHub-hosted PR/push CI cannot produce a qualifying device receipt.

The harness has three phases:

- **weak-device** — records a persistent Chrome 153 session on an actual 4 GiB or 8 GiB reference environment, including device memory/CPU identity, repeated runtime/VFS/command activity, browser heap samples and latency distributions;
- **soak** — requires at least **480 minutes** in one persistent browser session and rejects shortened runs as non-qualifying;
- **lifecycle** — requires a real host suspend/resume discontinuity and simultaneous host CPU contention. Visibility-only browser automation is not accepted as system-sleep evidence.

Memory-class qualification is fail-closed. A cgroup/container cap that materially reduces a larger host below its physical memory does not count as a 4/8 GiB reference-device campaign. The harness also requires exact Node 24.21.0, npm 11.19.0 and the frozen Chrome 153.0.8010.52 browser profile.

Per-device receipts are **candidate evidence only**. A single receipt cannot modify the production ledger. P7-12/P9-12/P14-14 additionally require weak-device budgets to be frozen from a calibration campaign and then passed by an independent validation campaign; this prevents post-hoc budget selection.

Therefore **P7 remains 10/14 closed** and P7-01/P7-09/P7-10/P7-12 remain open until retained external receipts satisfy the frozen requirements. `production_closed=false`.


### Exact-commit aggregation

`scripts/p7-external-device-aggregate.mjs` combines exactly four retained receipts: 4 GiB weak-device, 8 GiB weak-device, >=8-hour soak and lifecycle. All four must be PASS and carry the same non-empty source commit. The 4 GiB and 8 GiB calibration receipts must use distinct device identities.

A valid aggregate can mark P7-01/P7-09/P7-10 as `READY_FOR_REVIEW`, but it still sets `closureEligible=false`. P7-12, P9-12 and P14-14 remain explicitly blocked until weak-device budgets are frozen before, then passed by, a separate validation campaign.
