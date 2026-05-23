---
title: Follow push-sync from a third-party app is infeasible on both Twitch and Kick
date: 2026-05-23
discovered-during: docs/plans/2026-05-22-003-feat-account-follows-push-sync-plan.md (U3, U4, U6 live probing)
related:
  - docs/solutions/architecture-patterns/kick-auth-surface-oauth-vs-session-cookies-2026-05-22.md
  - docs/solutions/integration-issues/kick-predictions-vote-auth-2026-05-22.md
  - docs/brainstorms/2026-05-22-account-follows-push-sync-requirements.md
---

# Follow push-sync from a third-party app is infeasible on both Twitch and Kick

## What

We attempted to build push-sync for follow actions on both platforms — clicking Follow in StreamFusion → the follow propagates to the user's twitch.tv / kick.com account. After a full day of live probing every reasonable approach, **the feature is not reliably achievable** with the auth surfaces available to a third-party desktop app. Both platforms have aggressively designed their write APIs against exactly this pattern.

The U2 schema (`pending_follow_writes`) and U7 sync improvements (atomic `replaceAccountFollowsRespectingPending` + Twitch periodic refresh) shipped as foundational work and are independently valuable. **U3 (Twitch follow mutations), U4 (Kick follow mutations), and U6 (renderer integration) are abandoned.** The existing redirect-to-platform.com toast remains the unfollow UX for account-source rows on both platforms.

## Every approach we tried, and why it didn't work

### Kick (every path blocked)

| Path | Result | Why |
|---|---|---|
| Renderer `fetch()` to kick.com/api/v2 | 401 | `localhost:5173` origin can't carry first-party `kick.com` cookies even with `credentials:include` |
| Hidden iframe loading kick.com inside renderer | blocked | Kick sets `X-Frame-Options` / `frame-ancestors` |
| Page-context fetch from hidden BrowserWindow on kick.com | 419 CSRF mismatch | `XSRF-TOKEN` cookie is `HttpOnly` — page-context JS can't read it to construct the matching `X-XSRF-TOKEN` header. The SPA does it internally via runtime state that we can't reach |
| Main-process `net.fetch` with XSRF read from `session.defaultSession.cookies` | 429 Too Many Requests, empty body | Kasada bot-detection gates on TLS JA3 fingerprint — `net.fetch` from Node-style HTTP doesn't match Chromium-from-a-page; adding browser User-Agent + Sec-Fetch-* headers didn't help |
| DOM-click on `kick.com/{slug}` Follow button via hidden BrowserWindow | no Follow button in DOM after 12s hydration | The kick.com SPA detects the headless BrowserWindow context as anonymous viewer — the Chat input renders fine but Follow UI is entirely absent. Cookies are in the jar but Kick's frontend auth check isn't satisfied |

The Kick read path (`/following/channels` DOM scrape, already shipped) works only because the followed-channels page renders the follow list as DOM elements for an authed user. There's no equivalent rendered "list of channels you don't follow with Follow buttons attached" page to leverage for writes.

### Twitch (one path works once, then becomes unreliable)

| Path | Result | Why |
|---|---|---|
| GQL `FollowButton_FollowUser` with third-party OAuth token + Android Client-Id | 401 "The Authorization token is invalid." | Twitch's GQL gateway rejects all OAuth tokens issued under non-web Client-Ids |
| GQL with third-party OAuth token + no Client-Id | 401, same body | Same rejection |
| GQL with third-party OAuth token + StreamFusion's actual Twitch Client-Id (`tk3u3q5807...`) | 401, same body | Twitch GQL is a private API for their web client; third-party-issued tokens not honored at all |
| GQL with web `auth-token` cookie (extracted from `session.defaultSession.cookies`) + Android Client-Id | 200 with `failed integrity check` error | The Android Client-Id integrity-bypass that works for prediction mutations does NOT bypass for `FollowButton_FollowUser` — Twitch enforces integrity for follow specifically |
| GQL with `auth-token` cookie + web Client-Id (`kimne78kx3ncx6brgo4mv6wki5h1ko`) | 200 with `failed integrity check` | Same — integrity required regardless of Client-Id |
| Programmatic `element.click()` on twitch.tv Follow button | no-op | React's synthetic event system ignores it because `MouseEvent.isTrusted === false` |
| `webContents.sendInputEvent` (real system-level mouseDown/mouseUp) on twitch.tv Follow button | **worked once** on `day9tv` (verified via next Helix sync showing the new follow), then `click-no-effect` on all subsequent attempts in the same session | Twitch's runtime behavioral bot-detection flagged the headless BrowserWindow context after one click and started silently dropping subsequent clicks. Lack of mouse movement, hover, scroll, real-user timing patterns — all signals Twitch uses to refuse automation |

The Twitch read path (Helix `/channels/followed`, already shipped) works because Helix accepts third-party OAuth tokens for read operations on the user's own data. Write operations were removed from Helix in 2023-09 specifically to prevent this kind of automation.

## Why this is the same shape across both platforms

Both Twitch and Kick deliberately moved their follow-write surfaces behind authentication mechanisms that aren't available to third-party app OAuth flows:

- **Twitch**: deprecated Helix follow-write in 2023, moved everything to their private GQL gateway. The gateway gates on Client-Integrity tokens generated by their web client's challenge flow + auth-token cookies issued by `passport.twitch.tv`. Third-party OAuth tokens (under any Client-Id) are not honored.
- **Kick**: never had a follow endpoint on their public `api.kick.com/public/v1` surface. The internal `kick.com/api/v2/channels/{slug}/follow` endpoint requires session cookies + XSRF + Kasada-acceptable browser fingerprint. The SPA itself satisfies all of these natively; an automation context cannot.

The only contexts that can reliably write follows are:
1. The platform's own web SPA running in a real browser tab (where the user is a verified human via cookies + behavior + integrity tokens)
2. The platform's official mobile apps (which have their own embedded auth that ties to the user's account)
3. Reverse-engineered "auth-token paste" workflows like the Xtra Android app's advanced setup (user manually extracts their web session cookie and pastes it into the third-party app — niche, ToS-gray, requires technical user)

A consumer desktop app with standard OAuth login can't reliably satisfy any of these.

## What we shipped instead

The work that landed and is staying:

- **U2 — `pending_follow_writes` schema** (commit `cd1d501`): tombstone-equivalent table tracking unconfirmed pushes, with dual-id slug bridge for the Kick `channel.id` vs `user_id` problem. Currently unused but stays for future-proofing if a viable write surface emerges.
- **U7 — atomic pending-aware sync + Twitch periodic refresh** (commit `9ee3c31`):
  - `replaceAccountFollowsRespectingPending` makes the read sync honor pending_writes tombstones (no-op today since pending_writes is never populated; would matter if push-sync ever ships)
  - Twitch follows now refresh every 15 min + on focus (previously only on login), matching the Kick pattern — this is a real UX improvement independent of push-sync
  - Twitch sync moved from non-atomic `clearAccountFollows + addLocalFollow` loop to atomic `replaceAccountFollows`, eliminating the half-cleared-state-on-crash failure mode

The follow-button.tsx unfollow behavior for account-source rows stays as `redirect to platform.com via toast` — the existing UX. We tried to remove it via U6; that's reverted.

## What NOT to retry without new platform-side changes

For future-you considering push-sync again — these specific paths are dead ends, confirmed by live testing 2026-05-22 / 2026-05-23. Don't burn time on them again unless one of the underlying assumptions has changed (e.g., the platform added a public follow-write endpoint, or rotated their bot-detection to be less strict).

- Twitch GQL mutations with our standard OAuth token, any Client-Id: blocked permanently
- Kick API v2 from any non-page-context surface: blocked by Kasada
- DOM-click in a hidden BrowserWindow as a reliable production path: unreliable (Twitch's behavioral detection flags it after a few uses, Kick's SPA doesn't render the Follow button at all)

Worth re-investigating ONLY when:
- Kick adds a follow-write endpoint to `api.kick.com/public/v1` with a documented scope
- Twitch reverses the 2023 Helix follow-write removal
- A reverse-engineering effort by another open-source project documents a programmatic auth flow that produces tokens GQL accepts (Xtra-style auth-token-paste workflow could be evaluated, with the ToS caveats)

## Related decisions in the brainstorm + plan

The 2026-05-22 brainstorm (`docs/brainstorms/2026-05-22-account-follows-push-sync-requirements.md`) made the WHAT decision optimistically based on the Xtra reference implementation. The plan (`docs/plans/2026-05-22-003-feat-account-follows-push-sync-plan.md`) followed. Live probing on 2026-05-23 invalidated both — Xtra's documented approach doesn't reliably work today either (possibly broke after Twitch's behavioral detection tightening, possibly required user-pasted web session cookies all along).

Both docs are kept for the historical record; this learning is the corrective followup.
