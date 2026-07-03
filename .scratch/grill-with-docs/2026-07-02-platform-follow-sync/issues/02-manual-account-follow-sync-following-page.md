# Slice 02 - Manual account-follow sync on Following page

Status: done

## Parent

PRD: ../prd.md

## What to build

Turn the `/following` page refresh control into a manual account-follow sync action. One click should sync all connected Platforms, update the local Follow store from the Platform account lists, and then refresh the followed content shown on the page. Success should be quiet; failures should be visible and Platform-specific.

The existing `/following` page already has a refresh icon that refetches query data by filter/tab. This slice should evolve that control into the PRD's "make account follows current" action rather than adding a duplicate refresh button.

## Acceptance criteria

- [x] Given Twitch and Kick are connected, clicking the `/following` refresh icon invokes account-follow sync for both Platforms.
- [x] Given only Twitch is connected, clicking refresh syncs Twitch only.
- [x] Given only Kick is connected, clicking refresh syncs Kick only.
- [x] While manual sync is in flight, the refresh icon shows progress and cannot be clicked again.
- [x] On full success, no toast appears, the Follow store is hydrated, and followed-channel/followed-stream content refreshes.
- [x] On partial failure, the successful Platform still updates, existing rows for the failed Platform are preserved, and a toast names the failed Platform.
- [x] On full failure, existing rows are preserved and a toast names the failed Platform(s).
- [x] Last successful follow-sync time is tracked per Platform.
- [x] `/following` displays per-Platform freshness text without using a single misleading combined timestamp.
- [x] Unit tests cover all-connected, one-connected, partial-failure, full-failure, pending-state, and per-Platform timestamp behavior.

## Blocked by

None - can start immediately

## Comments

- Closed 2026-07-02: `/following` refresh now runs all connected account-follow syncs before refetching page data, with quiet success, platform-specific failure toast, pending state, and per-platform freshness text. Verified by auth-store and Following page tests.
