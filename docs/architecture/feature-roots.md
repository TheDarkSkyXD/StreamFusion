# Feature ownership

StreamFusion uses runtime-local feature roots. A feature owns its UI, workflows,
ports, integrations, persistence, and tests together. Electron still has separate
`backend`, `frontend`, and `shared` source roots; feature ownership does not grant
the renderer access to privileged implementations.

Each feature contains these directories:

| Directory | Responsibility |
| --- | --- |
| `routes` | Thin HTTP, IPC, or navigation entry points |
| `components` | UI, presentation hooks, and view state |
| `domain` | Business rules and workflows |
| `capabilities` | Application-owned, provider-neutral ports |
| `adapters` | Browser, Electron, device, and vendor integrations |
| `data` | Persistence, queries, schemas, and record mappers |
| `utils` | Small pure helpers private to the feature |
| `composition` | Dependency wiring |
| `tests` | Feature tests and Storybook artifacts |

Empty directories use `.gitkeep` so a fresh checkout preserves the shape. An
empty layer does not imply that a feature implements that responsibility.

## Runtime boundaries

- Desktop owns feature roots under `apps/desktop/src/{frontend,backend}/features/`.
  Main and preload entry points remain in backend; the route registry and renderer
  entry remain in frontend. Serialization-safe contracts remain in shared.
- Mobile owns roots under `apps/mobile/src/features/`. Expo's required `app/`
  entries delegate to the mobile composition root.
- The OAuth worker owns `apps/worker/src/features/kick-oauth/`. Its required
  `src/index.ts` delegates to the feature composition.
- Core owns shared business features under `packages/core/src/features/`.
  Consumers keep using the declared `@streamfusion/core/<subpath>` exports.
- Integration Relay currently implements deployment and protocol infrastructure.
  Planned product endpoints do not receive empty, fabricated feature roots.

## Dependency direction

Domain, capability, and utility modules use application-owned contracts and pure
code. They do not import React, Electron, provider libraries, UI, concrete storage,
or dependency composition. Adapters implement ports. Components render state and
collect input; composition supplies concrete collaborators. Production modules
cannot import feature tests or stories.

Normal lint checks dependency direction. Architecture proofs also exercise
allowed and forbidden imports through aliases and relative paths. Test runners
include feature-owned tests and retain their Node, DOM, or system environment.

## Migration decision

Flat runtime-wide layer directories were considered. They separate technologies,
but scatter each product change across unrelated directories. Runtime-local
feature roots provide ownership while preserving Electron, Expo, Worker, and
package export boundaries. A single cross-runtime feature directory was rejected
because it would obscure which code can access credentials, the filesystem, or
browser APIs.

The migration preserves existing test assertions and their `Guards` contracts.
File moves update callers and test discovery together; obsolete forwarding files
are removed. Required framework entries and public package exports remain stable.
