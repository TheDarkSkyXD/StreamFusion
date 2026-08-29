# Renderer Features

## Structure

Each capability owns one folder under `features/`. Every feature contains `components/`, `data/`, `routes/`, and `utils/`.

- `components/` owns feature-specific React UI used by pages.
- `data/` owns feature hooks, query adapters, and feature-owned Zustand stores.
- `routes/` owns lazy page handles, search validation, and intent preloading.
- `utils/` owns pure helpers used by the feature.
- `index.ts` is the route-facing public entry point when the feature registers pages.
- Route-level screens live in `src/frontend/pages/<PageName>/`; feature route modules lazy-load them.

The renderer features are `auth`, `chat`, `discovery`, `media-library`, `moderation`, `multistream`, `playback`, `settings`, and `shell`.

## Boundaries

- Keep `src/frontend/routes/router.tsx` as the TanStack Router composition root. Route behavior belongs to the owning feature.
- Add feature dependencies deliberately. `eslint.config.mjs` contains the enforced dependency graph.
- Keep main-process, preload, IPC, slot-host, and shared-contract code outside renderer features.
- Put process-neutral DTOs in `src/shared/`. Do not make a renderer feature depend on a backend type solely for convenience.
- Prefer feature-local imports for internals. Cross-feature imports must represent a real product collaboration.
- Do not recreate compatibility barrels at the deleted `pages`, feature-specific `components`, or feature-specific `hooks` paths.

## Verification

Run `npm run architecture:features` to verify the three-root layout, feature layout, and one allowed plus one forbidden dependency edge.
