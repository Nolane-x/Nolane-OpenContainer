# Critical Flake Campaign

OpenContainer stable promotion does not trust a manually declared flakiness count.

The frozen campaign is defined in `release/CRITICAL-FLAKE-POLICY.v0.1.json` and produces two independent, source-bound receipts.

## Contract campaign

`npm run critical:contract-flake` executes the frozen critical test set five times.

The current policy contains 12 files covering production profile identity, release preflight/governance, release storage migration, OPFS checkpoint/package persistence, frozen install, Service Worker/ESM edge behavior, browser Node compatibility, native ESM publication and the Vite C1 oracle.

A failure is unexplained unless it matches an explicit exception carrying an issue reference, expiry and exact output signature. The current exception list is empty.

## Browser campaign

`npm run critical:browser-flake` runs the complete installed-distribution Chrome product path twice. Every iteration must report both:

- `browser acceptance PASS`;
- `distribution browser PASS`.

A browser receipt is invalid if its profile differs from `installed-distribution-chrome-product-path`.

## Stable preflight

Stable promotion requires both receipts to:

- match the release source commit;
- match the frozen test set/profile;
- meet minimum iteration counts;
- report zero unexplained failures;
- pass every required browser product-path iteration.

Missing, stale, commit-skewed or failing receipts force `REDESIGN`.

The legacy `candidate.criticalTestFlakiness` field is no longer an authority for stable promotion.

## Evidence

CI #356 exercised the campaign on the tested pull-request checkout:

Contract receipt:
- 5 / 5 iterations passed;
- 12 critical test files per iteration;
- 60 test-file executions total;
- 0 failed iterations;
- 0 explained failures;
- 0 unexplained failures;
- 0 known exceptions.

Browser receipt:
- 2 / 2 iterations passed;
- 2 / 2 full installed-distribution product-path passes;
- 0 failed iterations;
- 0 explained failures;
- 0 unexplained failures;
- 0 known exceptions;
- iteration durations: 44,222 ms and 34,561 ms.

Both receipts were archived as independent GitHub Actions artifacts for 90 days.

## Evidence boundary

Pull-request CI tests the merge checkout produced by GitHub Actions. A future beta/RC/stable release must generate fresh receipts from the exact promoted release source/tag; these CI #356 receipts are evidence that the mechanism and current tree are non-flaky under this campaign, not a reusable waiver for a later release.
