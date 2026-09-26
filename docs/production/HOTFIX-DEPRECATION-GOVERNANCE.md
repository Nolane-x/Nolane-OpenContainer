# Hotfix and Deprecation Governance

OpenContainer treats emergency release speed as a reason to narrow scope, not as permission to bypass release evidence.

## Hotfixes

A hotfix must retain the normal distribution and release evidence chain:

- distribution certification;
- installed-distribution browser regression;
- reproducible release evidence;
- release-evidence verification;
- release preflight;
- archived release decision.

The source release must remain bound to its source commit, artifact SHA-256/SHA-512, SBOM digest, provenance digest and decision receipt.

Hotfix artifacts are rebuilt from source. Editing or replacing a published tarball in place is forbidden.

Storage-impacting hotfixes must additionally retain migration discipline:

- migration dry-run;
- crash injection after preflight, payload, verify and publish;
- rollback plan;
- no destructive storage downgrade.

Security hotfixes require an incident reference and full browser regression. Stable hotfixes are patch-only. Prerelease hotfixes retain the same base version and prerelease channel while incrementing the prerelease sequence.

## Public API and adapter deprecation

Normal removal requires both:

- at least **2 stable releases** after deprecation;
- at least **90 calendar days**.

It also requires:

- published notice;
- replacement or explicit rationale;
- migration guide;
- release-note entry.

The policy applies to public APIs and public adapters.

## Security emergency disablement

A public API/adapter may bypass the normal removal window only for a security emergency with:

- severity high or critical;
- incident ID;
- customer warning/advisory;
- recovery path or safe alternative;
- post-incident review plan.

The exception is auditable and does not silently redefine the normal deprecation window.

## CI evidence

CI #352 at head `11bbf821b04ee87ca150d2d3c51abdc4c72af6a6` passed the contract and full installed-distribution Chrome path.

The contract court verifies:

- a valid provenance-preserving prerelease hotfix;
- stable patch-only hotfix semantics;
- rejection when provenance, release verification, rebuild-from-source, migration crash phases, non-destructive rollback or security browser regression are missing;
- normal 2-release / 90-day deprecation;
- rejection of shortened normal windows;
- security emergency exception only with complete incident evidence;
- the repository deprecation registry under the same validator.

No actual hotfix or deprecation event is claimed by this policy evidence.
