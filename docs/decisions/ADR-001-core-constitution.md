# ADR-001 — Keep Core at exactly nine semantic surfaces

**Status:** Accepted for 1.x implementation.

OpenContainer's implementation may use many internal packages, but public semantics remain S1–S9. New product concepts must map to an existing surface or remain adapters/consumers.

This prevents research/tooling concerns from silently becoming product scope and preserves a small SDK mental model.
