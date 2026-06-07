# Slice 07 — EventSub disconnect as Twitch failure signal (debounced)

Status: ready-for-agent

## Parent
PRD: https://github.com/TheDarkSkyXD/StreamFusion/issues/50

## What to build

Feed Twitch EventSub disconnect events into the Twitch platform-health signal — but only sustained disconnects, not brief reconnect blips. Short-blip reconnects (<5s) are normal WebSocket behavior and must not trip the outage banner.

Behavior:
- `twitch-eventsub-client.ts` exposes (or already exposes) `disconnect` and `reconnect` lifecycle events. Hook a debouncer onto these.
- On disconnect, start a 5s timer. If a successful reconnect fires inside the window, do nothing (normal blip). If the window expires without a reconnect or with a failed reconnect, record one `TRANSIENT:eventsub-disconnect` failure into Twitch platform-health.
- On every successful reconnect inside the window, record a corresponding success into Twitch platform-health (keeps the rate counter representative — a healthy reconnect cycle shouldn't bias the rate toward "degraded").
- EventSub disconnect is a distinct failure class from HTTP timeouts/5xx in the platform-health counter — same weight, different label for the telemetry log (slice 10).
- Should NOT double-count when both an HTTP failure and an EventSub disconnect fire on the same outage. The platform-health module just sums them with the existing rolling-window — the natural debounce of the per-event sources prevents storms.

## Acceptance criteria

- [ ] A disconnect followed by a successful reconnect within 5s records nothing into platform-health.
- [ ] A disconnect that fails to reconnect within 5s records exactly one failure into Twitch platform-health.
- [ ] Multiple rapid disconnect/reconnect cycles within 5s are coalesced into at most one failure record.
- [ ] EventSub failures contribute to the same Twitch `degraded` trip as Helix/GQL failures.
- [ ] Twitch failure cache flush on recovery (from slice 02 + 06) clears any EventSub-related caches too, if any exist.
- [ ] Test extension in the existing EventSub client test asserts the debounce + recording behavior using fake timers.

## Blocked by

- 06-twitch-instrumentation.md
