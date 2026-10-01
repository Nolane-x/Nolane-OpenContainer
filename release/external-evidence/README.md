# Final External Blocker Evidence

This directory is reserved for **real retained external/human/admin/legal evidence receipts**. No placeholder or synthetic PASS receipt belongs here.

The authoritative contract is `release/FINAL-EXTERNAL-BLOCKER-POLICY.v1.0.json`. Structural verification is performed by:

```sh
npm run external:blocker:verify -- --receipt=release/external-evidence/<receipt>.json
```

The verifier is intentionally fail-closed. A structurally valid receipt does not close a production gate. It can only become `READY_FOR_REVIEW` when the matching repository policy state has also been updated from the real external event. Ledger promotion remains a separate reviewed commit.

## Receipt envelope

Every retained receipt must use schema `opencontainer.external-blocker-receipt.v1.0` and contain:

- the exact gate and policy-defined evidence kind;
- the exact 40-hex source commit reviewed;
- an ISO timestamp;
- the named human/admin/counsel actor, role, and non-automation actor type;
- SHA-256 of the underlying retained evidence artifact;
- an explicit actor confirmation statement;
- gate-specific evidence under `data`.

Do not commit private vulnerability details, secrets, privileged legal advice, personal participant data, private admin credentials, or sensitive security findings into the receipt. Retain sensitive source material in the appropriate controlled system and record only the non-sensitive identity/digest needed for review.

## Gate-specific authority

- **P1-15** — actual field browser-regression incident evidence with environment, root cause, disposition/fix, and retained regression.
- **P9-05** — manual screen-reader acceptance covering the retained screen-reader scenarios, with screen-reader/browser/OS identity and zero unresolved blocking issues.
- **P9-11** — human comprehension task evidence; the repository does not invent a stronger participant threshold than the source gate requires.
- **P12-17** — independently verified live private vulnerability intake channel.
- **P12-18** — independent/second-party security review covering isolation, storage, and network.
- **P12-20** — human product-security review.
- **P13-03** — real npm OIDC/trusted-publisher configuration for `@nolane/opencontainer`, without a long-lived publication token.
- **P13-17** — external certification of branch/tag/release protection settings.
- **P16-01** — final project-license decision by the accountable human/legal authority.
- **P16-05** — jurisdiction-specific FTO review by qualified counsel.

## Legal and security boundaries

A P16-01 receipt is rejected while the repository/distribution still says `UNLICENSED`. A P16-05 receipt is rejected until the legal policy records the counsel decision. A counsel result of `BLOCKED` is preserved as `BLOCKED_BY_COUNSEL`, never converted into release readiness.

P12/P13 receipts likewise cannot override repository policy. The corresponding review/admin state must be updated from the real external event before the receipt can become `READY_FOR_REVIEW`.

The workflow `.github/workflows/external-blocker-receipt.yml` has read-only repository permission. It cannot publish, deploy, modify policy, mutate the ledger, or create external authority.

Current production closure remains `false`.
