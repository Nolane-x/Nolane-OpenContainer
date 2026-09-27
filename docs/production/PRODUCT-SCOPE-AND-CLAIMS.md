# Product Scope, Supported Evidence Profile and Public Claims

OpenContainer 1.0 scope is frozen around the existing **nine Core surfaces**. This document is the human-readable view of the machine-enforced policy in `release/PRODUCT-SCOPE.v1.0.json`.

## Current P0 evidence profile

The only P0-supported evidence profile is:

- production profile: `opencontainer-alpha-chromium-node24-v1`;
- browser: Google Chrome **153** (CI #383 observed **153.0.8010.52**);
- OS: Ubuntu **24.04**, Linux x64, GitHub-hosted standard x64 runner;
- Node/npm oracle: **24.21.0 / 11.19.0**.

This is deliberately narrower than the eventual browser/device matrix. It does **not** authorize claims for Firefox, Safari, Windows, macOS, mobile, weak-device floors or future Chrome majors. `npm run browser:profile:verify` fails when the CI browser major, OS or architecture moves outside the frozen profile, forcing an explicit reviewed profile update instead of silent evidence inheritance.

## Scope constitution

The 1.0 product surface remains S1–S9:

`runtime`, `runtime.fs`, `runtime.process`, `runtime.packages`, `runtime.net`, `runtime.preview`, `runtime.snapshots`, `runtime.resources`, `runtime.diagnostics`.

AI/agent behavior, Git hosting, cloud sync, accounts and billing remain consumers/adapters or separate products. They cannot redefine Core authority or become release-blocking Core scope without an explicit versioned scope decision.

## Unsupported classes

Core 1.x does not claim native `.node`/node-gyp binaries, arbitrary raw TCP/UDP/TLS, full Linux/POSIX/host-machine semantics, or undeclared browser/OS/device profiles.

Unsupported behavior is a product boundary, not a reason to weaken a capability check or silently substitute an implementation.

## Scope debt

`release/SCOPE-DEBT.v1.0.json` is the scope-debt register. Every entry carries an owner, an explicit removal/rehome plan and a revisit trigger. Temporary compatibility work introduced under this policy must use the `OC_SCOPE_DEBT:<id>` marker and reference a registered debt ID.

Open debt never expands the public compatibility claim.

## Production severity

The following are unconditional release blockers: canonical **data loss**, **isolation break**, **secret exposure**, and **silent semantic corruption**. An unresolved blocker forces REDESIGN or KILL; a missing decision record is not a waiver.

## Public claims

`release/PUBLIC-CLAIMS.v1.0.json` is the release/marketing claim registry. Every approved claim names the production profile and retained evidence. Claims absent from the registry are not approved release claims.

This is intentionally stricter than README prose: implementation history may describe experiments, but release/marketing language must remain within the registry and the declared evidence profile.

## 1.0 decision boundary

GO / REDESIGN / KILL comes from `release/RELEASE-POLICY.v0.1.json`. Stable 1.0 additionally requires `production_closed=true`, all critical gates closed to their frozen minimum, current release verification/critical-flake evidence, required legal/FTO decisions and exercised operations handoff.

Those criteria are independent from future SaaS/Program B.

## Critical-gate waivers

`release/CRITICAL-GATE-WAIVERS.v1.0.json` is fail-closed and currently empty. Any future critical waiver must name the gate, rationale, approver, review date, revisit trigger and a retained decision record. Stable release cannot carry an unresolved critical waiver.
