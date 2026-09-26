# SDK, Protocol and Storage Migration Guide

This guide tracks migration rules for versioned public surfaces. It is not a substitute for release-specific notes.

## Current public version

Current package/protocol version: `0.1.0-alpha.1`.

Current profile identities are published in `docs/production/PRODUCTION-PROFILE.json`. Consumers should record the profile used for persisted/exported state when release rollback or long-lived storage matters.

## Public SDK/API changes

Normal public API/adapter removal follows the repository deprecation policy:

- at least 2 stable releases after deprecation;
- at least 90 calendar days;
- published notice;
- replacement or explicit rationale;
- migration guide;
- release-note entry.

The current deprecation registry is `release/DEPRECATIONS.v0.1.json`. An empty registry means no active deprecation is currently recorded; it does not waive future migration requirements.

Security emergency disablement is a separate auditable exception and requires the incident/recovery evidence defined by the deprecation policy.

## Protocol changes

When the Worker RPC envelope or Service Worker compatibility identity changes, runtimes must not assume cross-version compatibility.

A Service Worker with a mismatched compatibility ID is left unpromoted. Consumers should deploy runtime + Service Worker from the same release artifact.

## Storage changes

Canonical release storage migrations are adjacent-version only: `N → N+1`.

Before publication the migration authority:

1. dry-runs transform/validation;
2. checks available storage;
3. assigns a new derived-cache namespace;
4. writes and verifies the new payload;
5. publishes the alternate manifest last.

Rollback never destructively downgrades canonical storage. An older runtime that can safely read newer storage enters read-only mode; one that cannot read it refuses open.

Derived caches are rebuildable and receive versioned namespaces rather than being migrated on the critical open path.

## Portable snapshots/exports

Portable NDJSON format version is published in the production profile. A breaking portable format change requires a release migration note and an explicit importer/exporter compatibility plan.

## Release checklist for a breaking change

A breaking SDK/protocol/storage change is not ready until:

- version/profile identity is bumped coherently;
- deprecation/removal policy is satisfied or a security exception is recorded;
- migration guide contains old/new behavior and recovery;
- compatibility tests cover the supported adjacent pair;
- release preflight contains the change's API/storage/security implication;
- rollback behavior is documented and tested;
- generated API/error docs remain in sync.
