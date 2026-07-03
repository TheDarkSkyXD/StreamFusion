Status: done

# Add Twitch EventSub online/offline source with polling fallback

## Parent

.scratch/grill-with-docs/2026-06-30-live-stream-notifications/prd.md

## What to build

Extend the existing Twitch EventSub seam to support `stream.online` and `stream.offline` as a Live Notification source. EventSub should update the service's live/offline memory quickly, while polling remains a fallback for missed events, revoked subscriptions, or degraded EventSub coverage.

## Acceptance criteria

- [x] The Twitch EventSub event type model supports `stream.online` and `stream.offline`.
- [x] EventSub subscription creation uses the correct event-specific condition and version for stream online/offline events.
- [x] `stream.online` can create an eligible Live Notification through the main-process service.
- [x] `stream.offline` updates service memory so a later online transition can notify again.
- [x] Duplicate EventSub deliveries do not create duplicate Live Notifications for the same observed transition.
- [x] EventSub revocation, subscription failure, or connection error falls back to polling coverage.
- [x] Auth logout/auth-lost stops auth-only EventSub subscriptions without clearing eligible Guest Follow monitoring.
- [x] Tests cover EventSub subscription setup, online dispatch, offline state update, duplicate handling, fallback behavior, and auth cleanup.

## Blocked by

- .scratch/grill-with-docs/2026-06-30-live-stream-notifications/issues/03-live-notification-service-polling-mvp.md

## Comments

- Completed issue 05. Twitch EventSub now models `stream.online` and `stream.offline`, creates v1 stream subscriptions with only `broadcaster_user_id`, dispatches stream events through a Twitch live EventSub source, and feeds online/offline observations into the app-lifetime Live Notification service.
- The main-process service now subscribes authenticated Twitch follows after silent startup seed, keeps polling as fallback coverage, resyncs EventSub on auth/token changes, reports EventSub degradation to logs, and tears down auth-only subscriptions when Twitch auth disappears while Guest Follow polling remains available.
- Evidence: focused tests passed for `twitch-eventsub-client`, `live-notification-service`, and `twitch-live-eventsub-source`; `npm run typecheck` passed; `npm run lint` passed; `npm run build` passed with existing chunk-size warnings; full `npm test` passed 345 files / 4419 tests.
