# Renderer migration map: observed runtime and ownership

## Runtime boundary

The desktop application has three source roots. This map only relocates renderer feature code beneath `apps/desktop/src/frontend/features/<feature>/`. It does not move `backend/`, preload, IPC handlers, or `shared/`.

The renderer entry mounts `App.tsx`; `routes/router.tsx` remains the single TanStack Router composition root. A route lazy-loads a page screen, the screen composes its owning feature UI and presentation hooks, and infrastructure calls flow only through `window.electronAPI` into preload and registered main-process handlers. The migration must preserve that direction.

## Feature flows

| Feature | Renderer entry and flow | Owner after migration |
| --- | --- | --- |
| shell | `App.tsx` mounts Query/Auth/tooltip/recovery providers and root lifecycle effects; `router.tsx` applies `AppLayout` around registered destinations. | Shell owns layout, navigation chrome, global dialogs/toasts, notifications, shutdown wiring, and route composition support. |
| discovery | Home, Following, Categories, CategoryDetail, and Search screens call discovery query hooks, then render cards/grids/search UI. Query functions use the preload API for unified platform reads. | Feature screens and presentation state go under components; query caches/persistence remain data; preload readers become capability + electron adapter. |
| playback | Stream/Video routes preload intent, request a playback source, render HLS/platform players, and compose related content. | UI/player hooks live in components; Hls.js, browser media, Twitch playlist/proxy code, and playback-source IPC become adapters; pure route policy stays routes/domain. |
| chat | Stream and multistream surfaces mount `ChatPanel`, branch once to Kick/Twitch orchestration, keep per-channel state, and render the selected or merged feed. | Presentation, local feed state, and view hooks stay components; socket/chat-service calls must be bridged through adapters. |
| auth | `AuthProvider` initializes signed-in/guest state. Connect, reconnect-for-scopes, profile, and live-notification UI consume it. | Auth UI/state is components; application-mounted notification/shutdown-style effects are composition; preload auth status and mutations become adapters. |
| multistream | The MultiStream screen owns StreamSlot layout and active/suspended playback selection. | Layout UI and its Zustand presentation store are components; it collaborates with playback and chat without importing privileged implementations. |
| media-library | Downloads, recordings, history, and duplicate confirmation screens invoke renderer action hooks and show state from main-owned work. | UI/action hooks are components; media/recording IPC is an adapter; history query/cache remains data. |
| moderation | Mod route screens select a Platform-specific channel workspace, while chat embeds the interactive mod strip and tabs. | Moderation screens/state/hooks are feature-owned; the existing chat embedded controls remain chat UI but consume moderation contracts/adapter reads. |
| settings | Settings screen hosts preferences, update state, network/platform health, and diagnostics workspace. | Settings UI/hooks own presentation; generic desktop/update/diagnostic subscriptions split into capabilities and electron adapters; root reporter wiring is composition. |

## Classification rule used in the JSON

- **components**: React screens, UI, presentation hooks, and Zustand presentation state.
- **domain**: pure command, search-validation, and feature policy functions.
- **data**: query keys, cache policy/performance, persistence snapshots/LRUs, schemas, and mappers.
- **capabilities/adapters**: the port plus its browser or preload/IPC implementation. A renderer adapter may call `window.electronAPI`; it may not import Electron or main-process code.
- **composition**: root lifecycle and dependency wiring with no product decisions.
- **tests**: central tests and Storybook artifacts that follow their implementation to the feature root.

## Mixed modules that must be split during relocation

The manifest enumerates the concrete files. The high-risk groups are:

- discovery query hooks currently combine TanStack Query presentation with direct preload calls;
- chat session/settings hooks and Kick/Twitch chat components combine React lifecycle with socket/service transport;
- playback source hooks and HLS player components combine UI state with IPC or Hls.js/browser engines;
- auth, media-library, settings, and shell hooks combine UI state/lifecycle with preload events or mutations.

Move the public React hook/component first, extract a provider-neutral port only where it has real consumers, then implement it with a browser or electron adapter. Do not make data folders a home for React state merely because the file had previously lived under `data/`.

## Migration cautions

- Keep `router.tsx` as global URL registration. Feature `routes/` modules validate search, preload route intent, and export lazy screens.
- Keep the three Electron roots intact. No map entry relocates backend, preload, IPC, or shared contracts.
- The existing renderer imports that reach `@backend` are violations to remove, not a new dependency direction. The JSON calls them out in `splits`.
- Central test ownership is inferred from current implementation imports/names; the relocation tool should confirm each import target before a move. Cross-feature shared tests remain retained.
- Source inventory at HEAD has 464 feature-tree files: 3 `AGENTS.md` instruction files and 4 placeholders. The JSON maps all 461 non-instruction files, including placeholders, which is one more than the request's stated 460.

