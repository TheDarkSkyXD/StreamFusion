# Slice 09 — Per-stream-card staleness overlay

Status: ready-for-agent

## Parent
PRD: https://github.com/TheDarkSkyXD/StreamFusion/issues/50

## What to build

While a platform is `degraded` or `down`, stream cards from that platform show a subtle staleness overlay so it's clear at a glance which cards show last-known data vs fresh data. Reinforces the global banner with localized signal.

Behavior:
- Stream-card component (the existing one used by the followed sidebar + discover grid) consumes the same `usePlatformHealth()` hook from slice 01.
- When `usePlatformHealth().kick === "degraded" | "down"`, every Kick stream card renders a subtle visual: fade the card slightly + show a "Last updated X min ago" badge in a corner, where X is computed from the card's data's `lastUpdatedAt` timestamp (or stream's `startedAt` if no separate timestamp is tracked).
- Same behavior for Twitch when its state is `degraded` | `down`.
- Overlay is visual only — does not change card click behavior or layout dimensions.
- On recovery transition, overlay disappears automatically via the existing IPC subscription.

## Acceptance criteria

- [ ] While Kick is `healthy`, Kick stream cards render unchanged from today.
- [ ] While Kick is `degraded`, Kick stream cards show a faded appearance + a "Last updated X" badge.
- [ ] Same for Twitch and its state.
- [ ] Card click behavior + dimensions unchanged (overlay is overlay, not layout-shifting).
- [ ] Recovery transition removes the overlay within one render cycle (no flash, no manual refresh needed).
- [ ] If a stream card has no available `lastUpdatedAt` timestamp, badge degrades gracefully (e.g. shows nothing rather than "Last updated NaN min ago").
- [ ] Component tests cover both states + the recovery transition.

## Blocked by

- 01-kick-degraded-banner-mvp.md
