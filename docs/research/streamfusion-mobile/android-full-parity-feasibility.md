# Android feasibility for Desktop capability parity

- Status: resolved research for [issue 97](https://github.com/TheDarkSkyXD/StreamFusion/issues/97)
- Research date: 2026-08-29
- Desktop source baseline: `0cab576480b757579e1c9affe168d7521ea10c18`

## Decision summary

Android-equivalent parity is feasible, but a JavaScript-only Expo port is not. StreamFusion should use Expo for the Android application shell and product UI, Kotlin Expo modules for media-specific capabilities, and trusted services for Kick OAuth secrets and timely Live Notifications.

Literal implementation parity is neither feasible nor desirable in three areas:

- Android cannot guarantee six concurrent video decoders on every supported device.
- Android 15 [limits some foreground-service work while an app is in the background](https://developer.android.com/develop/background-work/services/fgs/timeout), so indefinite unattended recording cannot be guaranteed.
- Android cannot expose Electron's process topology, process controls, or broad system diagnostics to a regular application.

These limits still permit equivalent user outcomes if the product adopts capability-based Multistream degradation, visible and recoverable media jobs, and Android-native diagnostics. Live Notifications require server-originated push rather than background polling.

## Capability matrix

The Desktop evidence is organized by the current [feature map](../../../.agents/skills/streamfusion-feature-map/references/features.md) and [Desktop context](../../../apps/desktop/CONTEXT.md).

| Capability | Current Desktop mechanism | Android-equivalent mechanism | Feasibility and limits |
| --- | --- | --- | --- |
| Shell and navigation | Electron window, React Router, Zustand, React DOM | Expo Router, React Native, Android back handling, adaptive native layouts | Feasible. Share domain state and contracts, not DOM components. |
| Discovery and search | Unified platform readers behind preload and IPC | Direct `fetch` adapters from the mobile client, TanStack Query, shared DTO validation and normalization | Feasible. React Native has no browser CORS restriction. Some Kick paths still depend on legacy endpoints and browser-like headers, so real-device contract tests and a remotely configurable fallback are required. |
| Follows | Twitch and Kick provider APIs through the unified client | The same provider operations through mobile HTTP adapters using securely stored tokens | Feasible within each provider's scopes and API behavior. |
| Live and VOD playback | Twitch and Kick HLS resolvers, `hls.js`, HTML video, Electron network interception | AndroidX Media3 HLS in a Kotlin Expo module; Expo/React Native controls over a native player surface | Feasible. Media3 supports live HLS, adaptive variants, subtitles, custom data sources, and analytics. Stock `expo-video` is suitable for a basic playback milestone, but it does not expose all hooks needed for proxying, playlist rewriting, ad filtering, decoded PCM capture, and reliable multi-player control. |
| Clips | Provider clip URLs and HTML video | Media3 or `expo-video`, depending the resolved media URL | Feasible. Provider URL expiry and authentication behavior remain provider concerns. |
| Picture-in-picture and background playback | Chromium picture-in-picture and an always-running Electron process | Android picture-in-picture plus a Media3 `MediaSessionService` foreground service | Feasible. Only one player should own picture-in-picture and background audio. Android requires the correct foreground-service permissions and a visible notification. |
| Proxy and ad filtering | Electron session proxy, request interception, manifest and playlist rewriting, VAFT rules | Custom Media3 `DataSource`, URI/manifest transforms, request headers, and app-scoped proxy configuration in the native player module | Feasible but native and high-risk. It is not a configuration toggle on stock Expo video. Provider and stream-format changes require contract tests and telemetry. |
| Chat, emotes, and engagement | Twitch Hermes WebSocket, Kick Pusher channels, provider send/action APIs, renderer chat UI | Foreground React Native WebSockets or a native socket adapter, provider HTTP actions, local emote cache, Android-native chat UI | Feasible while the app is active. Sockets must reconnect after suspension or network change; background chat continuity is not a reliable Android guarantee. |
| Authentication | Twitch Device Code flow; Kick browser authorization and localhost callback; Worker exchanges Kick codes and refreshes tokens | Twitch Device Code flow; Android browser authorization with PKCE and a verified App Link or custom scheme; SecureStore for refresh material; trusted Worker for Kick exchange/refresh | Feasible. Kick requires a client secret during token exchange, so that secret must never ship in the APK. The current Worker callback allowlist only accepts Desktop localhost callbacks and must be extended deliberately for Android. |
| Live Notifications | Desktop interval polling, Twitch EventSub source, Electron notifications | Provider webhooks or durable provider connections in a trusted service, then FCM or Expo Push Service; local notification preferences remain device-local | Feasible only with a trusted push service. [WorkManager's inexact minimum interval](https://docs.expo.dev/versions/latest/sdk/background-task/) and socket suspension cannot provide timely live alerts. Android 13 also [requires notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission/), and force-stopped applications do not receive notifications until reopened. |
| Multistream | One Electron `WebContentsView` per slot, up to six slots, draggable React layout | Multiple Media3 player instances with one audio owner, lifecycle-aware pause/release, adaptive quality reduction, and a native player grid | Conditionally feasible. Android reports only an [upper-bound estimate for concurrent codec instances](https://developer.android.com/reference/android/media/MediaCodecInfo.CodecCapabilities#getMaxSupportedInstances()), and actual availability may be lower. The app must measure capability and degrade to lower quality, audio-only, or paused thumbnails. Six simultaneously decoded videos cannot be guaranteed on every device. |
| Downloads | Electron networking and FFmpeg-backed HLS or direct-file jobs | Media3 `DownloadService` for in-app offline HLS; Android `DownloadManager` for stable direct files; native remux/export job plus Storage Access Framework when a portable media file is required | Feasible. App-private offline cache is much simpler than exporting a single MP4. Export and remux need native work, free-space checks, cancellation, and recoverable job state. |
| Recording | Long-running bundled FFmpeg process, reconnect, pause/resume, section finalization, partial recovery | Native Media3 or FFmpeg-based segmented recording service, persistent SQLite journal, foreground notification, partial-section recovery, and explicit export | Conditionally feasible. On Android 15, each of the `dataSync` and `mediaProcessing` types has a separate six-hour background budget per 24 hours, shared by all services of that type. Unbounded unattended recording is therefore not a portable guarantee. |
| History | Local SQLite rows and renderer stores | `expo-sqlite` with WAL, schema migrations, repository ports, and app-private files | Feasible and consistent with device-local data. No cloud synchronization is implied. |
| Moderation | Provider moderation actions, local moderation log and retention database, moderator React pages | Provider API adapters, SQLite moderation log, scoped native mobile workflows | Feasible where provider APIs expose the operation. Existing Twitch/Kick capability differences remain. |
| Captions | Browser `AudioWorklet` captures decoded program audio; Electron utility process runs `sherpa-onnx-node` with a local model | Media3 audio processor taps decoded PCM; a Kotlin module invokes sherpa-onnx Android; native subtitle overlay and local model manager | Feasible with a custom player module and a performance spike. Microphone permission is not needed when program audio is tapped inside the player. Stock Expo video does not expose this decoded PCM path. |
| Settings | Electron and platform settings for behavior, appearance, buffer, ad filtering, proxy, accounts, diagnostics, and updates | React Native settings grouped around Android capabilities, shared validated domain settings, SecureStore for secrets, SQLite or app preferences for non-secrets | Feasible. Desktop-only concepts must be translated to their Android outcome rather than copied as inactive controls. |
| Diagnostics and bug reports | Electron process metrics, process lists, logs, traces, performance counters, diagnostic actions, report bundle | App-owned structured logs, redacted report bundles, Media3 analytics, `Debug` memory data, ANR and `ApplicationExitInfo` history, job/player health and recovery actions | Equivalent support outcome is feasible; exact parity is not. Since Android Q, a regular app can [retrieve process memory information only for its own UID](https://developer.android.com/reference/android/app/ActivityManager). Production logcat is also [unavailable to ordinary apps](https://developer.android.com/privacy-and-security/risks/log-info-disclosure), so StreamFusion must maintain its own sanitized file logs. |
| Maintenance and updates | `electron-updater`, process restart, log access, local recovery | Signed GitHub APK check, download, system package-installer handoff, migration/recovery screens, optional EAS Update for compatible JavaScript and assets | Feasible with user participation. Android does not allow a GitHub-distributed app to silently replace itself. Every APK update must use the [same signing certificate](https://developer.android.com/studio/publish/app-signing). [EAS Update runtime compatibility](https://docs.expo.dev/eas-update/runtime-versions/) means native modules, permissions, or the native runtime still require a new APK. The project should prepare package registration and identity verification for Android's [2027 global verification rollout](https://developer.android.com/developer-verification/guides); otherwise users will need the advanced sideloading flow for unregistered apps. |

## Required architecture

The Android client should preserve the repository's dependency direction: product UI calls application use cases, use cases depend on capability ports, and platform adapters implement those ports.

| Boundary | Ownership |
| --- | --- |
| Shared core | Platform-neutral domain types, provider-normalized DTOs, validation, capability contracts, settings rules, history and moderation use cases, chat event normalization, and test fixtures extracted from Desktop before mobile implementation |
| Expo Android app | Expo Router shell, React Native feature UI, query/cache coordination, permissions, deep links, foreground lifecycle, SQLite repositories, SecureStore adapter, and provider HTTP/WebSocket adapters |
| Kotlin Expo modules | Media3 playback and Multistream engine, custom networking and manifest transforms, decoded PCM caption bridge, durable recording/download jobs, foreground services, native diagnostics, and APK installer handoff |
| Trusted services | Existing Kick OAuth code/refresh exchange, Android callback validation, Live Notification subscriptions and provider event ingestion, push-token registration, and FCM or Expo push delivery |

This boundary avoids moving Electron, DOM, Node process, or filesystem assumptions into shared code. Transport errors should be translated at the adapter boundary so application code receives stable domain failures rather than Electron IPC, React Native networking, or Kotlin exceptions.

## Android constraints and permissions

The expected Android manifest surface is:

- `INTERNET` for provider APIs, HLS, chat, models, and updates.
- `POST_NOTIFICATIONS` at runtime on Android 13 and later.
- `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK` for background audio and picture-in-picture ownership.
- The applicable data-sync or media-processing foreground-service types for recording and media export. Their Android 15 time budgets must be designed into the job model.
- Storage Access Framework or MediaStore user grants for exported files. Broad storage permission should not be needed when source data remains app-private.
- No microphone permission for local captions if PCM comes from the Media3 playback pipeline.
- Package installation permission only if StreamFusion initiates installation directly. Opening a downloaded APK in the system installer is a simpler, more transparent maintenance path.

The application should assume battery optimization, OEM process killing, notification denial, network switching, and force-stop. Every long-lived operation must be resumable or fail with a recoverable partial artifact.

## Performance and reliability gates

Implementation should not begin with all product screens. First prove the platform risks on representative low, mid, and high Android devices:

1. Resolve and play current Twitch and Kick live, VOD, and clip URLs over Wi-Fi and mobile data.
2. Sustain one through six Media3 players while recording decoder count, dropped frames, memory, thermal pressure, and battery use.
3. Exercise custom headers, proxy routing, playlist rewriting, ad-filter behavior, and provider URL refresh.
4. Capture decoded 16 kHz mono PCM and run the selected sherpa-onnx model without destabilizing playback.
5. Record and recover segmented HLS across backgrounding, network loss, process death, device reboot, storage exhaustion, and Android 15 foreground-service timeout.
6. Prove Kick App Link authentication through an expanded Worker callback policy without embedding a client secret.
7. Prove end-to-end provider event to FCM/Expo push delivery, including token rotation, permission denial, duplicate events, and force-stop behavior.

The moving Desktop parity baseline also needs an automated capability ledger. Each Desktop feature addition should state whether it changes shared core, Desktop-only adapters, Android adapters, or both; otherwise Android parity becomes an unbounded manual audit.

## Decisions still required

1. Is Multistream parity defined as up to six active videos when the device supports them, with quality/audio/thumbnail degradation on constrained devices? This is the recommended contract; six active decoders on every device is not achievable.
2. Is a visible, resumable recording job with an explicit supported duration acceptable? Indefinite unattended background recording is not a defensible Android promise.
3. Are downloads primarily in-app offline media, or must every download be exported as a portable file? Recommend in-app storage with an explicit Export action.
4. Can diagnostics be defined by the support outcome, using app-owned logs and Android health data, instead of duplicating Electron process controls? Recommend yes.
5. Should Android OAuth return through a verified HTTPS App Link or a custom URI scheme? Recommend a verified App Link and a narrowly validated Worker callback.
6. May compatible JavaScript and asset fixes use EAS Update while native releases remain signed GitHub APKs, or must every release be a GitHub APK? EAS Update reduces APK churn but requires a separate update policy.
7. What Android API floor and minimum device performance tier will StreamFusion support? The answer determines realistic Multistream, captions, and recording guarantees.
8. Will StreamFusion complete Android Developer Console identity and package verification for GitHub distribution before the 2027 global rollout, or accept the more difficult unregistered-app sideloading flow? Recommend verification.

## Primary sources

Repository evidence:

- [Twitch stream resolver](../../../apps/desktop/src/backend/api/platforms/twitch/twitch-stream-resolver.ts)
- [Kick stream resolver](../../../apps/desktop/src/backend/api/platforms/kick/kick-stream-resolver.ts)
- [Stream proxy service](../../../apps/desktop/src/backend/services/stream-proxy-service.ts)
- [Multistream slot controller](../../../apps/desktop/src/backend/api/unified/slot-controller.ts)
- [FFmpeg download service](../../../apps/desktop/src/backend/services/ffmpeg-download-service.ts)
- [Stream recording service](../../../apps/desktop/src/backend/services/stream-recording-service.ts)
- [Live Notification service](../../../apps/desktop/src/backend/services/live-notification-service.ts)
- [Desktop caption audio capture](../../../apps/desktop/src/frontend/features/playback/components/player/local-audio-capture.ts)
- [Desktop caption recognizer](../../../apps/desktop/src/backend/utility/caption-recognizer.ts)
- [Desktop diagnostics runtime](../../../apps/desktop/src/backend/diagnostics/diagnostics-runtime.ts)
- [Kick OAuth Worker](../../../apps/worker/src/index.ts)

Expo and Android:

- [Expo BackgroundTask](https://docs.expo.dev/versions/latest/sdk/background-task/)
- [Expo notifications overview](https://docs.expo.dev/push-notifications/overview/)
- [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Expo Video](https://docs.expo.dev/versions/latest/sdk/video/)
- [Expo AuthSession](https://docs.expo.dev/versions/latest/sdk/auth-session/)
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/)
- [Expo native modules](https://docs.expo.dev/modules/overview/)
- [EAS Update runtime versions](https://docs.expo.dev/eas-update/runtime-versions/)
- [EAS APK builds](https://docs.expo.dev/build-reference/apk/)
- [Android Media3 HLS](https://developer.android.com/media/media3/exoplayer/hls)
- [Android Media3 customization](https://developer.android.com/media/media3/exoplayer/customization)
- [Android Media3 background playback](https://developer.android.com/media/media3/session/background-playback)
- [Android Media3 offline downloads](https://developer.android.com/media/media3/exoplayer/downloading-media)
- [Android codec instance capability](https://developer.android.com/reference/android/media/MediaCodecInfo.CodecCapabilities#getMaxSupportedInstances())
- [Android foreground-service start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
- [Android foreground-service timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout)
- [Android persistent work](https://developer.android.com/develop/background-work/background-tasks/persistent)
- [Android Storage Access Framework](https://developer.android.com/guide/topics/providers/document-provider)
- [Android notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission)
- [Android application process visibility](https://developer.android.com/reference/android/app/ActivityManager)
- [Android ANR diagnostics](https://developer.android.com/topic/performance/vitals/anr)
- [Android log disclosure guidance](https://developer.android.com/privacy-and-security/risks/log-info-disclosure)
- [Android app signing](https://developer.android.com/studio/publish/app-signing)
- [Android developer verification](https://developer.android.com/developer-verification/guides)
- [sherpa-onnx Android](https://k2-fsa.github.io/sherpa/onnx/android/prebuilt-apk.html)

Providers:

- [Twitch OAuth flows](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/)
- [Twitch EventSub WebSocket behavior](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/)
- [Kick OAuth flow](https://github.com/KickEngineering/KickDevDocs/blob/main/getting-started/generating-tokens-oauth2-flow.md)
- [Kick OAuth scopes](https://github.com/KickEngineering/KickDevDocs/blob/main/scopes/scopes.md)
