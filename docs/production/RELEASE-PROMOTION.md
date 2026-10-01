# Release Promotion Preflight

OpenContainer release promotion is machine-readable and monotonic. The frozen sequence is:

`canary → beta → rc → stable`

A higher channel may never bypass lower-channel evidence. The preflight produces exactly one decision: `GO`, `REDESIGN`, or `KILL`.

## Decision semantics

- **GO**: release metadata is structurally valid and all evidence required by the target channel is satisfied.
- **REDESIGN**: metadata is valid, but release evidence, prior promotion receipts, production closure, flakiness, or risk requirements are insufficient.
- **KILL**: the release input itself is invalid, including malformed policy, semantic-version drift, SDK/protocol/profile version skew, or incomplete reviewed-change metadata.

Every decision receipt explicitly retains unresolved risks.

## Version identity

The preflight requires the release candidate version to be valid SemVer and identical across:

- root package;
- public `@nolane/opencontainer` SDK;
- `@nolane/opencontainer-protocol`;
- production-profile runtime version;
- production-profile protocol package version.

It also requires explicit version identities for WorkspaceFS, OPFS checkpoint, sync RPC mailbox and Service Worker compatibility profiles, plus positive integer versions for snapshot schema, OPFS manifest, portable snapshot format and worker RPC envelope.

## Reviewed-change changelog

`release/RELEASE-CANDIDATE.v0.1.json` is the reviewed release input. Every change must include:

- review reference;
- full merge commit;
- title;
- API implication;
- storage implication;
- security implication.

`npm run release:preflight` deterministically renders these reviewed changes into `.artifacts/release-preflight/CHANGELOG.md` and writes `decision.json` beside it.

## Channel evidence

Canary currently requires promoted distribution evidence, distribution content-policy evidence, reproducibility evidence and the closed Service Worker compatibility gate.

Beta requires prior canary GO evidence plus the frozen distribution/compatibility/sample closure gates.

RC requires prior canary and beta GO evidence plus browser-floor, rollback and release-regression gates.

Stable additionally requires prior canary/beta/RC GO receipts, a non-prerelease SemVer, `production_closed=true`, a verified release receipt, zero unexplained critical-test flakiness, no unresolved risks and the stable closed-gate set frozen in the policy.

The evaluator never lowers these requirements to make the current repository pass.

## Current evidence

CI #338 on implementation head `522f6501cd355e96c5642dfe8f1544ec46e98fac` passed:

- full contract suite;
- compatibility promotion;
- distribution certification;
- reproducible release evidence generation and verification;
- release preflight;
- separate release-evidence artifact archive;
- separate release-preflight artifact archive;
- full installed-distribution Chrome product path.

The current candidate `opencontainer-0.1.0-alpha.1-canary` produced:

- decision: `GO`;
- eligible: `true`;
- version/profile coherence: `true`;
- reviewed-change completeness: `true`;
- channel evidence: `true`;
- prior-promotion chain: `true`;
- unexplained critical flakiness field: `0`;
- generated changelog SHA-256: `41e85619ebe27a8f16bb903e8e08f362ea2525878d841341c4cd710f14aaf310`.

## Evidence boundary

The preflight is not a public release and does not prove beta, RC or stable readiness. Cross-browser floors, release rollback, production CDN/header topology, weak-device release budgets, signed/authenticated publication, legal/FTO and operations handoff remain separate gates.

The stable flakiness rule is implemented and tested fail-closed, but P14-15 remains partial until critical-test flakiness is supplied by an independent release campaign rather than only the reviewed candidate manifest.


## P14-13 browser-floor regression evidence

PR #72 adds an independent pre-promotion browser campaign instead of silently following the browser version installed on the GitHub runner.

The **frozen-floor lane** installs exact Chrome **153.0.8010.52**. The **newest-Stable lane** resolves the live Chrome for Testing `channels.Stable` manifest, validates the downloaded Linux x64 binary against the manifest version, and retains both manifest and browser-archive SHA-256 values. On implementation CI #960 the live Stable version was **154.0.8037.92**.

Each lane executes the existing repeated **installed-distribution full product path twice**. CI #960 retained **4/4 full product paths** across the two browser versions with zero unexplained failures.

This evidence originally closed P14-13 only. PR #76 subsequently uses the retained dual-version result to freeze Chrome 153.0.8010.52 as the minimum **only** for the declared Ubuntu 24.04 x64 evidence profile, closing P11-13 without claiming cross-browser support. The current candidate is still canary, so P1-14's requirement to repeat the matrix at each RC remains separate. P14-04, P14-12 and P14-14 also remain open.


## Real public topology evidence

`.github/workflows/public-deployment-evidence.yml` is a manual read-only court for P1-13/P14-12. It checks out the exact deployed tag and requires the public deployment to expose the same runtime version. HTTPS/TLS/HSTS, public DNS, edge-marker identity, deployment headers, cross-origin isolation and a live Chrome product-shell boot are all checked from outside the deployment.

The court never deploys or promotes. A PASS is candidate evidence only and requires reviewed reconciliation.

## RC and adjacent-release evidence

The external release court already reruns frozen-floor/newest-Stable lanes on exact RC tags. Separately, `.github/workflows/adjacent-release-evidence.yml` validates P14-04 against two actual adjacent npm artifacts using one persistent browser origin/profile across old→new→old→new storage phases. Synthetic v1/v2 migration evidence remains supporting evidence, not a substitute for this real-artifact campaign.
