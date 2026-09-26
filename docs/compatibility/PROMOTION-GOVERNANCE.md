# Compatibility Promotion Governance

OpenContainer does not promote compatibility by a single percentage. Promotion is evaluated from frozen thresholds against the same machine-readable gate ledger and compatibility baseline used by CI.

The frozen threshold source is `compat/PROMOTION-THRESHOLDS.v0.1.json`.

## Levels

- **Alpha** requires the frozen corpus, repeated real-repository browser evidence, machine-readable compatibility reporting, explicit adapter semantics, fail-closed Node oracle exception handling, a published third-party package court, and closure of P11-01 through P11-11.
- **Beta** additionally requires certification of the actual OpenContainer distribution, published examples against that distribution, and a release compatibility report.
- **RC** additionally requires a browser-version matrix frozen from real evidence, no critical open gate in product/release domains, and a rollback drill.
- **1.0** additionally requires `productionClosed=true`, all critical production gates closed, release verification, legal/FTO closure, and operations handoff.

CI computes the highest qualified level using `npm run compat:promotion`. A higher level cannot be qualified if a lower level fails.

## Node executable/doc oracle exceptions

`compat/NODE24-ORACLE-EXCEPTIONS.v0.1.json` is the only allowed exception registry for selected Node 24.21.0 differential cases.

- an unlisted mismatch fails CI;
- a stale exception also fails CI;
- executable behavior is the selected-case primary oracle;
- any documentation/executable discrepancy must stay visible in the exception artifact rather than being normalized away.

The current selected resolver differential has no active exceptions. That is not a claim that Node documentation can never disagree with the executable; it means no selected discrepancy is currently being hidden.
