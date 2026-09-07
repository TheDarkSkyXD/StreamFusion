# Chat UI

## Purpose

Owns all chat UI: message rendering, compose input, emote/mention autocomplete, badge rendering, pinned messages, prediction banners, mod tooling, and poll widgets. Browser transports and emote integrations belong in this feature’s `adapters/`; main-owned HTTP and credential integrations belong in backend features. View stores live under `components/state/`, and pure message rules live in `domain/`.

## Entry Points

- `ChatPanel.tsx` — sole platform split point; routes to `KickChat` or `TwitchChat` based on `platform` prop
- `ChatMessage.tsx` — single message row; platform-agnostic, receives all data via props
- `ChatMessageList.tsx` — virtualized list (react-virtuoso); must be keyed per `platform+channel`
- `ChatInput.tsx` — compose box; uses `EMOTE_CHAR` (U+E000) slot system; Enter-to-send only
- `EmoteAutocomplete.tsx` / `MentionAutocomplete.tsx` — trigger-based autocomplete overlays
- `Username.tsx` — colored clickable username; requires `UserPopoutProvider` ancestor
- `kick/KickChat.tsx` — Kick orchestrator: Pusher connect, emote init, event listeners
- `twitch/TwitchChat.tsx` — Twitch orchestrator: IRC connect, Hermes WS, pin polling
- `mod/` — mod strip, confirm dialogs, timeout picker, raid picker, user popout, mod log/engagement tabs

## Contracts & Invariants

- `ChatMessage` shape: `{ id (unique), platform, type, content: ContentFragment[], badges: ChatBadge[], isDeleted, isHistorical, timestamp }`
- Historical messages carry `isHistorical: true`; rendered at `opacity-60`
- Emote fragment shape: `{ id, name, url, isAnimated?, isZeroWidth? }`
- Kick native emotes serialize as `[emote:{id}:{name}]` on the wire
- `UserPopoutProvider` must wrap any surface that renders `Username` with click-to-popout
- `ChatMessageList` must be re-keyed on `platform+channel` change so Virtuoso resets scroll state
- Live messages → `addMessageBatched`; system/ban messages → `addMessage` (immediate)

## Patterns

**Adding a new message type:** Add to `ContentFragment` union, handle in `ChatMessage` render switch, update `serializeMessage()` if the type affects wire format.

**Adding mod tooling:** Place dialogs/pickers in `mod/`; expose from the mod strip. The orchestrators invoke typed feature capabilities wired by composition. Keep provider and preload operations in adapters.

**Emote substitution:** Call `substituteThirdPartyEmotes` with `includeNative: true` for Twitch, default (false) for Kick. Read emote store imperatively via `getState()` inside effects — never as a reactive selector.

**Orchestrator effects:** Keep connect, emote-load, and auth-swap as three separate `useEffect` blocks. Subscribe only to stable action refs from stores, never to `state.messages`.

## Anti-patterns

- Never import backend implementations in renderer components, including `KickChat.tsx` and `TwitchChat.tsx`.
- Never use `useEmoteStore((s) => s.getAllEmotes())` as a reactive selector — causes an infinite render loop; use `getState()` imperatively inside effects
- Never encode platform logic inside `ChatMessage` or `ChatMessageList` — they receive `platform` as a prop only
- No Send button — Enter-to-send is the only input path
- Never subscribe to `state.messages` inside orchestrators — only stable action refs

## Pitfalls

- Kick exposes three numeric IDs: `user_id`, `channel.id`, `chatroomId` — they are not interchangeable; mixing them silently produces wrong API calls or event routing
- `EMOTE_CHAR` (U+E000) is a private-use character; raw `.length` checks are wrong — always use `serializeMessage()` for length validation
- `TwitchPollWidget` uses `KickPoll` type by design — a unified type has not been split yet; do not "fix" this
- Pin polling is Twitch-only; Kick pins arrive via Pusher events — do not add polling to `KickChat.tsx`
- Merging the three orchestrator effects into one causes reconnects on every unrelated refetch

## Related Context

- `../../../AGENTS.md` — renderer feature responsibility boundaries
- `../state/` — chat and emote view state
- `../../adapters/browser/` — browser chat transports and emote providers
- `../../capabilities/` — provider-neutral operation contracts
