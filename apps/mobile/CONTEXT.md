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

Storage adapters import Expo secret, random, file, and SQLite APIs. The `native-contracts` feature owns typed TypeScript ports, adapters, proof, and composition. Its Kotlin Expo modules remain under `modules/streamfusion-native-contracts`. Diagnostics contract version 3 measures runtime, decoder inventory, memory, storage, thermal status, and form-factor facts. It does not qualify playback capacity. Media Jobs is a version 3 native contract: the Kotlin module owns the journal, media files, and foreground service, and JavaScript owns Product Store snapshots plus Activity rows. Playback contract version 5 owns Media3 sessions, program-audio taps, muted starts, and system PiP. Caption contract version 4 owns offline Vosk recognition. It downloads and verifies the 39.30 MiB English model once, accepts only the selected playback session's decoded PCM, and stops under low memory or severe thermal pressure. Diagnostic fixtures remain isolated and never supply production transcripts. Captions require a rebuilt Android native client; Expo Go cannot provide this audio tap. Maintenance remains a version 1 stub. The `capability-profile` feature turns those facts into an API, ABI, and form-factor candidate plus a visible degradation projection. It confirms the serialized current snapshot through the Product Store, but only as history. A restart starts fresh sampling and never restores workload admission or runtime protection. Multistream admission checks current native low-memory and severe-thermal facts before adding a player; these safeguards do not qualify device capacity. Caption resource checks also run while audio is arriving. Its sampler runs only while foregrounded, serializes measurement and persistence, samples every 30 seconds normally and every 120 seconds under any degradation, and cancels its timer on background or disposal. The cadence, reserve, and hysteresis values are provisional local safeguards, not qualification thresholds. This polling-only unit does not claim immediate thermal response: a pressure change can wait until the next foreground sample. Expo Go does not ship StreamFusion's SQLCipher native configuration. In that host the Product Store opens plain expo-sqlite and seals settings and Activity payloads with app-layer tweetnacl secretbox (key in SecureStore). Diagnostics labels this as app-layer secretbox. An existing SQLCipher Product file still fails closed without rewriting it. System Picture-in-Picture is unavailable in Expo Go. Navigating away from Watch keeps playback in the floating JS mini-player. Remote FCM push tokens are not requested in Expo Go on Android; local live alerts use expo-notifications and honor LiveNotificationPreferences. Android backup is disabled for all app-owned data. The Diagnostics proof uses isolated namespaces and removes its databases, sidecars, quarantine artifacts, and secrets in a `finally` path.

The [Mobile domain language](../../docs/research/streamfusion-mobile/CONTEXT.md) defines the parity and release terms used by this client.

The [Android app updates reference](UPDATES.md) records the in-app update flow and release metadata contract.


## Expo Go testing

The in-app mini-player supports one-finger dragging and two-finger resizing,
keeps its 16:9 shape, and stays inside the workspace above navigation. Its
position and size survive expansion and PiP return for the current stream.
The Android native client automatically enters system Picture-in-Picture
when leaving the app during playback. Paused or failed streams do not auto-enter.
Android owns movement and resizing of the system PiP window; pinch resizing
requires Android 12 or newer. Rebuild the native client for these PiP changes.

Custom Twitch ad blocking uses the native Media3 player's playlist interception.
It requests alternative Twitch player tokens, verifies clean backup renditions,
and holds unsafe media when no clean backup is available. Enabling it disables
the Twitch playlist proxy. The player shield appears only for enabled custom
blocking on Twitch live streams. Canary observation does not show the shield.
Expo Go cannot intercept playlists and shows the custom blocker as unavailable;
playlist proxy settings remain available there. Rebuild the Android development
client after changing the native blocker.

From `apps/mobile`:

```bash
npm start
```

Open the printed `exp://LAN:8081` URL in Expo Go on Android. Prefer the LAN URL form `exp://192.168.x.x:8081`. Use `npm run start:dev-client` only when loading a custom development APK that includes SQLCipher and native modules.

## Mobile workflows

Authenticated chat, recorded replay, moderation, engagement, and multistream own feature roots. Provider-neutral ports isolate Twitch and Kick APIs from UI and domain rules. Production token access refreshes the connected account and checks scopes for each operation; development account fixtures cannot authorize provider writes. Viewer voting and wagers open the provider. Unsupported Kick moderation and engagement operations display an explicit handoff. Storybook renders the production components with deterministic transports. See [workflow architecture](../../docs/research/streamfusion-mobile/workflow-architecture.md) and [caption recognition evidence](../../verification/evidence/mobile-local-captions/README.md).
