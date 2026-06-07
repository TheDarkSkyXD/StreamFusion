# Emote Services — `backend/services/emotes/`

## Purpose

Fetches, normalizes, and caches emotes from all supported providers (Twitch, Kick, BTTV, FFZ, 7TV). Exposes a single `emoteManager` singleton that the rest of the app queries for emote lookup, search, and text parsing. Does NOT own: UI rendering, the chat store, IPC registration, or auth token acquisition.

---

## File Inventory

| File | Role |
|------|------|
| `emote-types.ts` | Canonical type definitions: `Emote`, `EmoteSet`, `EmoteUrls`, `EmoteOwner`, `EmoteProvider`, `EmoteProviderService` interface, `EmoteManagerConfig` |
| `emote-manager.ts` | Orchestrator singleton. Registers providers, loads global/channel emotes via `Promise.allSettled`, holds in-memory cache, enforces LRU eviction (max 5 channels), deduplicates concurrent fetches via single-flight map |
| `7tv-emotes.ts` | 7TV v3 API. Supports both Twitch and Kick platform lookups; the only third-party that serves Kick. Maps `timestamp` → `addedAt`. Detects zero-width via flag bit `1 << 8` |
| `bttv-emotes.ts` | BetterTTV API. Twitch-only; merges `channelEmotes` and `sharedEmotes` into a flat list. Returns `[]` for non-Twitch platforms |
| `ffz-emotes.ts` | FrankerFaceZ API. Twitch-only; prefers animated URLs when present; treats `modifier` flag as zero-width |
| `kick-emotes.ts` | Kick-native emotes. No global endpoint (returns `[]`). Two-step fetch: primary `/emotes/{slug}`, fallback `/api/v1/channels/{slug}`. Surfaces `subscribersOnly` flag |
| `twitch-emotes.ts` | Twitch Helix API. Requires `clientId` + `accessToken` via `configure()`; silently skips when unconfigured. Selects `animated` format when `format[]` includes it |
| `index.ts` | Barrel export + provider registration. Exposes `initializeEmoteProviders()` and idempotent `ensureEmoteProvidersInitialized()` (lazy-init from chat components so non-chat pages pay no cost) |

---

## Contracts & Invariants

**`EmoteProviderService` interface** — every provider must implement:
- `name: EmoteProvider` — one of `"twitch" | "kick" | "bttv" | "ffz" | "7tv"`
- `fetchGlobalEmotes(): Promise<Emote[]>` — must never throw (catch internally or propagate for global-only; see note below)
- `fetchChannelEmotes(channelId, channelName?, platform?, kickUserId?): Promise<Emote[]>` — must return `[]` rather than throw; channel emote failures are non-fatal
- `getEmoteUrl(emote, size): string`

**`Emote` shape invariants:**
- `id` is a string (providers with numeric IDs must `.toString()`)
- `urls.url1x` and `urls.url2x` are always present; `url4x` is optional (falls back to `url2x`)
- `isZeroWidth` is always set (false when not applicable)
- `subscribersOnly` is only populated by the Kick provider
- `addedAt` is only populated by 7TV (Unix ms, absent for global emotes whose set has no per-emote timestamp)

**Platform routing** — `PLATFORM_PROVIDERS` in `emote-manager.ts` is the single source of truth:
- `twitch`: `["twitch", "bttv", "ffz", "7tv"]`
- `kick`: `["kick", "7tv"]`

Providers outside a platform's list are never called for that platform. Do not bypass this by calling providers directly.

**Cache:**
- TTL: 30 minutes (`DEFAULT_EMOTE_CONFIG.cacheTTL`)
- LRU cap: 5 channels (`MAX_CACHED_CHANNELS`)
- Periodic cleanup every 5 minutes (runs only in browser context)
- Cache keys: `global:{provider}` and `channel:{provider}:{channelId}`

**Single-flight dedup:** concurrent `loadChannelEmotes` calls for the same `channel:provider:channelId` key share one in-flight promise. The slot clears on both success and failure.

**7TV + Kick identity:** 7TV's `/users/KICK/{id}` requires the broadcaster `user_id`, not the slug, channel id, or chatroom id. This value must be resolved upstream (from the Kick channel payload) and passed as `kickUserId`. Without it the 7TV Kick fetch returns `[]` immediately.

---

## Patterns

### Adding a new emote provider

1. Create `{name}-emotes.ts`. Implement `EmoteProviderService`: `name`, `fetchGlobalEmotes`, `fetchChannelEmotes`, `getEmoteUrl`. Return `[]` (not throw) in `fetchChannelEmotes` for errors/unsupported platforms.
2. Add the provider name to `EmoteProvider` union in `emote-types.ts`.
3. Add the provider to the relevant platform entry in `PLATFORM_PROVIDERS` in `emote-manager.ts`.
4. Export the class and singleton from `index.ts`; register via `initializeEmoteProviders()` in `index.ts`.
5. If credentials are needed, add a `configure()` method and a top-level `initialize{Name}Emotes()` helper in `index.ts`.

### Using the manager from chat code

```ts
// Lazy init (called from ChatPanel mount, not app boot)
ensureEmoteProvidersInitialized();

// Load emotes for a channel (platform-filtered)
await emoteManager.loadGlobalEmotes("kick");
await emoteManager.loadChannelEmotes(channelId, channelName, "kick", kickUserId);

// Lookup at render time (O(n) scan — call once, cache result in the message object)
const emote = emoteManager.getEmote(word, channelId);

// Typeahead/autocomplete
const results = emoteManager.searchEmotes(query, channelId, 20);
```

---

## Anti-patterns

- **Do not call provider fetch methods directly** — always go through `emoteManager`. Direct calls bypass the cache and LRU.
- **Do not filter by platform inside a provider** (except for Twitch/BTTV/FFZ's own Twitch-only guard). Platform filtering belongs in `PLATFORM_PROVIDERS` and the manager.
- **Do not add Electron / Node.js imports** — this module is imported by renderer code. Keep it browser-safe.
- **Do not throw from `fetchChannelEmotes`** — the manager swallows errors at the channel level but relies on providers returning `[]` to avoid masking bugs in `Promise.allSettled` logs.
- **Do not pass the chatroom id or channel slug to 7TV for Kick** — it will 404. Only pass `kickUserId`.
- **Do not call `initializeEmoteProviders()` more than once** — use `ensureEmoteProvidersInitialized()` instead to avoid double-registering providers.

---

## Related Context

- `../chat/AGENTS.md` — chat services that consume emotes (`third-party-emote-enrich.ts` walks parsed fragments and substitutes emotes fetched here)
- `../../components/chat/AGENTS.md` — chat UI; calls `ensureEmoteProvidersInitialized()` and reads emote store for rendering
- `../../../store/AGENTS.md` — `emote-store` holds the loaded emote map that components read reactively
