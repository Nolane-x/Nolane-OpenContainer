# OpenContainer Governance

OpenContainer is pre-1.0. This document defines engineering approval authority; it is not a final license or FTO decision.

## Accountable authority

The current accountable repository authority is the **Nolane-x repository owner/maintainer**.

Roles are capability roles, not honorary titles:

- **Security Maintainer** — may approve security-critical source/policy changes and security-response actions.
- **Release Approver** — may approve release-candidate promotion, release evidence and rollback/revocation actions.
- **Maintainer** — may approve ordinary source/documentation changes within existing policy.
- **Contributor** — may propose changes but cannot self-approve privileged actions.

If a required role is unassigned or unavailable, the privileged action is blocked.

## Security-critical changes

Changes to Worker isolation, package ingestion, network/secret authority, preview isolation, persistence/canonical publication, diagnostics redaction, release evidence, or publishing/revocation policy require Security Maintainer review plus green required CI.

## Release approval

A public release requires Release Approver authorization after required release gates and evidence pass. CI cannot self-promote a release.

## Compromised release

Freeze promotion immediately. The Release Approver and Security Maintainer jointly authorize known-bad marking, credential revocation, yank/deprecation where supported, advisory/consumer warning, and clean-provenance rebuild. If both roles cannot be independently satisfied, public promotion remains blocked.

## External contribution

Broad external code contribution acceptance remains disabled until the final project license is recorded. See `CONTRIBUTING.md`.

## Legal boundary

Repository governance does not grant a trademark license, finalize the source-code license, or establish freedom to operate.
