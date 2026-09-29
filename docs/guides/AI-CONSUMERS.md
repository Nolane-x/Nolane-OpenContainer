# AI Consumer Guidance

AI is an optional consumer of OpenContainer Core. It is not part of the runtime trust model and must not redefine Core guarantees.

## Separation

Core provides deterministic runtime surfaces: workspace, process, package, network, preview, persistence, resources and diagnostics.

An AI/agent layer may call those surfaces through the public SDK, but it should live in a separate package/application layer. The Core runtime must remain useful without an LLM, model provider, MCP server or agent planner.

## Recommended agent boundary

Expose high-level actions such as:

- mount/read/write selected workspace files;
- run a registered/supported command;
- install from a frozen package graph;
- open a preview;
- create/export a snapshot;
- inspect structured diagnostics.

Do not hand an agent direct references to internal Worker authorities, origin-wide browser storage, unrestricted fetch, raw secrets or release infrastructure.

## Confirmation and policy

Consumer products should decide which AI actions require user confirmation. OpenContainer Core does not assume that "AI requested it" grants authority.

For destructive or externally visible actions, bind the agent to the same capability checks and audit receipts used by non-AI callers.

## Model/provider independence

Do not encode model-specific behavior into Core APIs. Provider adapters may translate model tool calls into public SDK operations. If one provider requires a special transport or prompt format, keep it outside runtime packages.

## Data handling

Before sending workspace data to a model/provider, the consumer must apply its own privacy and authorization policy. OpenContainer does not automatically upload files, snapshots, diagnostics or package content to an AI provider.

## Failure model

Agents should branch on stable OpenContainer error codes, not scrape console strings. Recovery logic belongs in the AI consumer layer and must not bypass Core security or compatibility failures.


## Reference consumer authority package

The repository now includes `@nolane/opencontainer-ai-consumer` as an **optional consumer package**. It does not add a tenth Core surface and the runtime remains fully usable with no model/provider configured.

The reference package freezes these boundaries:

- provider keys are opaque session-memory credentials by default; provider switch advances an epoch and clears credential/context scope;
- context egress is described by an explicit Context Manifest with file/category/range metadata; sensitive paths are excluded unless the application records an exact override;
- repository text, web pages and tool output are untrusted data and cannot grant tool authority;
- Discuss, Plan and Build are separate authority modes; mutation requires Build plus an explicit one-use approval;
- canonical AI mutation uses a preconditioned ChangeSet, validation, one VFS transaction, a commit receipt and explicit acknowledgement;
- broad destructive changes retain a local recovery point before canonical publication;
- retries use one ChangeSet/idempotency identity and cannot replay a committed side effect after acknowledgement loss;
- Undo is path/version-aware and refuses to overwrite newer user edits;
- provider failure or provider switch does not redefine local workspace/runtime availability;
- child-agent results are epoch-bound; stale/cancelled results may remain reviewable evidence but are never canonical;
- shared agent/tool concurrency consumes the same bounded `ResourceGovernor` task authority used elsewhere;
- cost/token UI is hidden unless the provider response marks metadata authoritative. The reference package does not fabricate token or cost estimates.

The reference browser court uses fake provider adapters only to exercise authority, failure, switch and metadata semantics. It makes **no claim about model/provider quality** and sends no workspace data to an external AI service during CI.
