# Hosting and Security Headers

OpenContainer's promoted browser path requires a secure browser context and cross-origin isolation. A deployment must not infer correctness from “the page loads.”

## Required host response headers

For the runtime/application document, the promoted Chromium profile currently expects:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

These headers are necessary for the SharedArrayBuffer/Worker execution path used by the current profile. The browser acceptance court additionally requires `globalThis.crossOriginIsolated === true`.

## Worker CSP profiles

The default guest Worker is intentionally stricter than the toolchain Worker.

Strict guest:

```http
Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'; child-src 'self'
X-OpenContainer-Worker-Profile: strict
```

Toolchain Worker:

```http
Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; connect-src 'self'; worker-src 'self'; child-src 'self'
X-OpenContainer-Worker-Profile: toolchain
```

JavaScript `unsafe-eval` is **not** permitted in the default guest profile. It is isolated to the toolchain bootstrap because the retained Vite 8.3 dependency-optimizer path currently requires dynamic code generation.

The Service Worker bootstrap must also expose:

```http
Service-Worker-Allowed: /
```

## Executable self-check

Run the playground or your deployment, then execute:

```bash
npm run hosting:self-check -- http://127.0.0.1:4173/
```

The command checks the runtime headers, both Worker CSP profiles, Service Worker scope, and the machine-readable production profile. It exits non-zero and reports the exact missing/mismatched header on failure.

This command verifies HTTP policy only. It does **not** replace browser acceptance: the shipping topology must still prove `crossOriginIsolated`, SharedArrayBuffer/Atomics, Workers, OPFS and Service Worker behavior in a real browser.

## Reverse proxies and CDNs

Do not assume application-server headers survive a CDN or reverse proxy. Run the self-check against the final public origin/CDN URL, and run the browser acceptance campaign against the same release topology before a production claim.
