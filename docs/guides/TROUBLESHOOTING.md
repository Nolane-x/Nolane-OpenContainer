# Troubleshooting

Start with stable OpenContainer evidence, not DevTools archaeology.

## 1. Capture the stable error

Record:

- `error.code`;
- `error.message`;
- `error.details`;
- the operation being performed;
- runtime/profile version;
- whether the failure occurred in Node contract CI or browser product path.

Look up the code in `docs/api/ERROR-REFERENCE.md`. Recovery automation should branch on the code, not the English message.

## 2. Capture runtime status

Use:

```js
console.log(runtime.status());
console.log(runtime.productionProfile);
```

For persistence issues, include current checkpoint/package persistence receipts without adding workspace file contents or secrets.

## 3. Hosting/browser failures

Run the executable header check against the final origin:

```bash
opencontainer-hosting-self-check https://your-origin.example/
```

If headers pass but browser execution fails, capture:

- browser/version/OS;
- `crossOriginIsolated`;
- Service Worker compatibility ID/activation receipt;
- the failing stable error code;
- the relevant browser-product-path stage.

Do not "fix" a Service Worker mismatch by forcing activation.

## 4. Package/module failures

For package errors capture the frozen package identity, importer/specifier and stable resolver error code. Do not replace a lockfile or disable SRI merely to see if the error disappears.

Native-addon errors require a WASM/pure-JS/backend alternative; they are not fixed by enabling lifecycle scripts.

## 5. Storage failures

For quota pressure export/GC before retrying writes. For migration errors retain both manifest/payload recovery roots and the migration receipt.

If rollback enters `OC_STORAGE_READ_ONLY`, do not rewrite/downgrade newer storage. Export data or return to a compatible writer.

## 6. Support bundle hygiene

A support bundle should contain machine receipts, versions, error envelopes and diagnostics required to reproduce the failure. It should not contain secrets, arbitrary workspace files, browser credentials or private package content unless the user explicitly chooses to provide them.

## 7. When DevTools is useful

DevTools can help inspect browser/platform behavior after the stable evidence above is collected. It is not the primary compatibility contract and console text is not a stable API.
