# Evidence Assurance and Research Integrity

P18 is enforced as executable release infrastructure, not a narrative confidence claim.

## Evidence levels

Every evidence key used by the production gate ledger is registered as SOURCE, DOCUMENTATION, MODEL, LOCAL, UNIT, INTEGRATION, BROWSER, DEVICE, CROSS-BROWSER, RELEASE-VERIFIED or BLOCKED-HARNESS. A critical gate may close only from an EXECUTABLE registry entry whose level is at least INTEGRATION. SOURCE/DOCUMENTATION confidence and LOCAL/UNIT-only claims cannot silently become release closure.

BLOCKED-HARNESS is never a passing evidence level.

## Decisive experiment bundle

Every contract/browser decisive campaign in the release path emits a hashed bundle containing:

- environment receipt;
- raw results;
- programmatic summary;
- retained logs;
- failure cases;
- frozen corpus lock;
- append-only negative/falsified-result history;
- a SHA-256 manifest covering every bundle file except the manifest itself.

The verifier recomputes every hash and count.

## Failure and exclusion policy

Application/runtime/product failures remain outcome data. A result may be excluded only when it is harness-invalid and uses one predefined HARNESS_* reason code, an issue, expiry and exact signature. Unknown failure is not an exclusion.

Negative results are append-only. A correction records a resolution/superseding result instead of deleting the original failure.

## Corpus governance

The compatibility corpus is frozen by schema, frozen date, row count and content-addressed Git blob identity. Any byte change requires a new corpus-lock version/change record before the changed corpus can support promotion.

## Benchmark validity threats

Every browser evidence environment receipt explicitly records warmup, cache, CPU throttling, GC, thermal, network and DevTools conditions. Unknown/uncontrolled conditions remain visible and cannot be rewritten as controlled benchmark evidence.

## Final 1.0 decision

Stable release is ledger-driven. The release preflight must see all 304 source gates reconciled and every one closed, in addition to `production_closed=true`. Aggregate percentages cannot substitute for an open or unreconciled critical gate.

The current repository remains `production_closed=false`.
