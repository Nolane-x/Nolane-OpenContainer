# Network, Secret and Preview Security Profile

OpenContainer Core treats external networking, secret use and preview routing as separate authorities. The promoted P5 profile is browser-native and fail-closed.

## Frozen network profiles

The machine API exposes four named profiles:

- **Offline** — no external request is authorized.
- **Registry-only** — only explicit capabilities marked `registry` may authorize.
- **Restricted** — the default; only explicit origin/method/path rules authorize.
- **Open-web** — explicit opt-in for non-local HTTP(S) destinations and a frozen method set. Local/private destinations still require `allowLocal=true`.

An existing authority can only move to an equal or more restrictive profile. A profile upgrade requires construction of a new authority so a caller cannot silently turn an Offline/Restricted runtime into Open-web.

Every allow/deny receipt carries a versioned policy identity and deterministic policy hash.

## URL and redirect rules

Policy matching happens after canonical URL parsing, but ambiguous raw syntax is rejected first. URL credentials, backslashes/control characters and percent-encoded host syntax are not accepted. Path prefixes are segment-aware, so capability `/api` does not authorize `/apix`.

Every redirect is handled manually and the target is re-authorized before it is fetched. Opaque redirects fail closed.

## Browser local-network boundary

Loopback aliases and local/private address classes are classified after URL canonicalization. Direct-browser local access remains disabled unless `allowLocal=true`.

The declared Chrome profile records browser Local Network Access permission behavior separately from network-policy classification; the result is evidence, not a promise that every browser exposes the same permission descriptor.

## Broker SSRF boundary

Core does not ship a broker fetch proxy. `BrokerSsrfRequirements` defines the minimum contract for a future separately trusted broker: DNS/address re-check, private/metadata denial, redirect re-authorization, request/response budgets and authority-side credential injection.

A future broker must earn its own evidence. Direct-browser PASS does not promote broker SSRF safety.

## Secret authority

Plaintext secrets are stored inside `NetworkAuthority`. Consumers receive opaque handles only. A binding may scope use by scheme, host, method, path, expiration, session, process and task.

Sensitive request headers (`Authorization`, `Proxy-Authorization`, `Cookie`) cannot be passed as raw fetch headers. They must be injected by an opaque secret handle after the request itself has passed network authorization. Redirect hops re-evaluate secret scope and drop a handle when the redirected target is outside scope.

Package installation does not accept secret handles in the promoted profile; lifecycle scripts remain denied by default.

## Response and cancellation budgets

Response budgets count bytes read from the actual response stream. A misleading or absent `Content-Length` does not weaken the limit. AbortSignal cancellation cancels the active body reader and rejects the operation.

## Preview isolation

Virtual preview routing is not an external-network capability. Service Worker preview routes require owner + epoch proof and stale receipts fail closed.

Browser products should embed untrusted preview documents using the promoted sandbox helper without `allow-same-origin`. The frame may execute scripts, but it must not gain the trusted page origin, parent credentials or canonical storage authority.

## Evidence boundary

The P5 court is bounded to the declared P0 evidence profile (Chrome 153 / Ubuntu 24.04 x64). It is not a cross-browser or production-CDN claim.
