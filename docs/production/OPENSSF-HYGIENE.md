# OpenSSF Scorecard hygiene evidence

OpenContainer runs the official OpenSSF Scorecard GitHub Action as **supplemental project-hygiene evidence** for P13-18.

The workflow is deliberately read-only. It pins Scorecard Action **v2.4.4** to commit `2d1146689b8cda280b9bc96326124645441f03bc`, stores raw JSON, verifies the output with an OpenContainer-owned parser and archives both raw output and the normalized receipt for 90 days.

No minimum Scorecard score is invented by this project. A low individual check or a low aggregate score remains visible evidence rather than being rewritten into a pass. The P13-18 requirement is to run and retain OpenSSF Scorecard/OSPS hygiene evidence; it is not a substitute for artifact signing, branch protection, OIDC publishing, registry staging, legal review or release verification.

The workflow uses `publish_results: false`. It therefore does not request an OIDC token and does not publish OpenContainer results to the public Scorecard API. The raw scan remains CI evidence tied to the tested repository state.

P13-18 is not promoted merely because this workflow exists. Promotion requires a retained successful workflow artifact and a separate exact-head CI pass. `production_closed=false` remains mandatory.
