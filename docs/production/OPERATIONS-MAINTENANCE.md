# Operations, Vulnerability Response and Long-Term Maintenance

P17 is treated as an executable pre-1.0 operating contract. It does not create a hosted control plane or claim production closure.

## Supported lines and security fixes

The current pre-1.0 support policy covers `main` and the active release-candidate line. Older alpha snapshots are unsupported unless a release note explicitly says otherwise. Critical/high correctness or security regressions block promotion; a known-bad runtime can be forced read-only while keeping project reads and portable export available.

## Vulnerability lifecycle

The drill follows RECEIVED → TRIAGED → EMBARGOED (for critical/high) → FIX_READY → ADVISORY_READY → DISCLOSED. Advisory targets are GitHub Security Advisory when available, SECURITY.md and release notes.

This process does **not** claim that a verified private intake channel exists. That remains P12-17.

## Incident and revocation

Named roles cover incident coordination, security, release, storage and communications. The revocation process freezes promotion, marks known-bad versions, deprecates/yanks published artifacts when they exist, invalidates bad release notices, publishes advisories and rebuilds from clean provenance.

Publication actions are conditional because OpenContainer does not currently claim an externally published npm/GitHub Release identity.

## Health, support and known issues

Local health checks require no central service and make zero remote requests. They expose only runtime/profile identity, primitive capability state, workspace read-only state and privacy-minimized diagnostic summaries.

Support bundles retain the current `opencontainer.support-bundle.v0.2` schema and a backward parser for v0.1/v0.2 metadata. Unknown schema majors fail closed.

`release/KNOWN-ISSUES.v1.0.json` maps each retained issue to version, evidence profile, browser scope and a safe workaround or explicit null workaround.

## Backup, export and EOL

Browser storage remains best-effort. Important projects should keep portable exports, especially before risky browser cleanup, migrations, unsupported-runtime changes or EOL. The product must not nag with false durability guarantees.

EOL behavior preserves project readability and portable export; unsupported or known-bad runtime lines can be blocked/read-only without destructive storage downgrade.

## Disaster drills

CI exercises four scenarios:

- bad release rollback;
- corrupt workspace recovery;
- compromised publishing credential;
- browser primitive regression.

Each must include containment, recovery, user notification, evidence preservation and post-incident regression.

The process is simulation evidence for pre-1.0 operations. It is not proof of a real external advisory channel, public package yank, cross-browser floor, weak-device floor or production CDN operation.
