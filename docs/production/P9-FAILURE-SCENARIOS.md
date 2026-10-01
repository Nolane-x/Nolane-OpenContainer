# P9 failure-scenario registry evidence

P9-03 is backed by the normative W5 UI/UX failure matrix retained at:

`docs/research/OPENCONTAINER-UX-STATE-FAILURE-MATRIX-v0.4-20260923.md`

The source is locked to SHA-256 `7f329e45b704465947488532658abdde90d699fc4ed33fc96e86bb603769ede5`. Mechanical parsing finds **280 table rows**, **280 provenance-qualified keys**, **234 unique raw IDs**, **46 raw IDs reused across sections/rounds**, and **55 evidence-court classes**.

The parser deliberately does not trust stale intermediate narrative totals in the research artifact. The table itself mechanically partitions as:

- base matrix: 100
- Round-23 extension: 40
- Round-24 state/failure extension: 52
- Round-24 additional completeness: 38
- Round-25: 50

Total: **280**.

Each row executes through `FailureStateProjection`, preserving the source trigger, user-visible state, canonical-project guarantee, primary recovery/action and evidence-court label. Every one of the 55 court labels maps to retained component/integration/browser evidence files, and the dedicated CI job refuses to run until the same-head P9 rendered court succeeds.

Implementation CI #1011 on PR #77 passed **648/648 contract tests**, **106 critical files × 5 = 530/530 repeated executions**, CodeQL, full installed-distribution browser regression and the same-head P9 rendered court. The dedicated P9 failure-scenario artifact is **#11142839511**, digest `sha256:9f541d0257347987de6a1ed45586e660800fcb0e2ee43984c9cb50fa1ef6e5d6`. Its projection digest is `269ee15268274b609b7e224a21a9e181f7cb447ee06d418ddda8820d61ff2bb4`.

The corpus contains semantic rows whose final acceptance still belongs to external obligations. The dedicated receipt therefore records **9 rows tied to P9-12** and **2 rows tied to P9-05** without promoting either gate. P9-11 human-comprehension testing also remains independent.

P9-03 closes the retained failure-registry/component-integration obligation only. **P9-05, P9-11 and P9-12 remain open.** No cross-browser, manual screen-reader, human-comprehension, weak-device plateau or production-closure claim is made.
