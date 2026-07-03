Status: done

# Harden Kick polling with bounded coverage and relay-ready source seam

## Parent

.scratch/grill-with-docs/2026-06-30-live-stream-notifications/prd.md

## What to build

Make Kick Live Notifications reliable through bounded main-process polling for the first build. The source should reuse existing Kick public lookup, stagger/cache behavior, and Guest Follow coverage, while exposing a source seam that a future hosted Kick webhook relay can feed.

## Acceptance criteria

- [x] Kick followed Channel live state is polled from the main-process Live Notification service.
- [x] Guest Follows for Kick are included wherever public lookup supports them.
- [x] Polling uses bounded concurrency and staggered requests rather than unbounded fan-out.
- [x] Existing Kick success/failure/cache behavior is respected so polling does not hammer Kick endpoints.
- [x] Offline-to-online Kick transitions create eligible Live Notifications.
- [x] Transient Kick failures do not falsely mark a Channel offline or create notification spam.
- [x] The Kick source exposes a clear internal seam that can later accept hosted webhook relay events.
- [x] Tests cover bounded polling, Guest Follow inclusion, cache usage, transient failures, transition detection, and relay-ready source dispatch.

## Blocked by

- .scratch/grill-with-docs/2026-06-30-live-stream-notifications/issues/03-live-notification-service-polling-mvp.md

## Comments

- Completed issue 06. Kick Live Notifications now use a main-process `KickLiveNotificationSource` that polls active Kick follows through `getPublicStreamBySlug`, preserving the endpoint's public lookup, cache, stagger, failure, and last-known-good behavior.
- The source bounds concurrency, staggers cache-miss work, dedupes duplicate slugs, includes Guest Follow slugs, preserves last live state across transient lookup failures, and exposes `dispatchRelayEvent(...)` for a future hosted Kick webhook relay to feed online/offline events into the same Live Notification service path.
- Evidence: focused Kick source/live service tests passed; `npm run typecheck` passed; `npm run lint` passed; `npm run build` passed with existing chunk-size warnings; full `npm test` passed 346 files / 4424 tests.
