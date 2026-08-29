# Shared-core boundaries and extraction sequence

- Status: approved design for [Choose shared-core package boundaries and extraction sequence](https://github.com/TheDarkSkyXD/StreamFusion/issues/102)
- Applies to: StreamFusion Desktop, StreamFusion Mobile for Android, and the Kick OAuth Worker

## Decision

StreamFusion will use one root npm workspace and one lockfile for `apps/desktop`, `apps/mobile`, `apps/worker`, and `packages/*`.

The first cross-client runtime package will be `@streamfusion/core`. It will expose explicit subpaths for portable product contracts, use cases, capability ports, and test support. Desktop and Android will keep separate UI, lifecycle, persistence, provider, and operating-system adapters. Each app will own an explicit composition root.

Core boundaries will be enforced from the package's first commit. Existing Desktop callers may use narrow compatibility re-exports during migration, but Android feature implementation cannot start until all portable responsibilities have moved, all Desktop-only responsibilities have an owner, the compatibility layer has been removed, and Desktop verification passes.

Expo project and build-system scaffolding may proceed before that gate. Android product-feature implementation may not.

## Current-state constraints

The existing repository is not yet one installation graph. The root workspace contains only the Worker, while Desktop has a separate manifest, lockfile, install command, and dependency policy.

`apps/desktop/src/shared` means shared between Electron processes. It is not a cross-client core. Its files mix portable product types with IPC channels, Electron preferences, provider-native payloads, and Desktop-only state. Moving that directory wholesale would preserve the wrong boundary.

Several seams in `apps/desktop/CONTEXT.md`, including `ChannelRef`, `OAuth2Session`, `ChatConnection`, and the broad `IPlatformReader`, describe the intended domain model rather than complete current implementations. Extraction must implement those seams from proven callers. It must not claim that a file move alone satisfies them.

## Workspace and public exports

The root workspace owns dependency installation, lockfile integrity, linting, type checking, tests, audits, and CI for every app and package. Nested application lockfiles will not remain after the workspace migration has passed Desktop packaging and release checks.

`@streamfusion/core` will not expose a catch-all root barrel. Consumers import only declared subpaths:

| Export                           | Ownership                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `@streamfusion/core/platform`    | `Platform`, stable identifiers, `ChannelRef`, and cross-provider identity rules                                 |
| `@streamfusion/core/content`     | Provider-neutral stream, channel, category, video, and clip contracts plus validation schemas                   |
| `@streamfusion/core/discovery`   | Search intent, results, ranking, deduplication, pagination, and progressive discovery use cases                 |
| `@streamfusion/core/auth`        | Platform-neutral session state, auth outcomes, and narrow token, refresh, clock, scheduler, and auth-lost ports |
| `@streamfusion/core/chat`        | Normalized chat models and events plus the `ChatConnection` capability port                                     |
| `@streamfusion/core/reliability` | Portable errors, results, retry decisions, and health semantics                                                 |
| `@streamfusion/core/testing`     | Fixtures, factories, and adapter contract suites available only to tests                                        |

Package internals are private. App code, tests, and other packages may not deep-import `src` files. Production code may not import `@streamfusion/core/testing`.

Start with one package because the portable candidates still have type coupling inside Desktop. Explicit exports and internal dependency rules provide boundaries without guessing at a multi-package graph. A subpath may become a package later after real consumers prove that it has an independent dependency and release lifecycle.

## Ownership

### Core must own

Before Android feature work, move or create every framework-independent responsibility shared by both clients:

- Platform identity, `ChannelRef`, stable content identifiers, and matching rules.
- Cleaned provider-neutral content contracts and schemas.
- Serialization-safe normalized chat contracts and events.
- Search normalization, validation, ranking, deduplication, and progressive discovery workflows.
- Platform-neutral auth-session semantics and capability ports.
- `IPlatformReader` and other narrow capability ports derived from real callers.
- Follow and live-notification product policy that does not depend on an operating system or provider transport.
- Portable reliability types, retry decisions, and business errors.
- Shared fixtures and contract suites that every concrete adapter must pass.

Core DTOs use serialized timestamps, not JavaScript `Date` objects. Provider-native response shapes, SDK objects, cookies, native handles, and operating-system errors cannot cross a core boundary.

### Desktop must retain

Desktop owns:

- Electron UI, renderer state, preload, IPC channels, IPC validation, and handlers.
- BrowserWindow, WebContentsView, session, tray, window, updater, and protocol behavior.
- Node, filesystem, process, FFmpeg, HLS proxy, recording, download, caption, ad-blocking, and diagnostics implementations.
- `electron-store`, SQLite, `safeStorage`, credential, and other Desktop persistence adapters.
- Concrete Desktop Twitch and Kick HTTP, auth, chat, notification, and media adapters.
- A Desktop composition root under `apps/desktop/src/backend/composition/`.

Desktop IPC contracts remain in Desktop even when their payloads refer to core models.

### Android must own

Android owns:

- Expo and React Native UI, navigation, permissions, and presentation state.
- Android lifecycle, app links, notifications, background tasks, and targeted native modules.
- Android secure storage, local persistence, connectivity, file, and media adapters.
- Concrete Android Twitch and Kick HTTP, auth, chat, notification, and media adapters.
- A Mobile composition root under `apps/mobile/src/composition/`.

Android may adapt an interaction to the platform, but it consumes the same core product contract and remains subject to the approved Android parity contract.

### Worker must retain

The Worker remains limited to Kick OAuth token exchange, refresh, and rate limiting. Core extraction does not turn it into a product-data proxy or shared application backend.

## Provider adapter rule

Desktop and Android own their provider transports and runtime adapters initially. Core owns the capability contracts and normalized results they must satisfy.

Both implementations must pass the same adapter contract suites and fixtures. This catches behavioral drift without forcing Electron cookies, Node APIs, Desktop storage, Expo networking, Android lifecycle, or native storage into one client.

Provider code may move into a future shared adapter package only after the same implementation passes Electron and Expo tests unchanged. It does not move into `@streamfusion/core` merely because both apps call the same Platform.

## Dependency direction

```text
apps/desktop UI and entry points     apps/mobile UI and entry points
                |                                  |
                v                                  v
       Desktop composition root          Mobile composition root
          |                 |               |                 |
          v                 v               v                 v
  core use cases     Desktop adapters   core use cases     Android adapters
          |                 |               |                 |
          +------> core capability ports <--------------------+
                          |
                          v
                 core foundations
```

Source imports follow these rules:

- Desktop and Mobile may import core public subpaths.
- Core domain use cases may import core capability ports and foundations.
- Concrete adapters import the ports and application-owned types they implement.
- Composition roots may import use cases, ports, and concrete adapters only to construct and inject dependencies.
- Core never imports an app, Electron, Expo, React, Node runtime APIs, provider SDKs, or concrete adapters.
- Production code never imports tests, fixtures, mocks, stories, or migration shims.

Runtime calls may flow from a use case through a port to an adapter. The source dependency still points from the adapter to the port. Core never imports the adapter.

## Composition roots

Desktop and Android construct their own dependency graphs. Entry points call the composition root and receive application services or controllers with dependencies already injected.

The Desktop migration will remove module-load provider registration one vertical slice at a time. Importing a Twitch or Kick module must not mutate a global registry. The Desktop composition root explicitly creates each adapter and passes it to the core use case or capability registry.

The Mobile composition root performs the same wiring with Expo and Android implementations. Neither composition root owns product decisions, validation rules, retries, or provider normalization.

## Automated enforcement

The first `@streamfusion/core` commit must include its import rules. Enforcement uses the repository's normal lint and CI paths:

1. Package `exports` allow only approved subpaths.
2. TypeScript project references establish build and type-check order.
3. `eslint-plugin-boundaries` classifies core foundations, capability ports, use cases, app adapters, UI, transport, and composition roots.
4. `no-restricted-imports` bans deep imports and Electron, Expo, React, Node runtime, provider SDK, app-source, test-support, and migration-shim imports in the wrong layers.
5. CI proves an allowed dependency passes and representative forbidden alias, relative, deep, dynamic, CommonJS, runtime, and provider-SDK imports fail.
6. CI runs with zero architecture warnings.

Legacy Desktop files may receive the smallest possible temporary exception while callers migrate. Each exception names its affected file and removal phase. New core and Mobile code receives no blanket exception. The extraction gate requires zero compatibility exceptions.

## Extraction sequence

Each phase keeps Desktop behavior working and ends with its relevant type checks, lint, tests, parity-inventory check, and build proof.

1. **Unify installation.** Move Desktop into the root npm workspace, produce one lockfile, and update dependency policy, Dependabot, audits, CI, packaging, and release commands. Do not move product behavior until Desktop build and packaging match the previous installation model.
2. **Create the boundary.** Add `@streamfusion/core`, explicit exports, project references, lint rules, tests, and allowed and forbidden import proofs without moving production behavior.
3. **Extract leaf contracts.** Move Platform identity, `ChannelRef`, stable identifiers, and reliability types. Keep temporary Desktop compatibility re-exports at the old paths.
4. **Clean data contracts.** Separate normalized content and chat models from provider-native and IPC shapes. Remove Kick-only fields from provider-neutral contracts and standardize serialized timestamps.
5. **Extract discovery behavior.** Move identity helpers, search normalization, validation, ranking, deduplication, pagination, and progressive discovery use cases.
6. **Expand capability ports.** Begin with top streams because the current caller already uses `IPlatformReader`. Continue through channels, categories, videos, clips, and follows. Replace provider self-registration with explicit Desktop composition as each slice migrates.
7. **Extract auth semantics.** Move session state and refresh coordination behind token-store, refresh, clock, scheduler, and auth-lost ports. Keep scopes, endpoints, cookies, secure storage, and Worker calls in app adapters.
8. **Extract chat and notification policy.** Add `ChatConnection`, normalized events, follow policy, live-notification policy, and remaining portable services. Keep sockets, SDKs, raw payloads, and device presentation in adapters.
9. **Finish Desktop migration.** Move every caller to core public exports, remove compatibility files and exceptions, and verify the complete Desktop application.
10. **Open Android feature work.** Start Android product-feature implementation only after the extraction-complete predicate passes.

## Extraction-complete predicate

Android feature implementation may begin only when all conditions hold:

- The current Desktop capability inventory has classified every candidate responsibility as core, Desktop, Android, Worker, or an approved future adapter package.
- Every responsibility classified as portable has moved behind a core public export.
- Desktop and Mobile ownership contains no unresolved shared-code placeholder.
- Desktop imports core through public exports, with no compatibility re-export or boundary exception remaining.
- Core contract suites cover every extracted capability port.
- Workspace install, dependency policy, audits, type checking, lint, unit tests, system tests, Desktop parity inventory, Electron build, and packaging checks pass.
- The Desktop outcome inventory remains semantically unchanged unless a separately approved product decision changed it.

## Rejected alternatives

| Alternative                                     | Reason                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Keep Desktop as a separate installation root    | It would require permanent custom packaging or local-dependency handling for the shared runtime package. |
| Create several shared packages immediately      | Current types are still coupled. Multiple manifests would encode guessed edges and likely cycles.        |
| Put complete Twitch and Kick clients in core    | Current clients contain Electron, Node, storage, lifecycle, provider, and renderer assumptions.          |
| Duplicate every provider detail permanently     | It would allow normalization and behavior to drift without a measured path to safe reuse.                |
| Delay boundary enforcement until migration ends | New shortcuts could enter while old callers move, extending the migration indefinitely.                  |
| Move `apps/desktop/src/shared` wholesale        | That directory mixes portable product contracts with Desktop IPC and provider-specific data.             |
| Perform a big-bang caller migration             | Hundreds of existing imports make behavior regressions and ownership mistakes difficult to isolate.      |

## References

- [Continuous Android parity contract](./continuous-parity-contract.md)
- [Desktop parity inventory](./desktop-parity-inventory.md)
- [Android feasibility for Desktop capability parity](./android-full-parity-feasibility.md)
- [Twitch and Kick integration constraints](./2026-08-29-android-twitch-kick-integration-constraints.md)
- [StreamFusion Mobile context](./CONTEXT.md)
- [StreamFusion context map](../../../CONTEXT-MAP.md)
