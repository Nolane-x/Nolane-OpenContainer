# Clean-room Design Diary

**Status:** active engineering provenance record. This is not legal advice or an FTO opinion.

OpenContainer uses public standards, public documentation, reviewed open-source artifacts and observable public behavior as compatibility inputs. Proprietary implementation internals are not an accepted design source.

## 2026-10-01 — browser substrate

Inputs: WHATWG web-platform standards and MDN documentation for Workers, Service Workers, Fetch/URL, OPFS/File System Access, Web Locks, permissions and lifecycle behavior.

Recorded learning: capability availability, browser lifecycle/failure behavior and public API semantics. Implementation remains OpenContainer-authored and is validated against browser behavior.

## 2026-10-01 — Node/package compatibility

Inputs: Node.js public API documentation, npm public package metadata/package-lock formats, and frozen permissively licensed compatibility repositories listed in `compat/REAL-REPOSITORY-CORPUS.v0.1.json`.

Recorded learning: public module/package/API behavior only. Unsupported behavior stays explicit instead of copying a proprietary runtime implementation.

## 2026-10-01 — browser/WASM toolchain

Inputs: public Vite documentation/package metadata, Rolldown v1.2.9 public release/package metadata and reviewed MIT artifacts, and Lightning CSS 1.33.0 public MPL-2.0 package metadata.

Recorded learning: public package/export/artifact contracts, version/digest identity and observable browser execution behavior.

## 2026-10-01 — accessibility

Inputs: WCAG guidance, WAI-ARIA authoring guidance and browser accessibility APIs.

Recorded learning: focus, keyboard, dialog, announcement, reflow and high-contrast behavior.

## 2026-10-01 — release evidence

Inputs: SPDX 2.3, in-toto Statement v1, SLSA provenance v1 and OpenSSF public documentation.

Recorded learning: evidence formats and release-hygiene controls.

## Rule for future entries

Record the public source/standard or licensed artifact, what behavior was learned, and the OpenContainer component affected. Do not record or use confidential/leaked source, non-public vendor internals or decompiled proprietary implementation details as an implementation blueprint.
