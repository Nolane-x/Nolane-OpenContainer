# OpenSSF Scorecard hygiene evidence

OpenContainer runs the official OpenSSF Scorecard GitHub Action as **supplemental project-hygiene evidence** for P13-18.

The workflow is deliberately read-only. It pins Scorecard Action **v2.4.4** to commit `2d1146689b8cda280b9bc96326124645441f03bc`, stores raw JSON, verifies the output with an OpenContainer-owned parser and archives both raw output and the normalized receipt for 90 days.

No minimum Scorecard score is invented by this project. A low individual check or a low aggregate score remains visible evidence rather than being rewritten into a pass. The P13-18 requirement is to run and retain OpenSSF Scorecard/OSPS hygiene evidence; it is not a substitute for artifact signing, branch protection, OIDC publishing, registry staging, legal review or release verification.

The workflow uses `publish_results: false`. It therefore does not request an OIDC token and does not publish OpenContainer results to the public Scorecard API. The raw scan remains CI evidence tied to the tested repository state.

P13-18 is not promoted merely because this workflow exists. Promotion requires a retained successful workflow artifact and a separate exact-head CI pass. `production_closed=false` remains mandatory.


## Promoted evidence

PR #73 implementation head `9811c0f6423aa3a1a4aff21711b5116e95c75dd7` produced a successful official Scorecard run and same-head regression CI. Scorecard run #2 retained raw JSON with aggregate **6.9**, **11 checks**, one unavailable check and raw SHA-256 `6db20bee3c94f5d377ca49b3265e804c9382c9fffaa4df4a0f426d94997515a7`. Artifact #11093017366 is retained with digest `sha256:a09995085ce8d2fcb1dbc8b4a2c959bd23b688f507a5a0e20b2103e54e7e0b57`.

CI #969 passed 625/625 tests, 500/500 repeated critical-file executions, CodeQL and all browser regressions. The two initial harness failures are retained as NEG-005 and NEG-006 rather than deleted.
