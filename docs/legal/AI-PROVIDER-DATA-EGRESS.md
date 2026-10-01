# Optional AI Provider Data Egress

OpenContainer Core works without an AI provider. Provider connections are optional consumer-layer behavior.

Before a consumer sends workspace content, diagnostics, tool output, screenshots or other project data to a provider, the consumer must show or otherwise enforce the destination and context authorization appropriate to that product. OpenContainer does not automatically upload workspace files, snapshots, package contents or diagnostics to a model provider.

Provider credentials are opaque/session-scoped by default in the reference consumer. A provider switch changes the destination and must not silently reuse a prior sensitive-context approval.

The user or deploying product is responsible for reviewing the selected provider's terms, privacy policy, data-retention/training settings and any organization-specific data-processing requirements. OpenContainer makes no promise that third-party provider terms are suitable for every jurisdiction or workload.

Consumer products must provide their own privacy notice when they add provider egress beyond the reference local Core boundary. This document is product-language review for P16-13, not legal advice.
