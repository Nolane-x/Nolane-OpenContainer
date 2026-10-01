# Contributing to OpenContainer

OpenContainer is pre-1.0 and **not production-closed**. The final project license is not frozen yet.

## Current contribution gate

Broad external contribution acceptance is currently **disabled** until P16-01 records the final project-license decision. Issues and design discussion may be accepted, but a code contribution must not be merged merely because it is technically correct.

When external code contribution acceptance is enabled, every commit must carry a Developer Certificate of Origin 1.1 sign-off:

`Signed-off-by: Name <email>`

No separate CLA is currently adopted. If project governance or patent posture later requires a CLA, that change must be explicit and prospective; it must not silently rewrite prior contribution terms.

## Clean-room requirement

Contributions may use public standards, public documentation, reviewed open-source material, and observable public behavior. Do not submit copied proprietary implementation internals, leaked/confidential material, or code derived from unauthorized reverse engineering. Record unusual compatibility research in the clean-room diary/source register.

## Third-party material

Do not vendor or adapt third-party code without preserving its license/provenance metadata. New vendored artifacts must identify source, version, digest, license, notice obligations and redistribution review.

## Security

Do not put vulnerability details, credentials, secrets or private data in public issues. Follow `SECURITY.md`.

## Review

Security-critical changes, release changes and compromised-release recovery follow `GOVERNANCE.md`. Passing CI is necessary but is not a legal/FTO decision.
