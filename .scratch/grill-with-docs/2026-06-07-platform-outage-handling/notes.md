# Platform Outage Handling (Kick + Twitch): Grilling Session Notes
Date: 2026-06-07 · Goal: Detect when Kick/Twitch are having a platform-wide outage (timeouts, 502s, etc.) and react gracefully instead of letting per-channel retries flood the logs and degrade the UX. Includes the user's additional asks: "we need backend retries" and "we should have a twitch health monitor like we have for kick."

## PRD
Published as GitHub issue #50: https://github.com/TheDarkSkyXD/StreamFusion/issues/50 (label: `ready-for-agent`). GitHub issue is the canonical PRD; this file is the raw grilling audit trail. Next step: `/to-issues` to break it into implementation tickets under `.scratch/<feature-slug>/` per local-markdown tracker convention.

## Summary / key decisions

**New module:** `apps/desktop/src/backend/api/unified/platform-health.ts` exposing per-`Platform` health state `PlatformHealth = "healthy" | "degraded" | "down"`. Replaces the existing Kick-specific `kick-network-health.ts`; Twitch picks up the same instrumentation for free.

**Detection (degraded):** rolling failure-rate circuit breaker. Trip to `degraded` at ≥60% failure rate over ≥8 attempts in a 60s window. Recover after 30s of <40% failure rate (hysteresis prevents flap). Failure classes counted: `TRANSIENT:timeout`, `TRANSIENT:5xx`, `TRANSIENT:net::ERR_*`. Excluded: 401/403/404/429, parse errors.

**Detection (down):** short-fuse local-process burst — 3+ `net::ERR_*` in 2s → `down` for 3s minimum. Preserves the current `kick-network-health` behavior, now per-platform.

**Behaviors while unhealthy:**
- **Circuit-open with shed traffic** — ~20% probe-traffic gets through to gather recovery signal; everything else serves the stale-success cache (existing 5-min cache reused).
- **Log noise suppression** — per-slug warnings demoted to debug; one platform-level warn line per outage cycle.
- **IPC event** `platform-health-changed` to renderer with `{ platform, status, startedAt }`.

**Recovery (backend retry):** transition from `degraded → healthy` flushes the platform's negative caches so the next refetch immediately tries fresh, instead of waiting 30s–5min for per-slug TTLs to expire.

**Secondary confirmation:** poll `status.twitch.com` (Statuspage JSON API) + `status.kick.com` only while degraded (60s interval). Outcome NUDGES recovery cooldown (shortens to 15s on "all clear," extends to 60s on "incident ongoing"), never overrides the internal signal. Fetch failure = treat as no signal.

**UI:** persistent top-of-app banner (`PlatformHealthBanner` below TopNavBar) + per-stream-card overlay on Kick stream cards while degraded. Both consume the same IPC event. Banner is non-dismissible (auto-hides on recovery).

**Other:** in-memory only (no cross-restart persistence); JSONL telemetry log to `platform-health.log` on transitions; HLS playback unaffected during outage (different CDN); per-platform isolation (Kick outage doesn't affect Twitch and vice versa); call-site instrumentation across Kick public + Kick auth + Twitch Helix + Twitch GQL + EventSub disconnect.

**Test plan:** 8 vertical slices via `/tdd` (one slice per behavior, one slice per call-site cluster, one slice per renderer surface).

**Doc outputs:**
- `CONTEXT.md` updated — `PlatformHealth` term added to Cross-platform plumbing.
- `docs/adr/0002-platform-health-tracker.md` to be written (covers the merge-into-one-generic-tracker decision).

## Q&A log

### Q1 — Primary pain point / scope of feature
- Asked: Is the goal log-noise suppression, UI degradation handling, network back-off, or all three?
- Captured: **All three.** Detect outage → suppress per-slug log noise → preserve UI state and show banner → back off outbound traffic until recovery. Full circuit-breaker feature, not a logging tweak.
- Doc updates: none
- Flags: none

### Q2 — Detection signal
- Asked: How do we decide a platform is in outage? Failure-rate window, consecutive failures, burst counter, or active health-check?
- Captured: **Failure rate over rolling window** (industry-standard circuit-breaker pattern, see Industry-standard appendix below). Track recent request outcomes per platform; flip to "outage" when failure rate crosses a threshold over a minimum sample. Self-clears when recovery rate improves. Rejects "single broken channel = platform down" misclassification.
- Doc updates: none (naming + term deferred to Q8)
- Flags: thresholds (failure %, sample size, window) deferred to Q3

### Q3 — Outage thresholds
- Asked: How trigger-happy should the detector be?
- Captured: **Conservative: 60% failure rate over ≥8 attempts in a 60s rolling window.** Self-clears after 30s with <40% failures.
  - Rationale (from sample log): the user's outage showed ~12 TRANSIENT failures in ~5s out of ~80 followed channels — well above 60% and well above the 8-attempt minimum. Trips reliably on real outages; won't fire on a couple of flaky individual channels.
  - Hysteresis: distinct numbers up (60%) vs down (40%) prevent flap during partial recovery.
- Doc updates: none
- Flags: thresholds live as named constants in the module so they're tunable later.

### Q4 — What counts as a "failure"
- Asked: Which error classes feed the failure-rate counter?
- Captured: **Timeouts + 5xx + net::ERR_*. NOT 429/non-200 status codes** (those signal we're misbehaving, not the platform).
  - `TRANSIENT:timeout` — AbortSignal.timeout firing (dominant case in user's log)
  - `TRANSIENT:502 | 503 | 504` — platform-side server errors
  - `TRANSIENT:net::ERR_*` — Chromium net-layer failures
  - **Excluded:** 401/403 (auth state), 404 (channel doesn't exist), 429 (rate limit on US), non-TRANSIENT parse errors.
- Doc updates: none
- Flags: ~~Overlap with kick-network-health~~ — resolved by Q7's merge.

### Q5 — Platform scope
- Asked: Kick-only first or generic from day one?
- Captured: **Generic Platform-keyed module from day one.** Module owns `kick` and `twitch` state independently; same code path serves both. Aligns with the `Platform: "twitch" | "kick"` discriminated key already established in CONTEXT.md and with the `IPlatformReader` adapter pattern. Twitch has identical failure modes so the abstraction earns its keep immediately.
- Doc updates: none (naming TBD in Q8)
- Flags: none

### Q6 — Behaviors when outage is detected
- Asked: What activates when the tracker flips to "outage" for a platform?
- Captured: Three behaviors, all activate together (no half-mode):
  1. **Suppress per-slug logs.** Demote subsequent `TRANSIENT:*` warnings to `debug`. Emit one warn line per platform per outage cycle: `[PlatformHealth] Kick degraded: N/M requests failed in last 60s. Backing off.`
  2. **Circuit-open: pause new requests.** Callers checking the tracker (e.g. `getPublicStreamBySlug`) skip the network and serve the stale-success cache. Recovery probe traffic (Q11) flows through.
  3. **Emit IPC event to renderer.** `platform-health-changed` with `{ platform, status, startedAt }`. Renderer banner + per-card overlay (Q10 + Q15) consume it.
  - **Explicitly NOT included:** separate cache-TTL extension (the circuit-open stale-serve already does this).
- Doc updates: none
- Flags: none

### Q7 — Relationship to existing kick-network-health (Twitch equivalent ask)
- Asked: User added "we should have a twitch health monitor like we have for kick." How does that relate to platform-outage detection?
- Captured: **Merge into one PlatformHealthTracker per platform that covers BOTH concerns** (local-process Chromium crash AND remote platform outage).
  - Existing `kick-network-health.ts` evolves into the new generic module's Kick instance; a Twitch instance is added as the same shape.
  - Callers see a single API: `isPlatformHealthy(platform)` / `getPlatformHealth(platform)`.
  - Two failure-class buckets feed one health state:
    - (a) local burst of `net::ERR_*` → `down` (short-fuse, matches today's `UNHEALTHY_WINDOW_MS = 3s`)
    - (b) rolling failure-rate of timeout / 5xx → `degraded` (Q3 thresholds)
  - The double-count concern from Q4 dissolves: both inputs feed one machine; the state is just "unhealthy for either reason."
  - Kick-specific Cloudflare/CDN tuning (5-min stale-serve cache + 4-slot concurrency cap) stays put; the cap likely moves to `kick/kick-request-slot.ts` so its file name stops claiming to be about health.
- Doc updates: ADR-0002 (this turn) — "Replace per-Kick network-health with generic per-platform health tracker."
- Flags: none

### Q8 — Module name + location
- Asked: What's the canonical file path / module name? (Locks the CONTEXT.md term.)
- Captured: **`apps/desktop/src/backend/api/unified/platform-health.ts`** with type `PlatformHealth = 'healthy' | 'degraded' | 'down'`.
  - Public surface: `getPlatformHealth(platform)`, `isPlatformHealthy(platform)`, `recordPlatformFailure(platform, errorClass)`, `recordPlatformSuccess(platform)`, `onPlatformHealthChanged(listener)`.
  - Lives in `unified/` next to `platform-types.ts` — matches the `IPlatformReader` / Capability-interface convention in CONTEXT.md (Platform-neutral plumbing lives in `unified/`).
  - `kick-network-health.ts` deleted in the same change; call sites in `kick/endpoints/stream-endpoints.ts` and `kick/endpoints/channel-endpoints.ts` rewrite to `platform-health` imports.
- Doc updates: **CONTEXT.md updated** — `PlatformHealth` added to "Cross-platform plumbing."
- Flags: none

### Q9 — What "we need backend retries" means
- Asked: Per-request retries already exist (3× backoff). What's the gap?
- Captured: **Retry-on-recovery.** When `PlatformHealth` transitions from `degraded` back to `healthy`, the new module emits a recovery event and the per-platform negative caches are invalidated. Next refetch immediately tries fresh, instead of waiting 30s–5min for per-slug TTLs to expire.
  - Without this: an outage spans 90s, every slug gets blacklisted for 30s on its first failure, but per-slug TTL clocks are staggered — the UI takes 30s–5min after recovery to show live channels.
  - With this: recovery transition flushes failure caches per platform; next refetch cycle (already firing every 60s for followed-streams) sees a clean cache and tries immediately.
  - Twitch parity for per-request transient retries is **deferred** — separately worth doing but out of scope this round.
- Doc updates: none (covered by the event-emitter surface in Q8)
- Flags: implementation seam — `recordPlatformSuccess` triggers transition; transition callback clears `_publicStreamFailureCache` entries for that platform. Cache-clear hook to be exposed from `stream-endpoints.ts` in implementation phase.

### Q10 — UI surfacing
- Asked: How does the renderer show degradation to the user?
- Captured: **Persistent top-of-app banner while degraded** (`PlatformHealthBanner` below `TopNavBar`). Auto-hides on recovery. **Q15 added per-stream-card overlay on top of this** — final UI surfacing is banner + card overlay.
  - Banner copy: `"Kick is experiencing issues — showing last-known state."` / `"Twitch is experiencing issues — some channels may not load."` Both degraded → `"Kick and Twitch are experiencing issues."`
  - Non-dismissible by default (auto-hides on recovery; load-bearing context for stale data).
  - Renderer source: IPC channel `platform-health-changed` exposed via `electronAPI.platformHealth.onChange(listener)` + initial-state hydration via `electronAPI.platformHealth.get()`.
- Doc updates: none (banner/component names aren't vocabulary-worthy yet)
- Flags: banner copy + non-dismissible choice are recommendations the user can revisit during implementation.

### Q11 — Recovery detection
- Asked: How does the tracker decide an outage cleared?
- Captured: **Passive: ride the normal traffic signal.** No dedicated probe endpoint.
  - Circuit-open mode is NOT fully shut: a small percentage of incoming requests (~20%, or "the first request after each 5s cooldown bucket") is allowed through to gather recovery signal. Everything else gets the stale-cache path immediately.
  - Hysteresis from Q3: 30s of <40% failure rate across probe-traffic flips state back to `healthy` and emits the recovery event.
  - Q13 then refines this with optional status-page tie-breaker.
  - Trade-off accepted: a long idle period with no Kick traffic means state stays `degraded` until something triggers a request. That's fine — `useFollowedStreams` polls every 60s.
- Doc updates: none
- Flags: none

### Q12 — Call-site integration
- Asked: Which code sites record outcomes into the tracker?
- Captured: **All four — full instrumentation.**
  1. **Kick public/legacy fetches** — `_doFetchPublicStreamBySlug` + the channel/category/video endpoints in `kick/endpoints/`. Dominant log-spam source.
  2. **Kick authenticated requestor** — `KickRequestor.request()` in `kick-requestor.ts`. Single chokepoint for official-API calls.
  3. **Twitch Helix + GQL requestors** — `TwitchRequestor` + `twitch-gql-client.ts` request paths.
  4. **Twitch EventSub disconnect events** — WebSocket disconnect/reconnect on `twitch-eventsub-client.ts`. Distinct failure class so a single outage doesn't double-count (Helix timeout + EventSub disconnect).
- Doc updates: none
- Flags:
  - EventSub disconnect class: short-blip reconnects (<5s) are NORMAL and should not count; only sustained-disconnect-with-failed-reconnect counts. Will spec in implementation.
  - Each call-site update is a natural sub-issue if we break this into tickets.

### Q13 — Status-page secondary confirmation
- Asked: How should `status.twitch.com` / `status.kick.com` fit into recovery detection?
- Captured: **Confirmation only — internal signal stays primary.**
  - Internal failure-rate is the authoritative trigger for both `healthy → degraded` and `degraded → healthy`.
  - While degraded, poll status pages periodically (60s, with timeout + fallback-to-no-signal on error). NOT polled while healthy.
  - Status-page outcome nudges recovery thresholds:
    - Status "all clear" + internal <40% failure rate → shorten recovery cooldown (15s instead of 30s)
    - Status "incident ongoing" + internal <40% → hold `degraded` one extra cycle (don't false-recover)
    - Fetch fails / unparseable → behave as if status said nothing
- Doc updates: none (will add `PlatformStatusPage` term to CONTEXT.md if status-page parsing complexity warrants it)
- Flags:
  - Twitch status page = https://status.twitch.com/ (Atlassian Statuspage; stable JSON API at `/api/v2/status.json` and `/api/v2/incidents.json`)
  - Kick status page = https://status.kick.com/posts/dashboard (verify whether it exposes JSON/RSS; if HTML-only, parser fragility is higher — implementation-phase decision)
  - "Affects the API" filtering needs spec — Twitch's status page covers Player, Chat, Helix, Subs, etc. separately. Only API-affecting incidents should influence the tracker.

### Q14 — TDD slice plan
- Asked: How do we slice this for `/tdd` red-green-refactor?
- Captured: **Vertical slices by behavior, one slice per `/tdd` cycle.**
  - Slice 1: failure-burst flips state to `degraded` once Q3 threshold is met
  - Slice 2: success traffic below threshold flips back to `healthy` after the 30s hysteresis window
  - Slice 3: `net::ERR_*` burst flips to `down` immediately (preserves existing short-fuse behavior, now per-platform)
  - Slice 4: state transition fires `onPlatformHealthChanged` listeners (IPC emission seam)
  - Slice 5: recovery transition flushes per-platform negative caches (Q9 retry-on-recovery)
  - Slice 6: status-page poll integration (Q13 confirmation nudges)
  - Slice 7: call-site instrumentation per platform (one slice per cluster: Kick public, Kick auth, Twitch Helix, Twitch GQL, EventSub)
  - Slice 8: renderer banner + per-card overlay subscribe to IPC
  - **All core slices live in `apps/desktop/tests/backend/api/unified/platform-health.test.ts`** (new file, modeled on `tests/backend/api/platforms/kick/` patterns). Slices 7+8 add tests in their existing test files.
  - Each slice is green before moving on per AGENTS.md ISSUE WORKFLOW rule.
- Doc updates: none
- Flags: none

### Q15 — Completeness backstop
- Asked: Confirm a handful of edges before closing out.
- Captured: **All four edges confirmed in scope.**
  1. **Per-stream-card overlay (in addition to the top banner).** Refines Q10 — UI surfacing is banner + subtle per-card overlay ("Last updated X min ago" / warning icon) on Kick stream cards while degraded. Both feed off the same IPC event.
  2. **Player behavior during outage.** HLS playback continues unchanged — it hits a different CDN that may be fine even when `api.kick.com` metadata fails. Metadata refresh respects the circuit; the banner explains why titles/viewer counts are stale.
  3. **No cross-restart persistence.** Tracker is in-memory only; app restart resets to `healthy`. A real outage re-trips within seconds; persisting risks carrying stale `degraded` state from an hours-old blip.
  4. **Telemetry / outage event log to disk.** Append one JSONL line per transition to `platform-health.log` under the app log dir (`{ ts, platform, fromState, toState, sampleSize, failureRate, source }`). Useful for diagnosing user reports. No rotation/retention in v1.
- Doc updates: none
- Flags: none

## Open flags (pending input)
- Banner dismiss behavior — recommendation = non-dismissible; revisit in implementation if user feedback says otherwise.
- Banner copy wording — proposed in Q10; revisit during implementation.
- EventSub disconnect failure-class debouncing — needs concrete spec (suggested: ignore <5s reconnect blips, only count sustained-failed-reconnect).
- Kick status page JSON/RSS availability — to verify during implementation; HTML scrape as fallback.

## Industry-standard appendix

This design lines up cleanly with established resilience-engineering patterns. Per-decision mapping:

| Decision | Industry pattern | Source / parallel |
|---|---|---|
| Failure-rate rolling window | **Circuit breaker** | Netflix Hystrix (`circuitBreakerErrorThresholdPercentage`, default 50%/10s/20 samples). Our 60%/60s/8 samples is more conservative — appropriate for a desktop client where false positives are higher cost than a few extra log lines. |
| Three states `healthy/degraded/down` | **Closed / Half-open / Open** | Standard circuit-breaker FSM. Our `degraded` corresponds to "open with shed traffic" / half-open; our `down` is "open with no traffic" (hard cut for local-process crashes — a sensible client-side extension). |
| Hysteresis (60% trip, 40% recover) | **Asymmetric thresholds** | Standard practice in PID/threshold controllers and in Hystrix's separate `circuitBreakerSleepWindow`. Prevents flap during partial recovery. |
| Probe-traffic during outage (~20%) | **Half-open / load shedding** | Hystrix half-open state; AWS App Mesh + Envoy circuit breakers; Google SRE book "graceful degradation." |
| Stale-while-revalidate cache during degraded | **SWR (RFC 5861)** | HTTP cache standard; React Query, SWR (the library), CDNs all do this. |
| Per-platform isolation | **Bulkhead pattern** | Hystrix bulkheads; Resilience4j; Akka. One backend's failure can't take out the other. |
| Status-page confirmation as nudge, not override | **Tie-breaker / consensus signal** | Standard SRE practice — multiple signals reduce false positives; primary signal stays authoritative because external status pages lag user impact by 5–30min. |
| In-memory only (no persistence) | **Client-side circuit breakers always in-memory** | Server-side breakers sometimes use distributed state (Redis); client-side never does. Restart = clean slate is correct. |
| IPC event + persistent banner | **Status indicator UX** | GitHub status banner; Slack "trouble connecting"; Google Workspace incident banners. Established UX pattern. |
| Telemetry log on transitions | **Observability for debugging** | Standard practice — record state changes for post-hoc analysis. |
| Retry-on-recovery (cache flush) | **Cache invalidation on dependency change** | Standard pattern, occasionally called "graceful recovery." Less commonly stated as an explicit feature in textbook circuit breakers — but our coupling of the breaker to the negative-cache layer is correct and well-justified. |
| TDD vertical slices | **XP / Kent Beck** | AGENTS.md mandates this; standard practice. |

**Where we deviate from textbook (intentionally):**

1. **Naming.** `healthy/degraded/down` instead of `closed/half-open/open`. Friendlier for log lines and IPC payloads the renderer surfaces; conventional names are preserved in the appendix-level vocabulary.
2. **Splitting "open" into `degraded` and `down`.** Textbook circuit breakers don't distinguish failure SOURCE. We do, because a local-process crash (`down`, hard cut, 3s minimum recovery) and a remote API outage (`degraded`, shed traffic with probe) call for different traffic policies in a desktop client. The split was already implicit in `kick-network-health`; this design makes it explicit.
3. **Conservative thresholds.** 60%/8/60s vs Hystrix's 50%/20/10s. We accept slower trip in exchange for fewer false positives. With ~80 followed channels polled every 60s, the 8-attempt minimum is satisfied within one poll cycle anyway.

## Code context discovered up front
- **`apps/desktop/src/backend/api/platforms/kick/kick-network-health.ts`** — already exists. Tracks LOCAL Chromium network/GPU process crashes via `net::ERR_*` bursts (3 in 2s) or explicit `recordServiceCrash`. Exposes `isNetworkLikelyDown()`, used by `getPublicStreamBySlug` to short-circuit fetches and serve a 5-min stale-success cache. Filters out plain timeouts and 5xx as "normal Kick flakiness, not a process crash." This is the seam the new module supersedes.
- **`getPublicStreamBySlug` / `_doFetchPublicStreamBySlug`** in `kick/endpoints/stream-endpoints.ts` — already retries 3× with jittered exponential backoff (1s/2s/4s ±25%) on `TRANSIENT:*` errors, has positive cache (90s), failure cache (5min DNS/5xx, 30s timeouts), in-flight dedup, and a global 4-slot concurrency cap.
- **`fetchKickFollowed`** in `stream-handlers.ts:244` — fan-outs `Promise.allSettled` over every followed slug with 60ms stagger. This is the call site producing the log spam in the user's report.
- **Twitch side** — `helix-retry.ts` is just a single 401 token-refresh retry. No equivalent "transient burst" handler. `TwitchRequestor` itself does pre-call token refresh + 1 retry on 401.
- **Existing error pattern** — `TRANSIENT:timeout`, `TRANSIENT:502`, `TRANSIENT:net::ERR_*` is the established prefix convention; the new module keys off it.
- **No platform-outage abstraction exists today** — the `kick-network-health` module is local-process scope only.
