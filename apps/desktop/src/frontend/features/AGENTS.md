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
- `index.ts` is the route-facing public entry point when the feature registers pages.

The existing four-folder features, hooks/stores under `data/`, and screens under `src/frontend/pages/<PageName>/` are the current implementation, not the target layout. Move them by responsibility during a feature migration, update callers, and remove obsolete paths together.

The renderer features are `auth`, `chat`, `discovery`, `media-library`, `moderation`, `multistream`, `playback`, `settings`, and `shell`.

## Boundaries

- Keep `src/frontend/routes/router.tsx` as the TanStack Router composition root. Route behavior belongs to the owning feature.
- Add feature dependencies deliberately. `eslint.config.mjs` contains the enforced dependency graph.
- Keep main-process, preload, IPC, slot-host, and shared-contract code outside renderer features.
- Put process-neutral DTOs in `src/shared/`. Do not make a renderer feature depend on a backend type solely for convenience.
- Prefer feature-local imports for internals. Cross-feature imports must represent a real product collaboration.
- Do not recreate compatibility barrels at the deleted `pages`, feature-specific `components`, or feature-specific `hooks` paths.

## Verification

Run `npm run architecture:features` to verify the current three-root layout, feature layout, and one allowed plus one forbidden dependency edge. The current checks do not prove adoption of the nine-folder target. A feature migration must update the layout checks, layer import boundaries, and test discovery in the same change, then prove allowed and forbidden imports through aliases and relative paths.
