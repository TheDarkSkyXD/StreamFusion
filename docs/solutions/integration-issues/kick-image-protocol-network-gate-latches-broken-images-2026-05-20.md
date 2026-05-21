---
title: kick-image:// 404s latch as permanent broken images when isNetworkLikelyDown() gate fires
module: apps/desktop/backend/api/platforms/kick
date: 2026-05-20
category: integration-issues
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "Every Kick avatar and video/clip thumbnail on the discover page or stream-detail Videos tab renders the initial-letter fallback instead of an image"
  - "kick-image:// protocol returns HTTP 404 with anomalously fast timing (1-12 ms) — far below the 30-100 ms minimum for a real S3/CloudFront round-trip"
  - "Direct curl/renderer fetch of the same CDN URL returns 200 OK in ~26 ms, ruling out hotlink protection or URL invalidity"
  - "Once latched, images stay broken for the rest of the session — the underlying network recovers seconds later but no retry ever fires"
  - "No errors in the renderer DevTools console; only the fallback initials make the failure visible"
root_cause: logic_error
resolution_type: code_fix
related_components: [proxied-image, kick-network-health, kick-image-protocol, electron-net-request]
tags: [kick, electron-protocol, network-health-gate, proxied-image, image-fetch, circuit-breaker, one-shot-fetch]
---

# kick-image:// 404s latch as permanent broken images when isNetworkLikelyDown() gate fires

## Problem

A `kickClient.fetchImageBytes()` short-circuit (`if (isNetworkLikelyDown()) return null`) returned `null` whenever the global Kick network-health gate was armed, which the `kick-image://` protocol handler translated into HTTP 404. The renderer's `ProxiedImage` component latched `hasError=true` on the resulting `<img>.onerror` and never retried, so a brief 3-second unhealthy window during a discover-page mount left avatars and thumbnails permanently broken for the rest of the session — long after the gate self-cleared.

## Symptoms

- All Kick avatar / video / clip thumbnail `<img>` elements rendered the initial-letter fallback (`ProxiedImage` `hasError` branch).
- The `kick-image://` custom protocol handler returned HTTP 404 for every Kick CDN URL.
- Response timing on the 404s was 1-12 ms — diagnostic for a synchronous short-circuit, not a real network round-trip.
- Symptom appeared after any brief network turbulence at page mount, then persisted across navigation within the same session.
- No errors in the renderer DevTools console — only the visual fallback signaled the failure.

## What Didn't Work

**Suspected `persist:kick-cdn-direct` Electron session partition had corrupted state (cookies, cache).** Ruled out by reading `getCdnSession()` in `kick-client.ts`. The method calls `session.fromPartition("persist:kick-cdn-direct")` followed by `setProxy({ mode: "direct" })` — no meaningful mutable state to corrupt across restarts.

**Suspected the dynamic `require("electron")` calls at `kick-client.ts:145, :242, :287` were the cause.** Commit `c169aa4` had flagged this pattern as bundling-fragile in other files. Investigating revealed a vitest `require`-with-`resetModules` interop quirk that affected only the test environment, not production. Red herring.

**Suspected the URL was invalid or hotlink-protected.** Ruled out by direct `curl` from the dev machine: both example URLs returned HTTP 200 with image bytes. A direct `fetch` from the renderer (bypassing `kick-image://`) also returned 200 in ~26 ms. The URL was fine; the failure was in the proxy path only.

**Suspected the `catch`-branch in `fetchImageBytes` was firing and hiding an error.** Couldn't directly rule out from the renderer because the catch logs to the main-process console, which isn't visible via electron-mcp probes against the renderer. Eliminated by adding a temporary `kick-image://debug` endpoint that returned `{ networkDown: isNetworkLikelyDown(), ts: Date.now() }`. After a forced main-process restart, the debug endpoint returned `networkDown: false` and the same image URL returned 200 in 80 ms. That nailed the gate as the cause.

## Root Cause

`fetchImageBytes` contained a guard that mirrored the one on other Kick request methods:

```ts
// kick-client.ts — fetchImageBytes (pre-fix)
if (isNetworkLikelyDown()) {
  return null;
}
```

`kick-network-health.ts` tracks Chromium Utility/GPU process health to suppress retry storms during the ~1-3 s process restart window. Two inputs arm it: an explicit `recordServiceCrash()` from `main.ts` on `child-process-gone`, and implicit detection — 3+ `net::ERR_FAILED` errors within a 2-second rolling window fire `recordServiceCrash("ERR_FAILED burst")`, which sets `unhealthyUntil = Date.now() + 3000`. Each subsequent burst within 2 s rolls `unhealthyUntil` forward another 3 s.

During a discover-page mount, many concurrent Kick API calls and stream polls issue simultaneously. A single brief network blip causes a burst of `net::ERR_FAILED` from those callers — enough to arm the gate. While the gate is armed, every `fetchImageBytes` call returns `null` instantly. The protocol handler at `kick-image-protocol.ts:58` turns `null` into HTTP 404. The renderer's `<img>.onerror` fires. `ProxiedImage.onError` sets `hasError=true`. And there it stays — because `hasError` only resets when the `src` prop changes:

```tsx
// proxied-image.tsx — hasError resets only on src change, not on remount
useEffect(() => {
  if (seenSrcRef.current !== null && seenSrcRef.current !== resolvedSrc) {
    setIsLoaded(false);
    setHasError(false);     // only fires when src changes
  }
  seenSrcRef.current = resolvedSrc;
}, [resolvedSrc]);
```

The discover grid renders the same avatar URLs for the same channels across mounts, so `hasError` never resets. The gate cleared seconds after the blip, but no new fetch was ever attempted — the renderer was already in the latched-error state.

The cascade in one line: **network blip during mount → concurrent ERR_FAILED bursts arm the gate → fetchImageBytes returns null for every image during the window → protocol returns 404 → renderer latches hasError → images permanently broken for the session.**

## Solution

Remove the `isNetworkLikelyDown()` short-circuit from `fetchImageBytes` only. Other Kick callers (`request()` at `kick-client.ts:430`, `_doFetchPublicStreamBySlug` in `stream-endpoints.ts`) keep the gate — they have retry budgets and benefit from the brief back-off.

```ts
// kick-client.ts — fetchImageBytes (post-fix)
// (removed) if (isNetworkLikelyDown()) { return null; }

// Image fetches deliberately bypass `isNetworkLikelyDown()`. The gate is
// designed for retry loops (API, stream polls) that benefit from a brief
// back-off. Image fetches are one-shot: when they return null the renderer
// <img> goes to onError and the caller latches the error state until the
// component remounts, so a single 3-second unhealthy window — rolled
// forward by concurrent net::ERR_FAILED bursts from other Kick callers —
// can leave the whole discover grid stuck on broken avatars/thumbnails.
// The semaphore in `acquireKickRequestSlot` caps concurrency at 4, so
// removing the gate doesn't re-introduce the thundering-herd it was
// guarding against.
```

Companion change: `electronRequestBinary` now accepts a `timeoutMs` parameter (default 15000); `fetchImageBytes` passes `3000`. Image fetches are best-effort, and the 3 s cap on worst-case slot occupancy keeps a sustained CDN outage from starving the shared 4-slot Kick semaphore — worst-case wall-clock for a 50-image discover grid drops from ~195 s to ~40 s.

```ts
// kick-client.ts — call site
const { buffer, contentType } = await this.electronRequestBinary(url, headers, 3000);
//                                                                          ^^^^
//                                             3 s for images vs 15 s default for API
```

Accepted tradeoffs (documented inline alongside the comment above): (1) image `net::ERR_*` failures now feed `recordTransientNetworkError`, so a CDN-only outage can arm the gate for the API callers that DO check it; (2) image fetches contend with API calls for the shared 4-slot semaphore — the 3 s timeout caps the worst-case starvation window.

## Why This Works

The `isNetworkLikelyDown()` gate exists to protect **retry loops** from hammering a recovering process. Its value proposition is: "if the network service just crashed, skip this iteration and let it recover." That value depends on the caller having a next iteration — a retry budget. API polling and stream refresh calls have one. Image fetches don't: the renderer's `<img>` doesn't retry on its own, and `ProxiedImage` doesn't either. Without a retry, skipping the work converts a 3-second transient into a permanent visual failure that survives the gate's recovery.

The `acquireKickRequestSlot` semaphore (max 4 concurrent, in `kick-network-health.ts`) already prevents the thundering-herd scenario the gate was originally meant to address for images. At most 4 in-flight requests at any moment is well under what a recovering network service can handle. The semaphore is the right primitive for one-shot work; the gate is the right primitive for retry loops. Applying both to the same call site was redundant at best and broke the rendered UI in practice.

## Prevention

### Distinguish one-shot fetches from retry loops before placing a circuit breaker

When introducing a health gate to a request pathway, classify the caller:

- **Retry loop** (the caller will try again): the gate is appropriate. Missing one retry is low cost; preventing a storm is high value.
- **One-shot fetch** (the caller has no built-in retry; the result either arrives now or never): the gate is almost always harmful. If the caller's error state latches on any non-success response (as `ProxiedImage.hasError` does), skipping the fetch converts a transient condition into a permanent UI failure.

Useful heuristic: **if the caller renders a fallback UI on `onerror` and has no built-in retry, do not gate it.** Put the circuit breaker only on callers that will try again on their own.

### Use response timing to identify synchronous short-circuits during live debugging

CDN image fetches via Chromium's `net` module take 30-100 ms minimum for a real round-trip. A custom protocol handler returning in 1-12 ms is physically impossible for a real network fetch — it has to be a synchronous return path (cache hit, guard clause, or thrown-before-network error). That timing alone narrows the candidate code paths dramatically:

```ts
// Probe pattern via electron-mcp eval — measure elapsed time to distinguish
// real network vs synchronous short-circuit
const t0 = performance.now();
const res = await fetch("kick-image://image?u=<base64url-encoded-url>");
return "status=" + res.status + " dt=" + (performance.now() - t0).toFixed(0) + "ms";
```

Once you have a sub-20 ms 4xx, look at the function's synchronous return paths only — instrument the rest via temporary debug endpoints if log access is asymmetric (main-process logs not visible from a renderer-side probe).

### Mock the boundary, not the framework under it (test design)

The initial regression test for this fix passed for the wrong reason. It mocked `electron` shallowly; `session.fromPartition` resolved `undefined` under vitest's `vi.resetModules()` + dynamic `import()` interop, triggering a TypeError that was caught by `fetchImageBytes`'s `catch` block. The catch called `recordTransientNetworkError` — exactly what the test asserted. R7 source-diff-revert worked (pre-fix returned `null` before reaching catch, 0 calls; post-fix threw into catch, 1 call), but the test was actually verifying the error path, not the fix. If the mock or the dynamic-require pattern ever got cleaned up, the test would silently invert.

Four code-review reviewers independently flagged this. The fix: stub the boundary that comes **after** the removed guard, not the framework that wraps it:

```ts
// vi.spyOn the private method that IS the network boundary for this unit.
// Pre-fix: gate short-circuits to null before this is reached → spy called 0 times.
// Post-fix: gate is removed → spy called 1 time. Single failure mode, no
// dependency on framework interop.
const spy = vi
  .spyOn(kickClient as any, "electronRequestBinary")
  .mockResolvedValue({ buffer: Buffer.from([1, 2, 3, 4]), contentType: "image/webp", statusCode: 200 });

const result = await kickClient.fetchImageBytes("https://files.kick.com/images/test.webp");

expect(spy).toHaveBeenCalledTimes(1);
expect(spy).toHaveBeenCalledWith(
  "https://files.kick.com/images/test.webp",
  expect.objectContaining({ Referer: "https://kick.com/" }),
  3000
);
expect(result).not.toBeNull();
```

General rule for guard-clause-removal regression tests: spy on the method called **after** the removed guard. Pre-fix the spy is never called; post-fix it is called once. The before/after is unambiguous and survives refactors of everything upstream of the spy boundary.

### Wrap electron-mcp eval probes in try/catch and return prefixed strings

(auto memory [claude]) Exploratory probes during this investigation used the safe pattern documented in prior learnings:

```ts
// Stash on globalThis, read back as an explicit string with a prefix.
// Avoids the "falsy returns reported as failure" trap and keeps TypeErrors
// out of the user's DevTools console.
globalThis.__probe = null;
(async () => {
  try {
    const t0 = performance.now();
    const res = await fetch(probeUrl);
    globalThis.__probe = "ok:" + res.status + " dt=" + (performance.now() - t0).toFixed(0);
  } catch (e) {
    globalThis.__probe = "err:" + (e && e.message ? e.message : String(e));
  }
})();

// Read back in a separate eval call:
"RESULT:" + String(globalThis.__probe);
```

## Related Issues

- [`docs/solutions/architecture-patterns/poll-fan-out-cache-stagger-pattern-2026-05-19.md`](../architecture-patterns/poll-fan-out-cache-stagger-pattern-2026-05-19.md) — Origin of `kick-network-health` and `isNetworkLikelyDown()`. Documents why the gate exists and how it fits the poll retry/failure-cache path that it IS appropriate for. This learning is the sequel: it establishes the call sites where the gate must NOT apply.
- [`docs/solutions/integration-issues/electron-third-party-cookie-cross-site-warnings-2026-05-19.md`](./electron-third-party-cookie-cross-site-warnings-2026-05-19.md) — Established `kick-image://` as the canonical proxy pattern and noted 60 images routed through it at runtime. Companion to this doc: those 60 images were still failing under gate activation, even though the proxy itself was working as designed.
- [`docs/solutions/conventions/electron-webrequest-callback-contract-2026-05-19.md`](../conventions/electron-webrequest-callback-contract-2026-05-19.md) — Governs the `webRequest` callback contract used by the same session-partitioning layer the `kick-image://` protocol handler sits on.
- Commit `c169aa4` (`fix(kick): static-import electron + cookie-stripper to survive bundling`) — Hypothesized during the investigation. The remaining `require("electron")` calls in `kick-client.ts` (lines 145, 242, 287) follow the same fragility pattern; if they're ever statically imported, the mock-stub-the-boundary pattern in the regression test remains robust because it doesn't depend on the require/import shape.
- Audit-log entry: `docs/test-audit/2026-05-19-audit-log.md` § "Follow-up: Kick image-fetch network-down latch — 2026-05-20" (R7 source-diff-revert evidence).
