# Slice 03 — Circuit-open: stop hammering Kick during outage

Status: ready-for-agent

## Parent
PRD: https://github.com/TheDarkSkyXD/StreamFusion/issues/50

## What to build

While Kick is `degraded`, suppress most outbound requests and serve last-known-good cache instead. Reduces load on Kick during recovery (good citizen) and prevents the followed-streams sidebar from flickering through empty/loading states.

Behavior:
- `getPublicStreamBySlug` checks `isPlatformHealthy("kick")` before issuing a network request. When `degraded`:
  - Roughly 20% of calls (probe traffic) still go to the network — this is what feeds the recovery signal in slice 02.
  - The remaining ~80% return the existing 5-minute stale-success cache value immediately, without firing a request.
- "20% probe" approximated as "the first request after each 5s cooldown bucket" — deterministic, no random sampling, easy to test.
- If a probe request succeeds, it's recorded as a normal success (feeds slice 02's recovery logic).
- The existing in-flight dedup + concurrency slot logic stays in place — shedding happens BEFORE the slot is acquired so circuit-open requests don't queue.

## Acceptance criteria

- [ ] While Kick is healthy, behavior is unchanged from current state (verified by existing stream-endpoints tests still passing).
- [ ] While Kick is degraded, ~80% of `getPublicStreamBySlug` calls return cached values without firing `net.fetch`.
- [ ] Probe-traffic rate (~20%) is deterministic and asserted in tests — the test can fake time and confirm 1 probe per 5s window.
- [ ] Probe successes feed the failure-rate counter (so slice 02 can recover off them).
- [ ] When the stale cache is empty for a slug, the call still falls through to the network even under circuit-open (no false "offline" indication for cold slugs).
- [ ] No regression in concurrency-slot accounting (no leaked slots when requests are shed).
- [ ] Integration test in `stream-endpoints.test.ts` covers the shedding behavior end-to-end.

## Blocked by

- 01-kick-degraded-banner-mvp.md
