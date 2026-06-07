# StreamFusion

Electron desktop app for watching Kick and Twitch streams. Monorepo with a single app at `apps/desktop/`.

## Intent Layer

**Before modifying code in a subdirectory, read its AGENTS.md first.**

```
apps/desktop/src/
├── main.ts              # Electron main process entry
├── App.tsx              # React renderer entry
├── backend/             # Main process: IPC, auth, API clients, services
├── components/          # React UI (chat, player, stream, mod, etc.)
├── pages/               # Page-level route components
├── hooks/               # Shared React hooks
├── store/               # Zustand global state
├── shared/              # Types/contracts shared between main & renderer
├── preload/             # Electron context bridge (window.electronAPI)
└── lib/                 # Utilities
```

### Child Nodes

| Area | Path | Scope |
|------|------|-------|
| **Source root index** | `apps/desktop/src/AGENTS.md` | Master index — architecture, all subsystems, global invariants |
| Backend (main process) | `apps/desktop/src/backend/AGENTS.md` | IPC handlers, auth, services, window manager |
| IPC handlers | `apps/desktop/src/backend/ipc/AGENTS.md` | Handler registration, channel routing, error format |
| Auth / OAuth | `apps/desktop/src/backend/auth/AGENTS.md` | Kick + Twitch OAuth flows, token refresh, PKCE |
| Platform API clients | `apps/desktop/src/backend/api/platforms/AGENTS.md` | Twitch Helix/GQL + Kick REST clients |
| Chat services | `apps/desktop/src/backend/services/chat/AGENTS.md` | WebSocket/IRC connections, parsing, badges, predictions |
| Emote services | `apps/desktop/src/backend/services/emotes/AGENTS.md` | 7TV/BTTV/FFZ/native emote fetch, cache, provider system |
| Shared contracts | `apps/desktop/src/shared/AGENTS.md` | IPC channel constants, types shared across process boundary |
| Preload bridge | `apps/desktop/src/preload/AGENTS.md` | contextBridge security boundary, electronAPI surface |
| UI components index | `apps/desktop/src/components/AGENTS.md` | All React UI component areas |
| Chat UI | `apps/desktop/src/components/chat/AGENTS.md` | Message rendering, emotes, input, mod panels |
| Video player | `apps/desktop/src/components/player/AGENTS.md` | HLS.js player stack, controls, platform adapters |
| Stream browsing UI | `apps/desktop/src/components/stream/AGENTS.md` | Stream cards, grids, featured, related content |
| React hooks | `apps/desktop/src/hooks/AGENTS.md` | Auth, chat, queries, ad-blocking, mod, utilities |
| Pages index | `apps/desktop/src/pages/AGENTS.md` | Route-level page components |
| Mod dashboard | `apps/desktop/src/pages/Mod/AGENTS.md` | Standalone mod admin: bans, VIPs, mod log, engagement |
| Zustand stores | `apps/desktop/src/store/AGENTS.md` | Global state, selectors, IPC sync |
| Test suite | `apps/desktop/tests/AGENTS.md` | Quality bar, Guards convention, audit process |
| Documentation | `apps/desktop/documentation/AGENTS.md` | Feature doc lifecycle, naming, roadmap |

### Global Invariants

- Renderer ↔ main communication ONLY through `window.electronAPI` (context bridge). Never access `ipcRenderer` directly.
- All IPC channel strings live in `shared/ipc-channels.ts` — never hardcode.
- `better-sqlite3` is a native addon — any code importing it (directly or transitively via `database-service`, `storage-service`, `kick-send-window`) MUST stay in the main process. Importing in renderer crashes the bundle.
- Client secrets never ship in the binary — token exchange goes through the Cloudflare Worker at `streamfusion.leveluptogetherbiz.workers.dev`.
- Tokens never reach the renderer — `TokenStatusResult` deliberately has no token value fields.
- `webSecurity: false` is intentional (cross-origin video playback). Security-sensitive IPC handlers MUST validate sender origin via `isAllowedSender(event)`.
- Zustand stores are the UI state source of truth; they talk to backend exclusively through IPC.
- React Query handles all platform data (streams, channels, categories). Auth state uses Zustand only.
- Shutdown: main broadcasts `APP_BEFORE_QUIT`, hard-kills after 3s. Renderer must tear down WebSockets and stop timers on this signal.
- V8 heap capped at 350MB on both main and renderer processes.

### Build & Dev

- **Build tool**: `electron-vite` — 3 targets: main (Node/CJS), preload, renderer (ESNext)
- **Dev**: `npm run dev` (hot reload)
- **Quality**: `npm run check` (typecheck + Biome lint)
- **Test**: `npm run test` (Vitest)
- **Package**: `npm run dist:win/mac/linux`

---

# CRITICAL RULES - MUST FOLLOW

## RESPONSES

- Keep responses concise and to the point - unless the user asks otherwise

## PLANNING MODE

- Always ask clarifying questions
- Never assume design, tech stack or features
- Use deep-dive sub-agents to assist with research
- Use deep-dive sub-agents to review the different aspects of your plan before presenting to the user
- Grill the user on design and requirements, do not make any assumptions.

## CHANGE / EDIT MODE

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

- Never implement features yourself when possible - use sub-agents!
- Identify changes from the plan that can be implemented in parallel, and use sub-agents to implement the features efficiently
- When using sub-agents to implement features, act as a coordinator only
- Use the best model for the task - premium models for complex tasks (like coding) and mid-tier models for simpler tasks, like documentation
- After completing features (large or small), always run commands like lint, type check and next build to check code quality
- ALWAYS Use the deslop skill before committing any code to github.


## DATABASE SCHEMA CHANGES


## TESTING

- Use any testing tools, libraries available to the project for testing your changes
- Never assume your changes simply work, always test!
- If the project does not have any testing tools, scripts, MCP tools, skills, etc. available for testing, ask the user whether testing should be skipped.

## ISSUE COMPLETION

- After finishing work on any issue, ALWAYS run the `/tdd` skill to verify your changes with tests.
- All tests MUST pass with zero errors before you mark an issue as completed.
- Do NOT move to the next issue until the current issue's tests are green.
- If tests fail, fix the failures before marking the issue done.

## UI DESIGN

- Always follow the UI design system when creating or reviewing components or pages.
- Design System: @DESIGN.md
- If the project does NOT have a frontend ignore this.
- if the project has a frontend then make a DESIGN.md file if there is no DESIGN.md file.
