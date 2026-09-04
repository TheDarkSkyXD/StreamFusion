# Network library architecture synthesis

## Pick

Candidate C is the base. The cross-judge scored it highest because one Chromium-session `AppNetwork` boundary fixes the existing proxy-bypass class without exposing a partly effective engine preference.

Candidate A dropped out before producing an artifact. Candidate C replaced it so the arena still compared two complete designs.

## Grafts

- From Candidate B, retain an internal request-class migration ledger. It is implementation evidence, not renderer-facing routing policy.
- From Candidate B, add honest Settings copy showing the effective built-in Chromium network library and naming fixed or excluded transports. Do not persist an engine preference until a second transport has parity.

## Rejections

- Reject Android labels `HttpEngine`, `Cronet`, and `OkHttp`. They do not exist as selectable Electron engines.
- Reject an immediate `Chromium | Node` selector. Node global fetch bypasses the configured Electron session proxy and lacks parity for cookies, proxy authentication, media loads, and redirects.
- Reject duplicating API / Tokens or HTTP Proxy. Both are already implemented and tested, with stronger secret handling than Xtra.

## Implementation slice

1. Add the main-owned `AppNetwork` boundary over `session.defaultSession.fetch`.
2. Route the shared robust HTTP client through it first. Keep interceptor-owned Twitch manifest retrieval off `defaultSession.fetch`: `Session.fetch` re-enters that session's `webRequest` interceptor. A proxy-aware manifest path requires a separate, proxy-synchronized session and is outside this slice.
3. Add a read-only `Network library` row to the existing Proxy tab showing `Chromium (built in)` and its exact scope. This satisfies Settings discoverability without pretending an unavailable second engine exists.
4. Correct proxy copy so it does not claim control of WebSockets or named direct partitions.
5. Add deterministic boundary, robust-client routing, and Settings tests.

## Verification

The design is accepted when the new boundary tests prove session fetch is used, focused proxy/token/settings tests pass, typecheck and lint pass, and the real Settings route shows the new row with accurate copy.
