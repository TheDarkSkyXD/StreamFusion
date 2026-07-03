# PRD: Platform Follow Sync

## Problem Statement

StreamFusion already imports authenticated Twitch and Kick follows, but the user-facing promise is fuzzy. Users expect that when they follow or unfollow a channel on Twitch/Kick, StreamFusion catches up without a manual app restart. They also expect signed-in follow actions in the app to affect their real platform account, but Twitch and Kick do not currently provide supported viewer follow/unfollow write APIs that StreamFusion can safely call.

The feature should make the sync contract explicit: StreamFusion supports near-real-time pull-sync from Twitch/Kick into the app. It does not attempt unsupported app-to-platform follow writes.

Current source anchors:
- Twitch official API exposes `GET /helix/channels/followed` with `user:read:follows`.
- Twitch announced permanent shutdown of Create/Delete follow endpoints on July 27, 2021.
- Kick public docs expose `/public/v1/channels` channel APIs, but not a supported authenticated viewer followed-channels endpoint or follow/unfollow write endpoint.
- Existing repo notes say previous Twitch/Kick follow push-sync attempts were investigated and abandoned because platform anti-automation blocked the viable paths.

## Solution

Implement supported pull-sync as the account-follow contract:

- Account follows are platform-managed for both Twitch and Kick.
- Signed-in Follow and Unfollow clicks open the channel on the relevant platform site.
- StreamFusion imports platform-side changes on login, background interval, window focus, and manual refresh.
- Manual refresh controls appear in both `/following` and the sidebar Following section.
- Manual refresh syncs all connected platforms.
- Success is quiet: update per-platform last-synced metadata without a toast.
- Failure is visible: show a toast naming the platform(s) that failed and preserve existing rows.
- Guest Follows remain local and separate from account follows after sign-in.
- Kick pruning is cautious: remove absent Kick account rows only when the sync result is high-confidence.

## User Stories

1. As a signed-in Twitch user, when I follow or unfollow a channel on twitch.tv, StreamFusion updates my followed list after focus/background/manual sync.
2. As a signed-in Kick user, when I follow or unfollow a channel on kick.com, StreamFusion updates my followed list after a high-confidence sync.
3. As a signed-in user, when I click Follow or Unfollow in StreamFusion, I am sent to the platform site to perform the canonical account action.
4. As a user, when I click the manual refresh icon, StreamFusion refreshes all connected platform follows and shows progress.
5. As a user, when one platform fails to sync, StreamFusion keeps my existing follow rows and tells me which platform failed.
6. As a guest-follow user who later signs in, my Guest Follows remain local and are not promoted to account follows.

## Implementation Decisions

- Do not implement Twitch/Kick follow or unfollow write calls through private APIs, GQL mutations, page-context fetch, DOM automation, or undocumented anti-automation bypasses.
- Keep the existing 15-minute background refresh and window-focus refresh.
- Add a manual sync entry point that invokes existing `auth.syncFollows(platform)` for each connected platform.
- Track last successful follow-sync timestamp per Platform, not as a single global timestamp.
- `/following` should show a primary refresh icon button in the page header and per-platform freshness text.
- Sidebar Following should show a compact tooltiped refresh icon; tooltip can summarize the oldest connected platform freshness while preserving per-platform state internally.
- Signed-in FollowButton behavior should be symmetric:
  - Not following + signed in: open platform channel URL with copy to follow there.
  - Following account-source row: open platform channel URL with copy to unfollow there.
  - Guest/signed-out rows: retain local Guest Follow behavior.
- Kick sync should prune absent rows only when the backend can classify the result as a trusted, authenticated followed-channel list. Errors, Cloudflare/Kasada challenges, ambiguous zero results, and uncertain fallback scrape results must not prune.

## Testing Decisions

- Unit-test manual sync orchestration:
  - syncs Twitch and Kick when both are connected
  - syncs only the connected platform when one is connected
  - disables/spins refresh controls while in flight
  - updates per-platform last-synced on success
  - reports partial failure by platform
- Unit-test FollowButton signed-in behavior:
  - Twitch signed-in follow opens twitch.tv instead of local account write
  - Kick signed-in follow opens kick.com instead of attempting `follows.add`
  - account-source unfollow opens platform site
  - Guest Follow behavior remains local
- Backend/storage tests:
  - Twitch successful sync prunes absent account-source rows
  - Kick high-confidence successful sync prunes absent account-source rows
  - Kick error/uncertain sync preserves existing rows
- UI/manual verification:
  - Follow on twitch.tv, refocus StreamFusion, confirm row appears
  - Unfollow on twitch.tv, refocus StreamFusion, confirm row disappears
  - Follow on kick.com, manual refresh StreamFusion, confirm row appears
  - Simulate Kick sync failure, confirm existing rows remain and failure toast names Kick

## Out of Scope

- App-to-platform follow/unfollow writes.
- Guest Follow migration or promotion to account follows.
- True real-time event streaming for viewer follow-list changes.
- Aggressive 30-60 second polling.
- Settings-only sync controls.
- Bulk platform-management UI beyond opening the channel URL.

## Further Notes

- Recommended next step: run `/to-issues` against this PRD so implementation can be split into vertical slices.
- If Twitch or Kick later adds supported viewer follow/unfollow write APIs, create a new grill/ADR before changing the product promise.
- Official docs checked during grill:
  - Twitch API Reference: https://dev.twitch.tv/docs/api/reference
  - Twitch follow write endpoint deprecation: https://blog.twitch.tv/en/2021/06/28/deprecation-of-create-and-delete-follows-api-endpoints/
  - Kick Dev Docs repository: https://github.com/KickEngineering/KickDevDocs
  - Kick channels docs: https://raw.githubusercontent.com/KickEngineering/KickDevDocs/main/apis/channels.md
