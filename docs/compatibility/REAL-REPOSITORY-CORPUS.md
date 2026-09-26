# Compatibility Corpus v0.1

This corpus is frozen before further compatibility tuning. A case is not removed because it fails. Unsupported lockfiles, native addons, watcher-heavy repositories and postinstall/native toolchains remain visible so the compatibility boundary stays measurable.

The machine-readable source is `compat/REAL-REPOSITORY-CORPUS.v0.1.json`. Tests and the online pin verifier consume that file directly. `docs/compatibility/COMPATIBILITY-BASELINE.v0.1.json` is generated from the same source and intentionally contains no synthetic "Node compatibility percentage".

Current repository classes include tiny and medium Vite React, ESM-only, CJS-heavy, exports-heavy, watcher-heavy, dependency-heavy and monorepo cases. Package strata include pure JS, dual packages, streams, crypto, zlib, HTTP, CLI, postinstall, native addon and optional-native behavior.

The first browser real-repository court is `sindresorhus/yoctocolors@a85b98a90e5731914567d8c209e7ec45ac2d24e2`. Its exact `index.js` and `base.js` blobs are pinned in the corpus. The playground proxies only those immutable commit URLs, mounts the returned source into Workspace VFS, publishes it as native ESM, and executes a probe in the Dedicated Worker. The `node:tty` substitution is explicitly bounded: browser `hasColors()` is conservative rather than a claim of terminal parity.

## Known limitations

- The promoted package graph accepts npm `package-lock` v2/v3; pnpm/yarn lockfiles remain in the corpus but are not accepted as install authority.
- Native `.node` addons, node-gyp and arbitrary native binaries are unsupported in the browser runtime.
- Generic `fs.watch`/chokidar parity is not promoted; Vite's proven HMR path is a narrower compatibility claim.
- Guest code does not receive arbitrary OS child processes or raw TCP/UDP; those surfaces are intentionally different from Node host semantics.
- Exact Vite compatibility remains tied to the retained Vite 8.3.0/Rolldown 1.2.9 profile; repositories on other toolchain versions are not silently counted as equivalent.
- Minimum browser versions are not frozen until a real cross-browser matrix exists.
- A frozen repository selection and one passing real-repository court do not close P11. Repeated browser runs, broader repository execution, published-package testing and release compatibility reports remain open.
