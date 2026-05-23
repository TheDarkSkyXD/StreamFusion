---
date: 2026-05-22
topic: account-follows-push-sync
status: investigated-infeasible
superseded-by: docs/solutions/integration-issues/follow-push-sync-infeasible-2026-05-23.md
---

> **2026-05-23 outcome:** the WHAT in this brainstorm assumed Xtra's documented Twitch GQL approach and Kick's session-cookie BrowserWindow approach would work for follow writes. Live probing on 2026-05-23 invalidated both — every reasonable path is blocked by platform-side anti-automation systems. See the linked solutions doc. Foundational improvements (U2 schema, U7 atomic sync + Twitch periodic refresh) shipped from the plan; the actual push-sync units (U3, U4, U6, U8) are abandoned.

# Account Follows Push-Sync (Twitch + Kick)

## Summary

Push-sync Follow and Unfollow on both Twitch and Kick when the user is signed in: clicks fire writes to the platform on the same tick the local row toggles, the existing background sync reconciles on its next run, and a per-row banner surfaces divergence the user can retry. Twitch goes through `FollowButton_FollowUser` / `FollowButton_UnfollowUser` GQL persisted-query mutations on the existing `twitch-gql-*` infrastructure; Kick goes through POST/DELETE on the v2 follow endpoint via the same session-cookie BrowserWindow path the read fallback uses. Guest follows stay app-local forever — account and guest are two parallel, separate tiers by design.

---

## Problem Frame

The Kick follow IMPORT direction landed on 2026-05-21 (commit `4a1f64e` and the U1-U6 series): kick.com follows flow into the local `account`-source rows on login, reconciled on the 15-min background sync. Twitch's IMPORT has worked for longer — `syncFollowsOnLogin('twitch')` calls Helix `/channels/followed` on every Twitch login. Both directions of read work.

Writing back to either platform does not. Clicking Follow on a new channel in StreamFusion writes a `guest`-source row that kick.com or twitch.tv never sees. Clicking Unfollow on an existing account-source row pops a "Manage on \[platform\]" redirect toast that sends the user out to the platform's website to perform the actual unfollow. The result is sustained divergence between the app's followed list and the user's real platform account — and a confusing, asymmetric UX where Follow feels one-click but Unfollow makes you leave the app.

Both platforms have working write surfaces. Kick's is the same internal v2 endpoint already used by the read fallback (session-cookie auth via the existing BrowserWindow path at `apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts:231`). Twitch's is `gql.twitch.tv/gql` — same surface twitch.tv's own UI calls, used by the `FollowButton_FollowUser` and `FollowButton_UnfollowUser` persisted-query mutations. The earlier brainstorm (`docs/brainstorms/2026-05-21-kick-account-follows-import-requirements.md`) deliberately scoped both writes OUT, primarily to avoid expanding the surface of internal-endpoint writes. The intervening day's findings overturn that cost calculation: `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-prediction-mutations.ts` and the pin mutations already exercise the GQL gateway with the Android Client-Id (`kd1unb4b3q4t58fwlpcbzcbnm76a8fp`) that bypasses Twitch's integrity check; reference implementation `Xtra` (`reference/Xtra For-Twitch-Better-Functions-etc-master/app/src/main/java/com/github/andreyasadchy/xtra/repository/GraphQLRepository.kt:1170-1205`) confirms `FollowButton_FollowUser` is the same surface twitch.tv's web UI uses for its own follow button. Neither platform requires a new OAuth scope or a new auth surface; both reuse infrastructure already in production.

---

## Key Flows

```
                       User clicks heart (signed in)
                                    │
                                    ▼
                  ┌─────────────────────────────────┐
                  │  Optimistic local toggle (T+0)  │ ← row written/removed
                  │  Heart visually updates first   │   as account-source
                  └────────────────┬────────────────┘
                                   │
                                   ▼
                  ┌─────────────────────────────────┐
                  │  Background push (T+0 → T+~1s)  │
                  │  Twitch: GQL persisted query    │
                  │  Kick:   v2 POST/DELETE via BW  │
                  └────────────────┬────────────────┘
                                   │
                       ┌───────────┴───────────┐
                       │                       │
                   success                 failure
                       │                       │
                       ▼                       ▼
              ┌────────────────┐      ┌─────────────────────┐
              │ Clear pending  │      │ Mark row as having  │
              │ marker (if any)│      │ unconfirmed push    │
              └────────────────┘      └──────────┬──────────┘
                                                 │
                                                 ▼
                                Next background sync (15min / on-focus):
                                detects divergence → surfaces per-row banner
                                "N follow(s) didn't sync to [platform] — retry?"
```

- F1. Follow click while signed in
  - **Trigger:** User clicks the heart icon on a Twitch or Kick channel they don't currently follow, while signed in to that platform.
  - **Steps:**
    1. FollowButton writes the local row as `account`-source. Heart fills immediately in the same UI tick.
    2. Backend fires the platform-appropriate push in the background — Twitch: `FollowButton_FollowUser` persisted-query mutation. Kick: POST to `/api/v2/channels/{slug}/follow` via the existing BrowserWindow path.
    3. On success: row stays as `account`-source. Any pending-push marker is cleared.
    4. On failure (Kasada block, integrity rejection, hash rotation, network, parse): row stays as `account`-source but is marked as having an unconfirmed push. No user-visible interruption.
  - **Outcome:** Heart is filled and the row exists locally; the platform either reflects the new follow (happy path) or the discrepancy is queued for F3.
  - **Covered by:** R1, R2, R5, R6, R8

- F2. Unfollow click on an account-source row
  - **Trigger:** User clicks the heart icon on a Twitch or Kick `account`-source row they currently follow, while signed in to that platform.
  - **Steps:**
    1. FollowButton removes the local row. Heart empties immediately in the same UI tick. The previous "Manage on \[platform\]" redirect toast does NOT appear.
    2. Backend fires the platform-appropriate unfollow push — Twitch: `FollowButton_UnfollowUser` persisted-query mutation. Kick: DELETE to `/api/v2/channels/{slug}/follow` via the same BrowserWindow path.
    3. On success: row stays removed; pending-unfollow marker (if any) is cleared.
    4. On failure: row stays removed locally; a tombstone-equivalent marker records "this row was intentionally removed and should NOT be re-adopted by the next sync." Reconciliation in F3 surfaces the divergence.
  - **Outcome:** Local row is gone; platform either reflects the unfollow (happy path) or divergence is queued for F3.
  - **Covered by:** R3, R4, R5, R7, R9

- F3. Reconciliation on background sync
  - **Trigger:** The existing 15-min / on-focus background sync runs and compares the local `account`-source rows against each platform's fresh followed list.
  - **Steps:**
    1. Sync fetches each platform's followed list (existing read paths, unchanged).
    2. Sync identifies per-platform divergence:
       - Locally `account` + present on platform → matched, no action.
       - Locally `account` + absent from platform + pending-follow marker present → unconfirmed FOLLOW write. Add to reconciliation list.
       - Locally absent + present on platform + pending-unfollow tombstone present → unconfirmed UNFOLLOW write. Add to reconciliation list.
       - Locally absent + present on platform + no tombstone → externally added (user followed on platform's web UI). Adopt as `account`-source normally — existing import behavior.
       - Locally `account` + absent from platform + no pending marker → externally removed (user unfollowed on platform's web UI). Remove locally — existing import behavior.
    3. If the reconciliation list is non-empty after the sync completes, surface a per-row banner: "N follow(s) didn't sync to \[platform\] — retry?" with a single retry action.
    4. Retry click re-fires the original POST/DELETE / mutation for each pending row. Success clears the marker and removes the row from the banner; persistent failure leaves the marker in place for the next sync.
  - **Outcome:** Every user-initiated Follow/Unfollow either lands on the platform or surfaces visibly until it does. No silent drops; no silent overwrites of user intent by the background sync.
  - **Covered by:** R8, R9, R10, R11

- F4. Follow click while NOT signed in (regression guard)
  - **Trigger:** User clicks the heart icon on a Twitch or Kick channel while signed OUT of that specific platform.
  - **Steps:** Identical to today — local row written as `guest`-source. No push fires. No reconciliation applies to guest rows.
  - **Outcome:** Guest tier behavior is unchanged. The two tiers remain visually and functionally parallel.
  - **Covered by:** R12, R13

---

## Requirements

**Push-sync writes**

- R1. When the user clicks Follow on a Twitch channel while signed in to Twitch, the app fires `FollowButton_FollowUser` against `gql.twitch.tv/gql` as a persisted-query mutation, authenticated with the user's existing Twitch OAuth token. The local row is written as `account`-source immediately on click, before the network call completes.
- R2. When the user clicks Follow on a Kick channel while signed in to Kick, the app fires POST to `/api/v2/channels/{slug}/follow` via the same session-cookie BrowserWindow surface the read fallback uses (`apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts`). The local row is written as `account`-source immediately on click.
- R3. When the user clicks the heart on a Twitch `account`-source row while signed in, the app fires `FollowButton_UnfollowUser` via the same path as R1. The local row is removed immediately on click. The existing `isManagedByTwitch` redirect toast does NOT appear for Twitch `account`-source rows.
- R4. When the user clicks the heart on a Kick `account`-source row while signed in, the app fires DELETE to `/api/v2/channels/{slug}/follow` via the same path as R2. The local row is removed immediately on click. The existing `isManagedByKick` redirect toast does NOT appear for Kick `account`-source rows.

**Click-time UX**

- R5. The optimistic local toggle is unconditional — it happens regardless of whether the push is in flight, has succeeded, or has failed. The user sees no spinner, no loading state, no confirmation dialog on the heart click.
- R6. When a push fails on either platform (Kasada / integrity / hash-rotation / auth / network / parse / timeout), the local row stays in the toggled state. The push is marked as unconfirmed in the local DB so the next background sync (F3) can detect and surface it. No user-visible toast, banner, or modal appears on the click itself.
- R7. Unfollow failures on either platform record a tombstone-equivalent marker so the next background sync does NOT re-adopt the row from the platform's followed list. Reconciliation distinguishes "row removed and unfollow push failed" from "row was never here and external follow should be adopted."

**Reconciliation**

- R8. The existing 15-min / on-focus background sync detects divergence between local `account`-source rows and each platform's followed list. When the divergent row carries a pending-push marker (either direction), the sync does NOT silently overwrite the local state.
- R9. When the reconciliation list is non-empty after a background sync, a per-row banner surfaces with copy "N follow(s) didn't sync to \[platform\] — retry?" and a single retry action. Twitch and Kick failures appear as separate banner instances (one per platform), not a combined count.
- R10. Retrying re-fires the original POST/DELETE / mutation per row. Successful retry clears the pending marker. Persistent failure leaves the marker in place for the next sync cycle to surface again.
- R11. Externally-driven changes (user followed/unfollowed on the platform's web UI between syncs) continue to be adopted by the existing import behavior. The pending-marker check is the ONLY signal that prevents adoption — its absence means "external action, adopt normally."

**Guest tier separation**

- R12. When the user clicks Follow on a Twitch or Kick channel while NOT signed in to that platform, the existing guest-source local-write behavior is unchanged: row is written as `guest`-source, no push fires, no reconciliation applies.
- R13. Guest-source rows on either platform are never automatically promoted to `account`-source by this feature. No UI affordance exists to migrate a guest row to account. The two tiers remain parallel, separate, and permanent. A channel can exist as both a `guest` row and an `account` row simultaneously; the existing FollowButton hydration / dedup logic determines which behavior wins per render.

---

## Acceptance Examples

- AE1. **Covers R1, R5.** Given the user is signed in to Twitch and is viewing a Twitch channel they don't follow, when they click the heart, the heart fills in the same UI tick, a local `account`-source row exists in the DB before the network response returns, and `FollowButton_FollowUser` is POSTed to `gql.twitch.tv/gql` in the background with the user's OAuth token in the `Authorization` header.
- AE2. **Covers R2, R5.** Given the user is signed in to Kick and is viewing a Kick channel they don't follow, when they click the heart, the heart fills in the same UI tick, a local `account`-source row exists in the DB before the network response returns, and POST `/api/v2/channels/{slug}/follow` is fired in the background via the BrowserWindow session-cookie path.
- AE3. **Covers R3.** Given the user is signed in to Twitch and the sidebar shows a Twitch `account`-source row they follow, when they click the heart, the heart empties immediately, the local row is removed within the same UI tick, no "Manage on Twitch" redirect toast appears, and `FollowButton_UnfollowUser` is POSTed in the background.
- AE4. **Covers R4.** Given the user is signed in to Kick and the sidebar shows a Kick `account`-source row they follow, when they click the heart, the heart empties immediately, the local row is removed, no "Manage on Kick" redirect toast appears, and DELETE `/api/v2/channels/{slug}/follow` is fired in the background.
- AE5. **Covers R6.** Given the user clicks Follow on a Twitch channel and the subsequent `FollowButton_FollowUser` returns a `PersistedQueryNotFound` error (Twitch rotated the hash), then the heart stays filled, the local row stays present, no toast appears on the click, the row is marked as having an unconfirmed push, and the next background sync includes the row in its reconciliation list.
- AE6. **Covers R6.** Given the user clicks Follow on a Kick channel and the subsequent POST returns a Kasada challenge response, then the heart stays filled, the local row stays present, no toast appears on the click, the row is marked as having an unconfirmed push, and the next background sync includes the row in its reconciliation list.
- AE7. **Covers R7.** Given the user clicks Unfollow on a Kick `account`-source row and the DELETE fails for any reason, when the next background sync runs and Kick's followed list still includes the channel, the row is NOT re-adopted (the tombstone marker is honored). The reconciliation banner instead surfaces the failed unfollow with a retry action.
- AE8. **Covers R9.** Given a background sync completes and detects one unconfirmed Twitch follow + two unconfirmed Kick follows, when the sync finishes, two separate banner instances appear: one reading "1 follow didn't sync to Twitch — retry?" and one reading "2 follows didn't sync to Kick — retry?". They do not combine into "3 follows didn't sync."
- AE9. **Covers R11.** Given the user has a Twitch `account`-source row for channel X with no pending markers, AND the next background sync's Helix `/channels/followed` response does not include X (because the user unfollowed X on twitch.tv between syncs), when the sync runs, the local X row is removed (the existing import behavior is preserved for the no-marker case). The reconciliation banner does NOT surface for X.
- AE10. **Covers R12, R13.** Given the user has a Kick `guest`-source row for channel Y from before they signed in, when the user signs in to Kick, the row stays as `guest`-source. Y is not pushed to kick.com, is not promoted to `account`-source, and continues to appear in the sidebar exactly as it did before sign-in.

---

## Success Criteria

- A signed-in Twitch user who follows a new channel in StreamFusion sees that channel in their twitch.tv followed list within seconds (happy path), without leaving the app. Same for Kick / kick.com.
- A signed-in user who unfollows an `account`-source row in StreamFusion no longer sees that channel in their platform followed list, without leaving the app or seeing a redirect toast.
- Every Follow / Unfollow click eventually lands on the platform OR surfaces a visible, retriable banner. No silent drops; no silent overwrites of user intent by the background sync.
- A downstream implementer can wire push-sync into the existing FollowButton handlers + the existing Twitch GQL mutation pattern (modeled on `twitch-gql-prediction-mutations.ts`) + the existing Kick `_fetchViaBrowserWindow` infrastructure without touching the renderer-side store contract, the `account`/`guest` source model, the OAuth scope set on either platform, or the `AUTH_FOLLOWS_SYNCED` IPC.

---

## Scope Boundaries

- Migration of existing `guest`-source rows to `account`-source on either platform — explicitly rejected. Guest stays guest forever.
- Promotion UX for guest rows ("sync this local follow to the platform") — rejected. The two tiers are permanent and parallel.
- Bulk push of multiple follows in a single user action — out. One follow per user click; reconciliation retries one row at a time.
- Global "Push sync to \[platform\] is offline" indicator / banner / icon — out. The per-row reconciliation banner is the only failure surface. If a whole-session block occurs (Kasada policy tightening on Kick, or hash rotation + integrity tightening on Twitch), the user sees N rows accumulate in the reconciliation list with no top-line signal.
- DOM-fallback for failed pushes on Kick — out. The read-side DOM-scrape works because kick.com renders the follow list; there is no equivalent rendered button surface to "click" for a programmatic write that would survive Kasada.
- Switching Twitch to a session-cookie auth surface like Kick uses — out. Twitch GQL mutations work with the existing OAuth Bearer (as `Authorization: OAuth <token>` per the GQL scheme); no new auth flow is needed.
- Switching Twitch to the web Client-Id with an integrity-token solver — out. The Android Client-Id (`kd1unb4b3q4t58fwlpcbzcbnm76a8fp`) bypass already used throughout the codebase is sufficient. If Twitch ever closes that bypass, that's a re-evaluate moment, not part of this brainstorm.
- Proactive session-cookie / OAuth-token health check before allowing a click — out. App attempts the push and classifies the result.
- Circuit breaker / kill-switch after N consecutive failures in a session — deferred to planning if the natural failure rate proves bad enough; not specified up front.
- Settings UI for managing pending pushes — out. The reconciliation banner is the only surface.
- Push triggered from any source other than direct user click (e.g., import-driven, sync-driven, hover, batch) — out. Push is always user-initiated.
- Additional click surfaces beyond FollowButton (channel page header, embed view) — out unless those surfaces already wrap FollowButton.
- Read-direction sync changes — out. The existing Twitch Helix-based and Kick BrowserWindow / DOM-scrape import paths are untouched by this feature.

---

## Key Decisions

- **Optimistic + reconcile over pessimistic spinner.** Reason: both platforms' write surfaces will fail non-trivially often (Kasada / hash rotation / integrity). A pessimistic spinner UX would feel broken on every blocked click. Optimistic toggle keeps the happy path snappy; the reconciliation banner is honest about real divergence.
- **Symmetric DELETE / Unfollow mutation on click, replacing the redirect-to-platform.com toasts.** Reason: once push exists for Follow, asymmetry where Follow is instant but Unfollow is a multi-step external trip becomes more confusing than the loss of explicit-confirmation friction. Unfollow is reversible (just click again).
- **Guest tier stays permanently separate from account tier.** Reason: lazy-promotion has no natural UI trigger (heart on a guest row means unfollow, not promote); the only viable promotion paths add UI surface the user didn't want; mass-push on login is the rejected "auto" path. The cleanest model is two parallel paradigms.
- **No global "push sync offline" indicator.** Reason: per-row reconciliation banner is sufficient for anticipated failure rates and avoids "the app is broken" cry-wolf states. If accumulated pending rows per session become large in practice, a global indicator can be added later as a small follow-up.
- **Twitch goes through `gql.twitch.tv/gql` with persisted-query mutations + Android Client-Id, NOT through Helix.** Reason: Helix has no write endpoint for follows (verified live against `dev.twitch.tv/docs/api/reference` on 2026-05-22 — removed 2023-09); the GQL surface is alive (twitch.tv's own UI uses it), the persisted-query path is the same one reference app `Xtra` uses, and StreamFusion's existing `twitch-gql-prediction-mutations.ts` + `twitch-gql-pin-mutations.ts` already exercise this exact pattern with the Android Client-Id integrity-bypass. No new infrastructure.
- **Kick goes through the existing session-cookie BrowserWindow path, not a public API.** Reason: the public Kick OAuth API at `api.kick.com/public/v1` does not expose any follow endpoint or scope (verified live against `docs.kick.com/apis` and `docs.kick.com/getting-started/scopes` on 2026-05-22). The read fallback already uses session-cookie BrowserWindow; writes reuse the same surface.
- **No new OAuth scope on either platform.** Reason: Twitch GQL follow mutations work with the user's existing OAuth token; the social-graph action does not gate on a specific scope. Kick GQL writes don't go through OAuth at all (session-cookie). The Kick `chat:write` rollout pain (`project_kick_chat_write_scope_rollout.md`) confirms why we want to avoid forcing a re-auth.

---

## Dependencies / Assumptions

- **The Twitch GQL persisted-query hashes for `FollowButton_FollowUser` (`800e7346bdf7e5278a3c1d3f21b2b56e2639928f86815677a7126b093b2fdd08`) and `FollowButton_UnfollowUser` (`f7dae976ebf41c755ae2d758546bfd176b4eeb856656098bb40e0a672ca0d880`) are current.** Sourced from the Xtra reference implementation. Plan-time verification: hit `gql.twitch.tv/gql` with both hashes and confirm no `PersistedQueryNotFound` response; if rotated, capture fresh hashes from twitch.tv DevTools and update.
- **The Android Client-Id `kd1unb4b3q4t58fwlpcbzcbnm76a8fp` continues to bypass Twitch's Client-Integrity enforcement on the follow mutations.** The codebase already relies on this for prediction + pin mutations; nothing about follow writes should be structurally different. If Twitch tightens Client-Integrity enforcement on this Client-Id specifically, the Android-bypass strategy needs to change codebase-wide, not just for follows.
- **Twitch's GQL `Authorization: OAuth <token>` header accepts any user OAuth token without a follow-write scope.** Implicit from the Xtra implementation, which passes the same `gqlHeaders` token used for read operations and does not request a follow-write scope. Worth verifying live during planning.
- **Kick's `/api/v2/channels/{slug}/follow` accepts POST and DELETE with the same session-cookie + XSRF-token header dance the read fetch already uses.** Assumed by symmetry with the existing `_fetchViaBrowserWindow` pattern. Needs live verification — observe a real follow click on kick.com in browser DevTools, capture the request shape, mirror it.
- **The local DB has room for a "pending push" marker + "tombstone" marker without a destructive schema migration.** Plan-time decision: likely a new column on the LocalFollow table (`pending_action` enum: `none` | `follow` | `unfollow`) or a small companion table (`pending_follow_writes`). Either way, not a schema breakage.
- **The 15-min background sync's existing `clearAccountFollows` + reinsert pattern on Kick (and the Twitch equivalent) can be made aware of pending markers without a full diff-based rewrite.** Skipping rows with `pending_action != none` from the clear+reinsert step is a contained change. If that proves insufficient, planning re-evaluates.

---

## Outstanding Questions

### Resolve Before Planning

- None. Product behavior is fully specified.

### Deferred to Planning

- [Affects R2, R4][Needs research] Exact request shape (headers, body) for POST and DELETE on Kick's `/api/v2/channels/{slug}/follow`. The read fetch uses GET with the session-cookie + XSRF header. Writes likely require the same, plus possibly a body field or specific Content-Type. Observe live against kick.com.
- [Affects R1, R3][Needs research] Re-verify the two Twitch GQL hashes against a live `gql.twitch.tv/gql` call before shipping. Twitch rotated GQL hashes on 2025-11-11 per the prediction-mutations file comment; rotations happen.
- [Affects R6, R7, R8][Technical] Schema for pending-push + tombstone markers. Column on LocalFollow vs separate `pending_follow_writes` table. Decide based on how reconciliation logic shapes up and whether existing query paths can absorb a new column without contention with `channelsMatch` / hydration logic.
- [Affects R8][Technical] Race condition between push-sync writes and the existing 15-min background sync's `clearAccountFollows` + reinsert: a row written at T can be wiped by an in-flight sync completing at T+1s. Sync needs to be aware of pending writes (skip them from the clear+reinsert) OR move to a diff-based sync. Decide approach in planning.
- [Affects R9][Technical] Where the reconciliation banner lives in the React tree — global toast layer, a slot on the Following page, sidebar header, or a notification-center pattern. Affects which store the count subscribes to and how visible "pending pushes" feel.
- [Affects R1, R3][Technical] Whether the existing `twitch-gql-prediction-mutations.ts` patterns (response classification, integrity detection, sanitizeMessage, document-string fallback on `PersistedQueryNotFound`) factor cleanly into a shared helper that the new `twitch-gql-follow-mutations.ts` reuses, or whether duplication is fine for now. Architectural call at plan time.
- [Affects R5, R6][Technical] Whether the FollowButton's existing optimistic-update logic already covers the no-spinner / no-confirmation flow this brainstorm asks for, or whether a new code path is needed for the "marked as unconfirmed" hook on failure. Verify during planning.
- [Affects R9][User decision deferrable] Default copy for the reconciliation banner. "N follow(s) didn't sync to \[platform\] — retry?" is the working draft; final wording can shift during implementation review.
