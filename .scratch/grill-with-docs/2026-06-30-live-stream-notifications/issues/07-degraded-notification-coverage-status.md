Status: done

# Surface degraded notification coverage

## Parent

.scratch/grill-with-docs/2026-06-30-live-stream-notifications/prd.md

## What to build

Expose when Live Notification coverage is degraded instead of silently overpromising. Degradation can come from EventSub subscription failures, revoked Twitch subscriptions, Kick polling limits, many-follow batching limits, Platform health issues, or OS desktop notification support failures.

## Acceptance criteria

- [x] The Live Notification service reports coverage status for Twitch and Kick.
- [x] Coverage status distinguishes normal monitoring from degraded notification coverage.
- [x] EventSub failures, subscription limits, Kick polling limits, Platform health issues, and many-follow batching limits can mark coverage degraded.
- [x] OS desktop notification unsupported/blocked status is visible without disabling in-app notification history.
- [x] Settings Notifications tab displays non-blocking status for desktop notification support and degraded notification coverage.
- [x] Logs include enough context to diagnose degraded coverage without exposing secrets.
- [x] Tests cover status calculation, Settings rendering, OS desktop notification fallback status, and status recovery when coverage returns to normal.

## Blocked by

- .scratch/grill-with-docs/2026-06-30-live-stream-notifications/issues/02-notifications-settings-tab.md
- .scratch/grill-with-docs/2026-06-30-live-stream-notifications/issues/05-twitch-eventsub-live-source.md
- .scratch/grill-with-docs/2026-06-30-live-stream-notifications/issues/06-kick-bounded-polling-relay-ready-source.md

## Comments

- Completed issue 07. Live Notification coverage now has a shared status contract, main-process service reporting, IPC/preload access, and Settings Notifications rendering for desktop support plus Twitch/Kick source coverage.
- Degraded coverage can be recorded for EventSub failures, subscription limits/revocations, polling failures/limits, Platform health, and many-follow batching. Polling failures are non-fatal, recovery clears the related degraded issue, and in-app notification history remains active when desktop notifications are unsupported or blocked.
- Evidence: focused issue 07 tests passed; `npm run typecheck` passed; `npm run lint` passed; `npm run build` passed with existing chunk-size warnings; full `npm test` passed 346 files / 4429 tests.
