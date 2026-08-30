# StreamFusion Mobile implementation specification

Status: Draft for approval in [GitHub issue #107](https://github.com/TheDarkSkyXD/StreamFusion/issues/107)

Target: Android 11 and newer

Distribution: Signed APK through immutable GitHub Releases

## 1. Purpose

StreamFusion Mobile is the Android companion to the existing Desktop application. It must deliver the same user outcomes as Desktop while using Android-native interaction, lifecycle, storage, media, security, and release behavior.

This document is the integrated implementation contract. It combines the approved parity policy, shared-core extraction, Android architecture, Platform boundaries, navigation, persistence, background behavior, native capabilities, notification delivery, verification, signing, and release model. After approval, implementation tickets must preserve these decisions unless a later explicit decision supersedes them.

The words **must**, **must not**, **should**, and **may** are normative.

## 2. Source of truth and conflict order

Implementation must resolve conflicts in this order:

1. The generated Desktop parity ledger at the implementation commit.
2. A later approved GitHub decision that explicitly supersedes an earlier decision.
3. This specification.
4. The linked research and design documents.

The parity ledger is generated from Desktop behavior. It is not a manually frozen checklist. A Desktop capability added or materially changed after this document is approved creates an Android parity obligation before the next public Android release.

The notification design in section 12 supersedes earlier references to the Expo Push Service. The app uses `expo-notifications`, but the Integration Relay sends directly through FCM HTTP v1 to native Android tokens and topics.

## 3. Product boundary

### 3.1 Included

- One Android application built with Expo and React Native.
- Twitch and Kick discovery, accounts, viewing, chat, moderation, media, settings, diagnostics, and release behavior corresponding to the 24 Desktop capability contracts.
- A portable shared core consumed by Desktop, Android, and trusted services.
- The existing token-only Kick OAuth Worker.
- A separate Integration Relay for signed-out official reads, provider webhooks, foreground Kick chat fanout, signed capability policy delivery, and Android push.
- Device-local encrypted product state, bounded cache state, and app-private media.
- Native Android services or modules where JavaScript-only execution cannot satisfy the contract.

### 3.2 Excluded from 1.0

- iOS, Android TV, ChromeOS-specific support, Android Auto, Wear OS, 32-bit Android, and public x86 Android builds.
- Google Play distribution, mandatory updates, and production EAS Update delivery.
- Cloud synchronization of settings, history, downloads, recordings, or Guest Follows.
- Firebase products other than FCM registration and delivery.
- A general StreamFusion account, general provider proxy, server-side user credential store, or hosted chat-history archive.
- Guaranteed per-device push receipt.

## 4. Continuous parity contract

Every Desktop capability must have one Android parity record with these fields:

- stable Desktop capability ID;
- Desktop outcome and current evidence anchors;
- Android outcome and adaptation class;
- implementation owner and state;
- required automated, emulator, physical-device, live-provider, and human evidence;
- current evidence IDs and expiry;
- blocking reason when not release-ready.

The allowed adaptation classes are:

- **Equivalent**: the Android interaction differs, but the user outcome is the same;
- **Android-native**: Android supplies a better native expression of the same outcome;
- **Compatibility Integration**: a parity-critical outcome uses an isolated, non-public provider contract under the policy in section 11;
- **Unavailable**: allowed only when an approved capability decision permits it. A required unavailable outcome blocks release.

Parity status is computed from the generated ledger and evidence catalog. Documentation claims cannot override a failed predicate. Temporary development exceptions must identify an owner, reason, expiry, and affected capability. An exception or quarantined test blocks public release.

## 5. Capability placement

The current Desktop baseline contains 24 top-level capability contracts. The generated ledger remains authoritative for their detailed facts.

| Capability ID | Required Android outcome | Primary placement and mechanism |
| --- | --- | --- |
| `home-live-discovery` | Browse live streams, channel cards, and Platform availability. | Home under More; cards use 16:9 thumbnails, channel avatars, Platform badges, live state, and viewer metadata. |
| `followed-streams-and-sync` | View followed live channels, maintain Guest Follows, and import provider follows where supported. | Following tab with bottom floating search. Account follow writes become Guest Follow plus provider-page action when no official write API exists. |
| `category-discovery` | Browse categories and the streams, videos, and clips within a selected category. | Categories under More; 3:4 art opens Category Detail. Both screens use a bottom floating search field and every approved tab state. |
| `search` | Search channels, streams, videos, clips, and categories across Platforms. | Search tab with history, filters, bottom floating field, and All, Channels, Streams, Videos, Clips, and Categories tabs. |
| `platform-account-auth` | Connect, validate, refresh, scope-check, and disconnect Twitch and Kick. | Accounts in More and Settings. Twitch uses Device Code. Kick uses browser PKCE, a verified App Link, and the token-only Worker. |
| `live-playback` | Resolve and play Twitch and Kick live streams with visible compatibility state. | Watch tab, native player adapter, and isolated Platform playback-source adapters. |
| `vod-and-clip-playback` | Open and play videos and clips with correct metadata and history typing. | Watch routes launched from Search, Category Detail, History, and channel content tabs. |
| `player-controls-and-pip` | Provide transport, quality, volume, fullscreen, orientation, movable mini-player, and Android PiP. | Watch; in-app movable mini-player during navigation and system PiP when leaving the app. |
| `stream-recording` | Record supported playback into a recoverable, segmented local media job. | Contextual Watch action; job progress and results appear in Activity and Android notifications. |
| `local-captions` | Produce one real-time local caption session without uploading microphone or playback audio. | Watch overlay backed by a native caption module and visible resource state. |
| `ad-blocking` | Apply the approved Desktop-equivalent playback filtering outcome where technically available. | Playback-source and player adapters, never screen code; failure degrades only playback and is surfaced in Watch diagnostics. |
| `live-chat` | Receive and send live chat, show badges and emotes, and preserve focused-stream behavior. | Watch chat surface. Twitch uses foreground EventSub and direct Helix send. Kick receive uses the relay; send is direct official API. |
| `emotes-and-cosmetics` | Resolve Platform and approved third-party emotes, badges, paints, and display metadata. | Chat rendering and settings, backed by shared models and bounded caches. |
| `chat-replay` | Show synchronized replay where a validated source exists. | Video or clip Watch route. Compatibility sources are isolated and fail only this capability. |
| `moderation` | Execute authorized moderation, polls, predictions, pins, and managed-channel workflows. | Moderation under More, contextual chat actions, and all child tab states. Official endpoints are preferred; approved gaps follow section 11. |
| `multistream` | Configure and watch multiple simultaneous StreamSlots with one focused audio and chat context. | Multistream entry under More opens Watch. Up to six slots may be configured; the capability profile controls active video count. |
| `watch-history` | Record and browse watched items with an explicit Stream, Video, or Clip type. | History under More. Rows include thumbnail, avatar, Platform, type, timestamp, progress where applicable, and resume or replay action. |
| `downloads` | Download supported videos or clips, inspect progress, retry, cancel, delete, and explicitly export. | Contextual Watch action; active and completed jobs appear in Activity. There is no standalone Downloads or Media Library screen. |
| `general-chat-and-theme-preferences` | Configure appearance, chat behavior, playback behavior, and related preferences. | Settings under More, using the complete Desktop-derived settings panel set and Android-native controls. |
| `proxy-and-connectivity` | Configure supported proxy and network behavior and explain active restrictions. | Settings and Diagnostics. Network adapters own application; screens only present state and actions. |
| `notifications` | Configure live alerts and receive reconciled Activity events in foreground, background, and terminated cases allowed by Android. | Activity tab, notification settings, `expo-notifications`, native FCM tokens, and Integration Relay delivery. |
| `app-updates` | Check, validate, download, and hand a newer signed APK to Android's installer with user consent. | Settings and update prompt backed by the native updater module and GitHub Release metadata. |
| `diagnostics-logs-and-bug-reports` | Inspect status, logs, capabilities, storage, network, jobs, and sanitized reports. | Diagnostics under More with all six approved tabs and Android-native collection. |
| `app-shell-and-navigation` | Reach every capability through a stable Android-native shell without persistent Desktop chrome. | Five top-level destinations: Search, Following, Watch, Activity, More; adaptive navigation rail on wider windows. |

## 6. Navigation and visual contract

### 6.1 Top-level shell

The compact Android shell has exactly five static destinations:

1. Search
2. Following
3. Watch
4. Activity
5. More

Phones use bottom navigation. Wider tablet and unfolded layouts use an adaptive navigation rail while preserving the same destinations, state, and route identity. Home is not a bottom destination. It is the first entry in More, followed by Categories, Multistream, History, Moderation, Settings, Diagnostics, and Accounts or Maintenance.

There is no persistent branded footer, currently-playing strip, or other bottom element on every screen. Active viewing is represented by the movable mini-player, the Watch destination, or Android PiP.

### 6.2 Search behavior

The main Search screen includes recent search history, Platform and content filters, and the All, Channels, Streams, Videos, Clips, and Categories result tabs. Search fields on Search, Categories, Category Detail, Following, managed-channel surfaces, and Settings float above content at the bottom of the current screen. They must account for keyboard and safe-area insets and must not hide the final result row.

The bottom field expands in place, exposes clear and submit actions, preserves the current filter context, and can be dismissed without losing the current result set. It is a local overlay, not a sixth navigation destination.

### 6.3 Content identity

- Channel and creator surfaces show avatars.
- Stream, video, and clip rows show 16:9 thumbnails.
- Category rows show 3:4 category artwork.
- Platform, live state, duration or viewer count, and content type remain visible where they disambiguate an item.
- Selecting a category opens that category's detail route rather than applying an invisible filter.
- History identifies every entry as Stream, Video, or Clip.

### 6.4 Watch and mini-player

Watch supports live streams, videos, clips, chat, and multistream layouts. When the user navigates within StreamFusion while media is playing, the player may collapse into a movable in-app mini-player. The user can drag it among safe snap regions, expand it back to Watch, pause or close it, and navigate without restarting playback.

When the app leaves the foreground and the user permits it, a single focused stream may enter Android Picture-in-Picture. The in-app mini-player and Android PiP are mutually exclusive representations of the same playback session.

### 6.5 Settings, diagnostics, and tabs

The implementation must expose all 17 settings panels: Appearance, Playback, Notifications, Player controls, Buffer, Multiview, Chat, Ad blocking, Proxy, Predictions, Integrations, API tokens, Updates, Diagnostics, Logs, Report a bug, and About.

It must also expose these 40 directly testable tab states:

- Search: All, Channels, Streams, Videos, Clips, Categories.
- Following: Live, Videos, Clips, Categories, Channels.
- Category Detail: Live Streams, Clips, Videos.
- Channel Detail: Home, Videos, Clips.
- Watch: Chat, Info, Related.
- Video or Clip: Details, Comments, Related.
- Activity: All, Channels, Jobs.
- Moderation: Chat, Retention, Mod log, Banned, Engagement, Unban, Moderators, VIPs.
- Diagnostics: Overview, Resources, I/O, Traces, Logs and reports, Developer tools.

Tabs may be adapted into native segmented controls, top tabs, or nested routes, but no content state may disappear. Each state requires a stable test selector or routeable review scenario. The generated parity ledger and navigation inventory together define completeness.

### 6.6 Design system

Mobile uses the existing Dark Theater design language in [DESIGN.md](../../../DESIGN.md): Void Black and tonal surfaces establish depth, Storm Crimson is reserved for live and critical states, and Twitch Purple or Kick Green identify only their Platforms. Resting surfaces have no shadows. Touch targets are at least 48 dp. Text and controls meet WCAG AA contrast, support 200 percent font scaling, TalkBack, reduced motion, and Android system insets.

## 7. Device and capability policy

### 7.1 Supported installation profile

- Android 11, API 30, or newer.
- `arm64-v8a` for physical production devices.
- `x86_64` for emulator verification only.
- Touch phones, tablets, and foldables.
- Google Play services are required for FCM notifications, but the rest of the application must report notification unavailability without disabling unrelated capabilities.

Installation support does not imply maximum simultaneous media capacity. At first launch and after relevant environment changes, the app derives a measured capability profile from device, decoder, memory, thermal, storage, and runtime observations.

### 7.2 Lowest qualified profile

The lowest Parity-Qualified profile must support:

- two active live video surfaces with one focused audio source;
- one 43.11 MiB English local-caption model and one caption session;
- segmented recording with safe finalization and recovery;
- app-private downloads plus explicit export;
- complete diagnostics;
- visible performance, storage, and thermal state.

Higher profiles may allow three through six active videos. Multistream may retain up to six configured slots even when the device renders fewer active videos.

### 7.3 Runtime degradation

Degradation is ordered, visible, and reversible with hysteresis. It must preserve the focused task and recoverable artifacts. The order is:

1. reduce background refresh and nonessential animation;
2. lower nonfocused stream quality or frame rate;
3. replace nonfocused video with periodically refreshed thumbnails;
4. pause nonfocused decoders while retaining StreamSlots;
5. protect the focused player, recording finalization, and Product Store writes.

The UI must explain the active limitation and the recovery condition. It must not silently remove a StreamSlot or corrupt an active media job.

## 8. Workspace and shared-core architecture

### 8.1 Target workspace

The repository must converge on one root npm workspace and lockfile:

```text
apps/
  desktop/
  mobile/
  worker/
  integration-relay/
packages/
  core/
```

`@streamfusion/core` exposes explicit subpaths only:

```text
@streamfusion/core/platform
@streamfusion/core/content
@streamfusion/core/discovery
@streamfusion/core/auth
@streamfusion/core/chat
@streamfusion/core/reliability
@streamfusion/core/relay
@streamfusion/core/testing
```

There is no root barrel export. Package exports, TypeScript project references, `eslint-plugin-boundaries`, and `no-restricted-imports` enforce the dependency direction from the first extraction commit.

### 8.2 Core ownership

The core owns portable domain models, schemas, validation, use cases, ports, reliability policies, capability contracts, and shared test fixtures. `@streamfusion/core/relay` owns serialization-safe request, response, event, error, and version-envelope schemas shared by Mobile and the Integration Relay. Service internals and persistence records remain private. Core must not import React, React Native, Expo, Electron, Node-only APIs, Cloudflare bindings, SQLite, SecureStore, provider SDKs, or Kotlin types.

Desktop, Mobile, the OAuth Worker, and the Integration Relay own their concrete transports and adapters. Every Platform adapter runs the shared adapter contract suite plus Platform-specific tests.

### 8.3 Mobile module layout

```text
apps/mobile/
  app/                 Expo Router route declarations
  src/features/        screens, controllers, hooks, and presentation
  src/adapters/        port implementations
  src/transport/       provider and relay HTTP or WebSocket clients
  src/persistence/     Product Store, Cache Store, migrations, repositories
  src/composition/     application composition roots
  src/design/          mobile tokens and primitives derived from DESIGN.md
  modules/             narrow Kotlin Expo modules
```

Only `src/composition/` may import both a consumer and its concrete implementation. Route and feature code must not import Twitch, Kick, Cloudflare, SQLite, SecureStore, Expo native modules, or Kotlin bindings directly.

### 8.4 Runtime state ownership

- TanStack Query owns remote request state and invalidation.
- Encrypted SQLite repositories own durable product state.
- The bounded Cache Store owns disposable provider responses and media metadata.
- Zustand owns presentation-only state such as active sheets, local navigation affordances, and temporary layout state.
- The player session coordinator owns active playback and mini-player state.
- Android services own recoverable background media jobs.

No state is duplicated across owners without an explicit projection and reconciliation rule.

## 9. Platform, authentication, and relay boundaries

### 9.1 Direct-first rule

Signed-in documented Platform operations run directly from Android with the user's access token. The Integration Relay is not an ordinary signed-in proxy and never receives user access or refresh tokens.

Signed-out discovery may call narrowly scoped relay read endpoints backed by server-held app credentials. Those endpoints return shared schemas, apply rate limits, and expose no reusable app token.

### 9.2 Twitch authentication

Twitch uses Device Code Grant directly from Android. The credential coordinator must:

- show the verification URI and code accessibly;
- poll within provider intervals and cancellation rules;
- store access token, refresh token, expiry, scopes, user ID, and generation atomically;
- validate the session as Twitch requires;
- serialize refreshes because Device Code refresh tokens rotate and are one-time use;
- disconnect and erase credentials without removing unrelated local product data.

### 9.3 Kick authentication

Kick login opens in the system browser with S256 PKCE and `state`. The callback uses one verified HTTPS Android App Link tied to the production application ID and signing certificate. The app retains the verifier and expected state for the active attempt, then sends the authorization code, exact redirect URI, and verifier to the existing token-only Worker.

The Worker adds the Kick client secret for exchange and refresh. It must allow only the exact approved mobile callback in addition to its existing Desktop callbacks. It must not become a general Platform proxy or persist user tokens.

Current Kick documentation still requires `client_secret` for both exchange and refresh. The Worker cannot be removed until Kick documents and ships a public-client registration and secretless token contract, and StreamFusion validates that contract.

### 9.4 Integration Relay

`apps/integration-relay` is a separate Cloudflare Worker with these responsibilities only:

- narrow signed-out official Platform reads;
- Twitch and Kick webhook subscription management and verification;
- foreground Kick chat receipt, deduplication, and channel fanout;
- Live Notification registration, topic or token routing, and delivery ledger;
- delivery of an independently signed Capability Manifest;
- health and compatibility status needed by Settings and Diagnostics.

The relay may use D1 for minimal installation registrations, native push-token mappings, channel subscriptions, provider subscription records, and a bounded delivery ledger. A channel-sharded Durable Object may own active Kick chat WebSockets, deduplication, and fanout. It stores no chat history.

Each installation has a random Installation Identity and a rotating relay credential stored in SecureStore. The FCM token is neither identity nor authentication.

### 9.5 Capability Manifest

An offline operations key signs an expiring Capability Manifest. The relay serves but cannot sign it. The app verifies signature, schema, environment, monotonic version, issued time, and expiry before use.

The app caches the last valid monotonic manifest. Expiry falls back to baked safe defaults. Compatibility Integrations remain disabled unless the active valid policy explicitly allows them. A manifest may disable an unsafe narrow capability, but it may not force an update, erase local data, disable unrelated capabilities, or replace the parity release gate.

## 10. Persistence, offline behavior, and lifecycle

### 10.1 Storage classes

| Class | Storage | Contract |
| --- | --- | --- |
| Secrets | Expo SecureStore backed by Android Keystore | Tokens, relay credential, and secret references only; excluded from backup. |
| Product Store | SQLCipher-encrypted SQLite | Settings, Guest Follows, history, Activity, capability policy, media-job metadata, and durable user state. |
| Cache Store | Separate encrypted SQLite database and app cache directory | Disposable provider data, bounded by a 256 MiB least-recently-used target and seven-day default freshness. |
| Media | App-private Android files | Recordings, downloads, caption model, temporary segments, and explicit user exports. |

Android cloud backup and device-to-device transfer must exclude preferences, Installation Identity, SecureStore data, encrypted databases, app-private media, and signing-sensitive metadata. StreamFusion provides no implicit cloud synchronization of app-owned data.

### 10.2 Migrations and recovery

Product Store migrations are ordered, transactional, restart-safe, and tested from the oldest supported schema. Before migration, the app runs integrity checks and retains one encrypted local pre-migration backup. If repair and restore fail, it quarantines the Product Store, preserves recoverable media, offers artifact recovery, and requires an explicit reset. It never silently deletes product data. Clearing Cache Store must never clear Product Store, preferences, secrets, downloads, or recordings.

Media jobs use explicit durable states such as queued, preparing, running, pausing, paused, finalizing, completed, failed-retryable, failed-terminal, and canceled. Job commands are idempotent. On process restart, the native service and JavaScript coordinator reconcile from durable metadata and filesystem evidence.

### 10.3 Offline behavior

Cached discovery may render with its age and offline status. Previously stored History, Activity, settings, Guest Follows, downloaded media, and completed recordings remain usable offline.

Provider mutations that cannot be proven idempotent must not be silently queued for later execution. They fail visibly and can be retried by the user. Relay registration projections may use stable operation IDs and bounded retry because their reconciliation contract is idempotent.

Lifecycle behavior is explicit:

| Capability | Background or PiP | Process death or reboot | Offline |
| --- | --- | --- | --- |
| Playback | One selected primary stream may continue in Android PiP; other Multistream tiles pause. | Playback stops. The route may restore, but playback never silently restarts. | Previously downloaded media only. |
| Chat | Disconnect when chat is not visible. | Reconnect when visible, deduplicate supported replay, and show a gap marker. | Unavailable. |
| Recording | User-started visible foreground service may continue for the certified four-hour window. | Finalize and retain playable partial output when possible; restart requires user action. | No new remote job starts. Normal transient stream recovery may continue an already reachable source. |
| Download | User-started visible service continues while Android permits. | Reconcile journal, files, and native state; safely resumable work may resume. | Pause until the required network is available. |
| Export | User-started visible service continues while Android permits. | Reconcile and resume only when safe; never present incomplete shared output as complete. | Private source remains usable. |
| Discovery | No background polling. | Reload or use bounded cache. | Timestamped cached pages are read-only. |
| Product state | Durable local changes continue where applicable. | Restore History, Guest Follows, Activity, settings, diagnostics, and jobs from Product Store. | Fully available. |

### 10.4 Activity retention

Activity is the durable local inbox for notifications and media-job events. Completed events are retained for 90 days or 2,000 entries, whichever bound is reached first. Active jobs remain until terminal reconciliation regardless of that bound. Unread state, event identity, timestamps, Platform and channel identity, media-job links, and delivery source survive process death.

## 11. Playback, chat, media, and Compatibility Integrations

### 11.1 Native modules

Narrow Kotlin Expo modules may implement:

- playback session and Android PiP integration;
- foreground recording and download services;
- segmented media finalization and recovery;
- local caption runtime and model management;
- Android diagnostics and resource observations;
- APK verification, download handoff, and update maintenance.

TypeScript adapters translate these modules into core ports. Native module errors use stable typed codes and actionable diagnostics rather than raw exception strings.

### 11.2 Playback and media

Native HLS rendering is Android-owned. Platform adapters resolve playback sources. A playback-source failure affects only the selected item and must expose Platform, integration mode, last successful stage, and safe recovery action.

One playback session is focused for audio, chat, captions, recording context, and PiP. Multistream coordinates multiple StreamSlots without giving each slot independent background ownership.

Recording runs as a visible Android foreground service and is certified for at least four hours on the lowest qualified device. It writes segments, checkpoints metadata, monitors storage, and finalizes a playable partial artifact after interruption when possible. Downloads are app-private until the user chooses an explicit Android export destination. Broad storage permission is forbidden.

Local captions support one active English model session in 1.0. Playback audio is processed locally and is never uploaded for captioning. The UI shows download size, installed state, active resource cost, errors, and removal action.

### 11.3 Chat

Twitch foreground chat uses one managed EventSub WebSocket and direct Helix send. Reconnection recreates subscriptions and reports gaps because EventSub does not replay missed chat events.

Kick foreground receive uses provider webhooks verified by the Integration Relay and a channel-sharded fanout connection to active clients. Kick chat send remains a direct documented user-token call from Android. The relay deduplicates provider message IDs and stores no chat transcript.

Emotes and cosmetics are parsed into shared message models. Rendering caches are bounded. Moderation commands enforce provider scopes and channel authority in the adapter and surface partial Platform support explicitly.

### 11.4 Compatibility Integration policy

A Compatibility Integration is permitted only when all of these conditions hold:

- the outcome is parity-critical;
- no documented provider path delivers it;
- the integration is isolated behind a narrow port;
- it has fixtures, contract tests, a live canary, diagnostics, and an independent signed kill switch;
- failure affects only that capability;
- a safe fallback or explicit unavailable state exists;
- release notes disclose the compatibility dependency;
- its removal condition is recorded.

The approved initial compatibility set is:

- native Twitch and Kick playback-source resolution;
- Kick videos and clips;
- Twitch VOD chat replay or gap sources;
- Kick chat replay, predictions, and pins.

Twitch account follow writes and Kick account follow reads or writes are not approved compatibility work. Android uses Guest Follows and opens the provider page for account-level follow actions. Twitch playback may fall back to the approved web embed when technically possible. Kick playback becomes unavailable if its native source integration is disabled. Signed-out discovery asks the user to sign in if its narrow relay read path is unavailable.

When a documented replacement becomes available, it must pass the same contract and release gates. The compatibility implementation is deleted after one stable release on the official replacement.

## 12. Live Notifications and Activity

### 12.1 Client and credential boundary

Android uses `expo-notifications` for permission, channels, native token registration, receipt, response handling, and local presentation. It calls `getDevicePushTokenAsync()` and registers the native FCM token with the Integration Relay. It does not request or store an ExpoPushToken, and the relay does not use the Expo Push Service.

Firebase is used only for FCM registration and delivery. StreamFusion must not add Firebase Auth, Firestore, Realtime Database, Storage, Analytics, Cloud Functions, Remote Config, or Firebase Test Lab.

The production Firebase Android configuration registers only `com.thedarkskyxd.streamfusion`. The FCM HTTP v1 service credential exists only in the Integration Relay's protected production secret store. It never enters the APK, EAS client credentials, logs, diagnostics, or source control. Development and production use separate application IDs, Firebase projects, FCM credentials, relay namespaces, topics, tokens, and test data.

### 12.2 Routing and scale

Product Store is authoritative for Live Notification preferences. A versioned Live Notification Projection tells the relay which native token belongs to which enabled Platform and Channel pair. Each pair maps to a stable, non-secret FCM topic. A topic is a delivery address, not source of truth or authorization. The app and relay reconcile membership after preference changes, launch, foregrounding, token rotation, reinstall, account changes, and network recovery.

A small audience may use direct native-token fanout. A burst uses one topic event rather than one request per follower.

A single logical event chooses exactly one delivery mode, topic or direct token. A stable event ID deduplicates webhook retries, relay retries, client receipt, Activity reconciliation, and mode transitions.

FCM limits an app installation to 2,000 topic subscriptions. When an installation would exceed that limit, the relay keeps the preference and routes the overflow through direct native-token delivery. It never silently drops a subscription. Account, device, media-job, and other private notifications always use direct tokens.

The relay queues work, smooths bursts, respects `Retry-After`, and applies bounded exponential backoff with jitter. Invalid or unregistered tokens are retired. Delivery records distinguish accepted by FCM, retryable failure, terminal token failure, and local reconciliation. StreamFusion does not claim that FCM acceptance guarantees device receipt.

### 12.3 User behavior

Permission is requested in context when the user enables the first live alert, chooses notification setup, or starts notification-dependent media work. A denial never disables Activity, and Settings provides a retry path. Once permission exists, remote delivery defaults to enabled while at least one Live Notification is enabled. Users can configure the global setting and per-channel preference.

Payloads contain only a schema version, stable event and source identifiers, safe display metadata, and an allowlisted destination. They never contain credentials, secrets, chat content, or playable media URLs. Android validates the payload and resolves current data before routing. An ended stream opens its ended Channel or detail state rather than a broken player.

Android keeps separate Live, Media, and Account/Device notification channels. Required foreground-service notifications remain visible. Notification actions are restricted to safe local controls such as Watch, Pause, Resume, Stop, and Dismiss. Chat and moderation mutations are never notification actions.

- Foreground event: write Activity and show an in-app banner.
- Background or terminated event: write or reconcile Activity and request a system notification.
- Missed event whose stream is still live: notify and show the original stream start time.
- Missed event whose stream has ended: add Activity only.
- Force-stopped app: make no delivery promise until the user opens the app and reconciliation runs.

The app must not run a persistent provider listener, notification foreground service, or frequent notification polling loop. Notification actions open the correct channel in Watch and preserve stable event identity. Android upserts registration on launch, foregrounding, and token rotation; removes it when remote delivery is disabled or an associated account is disconnected where possible; and relies on relay expiry for inactive registrations and uninstall.

## 13. Build, identity, signing, and updates

### 13.1 Release identities

- Production application ID: `com.thedarkskyxd.streamfusion`.
- Development application ID and signing identity: separate from production.
- Production Expo project: owned by the StreamFusion Expo organization.
- Production Android publisher: the project owner's full-distribution individual Android Developer Console identity.

The publisher account uses two hardware security keys, offline recovery codes, and a dedicated browser profile. The production key is an EAS-managed operational key with two encrypted offline backups stored separately. A recovery drill is required before 1.0, every six months, and after credential or owner changes.

### 13.2 Version and build authority

`versionName` and monotonic `versionCode` are committed in the repository. Remote auto-increment is disabled. The Publisher explicitly starts the production EAS cloud APK build. Protected GitHub automation promotes one exact EAS build ID after a second Publisher approval.

The promotion must prove source commit, workflow inputs, lockfile digest, toolchain versions, EAS build identity and logs, application ID, version, ABI set, signer fingerprint, APK SHA-256, APK size, SBOM, and verification manifest.

### 13.3 Immutable Android Release Set

GitHub immutable releases must be enabled. A public stable release contains one internally consistent Android Release Set:

- universal signed APK;
- `android-update.json`;
- `SHA256SUMS`;
- signed verification manifest;
- `build-info.json` provenance record;
- SBOM;
- release notes and compatibility disclosures;
- parity snapshot;
- redacted release evidence index;
- installation and update instructions.

Every file must reference the same commit, version, application ID, signer, and APK digest. Promotion fails closed on a missing, mutable, mismatched, expired, failed, or quarantined element.

### 13.4 In-app update flow

The app checks only the latest stable GitHub release, manually or at most once per 24 hours while foregrounded. It validates metadata schema, application ID, monotonic version, expected production signer, and APK digest before offering an update. Download is resumable and app-private. A native module revalidates the completed artifact and hands it to Android PackageInstaller. Installation always requires explicit user action.

Updates are never mandatory. StreamFusion does not silently downgrade, uninstall, or overwrite data. A bad release is removed from update metadata while its evidence is retained, then replaced by a higher version signed with the same trusted key. A signed Capability Manifest may disable only the unsafe narrow capability while the forward fix is prepared.

## 14. Verification and public release predicate

### 14.1 Four gates

1. **Change Gate**: every change runs deterministic static analysis, unit, component, contract, native configuration, dependency, secret, and permission checks appropriate to its blast radius.
2. **Main Gate**: main runs the Change Gate plus clean API 30 and current-API emulator smoke journeys and publishes indexed evidence.
3. **Candidate Gate**: nightly or release-candidate runs cover phone, tablet, foldable, physical devices, accessibility, performance, security, live providers, install, upgrade, interruption, and recovery. The complete candidate must pass twice consecutively.
4. **Public Release Gate**: an independent reviewer, capability owners, and Publisher approve fresh evidence for the exact signed APK. Signer recovery must be current, and the immutable Android Release Set must match the promoted digest.

One visible diagnostic retry is allowed for infrastructure noise, with the original result retained. A release still requires two clean complete Candidate Gate results. Quarantined tests and Development Exceptions block release.

### 14.2 Required environments

The project-owned lab uses local or EAS emulators and five physical roles:

- lowest-qualified API 30 phone;
- constrained phone;
- current mainstream phone;
- tablet;
- foldable.

Dedicated Twitch and Kick test identities and channels cover auth, discovery, chat, moderation, webhooks, live state, and notification behavior. Firebase Test Lab is not part of the plan.

### 14.3 Quality thresholds

- Shared core: at least 90 percent branch coverage.
- Mobile domain and adapters: at least 80 percent branch coverage.
- Parity-critical scenarios: explicit tests regardless of aggregate coverage.
- Cosmetic UI: no arbitrary line-coverage quota.
- Accessibility: zero serious or critical findings, 200 percent font scaling, 48 dp targets, contrast checks, and physical-device TalkBack proof.
- Performance: absolute budgets on the lowest profile plus a release block for regressions greater than 10 percent from the accepted baseline.
- Media: constrained playback and a four-hour recording soak with artifact validation.
- Notification scale: accept and dispatch a 100,000-recipient logical event within 30 seconds without relay loss. This measures StreamFusion dispatch, not guaranteed FCM device delivery.
- Security: dependency, lockfile, action and package signature, secret, permission, network, environment-isolation, APK static, and SBOM checks.

### 14.4 Evidence catalog

A versioned machine-readable catalog is keyed by Desktop capability ID. Each record includes source commit, APK digest, test and verifier version, environment, device and API, artifact hashes, result, timestamp, expiry, and links.

One project-local verifier and mobile proof skill run the same checks locally and in CI and resume from retained artifacts. Automated redaction removes credentials, push tokens, provider content not needed for proof, and user data before publication.

Retention is 14 days for development evidence, 30 days for main evidence, and permanent for the redacted release index and release artifacts. Maximum ages at promotion are:

- exact artifact, promotion, and live-provider evidence: 24 hours;
- emulator evidence: 72 hours;
- physical-device and accessibility evidence: seven days;
- human review: 30 days;
- signing-key recovery drill: six months.

Install evidence covers clean install, upgrades from the previous two versions, migration from the oldest supported Product Store schema, wrong signer, downgrade attempt, low storage, interrupted download, and reinstall. Recoverable app-owned data must survive every supported path.

The final release predicate is true only when every current Desktop capability has an allowed Android outcome, fresh required evidence, two clean complete Candidate Gate runs, no blocker, exception, or quarantine, all approvals, current signer recovery, and an immutable Release Set matching the exact APK digest.

## 15. Implementation sequence

Implementation tickets must be cut into verifiable units in this order:

### Phase 0: repository and build foundation

- Expand the root workspace to Desktop, Mobile, Worker, Integration Relay, and packages.
- Establish the single lockfile, project references, package exports, dependency-boundary linting, Expo development client, dev and production identities, and CI skeleton.
- Create the evidence catalog schema and project-local verifier shell.

### Phase 1: shared-core extraction

- Execute the ten approved checkpoints: unify installation; create the boundary; extract leaf contracts; clean data contracts; extract discovery behavior; expand capability ports; extract auth semantics; extract chat and notification policy; finish Desktop migration; open Android feature work only after the extraction predicate passes.
- Keep Desktop behavior green through adapter contract suites.
- Track narrow Desktop migration exceptions and remove all of them before Android product feature work begins.

Expo and build scaffolding may proceed during extraction. Android product features may not bypass the extraction gate by recreating domain logic inside screens or adapters.

### Phase 2: mobile shell and device foundation

- Implement route shell, design primitives, adaptive navigation, complete placeholder route inventory, accessibility foundation, Product and Cache Stores, SecureStore, migrations, capability profiling, and diagnostics plumbing.
- Prove install, launch, offline state, process death, schema migration, and storage separation on API 30 before feature slices depend on them.

### Phase 3: identity, discovery, and relay

- Implement Twitch Device Code and Kick App Link PKCE flows.
- Extend the token-only Worker allowlist without expanding its role.
- Build Integration Relay identity, signed-out reads, signed Capability Manifest, webhook verification, registration, and environment isolation.
- Deliver Home, Search, Categories, Category Detail, Following, Accounts, and Guest Follows as vertical slices.

### Phase 4: Watch and engagement

- Implement playback source ports, native player, Watch, movable mini-player, Android PiP, videos, clips, live chat, emotes, replay, moderation, History, and Multistream.
- Add each Compatibility Integration independently with its kill switch, canary, fallback, diagnostics, and disclosure.

### Phase 5: native media and maintenance

- Implement downloads, segmented recording, local captions, media-job Activity, proxy and connectivity, complete Settings, complete Diagnostics, and Android maintenance services.
- Pass lowest-profile, interruption, storage-pressure, thermal, and four-hour recording gates.

### Phase 6: notifications and release path

- Implement native FCM registration, topic and direct-token routing, Activity reconciliation, permission behavior, scale controls, and failure handling.
- Implement exact-APK verification, GitHub metadata, updater module, EAS promotion, signed manifest, SBOM, immutable Release Set, and signer-recovery procedure.

### Phase 7: parity closure

- Reconcile the generated ledger against the exact candidate.
- Close every required capability and tab state with fresh evidence.
- Pass the complete Candidate Gate twice, complete independent review, and promote the exact signed APK.

Each implementation ticket must name affected capability IDs, architectural layer, allowed dependencies, acceptance evidence, failure containment, and rollback or forward-fix behavior. A ticket is not complete when code merely exists; its required evidence must be indexed.

## 16. Approval criteria

This specification is ready for implementation-ticket creation when the reviewer confirms that it:

- preserves all 24 current Desktop capability outcomes;
- reflects the approved five-destination navigation and complete nested screen or tab inventory;
- keeps shared business logic portable and concrete transports app-owned;
- confines trusted services and secrets to the approved boundaries;
- uses direct FCM without adding other Firebase products;
- defines recoverable Android lifecycle and media behavior;
- makes Compatibility Integration risk explicit and independently controllable;
- defines the exact signed APK, evidence, and immutable GitHub Release contract;
- leaves no product or architecture decision that would materially change implementation-ticket boundaries.

Approval of this document authorizes decomposition into implementation tickets. It does not by itself authorize a public release or waive any parity or verification gate.

## 17. Supporting decisions

- [Desktop parity inventory](./desktop-parity-inventory.md)
- [Continuous parity contract](./continuous-parity-contract.md)
- [Shared-core boundaries and extraction sequence](./shared-core-boundaries-and-extraction-sequence.md)
- [Android navigation and interaction model](./android-navigation-and-interaction-model.md)
- [Android device support and capability policy](./android-device-support-and-capability-policy.md)
- [Android feasibility](./android-full-parity-feasibility.md)
- [Twitch and Kick integration constraints](./2026-08-29-android-twitch-kick-integration-constraints.md)
- [Signed GitHub APK delivery and update safety](./github-apk-delivery-and-update-safety.md)
- [Kick native OAuth recheck](../kick-oauth-worker-exit/native-public-client-recheck-2026-08-30.md)
- [StreamFusion design system](../../../DESIGN.md)
- [Wayfinder map](https://github.com/TheDarkSkyXD/StreamFusion/issues/96)
