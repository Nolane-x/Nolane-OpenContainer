# Final External Decision Evidence

This directory stores **non-sensitive receipt metadata** for real external decisions/events. It must never contain privileged legal advice, private vulnerability details, credentials, participant PII, or synthetic PASS evidence.

The dedicated last-mile verifier covers only:

- **P1-15** — actual field browser-regression incident evidence with a retained regression test and SHA-256;
- **P13-03** — actual npm trusted-publisher/OIDC configuration for `@nolane/opencontainer`;
- **P16-01** — final project-license decision whose legal policy, root LICENSE file, and actual built distribution license all agree;
- **P16-05** — jurisdiction-specific FTO counsel review covering preview, network, storage, and runtime topology.

A receipt can become `READY_FOR_REVIEW` only when it matches the exact checked-out commit and the corresponding repository policy state has already been updated from the real external event. The verifier never edits policy or the production ledger.

Sensitive source material should remain in the appropriate external controlled system. The repository receipt records only the minimum non-sensitive identity, SHA-256 digest, outcome metadata, and actor attestation needed for review.

Verification:

```sh
npm run final:external:verify -- --receipt=release/external-evidence/<receipt>.json
```

The workflow `.github/workflows/final-external-decision.yml` is manual and read-only. It cannot publish, deploy, alter legal policy, or close gates. `closureEligible=false` and `production_closed=false` remain mandatory until a separate reviewed reconciliation.
