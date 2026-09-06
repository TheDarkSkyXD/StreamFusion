
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

## FEATURE ARCHITECTURE

Every implemented feature owns a `features/<feature>/` root with this structure:

```text
features/<feature>/
├── routes/          # Thin route modules and transport entry points
├── components/      # Feature-specific UI
├── domain/          # Business rules and workflows
├── capabilities/    # Provider-neutral ports
├── adapters/        # Device, Platform, and vendor integrations
├── data/            # Persistence adapters, schemas, queries, and mappers
├── utils/           # Small, pure, feature-private helpers
├── composition/     # Dependency wiring only
└── tests/           # Feature-owned tests
```

- Place code by responsibility. Convex, Clerk, Electron, Twitch, and Kick integrations belong behind ports in `adapters/` when used; database-specific implementations belong in `data/`.
- Keep `domain/` independent of React, routing frameworks, vendor SDKs, and concrete persistence. It depends on application-owned contracts and `capabilities/`.
- Adapters implement capabilities. Capabilities never import their implementations. `composition/` connects consumers to implementations without business logic.
- `routes/` parses and validates incoming requests, resolves the actor, invokes workflows, and maps results. Components render UI and collect input.
- Keep feature-private code and tests inside the feature root. Shared test infrastructure and cross-feature integration tests may remain in workspace test directories.
- Preserve runtime boundaries. Desktop renderer features cannot import privileged main-process implementations; use the allowlisted preload/IPC bridge.
- This is the target for new features and feature migrations. Existing layouts are migration work, not evidence that the target is implemented. Update imports, route registration, test discovery, and ESLint boundaries together when migrating a feature.



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
