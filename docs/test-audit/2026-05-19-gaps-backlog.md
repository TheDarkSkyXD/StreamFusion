# Test-suite audit gaps backlog — 2026-05-19

Non-critical-path test coverage gaps and source bugs discovered during the [test-suite audit](../plans/2026-05-19-001-refactor-test-suite-audit-plan.md). Converted to GitHub issues + this file deleted at U19.

## Backlog overview

- **Source:** appended chronologically as gaps are discovered per batch.
- **Routing:** critical-path gaps are fixed inline per batch (per plan R11); only non-critical-path gaps land here.
- **Lifecycle:** at U19, every entry is converted to a GitHub issue with label `test-audit-gap` (or `bug` for source-code findings), then this file is deleted.

---

## Entries

### Kick image-fetch dynamic-require failure — 2026-05-19, U0 smoke

**Behavior to cover:** `[KickClient] Image fetch failed (Cannot find module '../../../services/third-party-cookie-stripper'...)` logs spam the console on every Kick channel-image fetch. The bundled `apps/desktop/out/main/index.js` does a runtime `require('../../../services/third-party-cookie-stripper')` whose relative path doesn't survive bundling, so Kick image fetches run without the cookie-strip wrapper (third-party cookies leak on those requests).

**Suggested test shape:** Integration — exercise a Kick channel-image fetch path with the cookie-stripper expected to be active; assert no "Cannot find module" log line is emitted and that the request's cookie header matches the stripper's contract. Add the assertion at the same level as `tests/services/third-party-cookie-stripper.integration.test.ts`.

**Source fix shape:** Replace the runtime dynamic `require()` with a static import at the top of the Kick client image-fetch helper, OR inline the cookie-strip call so no runtime path resolution is needed. The dynamic require is almost certainly an attempt to avoid a circular import — refactor the module graph so the static import is safe.

**Priority:** medium. Functional surface (the cookie strip silently no-ops on Kick image fetches) plus very noisy log output. Not user-facing failure; auditor can defer.

---

### Kick fan-out / public-stream-cache 4-part contract — 2026-05-20, U7

**Behavior to cover:** The Kick `getPublicStreamBySlug(slug, staggerOffsetMs, signal)` surface (`apps/desktop/src/backend/api/platforms/kick/endpoints/stream-endpoints.ts`) ships a four-part contract that fixed two production regressions (`cb0b7b6` public-stream cache; `6d3606d` followed-stream fan-out stagger) and was then refactored in `640870a`. None of it is currently tested. Plan U7 named all four shapes:

1. **Positive cache TTL > poll interval.** Second call to the same slug within `PUBLIC_STREAM_POLL_HIT_TTL_MS` (90s) must resolve from `_publicStreamSuccessCache`, not re-hit the network. The followed-streams hook polls every 60s, so the TTL has to outrun the poll.
2. **Stagger AFTER cache check.** Cache-hit returns synchronously; `staggerDelay(staggerOffsetMs, signal)` only fires on cache-miss work. Otherwise back-to-back same-slug calls eat a delay they don't need.
3. **AbortController scoped per dispatch.** A cancelled `staggerDelay` rejects with an `AbortError` that the caller must NOT log as a warning. Orphan stagger timers from a stale dispatch must clear when the next dispatch's signal aborts.
4. **Transient timeout does not preempt fresh positive cache.** A 5s timeout sets `PUBLIC_STREAM_TIMEOUT_TTL_MS = 30s` negative cache. If the slug already had a positive-cache entry, the timeout must NOT evict it; the next call within the 90s window should still serve the cached value.

**Suggested test shape:** integration-style. New file `tests/backend/api/platforms/kick/stream-endpoints.test.ts`. Mock `electron.net.request` (event-emitter API: `on('response', cb)` → response object with `on('data')` / `on('end')`). Mock `acquireKickRequestSlot` to a no-op release. Mock `isNetworkLikelyDown` to `false`. Use `vi.useFakeTimers()` for the TTL checks and `vi.resetModules()` between tests to flush the module-level `_publicStreamSuccessCache` / `_publicStreamFailureCache` / `_publicStreamInFlight` maps. Four describes mirroring the four contracts above.

**Source-diff-revert posture (per `tests/AGENTS.md`):** parent commits of `6d3606d` / `cb0b7b6` won't build cleanly under the current toolchain because `640870a` changed `getPublicStreamBySlug`'s signature (added `staggerOffsetMs` and `signal` params and renamed internal constants). Apply `-R` on the source diff of the fix commit onto current HEAD (excluding tests), run the new test against that synthetic state, confirm failure, re-apply.

**Priority:** medium. The contracts ship correctly today (smoke-verified by running the app + observing no log spam) and the in-source comments capture the WHY. But there's no automated guard, so any well-meaning refactor of the cache / stagger logic could silently regress one of the four shapes. The current adversarial-reviewer comment already cites the relevant SHAs.

**Why deferred from U7 rather than landed inline:** writing the mocks (electron.net event-emitter + network-health + slot semaphore) and the cache-reset plumbing is ~200 lines of test scaffolding for four contracts. With the session-wide bar set to "current pace — Delete shallow, // Guards: the Keeps, no aggressive backfills", this didn't fit. Filing here so it lands as a focused follow-up rather than getting buried under the broader audit close-out.

---

<!-- Append more entries per batch as gaps are discovered. -->
