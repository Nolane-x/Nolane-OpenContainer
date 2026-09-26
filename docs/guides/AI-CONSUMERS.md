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
