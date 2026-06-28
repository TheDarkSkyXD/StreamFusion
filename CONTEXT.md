# StreamFusion

A desktop client for watching live streams and recorded videos on Twitch and Kick. One app, two providers, one unified experience.

## Language

### Providers and identity

**Platform**:
The provider a piece of content lives on. `"twitch" | "kick"`. Every Channel, Stream, Video, Clip, and Follow is keyed by exactly one Platform.
_Avoid_: Provider, vendor, network.

**Twitch**:
The Amazon-owned streaming platform. Uses GQL + Helix REST + Hermes WebSocket for IRC chat.
_Avoid_: ttv (use only inside identifiers Twitch itself defines).

**Kick**:
The streaming platform built on Pusher WebSocket for chat. Public reads do not require auth.
_Avoid_: KCK, kick.com (use only in URLs).

### Content

**Channel**:
A broadcaster's home on a Platform. Has a slug, a numeric id, badges, and (optionally) a live Stream right now.
_Avoid_: Broadcaster page, profile, account.

**Stream**:
A live broadcast happening on a Channel right now. Has a category, a viewer count, and a playback URL.
_Avoid_: Live, broadcast, show.

**Video**:
A recorded VOD attached to a Channel. Past Streams or uploads.
_Avoid_: Recording, archive.

**Clip**:
A short, user-curated excerpt from a Stream or Video.
_Avoid_: Highlight, snippet.

**StreamSlot**:
One of N (up to the MultiviewCap) addressable render containers in the multiview grid. Owns a single Stream's player instance, its SlotPresence, and (after the per-stream isolation work) its own renderer process. Distinct from the Stream itself — a Stream can be loaded into any slot; a slot can hold any Stream or be empty.
_Avoid_: Tile, pane, view, window.

**MultiviewCap**:
The user-configurable upper bound on simultaneous StreamSlots (range 1–6, default 4). Replaces the previous hard-coded 6. Sets the maximum number of slot processes the app will spawn; settings UI exposes the slider with copy explaining the memory trade-off. Persists in the same store as other multistream preferences.
_Avoid_: maxStreams, streamLimit, multistreamLimit.

**SlotPresence**:
The user-attention state of a StreamSlot: `"focused" | "background" | "hidden"`. `focused` is the slot the user is actively watching (full quality, full buffer, audio). `background` is on-screen but unfocused in multiview (degraded quality, trimmed buffer, muted). `hidden` is not rendered right now (collapsed tab, off-screen) — the HLS instance is torn down entirely. The slot state machine drives quality, buffer config, and process lifecycle from this single attribute.
_Avoid_: visibility (CSS-overloaded), mode, focus.

**Follow**:
The authenticated user's persistent relationship to a Channel. Distinct from a moderator relationship.
_Avoid_: Subscription (subscription is a paid Twitch-only concept), bookmark.

### Cross-platform plumbing

**ChannelRef**:
A discriminated reference to a Channel that crosses the IPlatformReader seam: `{ kind: "slug", value } | { kind: "id", value }`. Replaces the overloaded `channelId: string` callers used to pass. The adapter resolves to its provider's underlying lookup.
_Avoid_: channelId (overloaded), login, slug-or-id.

**IPlatformReader**:
The common read-side seam every Platform's adapter implements: streams, channels, categories, follows, videos, clips. Platform-only features (Twitch polls, EventSub; Kick public reads) live behind their own capability interfaces — they are not part of IPlatformReader.
_Avoid_: PlatformClient (the old `IPlatformClient` interface from `unified/platform-client.ts` that nothing implemented), PlatformAPI, PlatformService.

**Capability interface**:
A narrow seam covering one Platform-specific or optional concern (e.g. `IPlatformPredictions`, `IPlatformEventSub`). A Platform's adapter implements whichever capability interfaces apply. Callers ask `clients.for(platform).as(IPlatformPredictions)` and get either the adapter or `null`.
_Avoid_: Optional method, feature flag.

**Unified type**:
A Platform-neutral DTO produced by adapters: `UnifiedStream`, `UnifiedChannel`, `UnifiedVideo`, etc. Defined in `backend/api/unified/platform-types.ts`. Adapters own the transformation from provider-native shapes.
_Avoid_: Common type, normalised type.

**OAuth2Session**:
The Platform-neutral wrapper around an authenticated session: owns single-flight refresh dedup, auth-lost emission, and storage I/O around tokens. Constructed by `createOAuth2Session({ platform })`. Platform-specific lifecycle (Twitch's proactive refresh scheduler, Kick's Cloudflare cookie purge) wraps it from the outside, not from within.
_Avoid_: AuthService, AuthClient, OAuth2Client.

**ChatConnection**:
The Platform-neutral lifecycle seam every chat adapter implements: `connect | disconnect | on | sendMessage | joinChannel | leaveChannel`. Defined in `shared/chat-types.ts` alongside `ChatServiceEvents`. Renderer components and hooks hold a `ChatConnection`, never the concrete `TwitchChatService` / `KickChatService` class. Constructed via `chatFactory.open(platform, options)`.
_Avoid_: ChatService, ChatClient, IRCConnection (Twitch-only flavour).

**Chat Send Eligibility**:
Whether the authenticated viewer is allowed to send a message in the current Channel right now, after Platform auth, follow, subscription, verification, and chat-mode rules are considered. Distinct from draft editing: a viewer can type a draft even when they are not currently eligible to send it.
_Avoid_: canSend (implementation flag), input disabled state.

**channelKey**:
The canonical bucket identifier used by the chat store and message batcher: a composite string `${platform}:${channelId}` (e.g. `"kick:12345"`, `"twitch:71092938"`). Built only via `buildChannelKey(platform, channelId)` in `store/chat-store.ts` — never assembled inline. Keys `state.messagesByChannel` and `state.pausedChannels`, and scopes the `addMessageBatched` flush timer so each channel batches independently. Distinct from `ChannelRef`, which is a lookup reference (slug or id) and is not stable enough to use as a map key.
_Avoid_: chatroomKey, roomKey, bare platform string.

**PlatformHealth**:
The per-Platform reachability state observed from this app: `"healthy" | "degraded" | "down"`. `degraded` means a rolling failure-rate threshold of remote TRANSIENT failures (timeouts, 5xx) has tripped — the platform is up but flaky. `down` means a short-fuse burst of Chromium net::ERR_* — the LOCAL network/GPU service has crashed and every request will fail until it restarts. Owned by `backend/api/unified/platform-health.ts`. Callers consult `isPlatformHealthy(platform)` before issuing a request and serve stale-success cache when unhealthy; main → renderer IPC fires on transitions so the UI can show a degraded-platform banner.
_Avoid_: outage flag, network-down, isOnline (overloaded with browser navigator).

### Renderer ↔ main

**electronAPI**:
The single contextBridge surface the renderer is allowed to call. Defined in `preload/index.ts`, typed by `shared/electron-api-types.ts`. Renderer code reaches the main process through nothing else.
_Avoid_: IPC bridge, window bridge.

**IPC channel**:
A string constant in `shared/ipc-channels.ts` that names a request/response pair handled by `ipcMain.handle`. Channels are the only cross-process message types.
_Avoid_: Event, message, route.
