# StreamFusion Mobile runtime

The Android client uses Expo Router and React Native. Portable product rules and contracts remain in the public `@streamfusion/core` subpaths.

## Runtime flow

```text
app route
  -> src/composition/mobile-runtime.tsx
  -> feature controller and UI
  -> core or Mobile capability
  -> transport, adapter, persistence, or native implementation
```

`src/composition/mobile-runtime.tsx` is the application composition root. It constructs concrete implementations and injects them into consumers. It contains no product policy, retries, provider normalization, or persistence rules.

## Source ownership

| Path                | Responsibility                                                       |
| ------------------- | -------------------------------------------------------------------- |
| `app/`              | Expo Router declarations that call the composition root              |
| `src/features/`     | Screens, presentation, hooks, and controllers                        |
| `src/design/`       | Mobile design tokens and reusable presentation elements              |
| `src/foundations/`  | Stable Mobile-only contracts and utilities                           |
| `src/capabilities/` | Mobile-owned ports for runtime and device operations                 |
| `src/transport/`    | Provider and Integration Relay clients                               |
| `src/adapters/`     | Concrete implementations that normalize transport or native behavior |
| `src/persistence/`  | Product Store, Cache Store, migrations, and repositories             |
| `src/native/`       | Restricted Expo and Android API bridges                              |
| `src/composition/`  | Construction and dependency injection                                |
| `modules/`          | Narrow Kotlin Expo modules                                           |
| `tests/`            | Mobile tests and fixtures                                            |

## Import policy

ESLint classifies each production file and rejects reverse imports. Routes import the Mobile composition root. Features consume capabilities, design code, Mobile foundations, and public core contracts. Concrete adapters import the ports they implement. Production code cannot import test support, Node or Electron APIs, another app's source, core internals, or provider and native APIs from UI code.

The architecture verifier creates temporary imports for every layer. It proves both allowed dependencies and forbidden alias, relative, dynamic, and CommonJS paths. The normal Mobile test command runs this verifier.

## State ownership

TanStack Query owns remote request state. The Product Store owns durable StreamFusion records. The Cache Store owns disposable provider results. Zustand owns presentation-only state. Android services own recoverable background media work. A new state owner needs a projection and reconciliation rule before it duplicates existing state.

The [Mobile domain language](../../docs/research/streamfusion-mobile/CONTEXT.md) defines the parity and release terms used by this client.
