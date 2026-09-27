# Production diagnostics and support bundles

OpenContainer diagnostics are local-first, bounded and privacy-minimized by default. Core does not require remote analytics to boot, execute packages, run processes, persist workspaces or generate support evidence.

## Bounded evidence

The production policy freezes independent budgets for:

- diagnostic entry count;
- raw diagnostic bytes;
- duplicates per fingerprint;
- tracked duplicate fingerprints;
- terminal metadata entry count;
- terminal metadata bytes.

Terminal history records process/stream/byte metadata only. Raw terminal text is not copied into support bundles.

## Stable failure fingerprint

Every support bundle contains a stable `ocfp:...` fingerprint plus a non-sensitive fingerprint basis:

- production profile and runtime version;
- Worker RPC/snapshot/Service Worker compatibility versions;
- runtime state;
- preview epoch;
- workspace generation;
- package generation;
- persisted workspace sequence/generation.

Diagnostic event contents are represented by redacted event fingerprints rather than raw detail.

## Preview before export

Call:

```js
runtime.supportBundlePreview(options)
```

before sharing a bundle. The preview lists included categories and privacy exclusions without mutating canonical runtime state.

## Package and storage identity

Support bundles may include:

- package name/version/contentId and valid SRI digests;
- a stable package-graph fingerprint;
- workspace generation;
- checkpoint sequence/generation/digest;
- persistent package-store counts.

Resolved package URLs and package/source bytes are not included. Non-SRI integrity metadata is represented only by a fingerprint.

## Recovery, migration and update outcomes

Workspace recovery is recorded automatically during SDK boot. Migration and update courts can attach their last structured outcome with:

```js
runtime.recordSupportOutcome('migration', receipt)
runtime.recordSupportOutcome('update', receipt)
```

Only an allowlisted set of status/version/generation/profile fields survives into the support bundle.

## Browser and deployment probes

Browser bundles include capability evidence for secure-context-adjacent runtime requirements such as cross-origin isolation, SharedArrayBuffer, Service Worker, OPFS and Web Locks.

Pass an executable `opencontainer.hosting-self-check.v0.1` receipt to `supportBundle()` to include deployment-header diagnostics without exporting HTTP bodies.

## AI content

AI prompt/transcript content is absent by default. A caller must explicitly request `includeAi: true`; even then prompt/transcript fields are redacted by the diagnostics privacy policy.

## Telemetry

Remote telemetry is off by default and there is no built-in remote transport. An embedding product may opt in only by supplying an explicit sink. The sink receives metadata-only events: sequence, public event type and stable fingerprint.

## Local/headless reproduction

The installed package exposes:

```bash
opencontainer-diagnostic --simulate-error OC_INVALID_STATE
opencontainer-diagnostic --url https://your-origin.example/ --simulate-error OC_INVALID_STATE
```

The command emits deterministic profile/fingerprint/capability/hosting/privacy metadata suitable for CI bug reproduction.

## Support issues

The repository issue template asks for privacy-minimized receipts and stable fingerprints. It explicitly tells reporters not to paste credentials, private source, workspace contents, HTTP bodies or AI prompts/transcripts.
