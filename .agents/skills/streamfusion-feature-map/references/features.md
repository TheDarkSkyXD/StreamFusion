# StreamFusion features

Locate code by product outcome, then by runtime. Every implemented feature owns
`routes/`, `components/`, `domain/`, `capabilities/`, `adapters/`, `data/`, `utils/`,
`composition/`, and `tests/`. Current source and tests prove behavior; this map
does not imply that every provider supports every listed surface.

## Desktop

Renderer roots: `apps/desktop/src/frontend/features/<feature>/`.
Main-process roots: `apps/desktop/src/backend/features/<feature>/`.
Shared contracts: `apps/desktop/src/shared/`.

| Outcome | Renderer owner | Main owner | User entry |
| --- | --- | --- | --- |
| App navigation, recovery, notifications | `shell` | `shell` | Window chrome and global navigation |
| Accounts, sign-in, scope consent | `auth` | `authentication` | Account menu and connection dialogs |
| Browse streams, channels, categories, follows | `discovery` | `discovery` | `/`, `/following`, `/categories`, `/categories/$platform/$categoryId` |
| Unified search | `discovery` | `discovery` | `/search` and search input |
| Live, VOD, clip playback, PiP, captions, ad handling | `playback` | `playback` | `/stream/$platform/$channel`, `/video/$platform/$videoId` |
| Chat, emotes, badges, engagement, message controls | `chat` | `chat` | Chat panels in watch and MultiView |
| Multiple streams and player slots | `multistream` | `multistream` | `/multistream` and MultiView controls |
| Downloads, recordings, history | `media-library` | `media-library` | `/downloads`, `/history`, player actions |
| Moderator workspace, actions, AutoMod, retention | `moderation` | `moderation` | `/mod`, `/mod/twitch/$channel`, `/mod/kick/$channel` |
| Preferences, updater, health, diagnostics | `settings` | `settings` | `/settings` and settings tabs |

Screens live in their feature's `components/screens/`. Presentation hooks and
view stores live under `components/`; persistence and cache implementations live
under `data/`. Feature tests and stories live under `tests/`. Shared test setup,
runtime contracts, and cross-feature integrations remain in `apps/desktop/tests/`.

`frontend/routes/router.tsx` composes route exports. `backend/main.ts` composes
the Electron process. The full app's preload remains `backend/preload/index.ts`.
Isolated player slots have their own narrow preload and shared slot contract.

Browser-owned chat connections and emote presentation providers belong in renderer
adapters. Electron networking, credentials, official platform mutations, SQLite,
FFmpeg, and filesystem operations remain in main. Calls cross the allowlisted
`window.electronAPI` bridge. Do not restore imports from renderer to backend
implementations to resolve a type error; use a shared contract or a narrow port.

Public browsing and playback do not require a signed-in account. Category media
crosses the discovery UI's read port into main-process playback adapters. Twitch
category videos and clips use an anonymous GQL primary for both guest and signed-in
sessions. Provider errors remain distinct from successful empty pages. Guest chat
continues receiving messages while its composer and send path remain locked.

Twitch AutoMod receives real held/resolved events. Kick retains its retention
surface. AutoMod/Retention panels stay pinned; Mod Actions docks beside them.
Hidden tools open a floating preview; Add to workspace docks the tool only when a
legal split has enough room. Chat can occupy the full outer-right column.
An authenticated broadcaster may open their own moderator workspace while remote
authority checks run. Existing moderation and player `AGENTS.md` files record
the behavioral invariants in detail.

Twitch workspace tools use independent role and scope grants. Shield Mode,
AutoMod policy, blocked terms and Edit Stream Info use the `channel-tools`
capability. Stream information, poll and prediction management require the
signed-in broadcaster for Helix calls. Stream information includes title,
category, tags, language and editable content labels; go-live notifications and
rerun settings use the native Twitch handoff.
Activity, Suspicious User Activity, Community, Active Mods, Whispers, Reward
Requests and channel navigation live in moderation `components/panels/` and use
the `workspace-panels` capability. Main-process moderation adapters validate the
current account and map Twitch responses into `shared/moderation-types.ts`.
The EventSub catalog specifies each event's version, routing condition and grants.
Feed events are bounded and describe coverage since connection, not historical
Twitch records. Reward history and decisions are limited to app-created rewards.
Native Twitch links cover tools and history unavailable through its public API.

## Mobile

Roots: `apps/mobile/src/features/`.

- `shell`: navigation, deep-link parsing, restoration, and app UI.
- `activity`: activity presentation and operations.
- `diagnostics`: app/device health and persistence diagnostics.
- `capability-profile`: measured Android resource facts, pending workload admission, and visible runtime degradation policy.
- `native-contracts`: typed Android capability ports, Expo adapters, safe proof control, and Kotlin Expo modules.
- `storage`: encrypted Product/Cache stores, migrations, recovery, and native adapters.

Expo's `apps/mobile/app/` entries delegate to
`apps/mobile/src/composition/mobile-runtime.tsx`. Shared design tokens stay under
`src/design/`. Feature tests live with their owner; platform/tooling contract tests
remain in `apps/mobile/tests/`.

## OAuth worker

`apps/worker/src/features/kick-oauth/` owns token exchange, refresh, grant
validation, rate limiting, and Kick token transport. `apps/worker/src/index.ts`
is the required Wrangler entry. This worker does not proxy product reads or chat.

## Shared Core

`packages/core/src/features/` owns shared `activity`, `auth`, `chat`, `content`,
`discovery`, `follows`, and `reliability` contracts and workflows. Runtimes consume
declared `@streamfusion/core/<subpath>` exports. They do not deep-import feature
internals. Platform vocabulary, contract foundations, relay envelopes, and testing
support remain package-wide infrastructure.

## Integration Relay

The current `apps/integration-relay/` is deployment/protocol infrastructure.
`src/composition/worker.ts` validates its environment and returns unavailable or
not-found envelopes. Product endpoints are planned, not implemented feature roots.

## Verification

Normal lint enforces feature layers and runtime imports. Desktop
`npm run architecture:features` checks directory shape and positive/negative import
proofs. Test discovery includes feature roots with their original environments.
Use `verify-streamfusion` for actual Electron navigation and runtime evidence;
type checks and source inventories alone do not prove the app works.
