# Product Security Review — P12

This document describes the executable security-review boundary for OpenContainer Core 1.0. It does **not** claim that the product is secure or production-closed.

## Review authority

The machine-readable authority is `release/SECURITY-REVIEW-POLICY.v1.0.json`. It pins:

- OWASP ASVS 5.0.0 and the official JSON asset SHA-256;
- dependency-audit severity policy;
- immutable GitHub CodeQL action commit;
- vulnerability severity/SLA and release-blocking rules;
- the declared Chrome 153 / Ubuntu 24.04 x64 evidence profile;
- explicit non-machine-closable gates for disclosure-channel, second-party review, and human review.

## Threat model

`release/SECURITY-THREAT-MODEL.v1.0.json` covers the six source-gate trust zones:

1. trusted host/page authority;
2. guest JavaScript and Workers;
3. package bytes and metadata;
4. preview / Service Worker edge;
5. workspace and package storage;
6. future AI/provider credentials.

The threat model links each material threat to concrete controls and executable evidence. Future AI/provider credentials remain outside Core and do not inherit a security claim from the browser runtime.

## ASVS 5.0.0 cross-check

`release/ASVS-5.0.0-CROSSCHECK.v1.0.json` maps only requirements relevant to the deployed browser-native architecture. It does not mark unrelated server authentication/account requirements as PASS. Final public TLS/HSTS/CDN evidence remains outside the loopback CI topology.

## Executable courts

The P12 technical court includes:

- strict document CSP, Permissions-Policy, COOP/COEP/CORP, `nosniff`, and referrer controls;
- network capability, redirect and secret-handle tests;
- bounded package fetch/decompression/archive parsing;
- malicious-package corpus;
- deterministic parser fuzz/adversarial cases;
- path/symlink/traversal and snapshot/import ambiguity tests;
- Worker/resource/output/time bounds;
- Service Worker compatibility promotion and stale-route rejection;
- preview credential/identity isolation;
- stale-writer and recovery courts;
- generated secret redaction through journal/support paths;
- dependency vulnerability audit including build/dev tooling;
- pinned CodeQL JavaScript/TypeScript analysis;
- retained critical/high regression registry.

## Residual risks

`release/SECURITY-RESIDUAL-RISKS.v1.0.json` remains part of the review. Notable boundaries include browser-visible credentials, the isolated toolchain Worker's `unsafe-eval`, the single declared Chrome/Ubuntu evidence profile, lack of weak-device evidence, final CDN/header dependency, and untrusted third-party package behavior within granted capabilities.

## What remains intentionally open

- **P12-17:** no verified private disclosure channel is recorded yet.
- **P12-18:** no independent/second-party review artifact is recorded yet.
- **P12-20:** no human product-security review artifact is recorded yet.

CodeQL, npm audit, CI pass percentages, architectural confidence, or AI review must not be used to override those requirements.

`production_closed` remains false.


## Resource-DoS review

`release/SECURITY-RESOURCE-DOS-REVIEW.v1.0.json` explicitly reviews worker explosion, output floods, decompression, source-map generation and WASM memory growth. Source-map and WASM heap behavior retain residual-risk language: this security review does not claim a weak-device/browser-heap floor, and P7/P15 resource evidence remains open.

## Static analysis and regression evidence

CodeQL v4.38.2 is pinned by immutable commit. CI retains raw SARIF plus a commit-bound receipt; any unwaived CodeQL finding with security severity >= 7.0 fails the CodeQL job. Waivers must be explicit and unexpired.

The critical/high regression registry is also executable rather than documentary: `security:regressions` derives its test list from every registry entry, runs the union, hashes the log and emits a commit-bound receipt. A registry entry without executable test evidence fails closed.


## CI #409 technical closure boundary

PR #42 implementation head `4e05b3cf1ca27d6bb5f3e33fda69ebc6411d67af` passed CI #409 across contract, pinned CodeQL and installed-distribution Chrome. The retained receipts report zero npm vulnerabilities; zero CodeQL findings, waivers and unwaived blockers; 12 critical/high regression entries executed through 11 test files; and 2/2 complete browser product paths with zero unexplained failures.

This evidence closes the technical review duties for P12-01 through P12-16 and P12-19. It deliberately does not close P12-17, P12-18 or P12-20.


## External review intake

The repository now contains a fail-closed intake court for future independent/second-party and human product-security review artifacts.

An accepted review artifact must be public HTTPS JSON, match an explicitly supplied SHA-256, bind a full 40-hex OpenContainer source commit and identify a human reviewer. Independent P12-18 evidence must additionally state that the reviewer is independent from the project and cover at least the critical **isolation**, **storage** and **network** scopes named by the frozen security policy. P12-20 requires an explicit human product-security review flag.

The court rejects unresolved CRITICAL/HIGH findings. A PASS only produces `READY_FOR_REVIEW`; neither P12-18 nor P12-20 becomes machine-closable.

P12-17 has a separate repository-administration court. It can certify whether GitHub private vulnerability reporting is enabled only when an administrator supplies a read-only token with sufficient permission. Until such a receipt exists and is reconciled, P12-17 remains open.
