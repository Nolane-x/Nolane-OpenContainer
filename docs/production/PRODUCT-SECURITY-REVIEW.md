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
