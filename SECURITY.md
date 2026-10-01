# Security Policy

## Supported versions

OpenContainer is pre-1.0 and is not production-closed. Security fixes are maintained on the current `main` line and the active release-candidate line only. Older alpha snapshots are not promised security maintenance unless a release note explicitly says otherwise.

| Version | Supported |
| --- | --- |
| current `main` / active 0.1.x alpha candidate | Yes |
| older development snapshots | No guaranteed support |
| 1.0 stable | Not released |

## Reporting a vulnerability

Do **not** publish exploit details, credentials, private user data, or a working proof-of-concept in a public issue.

A verified private vulnerability-reporting channel is not yet recorded in this repository. If GitHub displays **Report a vulnerability** / private vulnerability reporting for this repository, use that private channel. If it is not available, open a minimal public issue that contains no sensitive details and asks the maintainers for a private contact path.

This limitation is deliberate and machine-readable in `release/SECURITY-REVIEW-POLICY.v1.0.json`; P12-17 remains open until a private disclosure channel is independently verified.

## Triage and release blocking

The versioned policy is `release/SECURITY-REVIEW-POLICY.v1.0.json`.

- Critical: acknowledge within 24 hours; target remediation within 7 days; release-blocking.
- High: acknowledge within 48 hours; target remediation within 14 days; release-blocking.
- Moderate: acknowledge within 120 hours; target remediation within 30 days.
- Low: acknowledge within 240 hours; target remediation within 90 days.

An unresolved Critical or High finding blocks public beta/stable promotion unless a complete, explicit decision record exists. Silent waivers are forbidden.

## Scope

Core security boundaries include guest Worker isolation, package/archive ingestion, network capability mediation, preview isolation, OPFS/workspace persistence, diagnostics/redaction, Service Worker promotion, and release evidence.

Accounts, identity, billing, cloud synchronization, Git hosting integrations, and AI/provider behavior are outside Core 1.0. Consumer products remain responsible for their own authentication, authorization, secret issuance, abuse controls, and final CDN/TLS deployment.

## Review status

Automated tests, dependency audit, CodeQL, and AI-assisted review are supporting evidence only. They are **not** a substitute for independent/second-party review or human product-security review. The repository must not claim P12-18 or P12-20 closed from machine evidence alone.


## Verification court for private intake

A manual, read-only verification workflow now exists to capture GitHub private-vulnerability-reporting state when a repository administrator supplies a separate admin-read token. The token is not stored in evidence. This workflow does **not** mean the private channel is currently verified or enabled; P12-17 remains open until a passing retained receipt is reviewed.
