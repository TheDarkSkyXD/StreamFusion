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
| `src/composition/`  | Construction and dependency injection                                |
| `modules/`          | Narrow Expo module bridges. Kotlin modules expose typed Android contracts. |
| `tests/`            | Mobile tests and fixtures                                            |

## Import policy

ESLint classifies each production file and rejects reverse imports. Routes import the Mobile composition root. Features consume capabilities, design code, Mobile foundations, and public core contracts. Concrete adapters import the ports they implement. Production code cannot import test support, Node or Electron APIs, another app's source, core internals, or provider and native APIs from UI code.

The architecture verifier creates temporary imports for every layer. It proves both allowed dependencies and forbidden alias, relative, dynamic, and CommonJS paths. The normal Mobile test command runs this verifier.

## State ownership

TanStack Query owns remote request state. The Product Store owns durable StreamFusion records. The Cache Store owns disposable provider results. Zustand owns presentation-only state. Android services own recoverable background media work. A new state owner needs a projection and reconciliation rule before it duplicates existing state.

## Encrypted persistence

`src/features/storage/composition/store-runtime.ts` opens independently keyed SQLCipher Product and Cache databases. Database keys are generated with `expo-crypto` and held by `expo-secure-store`; the encrypted pre-migration Product backup has its own key. Product migrations run transactionally after integrity checks. A failed migration or integrity check preserves a quarantine artifact and restores the encrypted backup when possible; a missing Product key never causes automatic deletion. Cache data is disposable, expires after seven days by default, and is evicted expired-first and then least-recently-used to a 256 MiB target.

Storage adapters import Expo secret, random, file, and SQLite APIs. The `native-contracts` feature owns typed TypeScript ports, adapters, proof, and composition. Its Kotlin Expo modules remain under `modules/streamfusion-native-contracts`. Diagnostics contract version 2 measures runtime, decoder inventory, memory, storage, thermal status, and form-factor facts. It does not qualify playback capacity. The remaining native contracts stay version 1 stubs until their feature tickets implement them. The `capability-profile` feature turns those facts into an API, ABI, and form-factor candidate plus a visible degradation projection. It confirms the serialized current snapshot through the Product Store, but only as history. A restart starts fresh sampling and never restores workload admission or runtime protection. Admissions remain unexercised until playback, captions, recording, and downloads exist. Its sampler runs only while foregrounded, serializes measurement and persistence, samples every 30 seconds normally and every 120 seconds under any degradation, and cancels its timer on background or disposal. The cadence, reserve, and hysteresis values are provisional local safeguards, not qualification thresholds. This polling-only unit does not claim immediate thermal response: a pressure change can wait until the next foreground sample. Expo Go does not ship StreamFusion's SQLCipher native configuration, so initialization fails closed before a persistent file is opened and Diagnostics explains that a development client is required. Android backup is disabled for all app-owned data. The Diagnostics proof uses isolated namespaces and removes its databases, sidecars, quarantine artifacts, and secrets in a `finally` path.

The [Mobile domain language](../../docs/research/streamfusion-mobile/CONTEXT.md) defines the parity and release terms used by this client.
