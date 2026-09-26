# ADR-007 — Release claims are derived from evidence, not labels

**Status:** Accepted.

OpenContainer release evidence binds a reproducible distribution artifact to checksums, SPDX SBOM, provenance, source identity and machine-readable release receipts.

Promotion follows a frozen canary → beta → rc → stable policy. The evaluator returns GO, REDESIGN or KILL and never lowers stable requirements to fit current evidence.

**Reason:** a tag, version string or successful source checkout does not prove that the distributed artifact passed the claimed browser/security/migration courts.

**Consequence:** some release gates remain open even when the core runtime is feature-complete. Public production claims require the corresponding artifact, browser, legal and operations evidence.
