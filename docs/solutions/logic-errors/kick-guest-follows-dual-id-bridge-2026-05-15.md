---
title: "Kick guest follows randomly unfollowed due to dual-id mismatch and VOD slug-as-id"
date: 2026-05-15
category: docs/solutions/logic-errors/
module: follow-store
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Kick guest-mode follows appear unfollowed when navigating between pages"
  - "Follow button state inconsistent across Stream, VOD, ClipDialog, and sidebar"
  - "Followed Kick channels persist in SQLite but isFollowing() returns false"
  - "Twitch follows unaffected; only Kick channels regress"
  - "Concurrent toggle clicks produce race conditions on follow state"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - follow-store
  - kick-channel-endpoints
  - vod-page
  - id-utils
  - use-channel-by-username
tags:
  - kick
  - follows
  - dual-id
  - guest-mode
  - identity-matching
  - vod-page
  - sqlite
  - race-condition
---

# Kick guest follows randomly unfollowed due to dual-id mismatch and VOD slug-as-id

## Problem

Kick exposes two distinct numeric identifiers per broadcaster — `user_id` and `channel.id` — and StreamForge's follow store was keying by a single id string. Avatar URLs use `files.kick.com/images/user/<user_id>/...` while banners use `files.kick.com/images/channel/<channel.id>/...`; the two numbers do not match for the same broadcaster.

`apps/desktop/src/backend/api/platforms/kick/endpoints/channel-endpoints.ts:368` (`getPublicChannel`) prefers `data.id` (channel.id) over `data.user_id`, but legacy SQLite follow rows written before that switch still carry `user_id`. Numeric ↔ numeric lookups across the dual-ID schema cannot bridge them.

A second, independent fault made it worse: `apps/desktop/src/pages/Video/index.tsx:254-266` synthesized a follow object with `id: channelName` (the slug), commented `// Use username as ID to match follow store format`. The store actually keys by `${platform}-${id}` with the canonical numeric id, so the VOD page wrote slug-shaped rows while every other surface wrote id-shaped rows.

Verified at runtime against ChickenAndy: DB row had `channelId: "421500"` (user_id), but `useChannelByUsername` returned `id: "411439"` (channel.id).

## Symptoms

- Kick channels followed in guest mode (no Kick login) appeared to "randomly unfollow" across pages.
- A channel followed on the VOD page showed "Follow" on the Stream page (slug-id row didn't match canonical-id lookup).
- After `hydrate()`, unfollowed channels would reappear — dual-row DB state (legacy `user_id` row + fresh `channel.id` row accumulated from cross-page follows) meant `find`-based unfollow only removed one of N matching rows.
- Symptom was guest-mode-only because authenticated Kick follows round-trip through Kick's own API and never hit this local-store path.

## What Didn't Work

1. **VOD page swap to `useChannelByUsername` + `<FollowButton/>` alone** (commit `6f50dd6`). Made the VOD page use the canonical id like ClipDialog does. Surfaced the deeper bug: legacy DB rows from the pre-channel-id-switch era still held `user_id`s, so channels now appeared *more* unfollowed, not fewer.

2. **Pre-existing `channelMatchesKey` lenient fallback in `apps/desktop/src/lib/id-utils.ts`.** Tried to bridge by matching any of: platform-key, slug-key, raw id, raw username — but its lookup parameter was a string key, not a channel object. Worked one direction (slug-shaped key vs id-shaped row) but couldn't bridge numeric ↔ numeric across the dual-ID schema, which was the actual production case.

3. **Disabled fallback Button on the VOD page** (initial state of commit `f0fea6e`). UX-wrong — user explicitly rejected: "we don't want a placeholder, we want the real thing."

4. **Single-row unfollow via `find`** (initial fix in `086bbd5`). Removed only one of multiple matching rows. Users with dual-row DB state saw the survivor reappear after the next `hydrate()`. Fixed in `f0fea6e` with `filter` + loop.

## Solution

Resolved across commits `6f50dd6` → `086bbd5` → `f0fea6e` → `99d3dd0`.

**1. New canonical identity primitive — `apps/desktop/src/lib/id-utils.ts`:**

```typescript
export function channelsMatch(
  a: Pick<UnifiedChannel, "platform" | "id" | "username">,
  b: Pick<UnifiedChannel, "platform" | "id" | "username">
): boolean {
  if (a.platform !== b.platform) return false;
  if (a.id && b.id && a.id === b.id) return true;
  if (a.username && b.username && a.username.toLowerCase() === b.username.toLowerCase()) {
    return true;
  }
  return false;
}
```

Matches by `(platform AND id) OR (platform AND username)`. The slug is stable across Kick's dual-ID schema, so it bridges legacy `user_id` rows to fresh `channel.id` lookups.

**2. Public store API changed from string keys to channel objects — `apps/desktop/src/store/follow-store.ts`:**

```typescript
// Before
isFollowing: (channelKey: string) => boolean;
unfollowChannel: (channelKey: string) => void;

// After
isFollowing: (channel: UnifiedChannel) => boolean;
unfollowChannel: (channel: UnifiedChannel) => void;
```

Backend unfollow filters by slug and removes every match:

```typescript
const slug = followToRemove.username?.toLowerCase();
const matches = backendFollows.filter(
  (f) =>
    f.platform === followToRemove.platform &&
    (f.channelId === followToRemove.id ||
      (!!slug && f.channelName?.toLowerCase() === slug))
);
for (const m of matches) {
  await window.electronAPI.follows.remove(m.id);
}
```

**3. VOD page renders the real `<FollowButton/>` with a synthesized fallback — `apps/desktop/src/pages/Video/index.tsx`:**

```typescript
const channelForFollow: UnifiedChannel = channelData ?? {
  id: "",
  platform: platform as Platform,
  username: channelName,
  displayName: channelDisplayName,
  avatarUrl: channelAvatar || "",
  isLive: false,
  isVerified: false,
  isPartner: false,
};
```

Empty `id` is fine — `channelsMatch` reads via the slug branch until canonical resolves.

**4. `upgradeFollowIfNeeded` store action.** When the canonical channel resolves, migrate any in-memory empty-id row to the canonical id and rewrite the DB row:

```typescript
upgradeFollowIfNeeded: async (channel) => {
  if (!channel.id) return;
  const slug = channel.username?.toLowerCase();
  if (!slug) return;
  const currentFollows = get().localFollows;
  const stale = currentFollows.find(
    (c) =>
      c.platform === channel.platform &&
      !c.id &&
      c.username?.toLowerCase() === slug
  );
  if (!stale) return;
  // replace in-memory, remove empty-id DB rows, write canonical row
},
```

Called from a Video-page `useEffect` when `channelData?.id` becomes truthy.

**5. Per-channel in-flight gate.** Module-scoped `Set<string>` keyed by `platform:id-or-slug` prevents concurrent toggle races (Follow firing during an in-flight Unfollow loop).

**6. Sentinel cleanup.** `hasResolvedChannelName` boolean replaces the literal-string `channelName !== "channel"` comparison so a real Kick user named "channel" wouldn't be trapped in placeholder-forever state.

## Why This Works

The slug (username) is the *only* identifier stable across Kick's dual-ID schema. Both DB rows (legacy and current) store `channelName`; both `UnifiedChannel` shapes (synthesized fallback and canonical API response) carry `username`. Matching on `(platform, id) OR (platform, slug)` covers every combination that maps to "the same channel":

| In-memory `c.id` | Lookup `channel.id` | Same slug? | Match? |
|------------------|----------------------|------------|--------|
| canonical | canonical (same) | yes | via id |
| user_id (421500) | channel.id (411439) | yes | via slug |
| empty "" | canonical | yes | via slug |
| canonical | empty "" | yes | via slug |
| any | any | no | correctly rejected |

`upgradeFollowIfNeeded` then converges the DB on canonical ids over time, so the slug-bridge path is a self-healing bridge rather than a permanent crutch. Multi-row `filter`-and-loop unfollow ensures duals never resurrect after `hydrate()`. The in-flight gate makes the bridge race-safe even when a user toggles rapidly during the unfollow loop.

## Prevention

1. **`channelsMatch` is the canonical channel-identity primitive.** Do not reintroduce key-string comparisons (e.g., `getChannelKey(channel) === key`). When adding consumers, pass channel objects, not strings.
2. **Never synthesize a `UnifiedChannel` with `id: channelName`.** Only the canonical numeric id should ever flow into `channelId` writes. Use `id: ""` when canonical isn't ready and let the slug bridge handle reads.
3. **Multi-row backend ops use `filter`, not `find`.** Anywhere the slug bridge applies, the DB may hold N matching rows — remove them all in a loop.
4. **Test contract for new identity surfaces.** Any new surface calling `isFollowing` or `unfollowChannel` must have a test seeded with a legacy `user_id` row and a fresh `channel.id` lookup, asserting both directions match. Pattern lives in `apps/desktop/tests/store/follow-store.test.ts`.
5. **Cross-reference `docs/api/kick/implementation-notes.md` §"Identity-mismatch defense".** The server-side half of this defense was already documented; `channelsMatch` is its client-side mirror — keep both in sync when Kick's identity model changes.

## Related

- [`docs/api/kick/implementation-notes.md`](../../api/kick/implementation-notes.md) §"Identity-mismatch defense" — server-side identity validation in `getChannel`/`getPublicChannel` (the API-layer mirror of `channelsMatch`).
- [`docs/api/kick/authentication.md`](../../api/kick/authentication.md) §"Identity-mismatch bug" — origin of the user_id/channel.id duality at the Kick API surface.
- Tests pinning the bug-fix contract: `apps/desktop/tests/lib/id-utils.test.ts`, `apps/desktop/tests/store/follow-store.test.ts`.
- Commits: `6f50dd6` → `086bbd5` → `f0fea6e` → `99d3dd0` (on `main`).
