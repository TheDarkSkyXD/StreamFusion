# Mod Dashboard Pages

## Purpose

Moderation console at `/mod`, with a live channel workspace inspired by Twitch Mod View.
Broadcasters and moderators use docked live video, chat, mod-log browsing, banned-user list,
unban requests, mod/VIP roster, engagement display (predictions/polls), retention settings.

Out of scope: in-chat mod actions (`src/frontend/features/chat/components/chat/mod/`), stream management,
downloads, settings.

## Entry Points / Structure

- `/mod` → `index.tsx` (ModPage) — channel list + global retention
- `/mod/twitch/$channel` → `ModChannelTwitchPage` → `ModChannelPage(platform="twitch")`
- `/mod/kick/$channel` → `ModChannelKickPage` → `ModChannelPage(platform="kick")`

Key files under `channel/`:

- `ModChannelPage.tsx` — shared shell; owns channel-id resolution and section layout
- `ChannelList.tsx` — grid of channel cards (Twitch: all moderated; Kick: own only)
- `ChannelModLogFeed.tsx` — paginated, filterable mod log (SQLite via IPC)
- `ChannelBannedList.tsx` — banned users with inline Unban (Twitch only)
- `ChannelModeratorsTable.tsx` — add/remove mods (broadcaster only, Twitch only)
- `ChannelVipsTable.tsx` — add/remove VIPs (broadcaster only, Twitch only)
- `ChannelUnbanRequests.tsx` — unban request queue with status filter
- `ChannelEngagement.tsx` — active predictions/polls, 30-second auto-poll
- `RetentionCard.tsx` — per-channel or global retention settings widget

## Contracts & Invariants

- Twitch channel ID must be a numeric string resolved via `useResolveTwitchChannel`
  (login → numeric id). `ModChannelPage` blocks rendering until resolved.
- Kick route parameters are lowercased slugs. Resolve the canonical broadcaster user ID
  for mod-log queries and keep the slug in the retention scope.
- Retention scope keys: `"global"` | `"channel:{twitchNumericId}"` | `"channel:kick:{slug}"`.
  Changing the scope format orphans saved settings.
- `refreshCounter` (integer prop, bumped by Refresh button) is the sole re-fetch trigger.
  Sections must not independently poll or set their own intervals.
- All Helix mutations require per-row busy state to prevent double-submits.
- `ChannelBannedList` used on Kick renders an informational note. The live workspace
  does not offer unsupported Kick tools in its dock.
- The workspace may compose the public `ChatPanel` and live player components. Do not clone
  chat internals or import its internal moderation panels directly.
- An authenticated broadcaster can open their own resolved workspace while scope checks
  run. Remote Twitch admin tools remain gated by verified authority.
- AutoMod Queue is Twitch-only and receives real held/resolved events through the main-owned
  EventSub feed. Do not invent historical queue entries or claim a complete history.
- AutoMod and Retention are pinned. Mod Actions can dock only to the left or right of the
  platform's pinned panel. Chat can dock against the outer workspace edge at full height.

## Patterns

- `useModLog` uses the feature's typed moderation port. Its Electron adapter performs IPC; components never access SQLite or the preload bridge directly.
- Helix calls use fresh tokens fetched per request; always check the `HelixModResult`
  discriminated union (`result.ok`) before acting on the response.
- Broadcaster-only sections (mods/VIPs tables) are conditionally rendered based on role;
  a 403 from Helix is the authoritative signal — do not guess from local state.

## Anti-patterns

- Never import `better-sqlite3` or `database-service` directly — DB access is IPC only.
- Never call Helix from the index/channel-list page — mutations belong on per-channel pages.
- Never bypass the `HelixModResult` discriminated union with a cast or `any`.
- Never assume Kick supports the same feature set as Twitch (banned list, unban requests,
  mod/VIP management, and engagement are Twitch-only).
- Let the public chat component own its providers and connection lifecycle.

## Platform Coverage

| Feature                        | Twitch                 | Kick             |
| ------------------------------ | ---------------------- | ---------------- |
| Channel list                   | All moderated channels | Own channel only |
| Mod log                        | Yes                    | Yes              |
| Retention settings             | Yes                    | Yes              |
| Banned user list               | Yes                    | No (note shown)  |
| Unban requests                 | Yes                    | No               |
| Mod/VIP management             | Yes (broadcaster only) | No               |
| Engagement (polls/predictions) | Yes                    | No               |

## Related Context

- Twitch Helix API docs for moderation endpoints
- `src/frontend/features/moderation/components/hooks/useModLog.ts` — mod-log presentation hook
- `src/frontend/features/moderation/components/hooks/useResolveTwitchChannel.ts` — login-to-id resolution hook
- `src/frontend/features/chat/components/chat/mod/` — in-chat mod panels (separate surface, do not import)
- `DESIGN.md` — app-wide design system tokens and component conventions
