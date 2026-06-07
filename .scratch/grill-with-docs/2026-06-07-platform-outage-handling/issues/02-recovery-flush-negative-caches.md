# Slice 02 — Recovery: banner clears + flush negative caches

Status: ready-for-agent

## Parent
PRD: https://github.com/TheDarkSkyXD/StreamFusion/issues/50

## What to build

Close the loop: a degraded platform recovers, the banner disappears, and the per-platform request-layer negative caches are flushed so the next refresh cycle picks up live state immediately instead of waiting per-slug TTLs to expire.

This is what the PRD's user-visible "backend retries" really means — when Kick comes back, the followed-streams sidebar refreshes everything in one cycle instead of dribbling channels back as their individual 30s-to-5min failure caches expire.

Behavior:
- State machine: `degraded → healthy` after 30s of <40% failure rate (hysteresis: trip at 60%, recover at 40% to prevent flap during partial recovery).
- Recovery transition fires `onPlatformHealthChanged` with `status: "healthy"`; renderer banner hides via the existing IPC subscription.
- On recovery, the platform-health module exposes a hook that the Kick stream-endpoints failure cache subscribes to and flushes its per-platform entries. Same hook must be reusable when Twitch failure caches are added later.
- No new UI surface in this slice — banner-clear reuses the slice 01 wiring.

## Acceptance criteria

- [ ] State machine recovers from `degraded → healthy` after the 30s-of-<40% window.
- [ ] Hysteresis verified: 50% failure rate after a trip does NOT recover; 30% does (after 30s).
- [ ] Listeners fire on the recovery transition; renderer banner hides as a result.
- [ ] Negative caches in the Kick public stream endpoint module are cleared on the recovery transition (assertable: pre-cached failing slugs are re-attempted on the next call after recovery, not served from negative cache).
- [ ] Recovery cache-flush hook is generic enough that Twitch can subscribe to it in slice 06 (no platform-specific code paths inside the platform-health module itself).
- [ ] State-machine tests cover the recovery branch + hysteresis edge cases.
- [ ] Integration test in `stream-endpoints.test.ts` covers the cache-flush behavior on recovery.

## Blocked by

- 01-kick-degraded-banner-mvp.md
