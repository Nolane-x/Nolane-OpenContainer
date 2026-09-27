# Support Diagnostics and Privacy

OpenContainer support diagnostics are local-first. A support bundle is a bounded machine receipt, not a workspace archive.

## Preview before generation

Call:

```js
const preview = runtime.supportBundlePreview();
```

The preview lists every category that would be included and its privacy boundary. AI prompt/transcript content is excluded by default. A deployment-header category appears only when a deployment probe is explicitly requested.

## Generate a local bundle

```js
const bundle = runtime.supportBundle(error);
```

The bundle contains:

- exact production/runtime/protocol/storage profile versions;
- runtime state;
- a stable `ocfp-v1-*` failure fingerprint;
- Preview epoch, VFS generation, package-graph generation and checkpoint sequence;
- browser capability flags;
- package content identities/digests without private package file bytes;
- storage generation/locking metadata;
- last known workspace recovery, release migration/rollback and Service Worker update outcomes when those events occurred;
- bounded diagnostic event types without diagnostic details;
- raw diagnostic/duplicate/terminal bounds;
- stable error name/code.

It excludes workspace contents, private source, HTTP bodies and secrets.

Generating the bundle is read-only with respect to canonical workspace/checkpoint state.

## Deployment-header diagnostics

To add a read-only deployment probe:

```js
const bundle = await runtime.createSupportBundle(error, {
  deploymentBaseUrl: location.origin
});
```

The probe fetches only the root, strict Worker, toolchain Worker and Service Worker endpoints and records selected security headers/status. It does not read or include response bodies. No network request occurs unless `deploymentBaseUrl` is explicitly supplied.

## AI content

Prompts/transcripts are excluded by default even if an `aiContent` value is passed.

They are considered only with explicit opt-in:

```js
runtime.supportBundle(error, {
  includeAiContent: true,
  aiContent: { prompt, transcript }
});
```

Secret-like values are still redacted. Consumer products should normally omit AI content and collect it only with user-facing consent.

## Deterministic local self-check

From the repository:

```bash
npm run diagnostics:self-check
```

From the installed package:

```bash
opencontainer-diagnostic-self-check
```

The command boots a bounded runtime, creates a stable failure, exercises duplicate suppression and privacy sentinels, then prints a deterministic support fingerprint and PASS/FAIL checks. It does not upload the receipt.

## Telemetry

OpenContainer Core has no analytics or crash-upload endpoint and does not require remote telemetry. See `docs/production/TELEMETRY-POLICY.md`.

When filing a bug, share the stable error code, fingerprint, profile/version and minimal reproduction receipt. Do not paste API keys, cookies, signed URLs, workspace files, private source or AI transcripts.
