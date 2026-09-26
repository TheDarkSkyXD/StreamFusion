# Renderer Features

## Structure

Each feature owns one folder under `features/`. Follow the nine-folder feature architecture in the root `AGENTS.md` for new features and feature migrations.

- `routes/` owns thin route modules, search validation, intent preloading, and transport entry points.
- `components/` owns feature-specific React UI, including route-level screens and presentation hooks.
- `domain/` owns business rules and workflows independent of React and concrete infrastructure.
- `capabilities/` owns provider-neutral, application-owned ports.
- `adapters/` owns browser, restricted desktop-bridge, and vendor integrations that implement ports.
- `data/` owns persistence adapters, schemas, queries, and record mappers. A React hook or presentation store does not belong here solely because it holds state.
- `utils/` owns small, pure, feature-private helpers.
- `composition/` wires dependencies without business logic.
- `tests/` owns feature tests. Include these paths in test discovery when migrating.
- Keep default route registration in `frontend/routes/router.tsx`. The opt-in Start candidate registers feature-owned `routes/start-*.tsx` modules through `apps/desktop/start.routes.mts` and generates `frontend/routes/start-routeTree.gen.ts`. Run `npm run routes:generate` after changing that manifest. Route-facing modules import the owning feature directly. Do not add a feature-root compatibility barrel.

The renderer features are `auth`, `chat`, `discovery`, `media-library`, `moderation`, `multistream`, `playback`, `settings`, and `shell`.

## Boundaries

- Keep `src/frontend/routes/router.tsx` as the default TanStack Router composition root and `src/frontend/routes/start-router.tsx` as the candidate composition root. Route behavior belongs to the owning feature. Shared components use the active router context rather than importing either router singleton.
- Add feature dependencies deliberately. `eslint.config.mjs` contains the enforced dependency graph.
- Keep main-process, preload, IPC, slot-host, and shared-contract code outside renderer features.
- Put process-neutral DTOs in `src/shared/`. Do not make a renderer feature depend on a backend type solely for convenience.
- Prefer feature-local imports for internals. Cross-feature imports must represent a real product collaboration.
- Do not recreate compatibility barrels at the deleted `pages`, feature-specific `components`, or feature-specific `hooks` paths.

## Verification

Run `npm run architecture:features` after changing feature placement or dependencies. It verifies the three runtime roots, all feature layers, and allowed/forbidden dependency edges.
