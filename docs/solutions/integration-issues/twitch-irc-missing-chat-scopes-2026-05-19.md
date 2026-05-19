---
title: Twitch IRC "Login unsuccessful" — OAuth token missing chat:read / chat:edit scopes
module: apps/desktop/backend/auth/oauth-config
date: 2026-05-19
category: integration-issues
problem_type: integration_issue
component: authentication
severity: high
symptoms:
  - "Error: Connection failed: Login unsuccessful (thrown from twitch-chat.ts onDisconnected handler)"
  - "[TMI] Login unsuccessful printed by tmi.js's logger immediately after client.connect()"
  - "Anonymous chat connections work, but authenticated connections fail before joining any channel"
root_cause: missing_permission
resolution_type: config_change
related_components: [chat, oauth]
tags: [twitch, irc, tmi-js, oauth, scopes, chat]
---

# Twitch IRC "Login unsuccessful" — OAuth token missing chat:read / chat:edit scopes

## Problem

Authenticated Twitch chat connections via tmi.js fail immediately with `Error: Connection failed: Login unsuccessful`. The user is signed into the app, the OAuth token is valid against Twitch's `validate` endpoint, and the Helix API works — but IRC rejects the handshake. Affects every authenticated Twitch chat session.

## Symptoms

- `twitch-chat.ts:175` rejects with `Error("Connection failed: Login unsuccessful")` (the `onDisconnected` handler inside `connect()`'s Promise).
- `twitch-chat.ts:575` (tmi.js logger) prints `[TMI] Login unsuccessful`.
- `TwitchChat.tsx:313` surfaces `Failed to connect Twitch chat: Error: ...`.
- Anonymous mode connects fine because `createClient` skips `options.identity` when `anonymous: true` (`twitch-chat.ts:586-592`), so tmi.js sends no PASS/NICK and IRC accepts it as `justinfan*`.
- Twitch's `/oauth2/validate` returns 200 for the token, masking the real issue — `ensureValidToken` (`twitch-auth.ts:107`) considers any non-expired token valid regardless of which scopes it carries.

## What Didn't Work

- **Looking at recent scope removals first.** The `b15bdec refactor: drop AutoMod, Streamlabs, and giveaway from the channel-mgmt console` commit removed scopes from `TWITCH_OAUTH_CONFIG`. That looked like the obvious suspect, but `git log -S "chat:read" -- oauth-config.ts` returned zero results — `chat:read` was never in the file. Not a regression, an original-author gap.
- **Assuming `moderator:manage:chat_messages` covers chat I/O.** It doesn't — that scope only authorizes the Helix `DELETE /moderation/chat` endpoint. IRC chat read/send is a separate scope family that lives outside Helix entirely.

## Solution

Add `chat:read` (for reading messages) and `chat:edit` (for sending messages and replies) to `TWITCH_OAUTH_CONFIG.scopes` in `apps/desktop/src/backend/auth/oauth-config.ts`:

```ts
scopes: [
  "user:read:email",
  "user:read:follows",
  "user:read:subscriptions",
  // IRC chat (tmi.js) auth. PASS oauth:<token> is rejected with
  // "Login unsuccessful" without these — moderator:manage:chat_messages
  // below only covers the Helix delete endpoint, not IRC.
  "chat:read",
  "chat:edit",
  // ...rest of the mod-console scopes...
],
```

**Critical post-fix step:** existing OAuth tokens do not gain new scopes retroactively. Every user must **log out of Twitch in the app and log back in** to be re-issued a token containing the new scopes. The fix is inert until they re-authenticate.

Fixed in commit `7bae79c` (`apps/desktop/src/backend/auth/oauth-config.ts`, `apps/desktop/tests/backend/auth/oauth-config.test.ts`).

## Why This Works

Twitch IRC (`irc-ws.chat.twitch.tv`) is a separate authentication boundary from the Helix REST API. tmi.js authenticates by sending `PASS oauth:<token>` and `NICK <login>` over WSS. The token is validated server-side against the IRC requirement: `chat:read` for any connection that will read messages (i.e. any authenticated connection), and `chat:edit` additionally if PRIVMSG sends are expected. With neither scope present, the IRC server responds `:tmi.twitch.tv NOTICE * :Login authentication failed` and closes the socket. tmi.js translates this to its `disconnected` event with reason `"Login unsuccessful"`.

The Helix scope family (`moderator:manage:chat_messages`, `moderator:manage:banned_users`, etc.) is checked only on HTTPS requests to `api.twitch.tv/helix/*`. IRC does not look at Helix scopes, and `/oauth2/validate` returning 200 means only "this token exists and isn't expired" — it doesn't check whether the scope set is sufficient for any particular subsystem.

## Prevention

- **Regression test pinning IRC scopes.** Added two independent `toContain` assertions in `apps/desktop/tests/backend/auth/oauth-config.test.ts` — one per scope — so a future scope-list refactor that drops either one fails CI with a precise message.
- **Treat IRC scopes and Helix scopes as separate scope families when adding Twitch features.** Mental rule: if the feature talks to `irc-ws.chat.twitch.tv` (via tmi.js or otherwise), it needs `chat:read` and/or `chat:edit`. If it talks to `api.twitch.tv/helix/*`, it needs the matching Helix scope. Adding a Helix-only mod scope does not unlock chat I/O, and vice versa.
- **Token-validation calls don't catch missing scopes.** The `/oauth2/validate` endpoint reports the scope list but `tokenExchangeService.validateToken` (called from `twitch-auth.ts:107`) only checks 200/non-200. If scope-sufficiency mattered upstream of a connect attempt, the validator call would need to inspect the returned `scopes` array. For now, the IRC handshake itself is the only path that catches this — by failing loudly with `Login unsuccessful`.
- **After any scope addition, users must re-authenticate.** Build the logout-then-login step into release notes for any Twitch scope change. Token refresh alone does not upgrade scopes.

## Related

- Repo docs flagged this gap pre-fix: `docs/api/twitch/authentication.md:37` lists `chat:read, chat:edit` as the IRC scopes, and `docs/plans/2026-05-17-002-feat-twitch-pinned-messages-plan.md:565` explicitly noted them as "not blocking this slice" — the kind of acknowledged-but-not-yet-fixed gap that survives because no test enforces it.
- Channel-management scope refactor (`b15bdec`, 2026-05-18) — confirmed not the cause (chat scopes were never in the file), but worth knowing about when reasoning about historical scope set drift.
- Twitch OAuth scope reference: https://dev.twitch.tv/docs/authentication/scopes/ (look under "Chat and Whispers Scopes" for the IRC family).
