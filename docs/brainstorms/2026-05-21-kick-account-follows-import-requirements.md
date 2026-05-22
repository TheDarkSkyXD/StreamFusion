---
date: 2026-05-21
topic: kick-account-follows-import
---

# Kick Account Follows Import on Login

## Summary

After a user signs into Kick, the channels they follow on kick.com are imported into StreamForge's local follow store as `account`-source rows — the same one-way sync model the Twitch side already uses. The list refreshes on each Kick login.

---

## Problem Frame

Twitch users who log in get their twitch.tv follows imported automatically: the post-login `syncFollowsOnLogin('twitch')` calls Helix `/channels/followed`, writes account-source rows into the local DB, and the renderer re-hydrates so the sidebar, Following page, and FollowButton all reflect the user's real Twitch account.

For Kick, the same hook fires (`syncFollowsOnLogin('kick')` runs on every Kick login) but `kickClient.getAllFollowedChannels()` returns an empty array. The comment in `apps/desktop/src/backend/api/platforms/kick/kick-client.ts:756` explains why: "Kick official API does not support followed channels endpoint." Verified live on 2026-05-21 against `docs.kick.com` — still no official endpoint. The only follow-related primitive in the public API is the `channel.followed` webhook event, which fires per-follow and has no bulk-list form.

The user-visible cost: a user logs into Kick, the app reports "connected," but their actual Kick follows never appear. The sidebar shows only whatever they happen to have followed locally in StreamForge. The Following page treats it as if they had nothing followed on Kick. The 60s `getFollowedStreams` poll runs against an empty set. Two recent commits (`525d19c`, `b648691`) muted symptoms of this gap rather than closing it.

---

## Key Flows

- F1. Post-login Kick follow import
  - **Trigger:** User completes Kick OAuth login (existing flow).
  - **Steps:**
    1. Login handler writes the OAuth token and calls `syncFollowsOnLogin('kick')` in the background.
    2. Sync fetches the user's followed channels from Kick's internal v2 endpoint using the persisted session cookies from the OAuth window's BrowserWindow partition.
    3. Sync clears existing `account`-source Kick rows in the local DB and inserts one row per imported channel.
    4. Main process emits `AUTH_FOLLOWS_SYNCED` with `platform: 'kick'`.
    5. Renderer re-hydrates `useFollowStore`, invalidates the followed-channels and followed-streams React-Query caches, and the sidebar / Following page repaint with imported rows.
  - **Outcome:** All channels the user follows on kick.com appear in StreamForge as `account`-source follows. `FollowButton` on any of those channels shows the "following" state immediately.
  - **Failure path:** If the fetch fails for any reason (Cloudflare challenge, expired cookies, endpoint shape change, network down), no DB writes happen, a single warning is logged, login still completes, and the existing guest follows surface via the existing `getActiveFollowsByPlatform` fallback. No toast on this path — it should fail quiet, the same way the empty-stub does today.
  - **Covered by:** R1, R2, R3, R4, R7

- F2. Unfollow on an imported Kick row
  - **Trigger:** User clicks the heart on a `FollowButton` whose `followSource === 'account'` on a Kick channel.
  - **Steps:**
    1. Button detects "account-source Kick row" and shows a toast: "Manage this follow on Kick" with an "Open Kick" action.
    2. User clicks the action; app opens `https://kick.com/{username}` in the system browser.
    3. User unfollows on kick.com.
    4. On next Kick login (or token refresh that re-runs sync), the row disappears from StreamForge.
  - **Outcome:** Unfollow eventually reconciles via re-sync, without the local DB being mutated in a way the next sync would undo.
  - **Covered by:** R5, R6

---

## Requirements

**Account follows import**
- R1. On Kick login completion, the existing `syncFollowsOnLogin('kick')` path imports the channels the user follows on kick.com into the local follow store as `source: 'account'` rows, with no behavior or wiring changes outside `kickClient.getAllFollowedChannels()` and the underlying data fetch.
- R2. The data source is Kick's internal `kick.com/api/v2/channels/followed` endpoint, accessed via the same hidden-BrowserWindow pattern used by `getPublicChannel` in `apps/desktop/src/backend/api/platforms/kick/endpoints/channel-endpoints.ts:224`. Cookie/session auth is inherited from the kick.com OAuth login partition.
- R3. Imported follows are pruned and re-inserted on each successful sync: previous `account`-source Kick rows are cleared before insert (existing `storageService.clearAccountFollows('kick')` behavior), so an unfollow done on kick.com between syncs is reflected after the next sync.
- R4. The renderer is notified of completed Kick sync via the existing `AUTH_FOLLOWS_SYNCED` IPC event with `platform: 'kick'`. The existing renderer-side listener re-hydrates `useFollowStore` and invalidates the React-Query followed-channel / followed-stream caches.

**Unfollow behavior on imported rows**
- R5. `FollowButton` recognizes Kick `account`-source rows and, when clicked, does **not** mutate the local DB. Instead it shows the same "Manage this follow on \[platform\]" toast pattern used by the existing Twitch `isManagedByTwitch` branch, with an action that opens `https://kick.com/{username}` in the system browser.
- R6. Clicking the heart on a `guest`-source Kick row continues to toggle the local row exactly as today (no new behavior for guest follows).

**Failure modes**
- R7. If the internal v2 fetch fails (network error, non-2xx, parse error, empty body), the sync writes nothing, logs a single warning at debug level, and returns. The login flow still completes; the existing `getActiveFollowsByPlatform` fallback surfaces the user's guest Kick follows for the session.
- R8. The failure path does not surface a user-visible toast or banner. Failures are observable in the dev console, not in the UI. (Rationale in Key Decisions.)

---

## Acceptance Examples

- AE1. **Covers R1, R3.** Given the user follows 12 channels on kick.com and StreamForge has 3 pre-existing `account`-source Kick rows from an earlier session, when the user completes Kick OAuth login, after the background sync settles, the local DB contains exactly the 12 channels currently followed on kick.com and the previous 3 are gone (re-pruned then re-imported).
- AE2. **Covers R4.** Given the Kick sync completes successfully and the user is currently on the Following page, when the `AUTH_FOLLOWS_SYNCED` event fires, the page re-renders and shows the newly imported follows without requiring a manual refresh.
- AE3. **Covers R5.** Given a user is signed into Kick and the sidebar shows a Kick channel they imported from kick.com, when the user clicks the heart icon on that channel's `FollowButton`, no local DB row is removed and a toast appears offering to open kick.com to manage the follow.
- AE4. **Covers R6.** Given a user is signed into Kick but ALSO has a Kick guest-source follow they added manually before logging in (e.g., a channel they don't follow on kick.com — possible if the local DB held the guest row before login), when the user clicks the heart on that guest row, the row is removed locally exactly as in current guest-mode behavior.
- AE5. **Covers R7, R8.** Given Kick's internal endpoint returns a 403 (Cloudflare challenge) on sync, when the sync runs, the local DB is unchanged from its pre-sync state, no toast appears, a warning is logged in the dev console, and the user's pre-existing guest follows continue to surface in the sidebar.

---

## Success Criteria

- A Kick user who follows N channels on kick.com sees those N channels in the StreamForge sidebar and Following page within seconds of completing Kick login, without manually re-following any of them.
- A downstream implementer can wire the fetch into `kickClient.getAllFollowedChannels()` and unblock the existing `syncFollowsOnLogin('kick')` path without changing the renderer, the storage service, the `account`/`guest` source model, or the `AUTH_FOLLOWS_SYNCED` contract.
- Unfollowing an imported row no longer produces the "heart bounce-back" failure mode where a local removal is undone on the next sync.

---

## Scope Boundaries

- Bidirectional sync (clicking Follow in StreamForge causing a `POST /api/v2/channels/{slug}/follow` on kick.com) — out. Import-only was the user's explicit choice.
- Multi-account scoping (separate follow lists per Kick user id) — out. Single Kick account at a time, matching today's model.
- Periodic background re-sync between logins — out. Login is the only refresh trigger.
- Importing subscriptions, mod channels, blocked users, or any other Kick relationship — out. Only the followed-channels list.
- Migrating pre-login guest-source Kick rows up to kick.com via the POST follow endpoint — out. Guest rows remain local-only.
- A "Refresh my Kick follows" button or any manual refresh affordance — out. Login is the trigger.
- Surfacing a UI toast or banner when the internal endpoint fails — out. Silent fallback is intentional; see Key Decisions.

---

## Key Decisions

- **Use Kick's internal v2 endpoint, not the public API.** The official `docs.kick.com` API has no followed-channels endpoint as of 2026-05-21 (verified live). Waiting for one is unbounded; the internal endpoint is already used elsewhere in the codebase (`getPublicChannel`, search, VODs, clips) and accepts the session cookies that the OAuth login window leaves in the BrowserWindow partition.
- **Redirect, do not push, on unfollow of account rows.** Even though Kick has a working `DELETE /api/v2/channels/{slug}/follow`, the user explicitly chose import-only over two-way sync. Redirecting to kick.com mirrors the existing Twitch `isManagedByTwitch` pattern, keeps the local DB in sync with kick.com without the local row being mutated and then re-added on the next sync, and avoids expanding the surface of internal-endpoint writes.
- **Silent fallback on fetch failure.** The internal v2 endpoint is undocumented and will break occasionally (Cloudflare clearance churn, shape changes, rate caps). A user-visible toast on every failure would cry wolf and the user can't act on it. The existing pattern across this codebase is silent degradation to the guest-follow fallback — keep that.
- **No client-side cache TTL for the imported list.** The sync fires on each login. There's no separate "follow list is stale" concept — re-login is the refresh.

---

## Dependencies / Assumptions

- **Cookies persist across the OAuth window into the BrowserWindow partition used for the fetch.** Assumed because `getPublicChannel` already relies on the `persist:kick_public` partition holding Cloudflare clearance tokens after a prior visit. Worth verifying in planning that the OAuth login flow's session cookies land in a reachable partition (same one, or otherwise wirable).
- **The internal `/api/v2/channels/followed` endpoint returns a paginated list of channels with slug, name, and avatar fields.** Assumed from community endpoint maps (`fb-sean/kick-website-endpoints`, `cibere/kick.py`). Exact response shape is not in the official docs and needs to be observed during planning.
- **BrowserWindow mutex contention is acceptable.** A single bulk fetch on login is one BrowserWindow acquisition. Compatible with the existing `_browserWindowMutex` discipline that serializes Kick BrowserWindow usage.
- **No new IPC channels are introduced.** The existing `AUTH_FOLLOWS_SYNCED` event already carries `platform: 'kick'` and is wired end-to-end in `apps/desktop/src/store/auth-store.ts` and `apps/desktop/src/backend/ipc/handlers/auth-handlers.ts`.
- **`channelsMatch` from `apps/desktop/src/lib/id-utils.ts` continues to handle the Kick dual-id problem.** Imported channels carry `channel.id`; the existing slug-bridge logic covers any legacy `user_id` rows that may co-exist.

---

## Outstanding Questions

### Resolve Before Planning

- None. Product behavior is fully specified above.

### Deferred to Planning

- [Affects R2][Technical] Which BrowserWindow partition holds the kick.com session cookies after OAuth login completes — the OAuth flow's own partition, the `persist:kick_public` partition used by `getPublicChannel`, or do we need to bridge them? Determines exactly how the fetch reuses session state.
- [Affects R2][Needs research] Observed response shape of `kick.com/api/v2/channels/followed` — fields present, pagination model (cursor vs offset vs none), max page size, and whether avatars are inline or require a follow-up `getUsersById` enrichment pass like `getChannel` does.
- [Affects R2][Technical] Whether the internal endpoint accepts the same Cloudflare-clearance flow as `getPublicChannel` or hits a different challenge path, and whether the existing in-flight dedup / negative-cache primitives in `channel-endpoints.ts` need a parallel for this endpoint.
- [Affects R7][Technical] Whether the failure path should distinguish "no cookies / not actually signed in" from "fetch failed" — the first might warrant a different log message so a future maintainer can tell the cases apart without re-instrumenting.
