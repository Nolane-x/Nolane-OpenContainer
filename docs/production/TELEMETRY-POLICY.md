# Telemetry and Crash Reporting Policy

OpenContainer Core has no remote analytics requirement.

The machine-readable policy is `docs/production/TELEMETRY-POLICY.v0.1.json`.

By default:

- remote analytics are off;
- crash upload is off;
- Core contains no crash/analytics endpoint;
- support bundles are generated locally;
- support bundle generation emits no network request unless the caller explicitly asks for a deployment-header probe;
- AI prompts/transcripts, workspace contents and HTTP bodies are excluded;
- enabling telemetry in a consumer product does not change Core correctness or compatibility guarantees.

A consumer may build opt-in telemetry outside Core. That consumer owns consent, retention, transport security, endpoint policy and deletion. It must not convert a Core support-bundle preview into automatic upload.
