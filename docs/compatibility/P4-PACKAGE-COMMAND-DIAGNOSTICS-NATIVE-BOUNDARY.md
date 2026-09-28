# P4 Package Command, Diagnostics, and Native-Addon Boundary

This document freezes the promoted P4 Wave 4 boundary for the declared OpenContainer browser profile. It narrows three production gates without expanding Core 1.x into host-native execution or software-composition analysis.

## P4-14 — package `.bin` commands

Package command resolution is derived from the frozen package graph and the invocation context.

- The graph retains every candidate for a command name; compilation does not use last-writer-wins replacement.
- At invocation, the command is resolved from the caller `cwd` / package ancestry.
- A nearer nested candidate wins over a visible root candidate.
- Candidates at the same effective scope are ambiguous and fail closed.
- The process registry only exposes the command name. It does not become the authority for which package instance owns that command.

## P4-17 — package diagnostics

Support diagnostics emit metadata needed to reproduce package identity and policy decisions:

- package name, version, physical location, content and instance identity;
- lockfile integrity identity;
- privacy-sanitized source provenance plus an irreversible diagnostic fingerprint of the original source string;
- package layout identity/fingerprint;
- install-script presence and the active `deny-by-default` policy;
- native-addon boundary metadata.

Source URLs remove username, password, query, and fragment before export. Workspace-link or opaque source strings are represented by a class plus fingerprint instead of raw source text.

These diagnostics are **not** a full SCA scanner. They do not claim vulnerability, malware, license-compliance, dependency-trust, exploitability, or package-safety verdicts.

## P4-18 — native addons and adapters

Native `.node` execution, node-gyp execution, and arbitrary host-native binaries remain unsupported in Core 1.x.

The resolver applies the following fail-closed boundary:

1. A resolved `.node` target fails with `OC_NATIVE_ADDON_UNSUPPORTED` by default.
2. Generic package aliases and generic path aliases do not authorize a native-addon fallback.
3. A fallback is accepted only through `nativeAddonAdapters` with an exact absolute `.node` source path.
4. The adapter target must be an exact non-`.node` file that exists in PackageFS/WorkspaceFS.
5. The adapter mapping participates in resolver cache identity.
6. The resolution receipt records the exact source and target with `explicit=true`.
7. No host-native code is executed by this mechanism; the adapter is ordinary supported browser/JS/WASM-side content.

This is an explicit compatibility adapter boundary, not generic native-addon compatibility.

`production_closed=false`.
