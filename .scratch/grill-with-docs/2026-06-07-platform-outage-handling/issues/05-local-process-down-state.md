# Slice 05 — `down` state: replace kick-network-health for local Chromium crashes

Status: ready-for-agent

## Parent
PRD: https://github.com/TheDarkSkyXD/StreamFusion/issues/50

## What to build

Migrate the existing local-process crash detection (Chromium network/GPU service crash → 3+ `net::ERR_*` in a 2s burst) from `kick-network-health.ts` into the new platform-health module as the `down` state. Delete the legacy module; update its call sites to use `isPlatformHealthy("kick")` / `getPlatformHealth("kick")`.

This formalizes the merge of "local-process unhealthy" and "remote-platform degraded" into one health state per platform. Decision recorded in ADR-0002.

Behavior:
- Platform-health module adds the `down` state: triggered by `recordPlatformLocalNetError(platform)` (a new function) being called 3+ times within 2s. Stays `down` for at least 3s after the last burst (matches today's `UNHEALTHY_WINDOW_MS = 3000`).
- `down` is a "worse than degraded" state — when both signals are active, `down` wins. Both behaviors (shedding from slice 03, log suppression from slice 04, banner from slice 01) apply when `down` too.
- The `child-process-gone` handler in `main.ts` that today calls `recordServiceCrash` is rewired to call the new function for the affected platform. (For now both Kick and Twitch get the signal — Chromium crash hits both — but the call site is platform-specific so it's explicit.)
- The 4-slot Kick concurrency cap (`acquireKickRequestSlot` and friends) is NOT moved in this slice; it stays where it is. Its file may be renamed in a follow-up cleanup (out of scope per PRD).
- `kick-network-health.ts` is deleted; all four current call sites (three in `kick/endpoints/stream-endpoints.ts`, one in `kick/endpoints/channel-endpoints.ts`) rewrite to platform-health imports.
- Existing 5-min stale-serve cache in stream-endpoints continues to work (it's a Kick-specific Cloudflare tuning concern; the new module just provides the health signal it consults).
- Banner copy distinguishes `down` from `degraded` — recommend "Kick is unreachable — retrying..." or similar for `down`, vs the existing "experiencing issues" for `degraded`. Final copy can be picked during implementation.

## Acceptance criteria

- [ ] `recordPlatformLocalNetError("kick")` called 3+ times in 2s transitions Kick to `down`.
- [ ] State stays `down` for at least 3s after the last burst before flipping back to whatever the failure-rate signal says (`healthy` or `degraded`).
- [ ] `down` takes precedence over `degraded` — banner, shedding, and log suppression all activate.
- [ ] `kick-network-health.ts` is deleted; no imports remain anywhere in the codebase.
- [ ] All four prior call sites use the new module's API and behave identically to the old `isNetworkLikelyDown()` checks.
- [ ] `main.ts`'s `child-process-gone` handler emits the local-net-error signal for both `kick` and `twitch` (Chromium crash affects both platforms).
- [ ] Banner shows distinct copy for `down` vs `degraded`.
- [ ] Existing tests covering kick-network-health behavior are migrated to the new module and pass.

## Blocked by

- 01-kick-degraded-banner-mvp.md
