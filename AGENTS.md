
@AGENTS.md

# CRITICAL RULES - MUST FOLLOW

## RESPONSES

- Keep responses concise and to the point - unless the user asks otherwise

## AGENT INSTRUCTION MAP

- Always read this root `AGENTS.md` first.
- Before editing a file, also read the nearest `AGENTS.md` in that file's directory tree.
- More specific `AGENTS.md` files add to these root rules for their subtree.

| Scope | Instructions |
|------|--------------|
| Documentation | `apps/desktop/documentation/AGENTS.md` |
| Desktop app source | `apps/desktop/src/AGENTS.md` |
| Backend main process | `apps/desktop/src/backend/AGENTS.md` |
| Platform API clients | `apps/desktop/src/backend/api/platforms/AGENTS.md` |
| Kick API endpoints | `apps/desktop/src/backend/api/platforms/kick/AGENTS.md` |
| Twitch API endpoints | `apps/desktop/src/backend/api/platforms/twitch/AGENTS.md` |
| Auth module | `apps/desktop/src/backend/auth/AGENTS.md` |
| IPC handlers | `apps/desktop/src/backend/ipc/AGENTS.md` |
| Chat backend services | `apps/desktop/src/backend/services/chat/AGENTS.md` |
| Emote backend services | `apps/desktop/src/backend/services/emotes/AGENTS.md` |
| UI components | `apps/desktop/src/components/AGENTS.md` |
| Chat UI components | `apps/desktop/src/components/chat/AGENTS.md` |
| Player components | `apps/desktop/src/components/player/AGENTS.md` |
| Stream browsing components | `apps/desktop/src/components/stream/AGENTS.md` |
| React hooks | `apps/desktop/src/hooks/AGENTS.md` |
| Pages | `apps/desktop/src/pages/AGENTS.md` |
| Mod dashboard pages | `apps/desktop/src/pages/Mod/AGENTS.md` |
| Preload bridge | `apps/desktop/src/preload/AGENTS.md` |
| Shared IPC contracts | `apps/desktop/src/shared/AGENTS.md` |
| Zustand stores | `apps/desktop/src/store/AGENTS.md` |
| Tests | `apps/desktop/tests/AGENTS.md` |


Dont open a PR only commit and push to main.



## UI DESIGN

- Always follow the UI design system when creating or reviewing components or pages.
- Design System: @DESIGN.md
- If the project does NOT have a frontend ignore this.
- if the project has a frontend then make a DESIGN.md file if there is no DESIGN.md file.

## Agent skills

### Issue tracker

Issues and specs are tracked with GitHub Issues through `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default SuperDev triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Use `CONTEXT-MAP.md` to locate the desktop and worker contexts, with shared ADRs in `docs/adr/`. See `docs/agents/domain.md`.
