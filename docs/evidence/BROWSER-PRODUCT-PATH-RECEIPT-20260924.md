# Browser Product Path Receipt

**Observed:** 2026-09-24 UTC / 2026-09-25 Asia/Bangkok  
**CI run:** 36070577289  
**Chrome:** 153.0.8010.52  
**Result:** PASS

The clean browser job passed the OpenContainer product-path acceptance court with a fresh Chrome profile.

Observed receipt:

```text
pageCrossOriginIsolated   true
first native ESM result  44
edited/restarted result  94
stale session status     504
edge                     service-worker
real OPFS recovery       PASS
browser package install  PASS
```

Real OPFS recovery deliberately corrupted the newest payload after two checkpoint publications. Reopening the authority rejected generation 2 and recovered generation 1.

The browser package-install court fetched the exact retained `lightningcss-wasm@1.33.0` artifact through NetworkAuthority + PackageArtifactAuthority, SRI-verified it, ingested 19 files into one immutable PackageContent identity, mounted the frozen graph, and resolved:

```text
/workspace/node_modules/lightningcss-wasm/wasm-node.mjs
```

Evidence boundary:

- PASS-CI-CHROME for the tested browser product path;
- not a claim of the full PC-A/PC-B target-device matrix;
- SharedArrayBuffer sync-RPC remains open;
- VITE-C1 guest/browser execution remains open;
- C2 dev/HMR remains open.
