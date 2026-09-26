# Compatibility Corpus v0.1

This corpus is frozen before further compatibility tuning. A case is not removed because it fails. Unsupported lockfiles, native addons, watcher-heavy repositories and postinstall/native toolchains remain visible so the compatibility boundary stays measurable.

The machine-readable source is `compat/REAL-REPOSITORY-CORPUS.v0.1.json`. Tests and the online pin verifier consume that file directly. `docs/compatibility/COMPATIBILITY-BASELINE.v0.1.json` is generated from the same source and intentionally contains no synthetic "Node compatibility percentage".

Current repository classes include tiny and medium Vite React, ESM-only, CJS-heavy, exports-heavy, watcher-heavy, dependency-heavy and monorepo cases. Package strata include pure JS, dual packages, streams, crypto, zlib, HTTP, CLI, postinstall, native addon and optional-native behavior.

The browser real-repository court now covers two pinned repositories. `sindresorhus/yoctocolors@a85b98a90e5731914567d8c209e7ec45ac2d24e2` exercises ESM-only source plus the bounded `node:tty` adapter; `lukeed/clsx@925494cf31bcd97d3337aacd34e659e80cae7fe2` exercises pure ESM default/named exports without Node builtins. Each case runs twice in fresh publication + Dedicated Worker realms and every closed session must subsequently fail stale fetch with HTTP 504.

For package-tarball identity, every corpus case explicitly records one of three states: published+digest-pinned, not published at the frozen root version, or not applicable because the root manifest has no frozen version. The 9 published cases pin exact npm tarball URL, SHA-512 SRI and SHA-1 shasum; CI downloads every `.tgz` and recomputes both hashes. Separately, the browser court installs and executes the exact npm-published `clsx@2.1.1` tarball through FrozenInstaller/VNFS/package-exports/native-ESM.

## Known limitations

- The promoted package graph accepts npm `package-lock` v2/v3; pnpm/yarn lockfiles remain in the corpus but are not accepted as install authority.
- Native `.node` addons, node-gyp and arbitrary native binaries are unsupported in the browser runtime.
- Generic `fs.watch`/chokidar parity is not promoted; Vite's proven HMR path is a narrower compatibility claim.
- Guest code does not receive arbitrary OS child processes or raw TCP/UDP; those surfaces are intentionally different from Node host semantics.
- Exact Vite compatibility remains tied to the retained Vite 8.3.0/Rolldown 1.2.9 profile; repositories on other toolchain versions are not silently counted as equivalent.
- Minimum browser versions are not frozen until a real cross-browser matrix exists.
- A frozen corpus, repeated browser execution and one passing published dependency package do not close P11. Broader repository execution, actual published OpenContainer package/bundle certification, promotion-threshold freeze, browser-version matrix and release compatibility reports remain open.
