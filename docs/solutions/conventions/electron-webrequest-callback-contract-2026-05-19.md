---
title: 'Electron webRequest listener — `callback({})` is the "pass through" form; never call with `{ responseHeaders: undefined }` or similar'
module: apps/desktop/backend
date: 2026-05-19
category: conventions
problem_type: convention
component: tooling
severity: medium
applies_when:
  - "Writing or modifying any Electron `webRequest.onHeadersReceived` / `onBeforeRequest` / `onBeforeSendHeaders` listener"
  - "Adding a try/catch to a webRequest listener"
  - "Handling URL filters whose patterns over-match the hosts you actually want to mutate"
  - "Modeling an Electron session in tests with a fake webRequest API"
tags: [electron, webrequest, session, callback, contract, network]
---

# Electron webRequest listener — `callback({})` is the "pass through" form; never call with `{ responseHeaders: undefined }` or similar

## Context

Electron exposes synchronous-callback hooks on each `session.webRequest.on*` API. Every listener takes `(details, callback)` and must invoke `callback` exactly once with a response shape that tells Electron what to do. The contract has two safe shapes:

```typescript
callback({});                                  // pass response through unchanged
callback({ responseHeaders: <new headers> });  // apply these headers
callback({ cancel: true });                    // cancel the request (onBeforeRequest only)
```

What's **not** in the documented contract is `callback({ responseHeaders: undefined })`. It looks equivalent to `callback({})` — but Electron's interpretation has shifted across versions:

- Some versions silently coerce `undefined` to "pass through" (matches `{}`).
- Some versions treat `responseHeaders: undefined` as "replace the response's headers with no headers" — which strips legitimate headers (Content-Type, Cache-Control) and breaks the response.
- Some versions throw a console warning but continue.

Tests against a fake session don't surface the divergence. The bug ships, then surfaces in a specific Electron upgrade or a specific OS network stack, and the diagnostic trail leads back to a webRequest listener that "looks correct."

## Guidance

Treat `callback({})` as the only correct shape for every non-mutating path in a webRequest listener. Apply this in three places:

1. **Excluded URL paths.** The URL filter (`{ urls: [...] }`) might over-match. Inside the listener, if your predicate decides not to mutate, return `callback({})`, not `callback({ responseHeaders: details.responseHeaders })`.

2. **Missing or unusable inputs.** `details.responseHeaders` (or `details.requestHeaders`) can be undefined in edge paths — early-cancelled responses, certain failure modes, particular protocols. Branch on truthiness and pass `{}`.

3. **Caught throws.** Wrap any non-trivial header mutation in a try/catch and pass `{}` in the catch arm. Never let a thrown error reach Electron's network stack — the listener will hang the request.

```typescript
// apps/desktop/src/backend/services/third-party-cookie-stripper.ts
export function registerThirdPartyCookieStripper(session: Session): void {
  session.webRequest.onHeadersReceived(
    { urls: [...THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS] },
    (details, callback) => {
      // callback({}) = "no modifications, pass response through" per Electron's
      // contract. We use it for every non-mutating path: hosts the predicate
      // excludes, responses that arrive without headers, and any unexpected
      // throw from the strip path (a malformed header shape should never hang
      // the response — passthrough is always safer than nothing).
      if (!shouldStripSetCookieForUrl(details.url) || !details.responseHeaders) {
        callback({});
        return;
      }
      try {
        const responseHeaders = stripSetCookieFromHeaders(
          details.responseHeaders as HeaderMap
        );
        callback({ responseHeaders: responseHeaders as Record<string, string[]> });
      } catch {
        callback({});
      }
    }
  );
}
```

For listeners that fan out into helper functions, the same rule applies: the helper either returns the new headers (and the listener wraps them in `{ responseHeaders }`) or it throws (and the listener catches and passes `{}`). Don't return `undefined` from a helper and feed it into the callback.

## Why This Matters

- **Failure mode is silent and version-dependent.** A listener that hands `{ responseHeaders: undefined }` to the callback can work for months, then break the day Electron is upgraded — and the failure manifests as broken response headers (missing `Content-Type`, stripped CORS), not as an obvious crash.
- **Cookie strippers and CSP rewriters are exactly the listeners where this bites.** They mutate headers on every cross-origin response. One unhandled edge path corrupts every response on that origin until the renderer is reloaded.
- **The fake session in tests under-models the contract.** A reasonable mock might just record what was passed; it won't reproduce Electron's interpretation of `undefined`. The only way to catch this with tests is to assert the listener calls `callback({})` (not `callback` with anything else) on the no-mutation path.
- **The cost of getting it right is one line.** `if (!ok) { callback({}); return; }` is shorter than the wrong alternative. There's no readability cost — only a correctness gain.

## When to Apply

- Every Electron `webRequest.on*` listener in `apps/desktop/src/backend/`.
- Helper functions that return headers for a listener — they must return a complete `HeaderMap` or throw; never return `undefined`.
- Tests that simulate Electron sessions: assert listener behavior on the excluded-URL path AND the missing-input path AND the throw path. The fake's `fire(url, headers)` method should treat a callback invocation with `responseHeaders === undefined` as "pass original through" (because that's what real Electron usually does), so that a regression where the production code stops calling `callback({})` is caught.

This convention does NOT apply to:
- `onBeforeRequest` cancel decisions — `callback({ cancel: true })` is correct and intentional.
- Listeners that intentionally clear all response headers — that's an extreme case requiring `responseHeaders: {}` (empty object), not `undefined`. Document the intent in a comment when this is the case.

## Examples

**Wrong — passes `undefined` through:**

```typescript
session.webRequest.onHeadersReceived(
  { urls: ["*://*.example.com/*"] },
  (details, callback) => {
    const responseHeaders = details.responseHeaders
      ? stripSomething(details.responseHeaders)
      : details.responseHeaders;  // <- `undefined` flows into the callback
    callback({ responseHeaders });
  }
);
```

**Wrong — no catch, listener hangs on throw:**

```typescript
session.webRequest.onHeadersReceived(
  { urls: ["*://*.example.com/*"] },
  (details, callback) => {
    const responseHeaders = stripSomething(details.responseHeaders); // may throw
    callback({ responseHeaders });
  }
);
```

**Correct — `{}` for every non-mutating path:**

```typescript
session.webRequest.onHeadersReceived(
  { urls: ["*://*.example.com/*"] },
  (details, callback) => {
    if (!shouldMutate(details.url) || !details.responseHeaders) {
      callback({});
      return;
    }
    try {
      const responseHeaders = stripSomething(details.responseHeaders);
      callback({ responseHeaders });
    } catch {
      callback({});
    }
  }
);
```

**Correct test assertion — fake session models the contract:**

```typescript
// In tests/services/third-party-cookie-stripper.integration.test.ts
fire(url: string, responseHeaders: HeaderMap): HeaderMap | undefined {
  // Electron semantics: a callback that omits responseHeaders means
  // "no modifications, pass original through". Model that here so the
  // listener's "no-op" paths look like Electron actually treats them.
  let result: HeaderMap | undefined = responseHeaders;
  listener({ url, responseHeaders }, (resp) => {
    if (resp.responseHeaders !== undefined) {
      result = resp.responseHeaders;
    }
  });
  return result;
}

it("calls callback({}) when details.responseHeaders is undefined", () => {
  // ... fire listener with undefined headers, capture the response object ...
  expect(capturedResponse).toEqual({});
});

it("falls back to callback({}) if the strip throws on a malformed header shape", () => {
  // ... pass a Proxy whose ownKeys throws ...
  expect(() => fake.fire(url, malformed)).not.toThrow();
});
```

Existing listeners to audit against this rule:
- `apps/desktop/src/main.ts:184-205` — `onBeforeRequest` ad-block (uses `callback({})` and `callback({ cancel: true })` correctly)
- `apps/desktop/src/main.ts:209-223` — `onBeforeSendHeaders` Kick CDN referer (currently does `callback({ requestHeaders: modifiedHeaders })` unconditionally — fine because the modification always succeeds, but a future contributor adding a conditional should pass `{}` on the non-mutating branch)
- `apps/desktop/src/main.ts:227-248` — `onHeadersReceived` Twitch CSP rewrite (calls `callback({ responseHeaders: headers })` with a shallow copy — also fine because `headers` is never undefined, but the try/catch passthrough pattern would be safer for future edits)
- `apps/desktop/src/backend/services/third-party-cookie-stripper.ts` — the reference implementation of this convention.
