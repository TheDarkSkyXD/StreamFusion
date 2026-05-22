---
title: "Kick chat send 401: missing chat:write scope and wrong broadcaster_user_id field"
date: 2026-05-21
category: docs/solutions/integration-issues/
module: apps/desktop/backend/services/chat/kick-chat
problem_type: integration_issue
component: authentication
severity: high
symptoms:
  - "api.kick.com/public/v1/chat:1 Failed to load resource: the server responded with a status of 401 ()"
  - "kick-chat.ts:592 Failed to send message: Error: Failed to send message: 401 {\"data\":{},\"message\":\"Unauthorized\"}"
  - "Every authenticated Kick chat send returns 401 regardless of message content or channel"
  - "Token validates against user:read / channel:read endpoints, masking that chat:write is missing"
  - "Even after the scope fix, sendMessage was posting channelInfo.chatroomId as broadcaster_user_id — a different numeric id than the broadcaster's user_id"
root_cause: missing_permission
resolution_type: code_fix
related_components:
  - chat
  - oauth
  - kick-api
tags:
  - kick
  - oauth
  - chat-write-scope
  - broadcaster-user-id
  - dual-id
  - 401-unauthorized
  - token-migration
---

# Kick chat send 401: missing chat:write scope and wrong broadcaster_user_id field

## Problem

Sending a chat message via StreamForge's ChatInput on Kick returned `401 Unauthorized` on every attempt. Two independent root causes compounded: the OAuth token lacked the `chat:write` scope entirely, and even with the scope present the POST body was supplying the chatroom id (`data.chatroom.id`, a Pusher subscription id) instead of the broadcaster's user_id (`data.id`, a different numeric id). Either alone would have killed the feature; both were live in production until commit `306a8e5`.

## Symptoms

- `api.kick.com/public/v1/chat:1 Failed to load resource: the server responded with a status of 401 ()` in the browser console on every send attempt.
- `kick-chat.ts:592 Failed to send message to <channel>: Error: Failed to send message: 401 {"data":{},"message":"Unauthorized"}` logged by `KickChatService.sendMessage`.
- `ChatInput.tsx:508 Failed to send message: Error: Failed to send message: 401 ...` thrown back into the React component's catch path.
- The token was visibly non-null and was accepted by `user:read` / `channel:read` endpoints (the connection step succeeded, channel data loaded, live messages received via Pusher), so the failure appeared unrelated to authentication at first glance.
- No user-facing recovery hint — the thrown error was the bare `401` string with no instructions, leaving users stranded.

## What Didn't Work

- **Assuming token expiry / refresh.** The access token was present (`this.accessToken` non-null) and working for other Kick API calls. It wasn't expired — it was simply minted without `chat:write` because that scope was commented out in `oauth-config.ts`. A valid token for the wrong scope set looks identical to a valid token for the right one until you check the specific endpoint.

- **Auditing the request payload shape.** `content` and `type` looked correct. The `Authorization: Bearer ${this.accessToken}` header was correct. The structural review missed that `broadcaster_user_id` was receiving `channelInfo.chatroomId` — a field that looked like an ID — rather than the distinct broadcaster user_id. Without knowing Kick's dual-ID model, `chatroomId` is a plausible-looking value.

- **The silent `?? chatroomId` fallback (pre-`87d1d5b`).** Commit `306a8e5`'s initial fix added `broadcasterUserId` to `ChannelInfo` but kept a fallback in `sendMessage`: `const broadcasterUserId = channelInfo.broadcasterUserId ?? channelInfo.chatroomId`. When `broadcasterUserId` was undefined, the wrong ID was posted silently with only a `console.warn` — one that fired on every send (up to 60+/min at the rate-limit ceiling). Kick would have continued rejecting those calls with a different error code. The fallback papered over the missing-id case rather than surfacing it; the `/ce-code-review` second-pass identified this and removed it.

## Solution

### Commit `306a8e5` — Add `chat:write` scope and thread `broadcasterUserId` through the join/send path

**`apps/desktop/src/backend/auth/oauth-config.ts:120-126`**

```ts
// BEFORE
scopes: [
  "user:read",
  "channel:read",
  // Future scopes:
  // 'chat:write',    // Send chat messages
  // 'events:subscribe',
],

// AFTER
scopes: [
  "user:read",
  "channel:read",
  "chat:write", // Required for POST /public/v1/chat — without this, every send returns 401
  // Future scopes:
  // 'events:subscribe',
],
```

**`apps/desktop/src/backend/services/chat/kick-chat.ts`**

- Added `broadcasterUserId?: number` to the internal `ChannelInfo` interface (optional so receive-only joins remain valid while `channelId` resolves).
- Extended `joinChannel(channel, chatroomId, broadcasterUserId?)` signature to accept and store the broadcaster user_id alongside the chatroom id.
- Changed `sendMessage` to consume `channelInfo.broadcasterUserId` for the POST body's `broadcaster_user_id` field.
- Threaded `broadcasterUserId` through the reconnection loop so post-reconnect sends address the correct channel.

**`apps/desktop/src/components/chat/kick/KickChat.tsx:290-294`**

```ts
const parsedBroadcasterId = Number(channelId);
const broadcasterUserId = Number.isFinite(parsedBroadcasterId)
  ? parsedBroadcasterId
  : undefined;
await kickChatService.joinChannel(channel, chatroomId, broadcasterUserId);
```

`channelId` here is the v2 channel response's `data.id` — the broadcaster's internal user_id, distinct from `data.chatroom.id` used for Pusher.

**`apps/desktop/tests/backend/auth/oauth-config.test.ts`** — added a `describe("KICK_OAUTH_CONFIG scopes (chat send)")` block with three guard tests (see [Prevention](#prevention)).

### Commit `87d1d5b` — Tighten `broadcaster_user_id` contract and add actionable 401 message

**`apps/desktop/src/backend/services/chat/kick-chat.ts` `sendMessage` — replace silent fallback with fail-fast throw**

```ts
// BEFORE (silent fallback — posts wrong id, warn fires per send)
const broadcasterUserId = channelInfo.broadcasterUserId ?? channelInfo.chatroomId;
if (channelInfo.broadcasterUserId === undefined) {
  console.warn(`[kick-chat] ... falling back to chatroomId.`);
}

// AFTER (throw clearly; receive-only joins are valid, only send requires the id)
if (channelInfo.broadcasterUserId === undefined) {
  throw new Error(
    `Cannot send to ${normalizedChannel}: broadcaster user_id not set. ` +
      "Rejoin the channel once its broadcaster id has loaded.",
  );
}
```

**401-specific actionable error message**

```ts
if (response.status === 401) {
  throw new Error(
    "Kick chat permission missing — please disconnect and reconnect " +
      "your Kick account in Settings to grant the chat:write scope.",
  );
}
```

**`apps/desktop/tests/backend/services/chat/kick-chat.test.ts`** — new file with three regression tests pinning the wire format, the 401 message, and the missing-id throw (see [Prevention](#prevention)).

## Why This Works

**Scope.** Kick's `POST /public/v1/chat` validates `chat:write` server-side on every request. An OAuth token minted without that scope is structurally valid (it's a real token that authenticates `user:read` and `channel:read` calls) but is missing the permission that authorises the chat endpoint, so Kick returns 401 unconditionally regardless of the request body. Adding `chat:write` to `KICK_OAUTH_CONFIG.scopes` in `apps/desktop/src/backend/auth/oauth-config.ts` ensures all new OAuth grants include it. Existing tokens issued before commit `306a8e5` are irrecoverable without a reconnect, which the new 401 message communicates directly to the user.

**Broadcaster user_id vs chatroom id.** Kick exposes two distinct numeric IDs per channel on the v2 channel response: `data.id` (the broadcaster's internal user_id, which is the `broadcaster_user_id` the chat send API expects) and `data.chatroom.id` (the Pusher chatroom subscription identifier, an entirely different number). Before this fix, `sendMessage` posted `channelInfo.chatroomId` — the Pusher id — as `broadcaster_user_id`. Kick would have rejected those calls with its own error even if the scope had been present. The fix passes the correct id through `joinChannel`'s third parameter and stores it under `broadcasterUserId` in the `ChannelInfo` map entry, keeping the two IDs structurally separated.

**Fail-fast throw vs silent fallback.** The `?? chatroomId` fallback allowed sends to proceed with the wrong id and only logged a warning. Throwing when `broadcasterUserId` is absent makes the receive-only / id-unresolved case visible to the caller (`ChatInput.tsx` already handles thrown errors via `setError(errorMessage)`), produces a single clear error per failed send rather than a warn flood, and removes the class of bug where the wrong id reaches the network silently.

## Prevention

- **`chat:write` scope guard test** in `apps/desktop/tests/backend/auth/oauth-config.test.ts`:

  ```ts
  it("includes chat:write so POST /public/v1/chat is authorized", () => {
    expect(KICK_OAUTH_CONFIG.scopes).toContain("chat:write");
  });
  ```

  Any PR that comments out or removes `chat:write` fails this test before merge. Mirrors the pattern already in place for Twitch IRC's `chat:read` / `chat:edit` guard (see [Related](#related)).

- **Base-scope preservation guard** — asserts `user:read` and `channel:read` are still present so a scope-list rewrite can't silently drop priors while adding new entries.

- **No-duplicate-scopes guard** — `new Set(scopes).size === scopes.length`. Catches copy-paste duplication when adding future scopes.

- **Wire-format regression test** in `apps/desktop/tests/backend/services/chat/kick-chat.test.ts` — stubs `globalThis.fetch`, populates the `channels` map with `chatroomId: 999_111` and `broadcasterUserId: 42`, calls `sendMessage`, then asserts `body.broadcaster_user_id === 42` and `body.broadcaster_user_id !== 999_111`. A future refactor that drops `broadcasterUserId` from the channel record or reintroduces a silent fallback is caught here.

- **401-message regression test** in `apps/desktop/tests/backend/services/chat/kick-chat.test.ts` — mocks a 401 response and asserts the thrown message matches `/disconnect and reconnect/i`. Ensures the recovery path isn't silently regressed to a generic error string.

- **Missing-broadcasterUserId regression test** — sets up a channel record without `broadcasterUserId`, calls `sendMessage`, asserts throw matches `/broadcaster user_id not set/i` and `fetch` was never called. Guards the fail-fast contract.

- **`// Guards:` comment prefix** on the new `describe` blocks per `apps/desktop/tests/AGENTS.md` makes the regression class explicit for reviewers and future agents scanning the test file.

- **Actionable 401 message at the send site** — when a future required-scope rollout happens (e.g., a new Kick API version adds another required scope), the user sees exactly how to recover rather than being stranded on a generic error.

- **Dual-ID rule for any new Kick API call that takes `broadcaster_user_id`** — route through the broadcaster's user_id (`data.id` from the v2 channel response), not the chatroom id. The same `data.id` vs `data.chatroom.id` confusion previously appeared on the follows surface; see [Related](#related). _(auto memory [claude] — `project_kick_dual_id_followups`)_

- **Token migration awareness** — Kick OAuth tokens issued before `chat:write` was added (i.e., before 2026-05-21) do not gain the scope retroactively from a refresh. Users must disconnect/reconnect Kick under Settings to mint a fresh token. The 401 message names this path; future agents debugging "user still seeing 401 after the scope fix landed" should suspect a pre-rollout token before suspecting a new regression. _(auto memory [claude] — `project_kick_chat_write_scope_rollout`)_

## Related

- **[Twitch IRC "Login unsuccessful" — OAuth token missing chat:read / chat:edit scopes](../integration-issues/twitch-irc-missing-chat-scopes-2026-05-19.md)** — Direct structural precedent. Same class of bug (missing platform chat scope causes auth failure at send time), same files touched (`oauth-config.ts`, `oauth-config.test.ts`), same prevention template (per-scope `toContain` assertions + "users must re-auth" rollout note). Differences worth noting: Twitch surfaces this via the IRC handshake (`tmi.js` "Login unsuccessful"); Kick surfaces it as a 401 from the REST `POST /public/v1/chat`.

- **[Kick guest follows randomly unfollowed due to dual-id mismatch and VOD slug-as-id](../logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md)** — Earlier manifestation of Kick's dual-numeric-id hazard. That doc covers the follows surface (slug vs `data.user_id` vs `data.id`); this doc covers the chat send surface (`data.chatroom.id` vs `data.id`). Both prove that any new Kick code path involving channel identity needs explicit awareness of the two distinct id systems.

- **Commits:** `306a8e5` (initial fix), `65b7a80` (adjacent TS cleanup — `electron-store@11` + `KickUser.verified`), `87d1d5b` (post-review tightening).
