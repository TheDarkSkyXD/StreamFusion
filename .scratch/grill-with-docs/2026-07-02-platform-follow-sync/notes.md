# Platform Follow Sync: Grilling Session Notes
Date: 2026-07-02 · Goal: Decide how StreamFusion should synchronize follows and unfollows between authenticated Twitch/Kick accounts and the app.

## PRD

- [prd.md](prd.md)

## Issues

- [issues/01-platform-managed-signed-in-followbutton.md](issues/01-platform-managed-signed-in-followbutton.md)
- [issues/02-manual-account-follow-sync-following-page.md](issues/02-manual-account-follow-sync-following-page.md)
- [issues/03-sidebar-follow-sync-affordance.md](issues/03-sidebar-follow-sync-affordance.md)
- [issues/04-high-confidence-kick-pruning.md](issues/04-high-confidence-kick-pruning.md)

## Summary / key decisions

Baseline:
- Existing glossary term: `Follow` means the authenticated user's persistent relationship to a Channel; `Guest Follow` means a local unauthenticated relationship.
- Existing code already refreshes account follows in the background: 15-minute interval plus window focus for both Twitch and Kick.
- Existing code uses `pending_follow_writes` and pending-aware reconciliation, but current UI still treats account-source follows as platform-managed because prior push-sync work was abandoned.
- Existing docs mark account follow push-sync as investigated-infeasible on 2026-05-23; the referenced solution doc is missing from the repo, but the superseding notes say Twitch GQL, Kick session-cookie fetch, main-process fetch, page-context fetch, and DOM-click approaches were blocked by platform anti-automation.
- Current official Twitch docs expose read-side `GET /helix/channels/followed` requiring `user:read:follows`; no supported follow/unfollow write endpoint was found. Twitch EventSub `channel.follow` is broadcaster-centric, not "this viewer changed their followed list."
- Current official Kick docs expose channel APIs, event subscriptions, and a `channel.followed` event for a channel receiving a follow. Kick scopes do not list a viewer follow/unfollow write scope; official channel APIs do not expose followed-channels read or follow/unfollow write endpoints.
- Decision: StreamFusion will make a supported pull-sync promise for account follows. The app should sync platform-side follow changes back into StreamFusion, but should not attempt unsupported in-app follow/unfollow writes to Twitch or Kick.
- Decision: "Real time" for account follow sync means near-real-time pull-sync: window-focus refresh, existing 15-minute background refresh, plus a manual refresh affordance where follows are shown. It does not mean a true platform event stream.
- Decision: For signed-in users, Follow and Unfollow are platform-managed for both Twitch and Kick. Clicking the app's FollowButton should send the user to the channel on the platform site, then StreamFusion imports the account change on focus/background/manual sync.
- Decision: Guest Follows stay separate after sign-in. Account follows come only from the Platform's synced list; duplicate guest/account relationships may be collapsed visually, but the underlying sources remain distinct.
- Decision: Kick account sync should prune local account-source rows only on a high-confidence successful sync. Errors, challenge pages, ambiguous zero-results, or uncertain fallback scrape results must preserve existing rows.
- Decision: Add manual follow-sync controls to both the `/following` page and the sidebar Following section. They should use a compact refresh icon affordance and trigger account follow sync for connected platforms.
- Decision: Manual follow sync targets all connected platforms. If the user is connected to only one Platform, it syncs that Platform; otherwise one click syncs both Twitch and Kick.
- Decision: Manual sync feedback should be quiet on success and visible on failure. The refresh icon should show an in-progress state; successful sync updates last-synced metadata without a toast; partial/full failure shows a toast naming the failed Platform(s) and preserves existing follow rows.
- Decision: Track and display last-synced freshness per Platform. Compact sidebar UI may show the oldest connected Platform timestamp in a tooltip, but state should remain per-platform so partial failures are truthful.

## Q&A log

### Q1 - Product promise for account follow sync
- Asked: What product promise should StreamFusion make for in-app follow/unfollow: supported pull-sync only, reopen unsupported write automation, or hybrid by platform?
- Captured: User chose "Supported pull-sync only." StreamFusion should sync changes made on Twitch/Kick back into the app, but should not make app clicks write to platform follow lists through unsupported automation.
- Doc updates: none
- Flags: Need decide freshness/latency target for pull-sync -> user

### Q2 - Freshness promise for platform-side follow changes
- Asked: What should "syncs in real time" mean: near-real-time pull-sync, aggressive polling, or current behavior only?
- Captured: User chose "Near-real-time pull-sync." Keep focus refresh and 15-minute background refresh, and add a visible manual refresh affordance where follows are shown. Do not claim true real-time because Twitch/Kick do not expose a supported viewer-follow-list event stream.
- Doc updates: none
- Flags: Need decide exact signed-in FollowButton behavior -> user

### Q3 - Signed-in FollowButton behavior
- Asked: For a signed-in user who is not following a channel yet, should Follow be platform-managed for both, local while signed in, or Twitch-local/Kick-platform-managed?
- Captured: User chose "Platform-managed for both." Signed-in Follow and Unfollow should happen on Twitch/Kick directly, with StreamFusion importing the resulting account state on refresh/sync.
- Doc updates: none
- Flags: Need decide guest-follow behavior after sign-in -> user

### Q4 - Guest Follow behavior after sign-in
- Asked: What should happen to existing Guest Follows after the user signs in: keep separate, hide guest duplicates while signed in, or prompt to migrate?
- Captured: User chose "Keep separate." Guest Follows stay local; account follows come only from the platform's synced list. If the same Channel exists in both tiers, the UI may collapse duplicates, but the sources remain distinct internally.
- Doc updates: Updated `CONTEXT.md` Guest Follow definition to say Guest Follows remain separate from account Follows after sign-in.
- Flags: Need decide Kick pruning behavior -> user

### Q5 - Kick pruning behavior
- Asked: For Kick specifically, should StreamFusion remove account follows locally when a successful Kick sync no longer includes them: high-confidence only, never prune, or always prune any successful list?
- Captured: User chose "Prune only on high-confidence sync." Successful authenticated Kick followed-channel results may remove absent account-source rows; flaky or uncertain Kick reads must preserve existing rows.
- Doc updates: none
- Flags: Need decide manual refresh surface -> user

### Q6 - Manual refresh surface
- Asked: Where should the manual "sync follows now" control appear: Following page plus sidebar, Following page only, or Settings only?
- Captured: User chose "Following page + sidebar." Add a refresh icon button in the `/following` page header and a compact tooltiped refresh icon near the sidebar Following section.
- Doc updates: none
- Flags: Need decide whether manual sync targets all connected platforms or only selected/current platform -> user

### Q7 - Manual refresh target scope
- Asked: When the user clicks manual refresh, should it sync all connected platforms, only the current platform filter, or expose separate platform buttons?
- Captured: User chose "All connected platforms." One click refreshes every connected platform; if only one account is connected, it refreshes that platform.
- Doc updates: none
- Flags: Need decide success/error feedback -> user

### Q8 - Manual sync feedback
- Asked: What feedback should manual sync show: quiet success with visible failure, toast every result, or inline only?
- Captured: User chose "Quiet success, visible failure." Refresh controls should spin/disable while syncing. On success, update last-synced text with no toast. On partial or full failure, show a toast naming failed platforms and keep existing follows unchanged.
- Doc updates: none
- Flags: Need decide last-synced metadata granularity -> user

### Q9 - Last-synced metadata granularity
- Asked: How should "last synced" be displayed: per-platform timestamps, single combined timestamp, or no timestamp?
- Captured: User chose "Per-platform timestamps." Track/display Twitch and Kick sync freshness separately. Compact sidebar UI can summarize via the oldest connected-platform timestamp in a tooltip.
- Doc updates: none
- Flags: Need decide whether the session is complete and produce PRD -> user

### Q10 - Close-out
- Asked: Are we complete enough to close this grill and turn it into a PRD?
- Captured: User chose "Yes, write PRD." Core decisions are settled and should be captured as a local PRD in this grill session folder.
- Doc updates: Created `prd.md`. No ADR created because the final shape is a scoped product decision built on existing repo direction, not a new hard-to-reverse architecture choice.
- Flags: none

## Open flags (pending input)

- None
