# Slice 06 — Twitch instrumentation (Helix + GQL)

Status: ready-for-agent

## Parent
PRD: https://github.com/TheDarkSkyXD/StreamFusion/issues/50

## What to build

Wire Twitch request paths into the platform-health module so Twitch outages trip the same `degraded` state and surface the same banner + (where applicable) shedding behavior as Kick. After this slice, the platform-health feature is symmetric across both platforms for HTTP request signals.

Behavior:
- `TwitchRequestor.request` instrumented to record outcomes (success + matching failure class) into platform-health for `twitch`.
- `twitch-gql-client.ts` request path instrumented identically.
- Existing 401 handling in `helix-retry.ts` is unchanged — auth failures are NOT counted by platform-health (per PRD's excluded classes).
- Twitch failure cache flush on recovery: any equivalent of the Kick negative-cache flush hook from slice 02 subscribes for Twitch entries. If there is no Twitch-side negative cache today, this is a no-op — note that in the implementation.
- Banner copy supports three states: "Kick is experiencing issues...", "Twitch is experiencing issues...", "Kick and Twitch are experiencing issues...". The renderer hook + component already key off `anyDegraded`; extend so both flags are individually addressable.
- Stream-card overlay for Twitch follows in slice 09; this slice only covers backend instrumentation + banner copy.

## Acceptance criteria

- [ ] `TwitchRequestor.request` records the right success / failure-class call for every outcome (assertable in `twitch-requestor.test.ts` extensions).
- [ ] `twitch-gql-client.ts` request path records identically (assertable in its existing test file).
- [ ] Twitch state trips to `degraded` when its own request failure rate crosses the threshold; Kick state remains unaffected.
- [ ] Excluded failure classes (401/403/404/429) do NOT contribute to Twitch state.
- [ ] Banner copy correctly switches between "Kick", "Twitch", and "both" based on which platforms are degraded.
- [ ] Renderer hook returns separable `kick` and `twitch` flags in addition to `anyDegraded`.
- [ ] No regression in existing Twitch request behavior (auth-refresh-on-401 still works; existing tests still pass).

## Blocked by

- 01-kick-degraded-banner-mvp.md
