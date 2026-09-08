# StreamFusion Mobile implementation specification

Status: Baseline approved in [GitHub issue #107](https://github.com/TheDarkSkyXD/StreamFusion/issues/107#issuecomment-5471120773). Expanded on 2026-09-07 at the user's request under [#195](https://github.com/TheDarkSkyXD/StreamFusion/issues/195) to make mockup, interaction, and grilling coverage explicit. Specification coverage does not mean implementation or verification is complete.

Target: Android 11 and newer

Distribution: Signed APK through immutable GitHub Releases

## 1. Purpose

StreamFusion Mobile is the Android companion to the existing Desktop application. It must deliver the same user outcomes as Desktop while using Android-native interaction, lifecycle, storage, media, security, and release behavior.

This document is the integrated implementation contract. It combines the approved parity policy, shared-core extraction, Android architecture, Platform boundaries, navigation, persistence, background behavior, native capabilities, notification delivery, verification, signing, and release model. After approval, implementation tickets must preserve these decisions unless a later explicit decision supersedes them.

The [screen and control contract](./mobile-screen-and-control-contract.md) is a normative part of this PRD, not optional research or a release-stage design backlog. Read it with sections 6, 18, and 19 before implementing any feature. It supplies the screen hierarchy, component inventory, individual controls, interaction outcomes, states, and ownership that the capability summary alone cannot express.

The words **must**, **must not**, **should**, and **may** are normative.

## 2. Source of truth and conflict order

Implementation must resolve conflicts in this order:

1. A later explicit user decision or approved GitHub decision that supersedes an earlier decision.
2. The generated Desktop parity ledger at the implementation commit, for required user outcomes subject to approved Android adaptations.
3. This specification and its normative screen and control contract.
4. The linked research and design documents.

The ledger discovers required outcomes. It does not make an implementation defect or an unapproved Desktop mechanism a Mobile requirement. Prototype B and its approved amendments define visual structure and interaction placement. Prototype fixtures, fake service responses, review tools, and arbitrary sample settings are not proof of an approved business rule. Section 18 records superseded decisions. Section 19 records unresolved details without inventing approval.

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

### 4.1 Same features, mobile-ready interaction

The Mobile application must preserve the current Desktop feature set at screen, component, action, setting, business-rule and workflow level. Matching the 24 capability names or reproducing a simplified mockup is not sufficient. The mockup is a mobile presentation reference, not a ceiling on functionality.

Before implementing a feature, its owner compares the current Desktop screen, controls, menus, keyboard/context actions, settings, loading/error states and tests with the Mobile contract. Each Desktop outcome maps to a discoverable mobile control or an explicitly approved Android adaptation. Missing mockup content is added to the mockup and PRD within that feature issue. Missing documentation is a coverage defect, not permission to remove the behavior.

Mobile-ready means touch-sized controls, portrait-first task layouts, contextual sheets, accessible focus and labels, keyboard-safe input, supported tablet/foldable layouts, and Android lifecycle behavior. Desktop hover, right-click, dense panels and shortcuts need touch-accessible equivalents. Responsive layout may move a function into a sheet, tab, menu or nested screen; it must not make that function disappear.

Desktop-only mechanisms such as Electron process signaling use the approved Android equivalent. Existing explicit adaptations, including private media/export, contextual media jobs, measured active-video limits and provider auth/support policy, remain binding. A technical limitation is recorded with its affected outcome, source evidence and proposed adaptation. An unavailable state alone does not satisfy a required feature, and no new omission is approved merely by labeling it mobile-specific.

Each feature's acceptance includes a Desktop-to-Mobile comparison of visible controls and end-to-end results. New or changed Desktop behavior updates the owning Mobile issue, PRD, mockup and affected tests. Review this comparison before feature closure, not at release.

The companion contract's [Desktop outcomes table](mobile-screen-and-control-contract.md#desktop-outcomes-that-must-remain-reachable-on-mobile) makes the newly identified gaps explicit: complete player/caption controls, merged and per-channel Multistream chat, the complete Moderation tools workspace, and historical Diagnostics with collection gaps and Android-safe recovery. These are feature-owned requirements, not optional release polish. Interactive HTML states demonstrate the intended interaction only; they do not prove native capabilities, provider mutations, persistence, or performance.

## 5. Capability placement

The current Desktop baseline contains 24 top-level capability contracts. The generated ledger remains authoritative for their detailed facts.

| Capability ID                        | Required Android outcome                                                                                                         | Primary placement and mechanism                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `home-live-discovery`                | Browse live streams, channel cards, and Platform availability.                                                                   | Home under More; cards use 16:9 thumbnails, channel avatars, Platform badges, live state, and viewer metadata.                                    |
| `followed-streams-and-sync`          | View followed live channels, maintain Guest Follows, and import provider follows where supported.                                | Following tab with bottom floating search. Account follow writes become Guest Follow plus provider-page action when no official write API exists. |
| `category-discovery`                 | Browse categories and the streams, videos, and clips within a selected category.                                                 | Categories under More; 3:4 art opens Category Detail. Both screens use a bottom floating search field and every approved tab state.               |
| `search`                             | Search channels, streams, videos, clips, and categories across Platforms.                                                        | Search tab with history, filters, bottom floating field, and All, Channels, Streams, Videos, Clips, and Categories tabs.                          |
| `platform-account-auth`              | Connect, validate, refresh, scope-check, and disconnect Twitch and Kick.                                                         | Accounts in More and Settings. Twitch uses Device Code. Kick uses browser PKCE, a verified App Link, and the token-only Worker.                   |
| `live-playback`                      | Resolve and play Twitch and Kick live streams with visible compatibility state.                                                  | Watch tab, native player adapter, and isolated Platform playback-source adapters.                                                                 |
| `vod-and-clip-playback`              | Open and play videos and clips with correct metadata and history typing.                                                         | Watch routes launched from Search, Category Detail, History, and channel content tabs.                                                            |
| `player-controls-and-pip`            | Provide transport, quality, volume, fullscreen, orientation, movable mini-player, and Android PiP.                               | Watch; in-app movable mini-player during navigation and system PiP when leaving the app.                                                          |
| `stream-recording`                   | Record supported playback into a recoverable, segmented local media job.                                                         | Contextual Watch action; job progress and results appear in Activity and Android notifications.                                                   |
| `local-captions`                     | Produce one real-time local caption session without uploading microphone or playback audio.                                      | Watch overlay backed by a native caption module and visible resource state.                                                                       |
| `ad-blocking`                        | Apply the approved Desktop-equivalent playback filtering outcome where technically available.                                    | Playback-source and player adapters, never screen code; failure degrades only playback and is surfaced in Watch diagnostics.                      |
| `live-chat`                          | Receive and send live chat, show badges and emotes, and preserve focused-stream behavior.                                        | Watch chat surface. Twitch uses foreground EventSub and direct Helix send. Kick receive uses the relay; send is direct official API.              |
| `emotes-and-cosmetics`               | Resolve Platform and approved third-party emotes, badges, paints, and display metadata.                                          | Chat rendering and settings, backed by shared models and bounded caches.                                                                          |
| `chat-replay`                        | Show synchronized replay where a validated source exists.                                                                        | Video or clip Watch route. Compatibility sources are isolated and fail only this capability.                                                      |
| `moderation`                         | Execute authorized moderation, polls, predictions, pins, and managed-channel workflows.                                          | Moderation under More, contextual chat actions, and all child tab states. Official endpoints are preferred; approved gaps follow section 11.      |
| `multistream`                        | Configure and watch multiple simultaneous StreamSlots with one focused audio and chat context.                                   | Multistream entry under More opens Watch. Up to six slots may be configured; the capability profile controls active video count.                  |
| `watch-history`                      | Record and browse watched items with an explicit Stream, Video, or Clip type.                                                    | History under More. Rows include thumbnail, avatar, Platform, type, timestamp, progress where applicable, and resume or replay action.            |
| `downloads`                          | Download supported videos or clips, inspect progress, retry, cancel, delete, and explicitly export.                              | Contextual Watch action; active and completed jobs appear in Activity. There is no standalone Downloads or Media Library screen.                  |
| `general-chat-and-theme-preferences` | Configure appearance, chat behavior, playback behavior, and related preferences.                                                 | Settings under More, using the complete Desktop-derived settings panel set and Android-native controls.                                           |
| `proxy-and-connectivity`             | Configure supported proxy and network behavior and explain active restrictions.                                                  | Settings and Diagnostics. Network adapters own application; screens only present state and actions.                                               |
| `notifications`                      | Configure live alerts and receive reconciled Activity events in foreground, background, and terminated cases allowed by Android. | Activity tab, notification settings, `expo-notifications`, native FCM tokens, and Integration Relay delivery.                                     |
| `app-updates`                        | Check, validate, download, and hand a newer signed APK to Android's installer with user consent.                                 | Settings and update prompt backed by the native updater module and GitHub Release metadata.                                                       |
| `diagnostics-logs-and-bug-reports`   | Inspect status, logs, capabilities, storage, network, jobs, and sanitized reports.                                               | Diagnostics under More with all six approved tabs and Android-native collection.                                                                  |
| `app-shell-and-navigation`           | Reach every capability through a stable Android-native shell without persistent Desktop chrome.                                  | Five top-level destinations: Search, Following, Watch, Activity, More; adaptive navigation rail on wider windows.                                 |

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

It must also expose these 42 directly testable tab states:

- Search: All, Channels, Streams, Videos, Clips, Categories.
- Following: Live, Videos, Clips, Categories, Channels.
- Category Detail: Live Streams, Clips, Videos.
- Channel Detail: Home, Videos, Clips.
- Watch: Chat, Info, Related.
- Video or Clip: Details, Comments, Related.
- Activity: All, Channels, Jobs.
- Moderation: Chat, Retention, Mod log, Banned, Engagement, Unban, Moderators, VIPs, Activity, Active moderators. Secondary channel-tools sheets remain required beyond these tabs.
- Diagnostics: Overview, Resources, I/O, Traces, Logs and reports, Developer tools.

Tabs may be adapted into native segmented controls, top tabs, or nested routes, but no content state may disappear. Each state requires a stable test selector or routeable review scenario. The generated parity ledger and navigation inventory together define completeness.

### 6.6 Design system

Mobile uses the existing Dark Theater design language in [DESIGN.md](../../../DESIGN.md): Void Black and tonal surfaces establish depth, Storm Crimson is reserved for live and critical states, and Twitch Purple or Kick Green identify only their Platforms. Resting surfaces have no shadows. Touch targets are at least 48 dp. Text and controls meet WCAG AA contrast, support 200 percent font scaling, TalkBack, reduced motion, and Android system insets.

### 6.7 Feature-owned UI and UX completion

Every issue that implements or changes a feature must deliver that feature's complete UI and UX together with its domain behavior, adapters, persistence, and tests. UI implementation is not deferred to #195, parity closure, Candidate Gate, or a release issue. The same rule applies to account flows, settings, notifications, diagnostics, media controls, and user-visible failures in native or relay-backed work.

Each feature issue must satisfy these acceptance criteria before closure:

- Name its PRD requirements, mockup screens, tabs, components, control IDs, and source decisions. Identify reused components and all affected screen usages.
- Deliver the approved visual hierarchy, information density, content identity, layout, typography, spacing, iconography, and Android adaptations. A route summary, placeholder, mocked service response, or inert control does not satisfy the feature.
- Implement every applicable action from entry to visible result, including validation, permission or scope checks, persistence, cancellation, retry, failure containment, and recovery. Buttons and native or background entry points use the same rules.
- Complete applicable loading, refreshing, empty, partial, stale, offline, failed, permission-denied, signed-out, expired-session, unsupported, constrained, disabled, and busy states. State why a listed condition does not apply instead of omitting it.
- Verify safe areas, portrait primary navigation, keyboard avoidance, floating-search clearance, overlay stacking, final-row reachability, large text, missing artwork, and supported resizing. Wider layouts must not replace or turn the portrait shell sideways.
- Meet the accessibility rules in section 6.6 in the actual feature, including semantic roles, labels, selected and disabled state, focus order, and non-color status cues.
- Add behavior and component regressions for the feature and exercise the real Android journey using literal root `npm start`, option 3, and Mobile MCP. Use Expo Go only for supported behavior and the matching development client for custom native capabilities. Record the source and tested artifact.
- Attach reference-versus-app screenshots at matched viewport and configuration, observed action and recovery results, and applicable accessibility and lifecycle evidence. Screenshots alone do not prove behavior.
- Record specified, implemented, and verified status independently. Missing required evidence or an unresolved rule keeps the affected acceptance item open.

Pure infrastructure and behavior-preserving extraction issues do not invent product screens. They must identify their actual consumer, verify any changed existing UI, and cite why no new UI applies. A feature cannot use this exception merely because its first implementation is a backend or native module.

Shared components are implemented when the first feature needs them and verified in their real usages. Later consumers own integration and regressions. Cross-feature dependencies name the missing integration explicitly; linking another ticket never turns unfinished behavior into a completed feature.

### 6.8 Continuous consistency review

Issue #195 starts with the specification and inventory and continues during feature implementation. It reviews completed feature slices for cross-screen consistency, missing contracts, and regressions. The feature owner fixes the feature's UI and UX before closing that feature issue. #195 is not a later batch that builds all pages after their feature tickets close.

Each milestone ends with complete UI and interactions for its delivered features. The integrated UI and UX review must finish before production artifact promotion in #178. Release work revalidates the completed experience against the exact APK; it does not implement missing pages. Publisher identity setup and verification tooling may proceed independently, but they do not waive this completion rule. The updater's own UI is feature work owned by #176 and must be complete before promotion.

The screen and control contract defines the current 34 prototype screen entries, 17 Settings panels, and 42 tab states. Its 67 review scenarios are derived from those overlapping inventories, not 65 separate features. Every approved addition updates the inventory and its feature issue before closure.

### 6.9 Action and state record

Each control or non-UI event has a stable requirement ID linked to its owner. Its acceptance record identifies actor, trigger, input, validation, permission, precondition, transition, side effect, persistence owner, visible result, cancellation, failure, retry, and evidence. A display-only component links to the data, formatting, content identity, and accessibility rules it presents.

Tests cover repeated taps, duplicate or out-of-order events, stale requests, concurrent commands, account changes, permission revocation, backgrounding, process death, and restoration where applicable. Read-only requests may be superseded. A stale response must not overwrite a newer query, account, selected channel, or slot. A canceled destructive action has no side effect. A failed mutation must not report success or leave an optimistic state that falsely claims persistence.

The authoritative operation determines whether retry is safe. Provider mutations, chat sends, and moderation are never silently queued offline. Idempotent local and relay operations reconcile by stable identity. Mockup toasts that simulate an action must become real operation feedback, not a replacement for implementation.

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
  src/features/<feature>/
    routes/            thin entry points
    components/        feature UI and input collection
    domain/            framework-independent rules and workflows
    capabilities/      application-owned ports
    adapters/          provider, relay, device, and native integrations
    data/              persistence, migrations, queries, and mappers
    utils/             pure feature-private helpers
    composition/       feature dependency wiring
    tests/             feature-owned verification
  src/composition/     application dependency wiring
  src/design/          mobile tokens and primitives derived from DESIGN.md
  modules/             narrow Kotlin Expo modules
```

Only composition modules may import both a consumer and its concrete implementation for dependency wiring. Domain, route, and component modules must not import concrete Twitch, Kick, Cloudflare, SQLite, SecureStore, Expo native module, or Kotlin implementations. Adapters and data modules own those integrations. This layout follows the current repository feature-ownership rules and replaces the earlier flat adapter and persistence sketch.

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

| Class         | Storage                                                    | Contract                                                                                                   |
| ------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Secrets       | Expo SecureStore backed by Android Keystore                | Tokens, relay credential, and secret references only; excluded from backup.                                |
| Product Store | SQLCipher-encrypted SQLite                                 | Settings, Guest Follows, history, Activity, capability policy, media-job metadata, and durable user state. |
| Cache Store   | Separate encrypted SQLite database and app cache directory | Disposable provider data, bounded by a 256 MiB least-recently-used target and seven-day default freshness. |
| Media         | App-private Android files                                  | Recordings, downloads, caption model, temporary segments, and explicit user exports.                       |

Android cloud backup and device-to-device transfer must exclude preferences, Installation Identity, SecureStore data, encrypted databases, app-private media, and signing-sensitive metadata. StreamFusion provides no implicit cloud synchronization of app-owned data.

### 10.2 Migrations and recovery

Product Store migrations are ordered, transactional, restart-safe, and tested from the oldest supported schema. Before migration, the app runs integrity checks and retains one encrypted local pre-migration backup. If repair and restore fail, it quarantines the Product Store, preserves recoverable media, offers artifact recovery, and requires an explicit reset. It never silently deletes product data. Clearing Cache Store must never clear Product Store, preferences, secrets, downloads, or recordings.

Media jobs use explicit durable states such as queued, preparing, running, pausing, paused, finalizing, completed, failed-retryable, failed-terminal, and canceled. Job commands are idempotent. On process restart, the native service and JavaScript coordinator reconcile from durable metadata and filesystem evidence.

### 10.3 Offline behavior

Cached discovery may render with its age and offline status. Previously stored History, Activity, settings, Guest Follows, downloaded media, and completed recordings remain usable offline.

Provider mutations that cannot be proven idempotent must not be silently queued for later execution. They fail visibly and can be retried by the user. Relay registration projections may use stable operation IDs and bounded retry because their reconciliation contract is idempotent.

Lifecycle behavior is explicit:

| Capability    | Background or PiP                                                                        | Process death or reboot                                                                       | Offline                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Playback      | One selected primary stream may continue in Android PiP; other Multistream tiles pause.  | Playback stops. The route may restore, but playback never silently restarts.                  | Previously downloaded media only.                                                                    |
| Chat          | Disconnect when chat is not visible.                                                     | Reconnect when visible, deduplicate supported replay, and show a gap marker.                  | Unavailable.                                                                                         |
| Recording     | User-started visible foreground service may continue for the certified four-hour window. | Finalize and retain playable partial output when possible; restart requires user action.      | No new remote job starts. Normal transient stream recovery may continue an already reachable source. |
| Download      | User-started visible service continues while Android permits.                            | Reconcile journal, files, and native state; safely resumable work may resume.                 | Pause until the required network is available.                                                       |
| Export        | User-started visible service continues while Android permits.                            | Reconcile and resume only when safe; never present incomplete shared output as complete.      | Private source remains usable.                                                                       |
| Discovery     | No background polling.                                                                   | Reload or use bounded cache.                                                                  | Timestamped cached pages are read-only.                                                              |
| Product state | Durable local changes continue where applicable.                                         | Restore History, Guest Follows, Activity, settings, diagnostics, and jobs from Product Store. | Fully available.                                                                                     |

### 10.4 Activity retention

Activity is the durable local inbox for notifications and media-job events. Completed events are retained for 90 days or 2,000 entries, whichever bound is reached first. Active jobs remain until terminal reconciliation regardless of that bound. Unread state, event identity, timestamps, Platform and channel identity, media-job links, and delivery source survive process death.

Ingesting the same event ID updates the existing Activity Item. It must not create a second row or reset a non-null read timestamp to unread. Native job events, relay retries, foreground receipt, notification entry, and restart reconciliation obey the same rule. A genuinely new event has a new stable ID and may start unread. Mark-read and mark-all-read operations persist locally; the badge derives from the persisted unread projection. Test a duplicate before and after restart after the item has been marked read.

Completed Activity can be dismissed one item at a time or by the explicit global Clear completed action. Dismissal is local metadata, not a provider deletion, notification change, job cancellation, or retention bypass; it survives restart and duplicate delivery. A duplicate completed event preserves both local read and dismissal metadata. Active jobs cannot be dismissed and remain visible until terminal reconciliation; a later active-job update clears prior local dismissal visibility without changing the existing read timestamp. Retention still prunes completed rows on its normal 90-day/2,000-entry bounds.

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

Signed-out Twitch viewing remains available, but opening Twitch chat requires login. The chat sheet explains this requirement without blocking playback. Anonymous IRC is not retained as a signed-out fallback. Closed or hidden chat disconnects without discarding the playback session. Only one supporting sheet or pane is active at a time.

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

Guest Follows are eligible for live alerts without a connected Platform account. The notification projection includes the enabled Guest Follow Platform and Channel identities. Account disconnect must not remove unrelated Guest Follows or their eligible notifications. Activity and Settings expose permission state, native registration status, last relay reconciliation, and actionable delivery failures without displaying the push token or relay credential.

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

The Settings Updates screen contains manual Check now, current version, last check and result, optional automatic foreground checks, and the available update's progress and actions. It must not offer the prototype's prerelease toggle, hourly frequency, or background polling. Check failure never blocks startup. Drafts and prereleases are ignored.

The update manifest contains schema version, tag, version name, numeric version code, APK asset name, SHA-256, byte length, minimum API, and application ID. It supplies no executable download URL. The updater selects the matching asset through GitHub release metadata and verifies immutable release state and bounded metadata. Before installation it rechecks asset name, length, hash, application ID, version, and pinned signer. Unknown-source installation access is requested only after Install. Cancellation, offline state, rate limits, low storage, malformed metadata, invalid APK, and installer rejection have explicit recovery states. Staged files are removed after completion, cancellation, or expiry. History, Activity, settings, diagnostics, local media, and export remain available on outdated builds.

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

- Implement route shell, design primitives, adaptive navigation, route inventory, accessibility foundation, Product and Cache Stores, SecureStore, migrations, capability profiling, and diagnostics plumbing. Temporary route placeholders are foundation-only and cannot satisfy a later feature's acceptance.
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

### Phase 6: notifications and UI/UX completion

- Implement native FCM registration, topic and direct-token routing, Activity reconciliation, permission behavior, scale controls, and failure handling.
- Complete verification tooling, GitHub metadata and updater behavior, signing prerequisites, and signer-recovery preparation. This infrastructure does not authorize artifact promotion or publication.
- Finish #195 integrated design, screen, action, logic and UI/UX acceptance. Review starts during phase 2 and continues within each feature; phase 6 is the final completion checkpoint.

### Phase 7: parity closure

- After #195 completes, #178 promotes the exact APK into the immutable Release Set with its signed manifest, SBOM and provenance. #178, #179, #180 and #181 each have a direct #195 dependency.
- Reconcile the generated ledger against the exact candidate.
- Revalidate every already-completed capability and tab state with fresh evidence. Missing feature UI or interactions return to the owning feature issue rather than becoming release-stage implementation work.
- Pass the complete Candidate Gate twice, complete independent review, and publish the exact approved signed APK through #181. Existing publisher approvals remain required.

Each implementation ticket must name affected capability IDs, architectural layer, allowed dependencies, acceptance evidence, failure containment, and rollback or forward-fix behavior. A ticket is not complete when code merely exists; its required evidence must be indexed.

Section 6.7 applies throughout phases 2 through 6. Feature UI, business behavior, integration, and observed evidence finish together, before the next dependent feature relies on them. #195 reviews continuously and must finish its integrated UI and UX acceptance before #178 promotion. Phases 6 and 7 contain no deferred general UI implementation milestone.

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

## 18. Grilling decisions and implementation contracts

This register reconciles approved decisions and later corrections with the build contract. Earlier questions and rejected options are history, not additional features. Each source remains linked so an implementer can check the exact approval. The screen and control contract supplies the visual and per-control detail; this section supplies cross-screen rules.

| Source decision                                                                                                                                                                                                                                                                                                                                                                                                                   | Binding requirements                                                                                                                                                                                                                                                                                                                  | PRD location and implementation ownership                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#101 approved parity contract](https://github.com/TheDarkSkyXD/StreamFusion/issues/101#issuecomment-5464879728)                                                                                                                                                                                                                                                                                                                  | Track specification, delivery, progress, freshness, blockers, approvals and exceptions independently. Bind proof to semantic Desktop outcomes and the Android candidate. An unavailable required outcome is not a successful adaptation. Public prereleases require the full public predicate.                                        | Sections 2, 4 and 14; #126, #177, #179–#181. UI acceptance belongs to each feature, not these release gates.                                                            |
| [#102 extraction resolution](https://github.com/TheDarkSkyXD/StreamFusion/issues/102#issuecomment-5465136707)                                                                                                                                                                                                                                                                                                                     | One workspace and lockfile. Private Core internals, explicit exports, serialized timestamps, pure shared rules, app-owned adapters and shared contract suites. No module-load provider registration, blanket Mobile boundary exception, or product work before extraction completion.                                                 | Sections 8 and 15; #123–#137. Production must not import testing exports. Reuse portable provider code only after the unchanged implementation passes both runtimes.    |
| [#103 runtime architecture](https://github.com/TheDarkSkyXD/StreamFusion/issues/103#issuecomment-5465895413)                                                                                                                                                                                                                                                                                                                      | One application composition root plus feature wiring; explicit state ownership; narrow typed native modules; direct signed-in calls; token-only OAuth Worker; separate Relay with no user Platform credentials or chat archive. Capability fallback is domain policy, not a silent adapter choice.                                    | Sections 8, 9, 11 and 12; #138, #142, #144–#147, #172–#174.                                                                                                             |
| [#104 navigation amendment](https://github.com/TheDarkSkyXD/StreamFusion/issues/104#issuecomment-5465607586), [complete panels and tabs](https://github.com/TheDarkSkyXD/StreamFusion/issues/104#issuecomment-5465685378), [Media removal](https://github.com/TheDarkSkyXD/StreamFusion/issues/104#issuecomment-5465709956), [selected category](https://github.com/TheDarkSkyXD/StreamFusion/issues/104#issuecomment-5465759749) | Search replaces Find. Five destinations remain fixed. Bottom local search retains its scope. No permanent Now Playing strip or standalone Media library. Category routes carry the selected identity. Movable mini-player and Android PiP replace the old strip. All Settings panels and tab states are mandatory.                    | Section 6 and the screen and control contract; #139, #141, all screen-owning feature issues, #195.                                                                      |
| [#105 lifecycle resolution](https://github.com/TheDarkSkyXD/StreamFusion/issues/105#issuecomment-5465991836)                                                                                                                                                                                                                                                                                                                      | Device-local Product Store authority, separate bounded cache, secret custody, backup exclusion, explicit quarantine/reset, private media and export. Durable media intent precedes native effects. Reconcile journals, service generations and files. No silent playback or recording restart and no offline provider mutation queue. | Sections 10 and 11; #140, #141, #153, #155, #163–#165, #170–#171.                                                                                                       |
| [#105 final FCM resolution](https://github.com/TheDarkSkyXD/StreamFusion/issues/105#issuecomment-5470835234)                                                                                                                                                                                                                                                                                                                      | Direct FCM supersedes Expo Push Service, while retained permission and missed-event UX remains binding. One delivery mode per logical event, stable IDs, private direct-token messages, topic-overflow fallback and no guaranteed device receipt.                                                                                     | Section 12; #151, #169, #172–#174. No ExpoPushToken or sender credential in the client.                                                                                 |
| [#106 verification resolution](https://github.com/TheDarkSkyXD/StreamFusion/issues/106#issuecomment-5470880790)                                                                                                                                                                                                                                                                                                                   | Four progressive gates, isolated environments, dedicated provider identities, five physical roles, retained diagnostic retry, two clean full candidate passes, coverage and accessibility requirements, expiry and immutable exact-artifact evidence.                                                                                 | Section 14; per-feature evidence under section 6.7, #177, #179–#181. Existing artifact-integrity success alone cannot satisfy the complete current-candidate predicate. |
| [#107 PRD approval](https://github.com/TheDarkSkyXD/StreamFusion/issues/107#issuecomment-5471120773)                                                                                                                                                                                                                                                                                                                              | Approved planning baseline. Approval does not authorize a release or waive extraction, parity, evidence or Publisher controls.                                                                                                                                                                                                        | Entire PRD; this amendment expands previously underspecified screen and action detail.                                                                                  |
| [#108 device resolution](https://github.com/TheDarkSkyXD/StreamFusion/issues/108#issuecomment-5465292269) and [approved detailed answers](https://github.com/TheDarkSkyXD/StreamFusion/issues/108#issuecomment-5465264499)                                                                                                                                                                                                        | Installation and qualification are distinct. Retain six configured slots, measure two through six active videos, protect focused work and artifacts. Four-hour recording, private downloads/export, one local caption session and app-owned diagnostics remain constrained outcomes.                                                  | Sections 7, 10 and 11; #143, #160, #164–#167, #171. Later section 7.3 defines the degradation order where the earlier document differs.                                 |
| [#109 provider policy](https://github.com/TheDarkSkyXD/StreamFusion/issues/109#issuecomment-5465818588)                                                                                                                                                                                                                                                                                                                           | Official first, isolated approved compatibility only, independent signed disable, safe fallback, diagnostics and removal after one stable official replacement. Guest Follow/provider-page adaptations; Twitch chat requires login even when viewing is signed out.                                                                   | Sections 9 and 11; #145–#162, #169. Scope and role failures never become fake success or blanket app failure.                                                           |
| [#110 signing and updater resolution](https://github.com/TheDarkSkyXD/StreamFusion/issues/110#issuecomment-5470620115)                                                                                                                                                                                                                                                                                                            | Separate identities and authority; two explicit Publisher approvals; permanent signer with offline recovery; stable immutable APK delivery; no production OTA; optional foreground updater with artifact rejection and consent. Account controls, succession and signer-compromise handling remain required.                          | Sections 13, 14 and 18.6; #175, #176, #178, #181. Mockup prerelease/hourly/background choices are superseded.                                                           |
| [#121 graph approval](https://github.com/TheDarkSkyXD/StreamFusion/issues/121#issuecomment-5471275135)                                                                                                                                                                                                                                                                                                                            | Preserve existing issue identities and dependency-ordered implementation. The original 59-ticket graph is the baseline, not proof that every UI action was specified.                                                                                                                                                                 | Section 15 and the roadmap. The user's 2026-09-07 amendment makes UI/UX part of every feature's closure and adds the pre-promotion #195 checkpoint.                     |

### 18.1 Navigation, discovery and content rules

- The account shortcut opens Accounts inside More. Selecting the current primary destination returns its nested history to root; the next repeat scrolls the root to the top. Android Back dismisses the nearest overlay before leaving a nested route or the task.
- Search History retains at most ten unique Channel, Stream and Category queries per search type locally. Repeat, remove and clear are distinct actions. Typing, submitting, clearing, changing a filter and switching a tab preserve the owning screen's context. Local search does not become global Search.
- Search uses All, Channels, Streams, Videos, Clips and Categories. Following uses Live, Videos, Clips, Categories and Channels, with live channels before offline channels and explicit Guest or account relationship identity. Recommendations do not appear as followed channels.
- Category cards open their own category identity, artwork, title, summary, scoped search and shareable route. Category tabs retain Live Streams, Clips and Videos plus Platform, language, tag and sort controls.
- The user's Category Videos correction requires Twitch VOD results rather than live streams in that tab. Live streams belong in Live Streams. Kick recorded-content support remains a separate approved compatibility capability elsewhere; this correction does not silently remove all Kick videos or clips from the app.
- Typed identity survives every transition: circular Channel avatar, 16:9 Stream/Video/Clip thumbnail, 3:4 Category artwork, Platform identity and disambiguating type/time metadata. Missing art uses a labeled fallback, not unrelated sample art.
- Partial-provider errors preserve successful results, show the failed Platform, and expose scoped retry. Refresh, pagination and filter changes must not duplicate records, merge unlike content types, or allow a late response from an old context to replace the current result set.

### 18.2 Watch, engagement and media rules

- Single and Multistream share one focused session for audio, chat, captions and PiP. Converting Single to Multistream preserves the current stream as focused. Returning to Single retains the configured room until explicit clear/end.
- Compact Watch has closed, peek and expanded supporting-sheet states. Chat, Info, Related and playback tools use that region instead of stacked independent overlays. Wider layouts use a supporting pane without losing selection or media state.
- The mini-player moves among safe snap regions without covering primary navigation or floating search. Expand, pause and close act on the existing session. Android PiP and the mini-player are mutually exclusive. Backgrounding pauses nonfocused video slots and preserves their configuration.
- Provider login, scopes and channel authority control chat and moderation actions. Unsupported tools have a capability-specific explanation. Pending commands, rejection, rate limits, cancellation and reconnect gaps are visible. Remote chat/moderation commands never become offline queued work or notification actions.
- Recording, download and export state appears at the originating content, in Activity and in required Android notifications. There is no separate Downloads destination. Commands reconcile by job identity and generation. A stale running flag is not proof that a native service still runs.
- Downloads resume only when source/range or segment validation allows it. Partial output remains private and incomplete until verified and finalized. Export copies through an explicit Android destination and preserves the private source unless separately deleted.
- Recording warns before the four-hour certified background window, finalizes recoverable segments at cutoff or interruption, and permits explicit foreground continuation when constraints allow. Stop, crash, reboot, network loss, low storage and OS timeout must report honest state and preserve recoverable output.
- Captions use one English 43.11 MiB model and one focused session. The user sees model size, download/install state, resource impact, errors and removal. Decoded program PCM stays local. There is no microphone-permission request, uploaded audio or cloud-transcription fallback.
- Device qualification derives from measured workloads rather than a model/RAM/version allowlist. Requalification follows a native update, Android update or material profile change. Temporary heat, memory, battery, network or storage pressure degrades visibly rather than silently revoking support. Safety demotion may be immediate; recovery requires stable evidence and hysteresis.

### 18.3 Accounts and follow rules

Twitch Device Code exposes readable/copyable code, verification destination, waiting state, provider-controlled polling, cancellation, expiry, denied scopes and retry. Kick PKCE retains one active attempt's verifier and expected state, validates the exact callback, and rejects stale or mismatched attempts. Neither flow reports connection before validated credentials are committed atomically.

One coordinator per Platform serializes refresh, checks generation and scopes, and exposes auth-lost state to affected features. Account switch or disconnect invalidates affected requests and secrets without deleting unrelated Guest Follows, History, Activity, settings or private media. Credentials and raw callback secrets never enter logs or report previews.

Guest Follow is a device-local mutation available while signed out and offline. Account follow actions without an approved official write path use Guest Follow plus an explicit provider-page action. Do not infer provider-account synchronization from a local follow toggle. A partial or unavailable provider read must not erase a previously valid follow set as if an authoritative empty result had arrived.

### 18.4 Activity, notifications and recovery rules

Activity includes channel alerts, media-job progress and recovery, actionable device degradation, eligible moderation alerts, updates and account/maintenance notices. All, Channels and Jobs filter the same durable inbox. Read count and item state agree after mutations and restart.

Duplicate ingestion preserves the existing read timestamp as required in section 10.4. Opening an item resolves its current destination; an ended stream opens ended Channel/detail state. An alert for a job returns to its actual source content and job controls. Malformed, unsupported or stale routes fail safely without creating a sixth destination or restarting playback.

Per-item dismissal is available only for completed Activity. Clear completed is an explicitly global local operation: its confirmation and persisted result state that it applies across All, Channels, and Jobs, even when invoked from a filtered tab. It captures eligible completed IDs when its confirmation opens, then rechecks active and missing IDs at execution; newly arriving completed items are not silently added to that confirmation. It leaves active jobs visible, reports already-dismissed/missing/active outcomes truthfully, and never cancels work or changes Android notification delivery. Local dismissal metadata migrates with Product Store schema changes, survives restart and duplicate delivery, and remains subject to the retention rules in section 10.4.

Permission-denied and unavailable-FCM states keep local Activity usable. Guest notification eligibility does not require Platform login. Registration and preference reconciliation runs after launch, foregrounding, token rotation, reinstall, account or preference changes and network recovery. One logical event uses topic or direct delivery, never both deliberately. Overflow preferences retain direct-token delivery eligibility. Permanent payload, credential and unregistered-token failures are surfaced rather than retried blindly.

After force-stop, delivery is not promised until reopening. Reopening reconciles identity, registration, preferences, jobs and Activity and exposes relevant interruption health. A missed still-live event uses its original start time; an ended missed event adds Activity without a stale system interruption.

### 18.5 Settings, diagnostics and destructive actions

All 17 Settings panels and their individual controls belong to the feature issue that implements the relevant behavior. The screen and control contract lists each control, its expected outcome and any unresolved default or range. Settings changes update the authoritative owner, show failure, and survive restart where durable. A displayed toggle must not claim that an OS permission, provider integration or native capability is enabled when only a local preference changed.

Clear Cache affects only disposable cache and images. Product reset, account disconnect, deleting private media, removing a caption model and clearing history are distinct operations with exact scope and appropriate confirmation. Cancel has no side effect. Storage pressure does not silently delete completed media. Recovery preserves artifacts before an explicit destructive reset.

Diagnostics adapts Desktop support outcomes to app-owned Android observations: structured redacted logs, memory/storage/network/battery/thermal state, media decoder and dropped-frame health, caption/job health, available ANR and process-exit evidence, capability/degradation state, report bundles and recovery. It does not promise arbitrary process signaling, other-app inspection or production logcat access. All six tabs remain distinct and testable.

Report creation offers a redacted preview, collection/progress/failure state, and explicit share/export action. Reports exclude credentials, push tokens, relay secrets, private provider content and unnecessary device identifiers. Debug proof controls and simulated prototype metrics do not satisfy user-facing Diagnostics or support workflows.

### 18.6 Publisher and update safeguards

The Publisher uses the approved individual Android Developer Console identity and controls the StreamFusion Expo organization. Package registration binds the permanent application ID and production signer before publication. Repository access, Expo membership and signing/publication authority remain distinct. Production credentials are unavailable to ordinary pull-request workflows.

Signing-key recovery uses two encrypted offline backups with secrets stored separately. EAS is the operational copy, not a backup. A drill restores in isolation and confirms the pinned certificate using a nonproduction test artifact. A lost operational copy pauses production until recovery. Confirmed compromise freezes signing/publication; the application ID is retired unless a tested rotation protects every supported API. Checksums do not revoke a compromised signer.

Publisher succession uses official package-account transfer, Expo/GitHub role transfer, authenticated encrypted keystore handoff, rotation of nonsigning credentials, preserved package/signer continuity and a witnessed recovery drill. These are Publisher tasks, not authority granted to an implementation agent.

The update prompt is optional. Install requests unknown-source access only after user intent and always delegates final consent to Android. Unsafe remote capability disablement cannot lock local data, force an update or erase data. Public prerelease, stable release and production OTA policies remain those in sections 3, 4 and 13.

### 18.7 Later user amendments and delivery ownership

The 2026-09-07 user direction is binding: implement the full UI and UX inside every feature issue and complete integrated UI review before release promotion. #195 owns continuous reconciliation and cross-feature consistency, not deferred page construction.

The root launcher retains Electron option 1 and Mobile option 3. Mobile source, configuration, assets, tests and dependency declarations belong under `apps/mobile`; root owns orchestration and the approved single workspace/lockfile. npm may hoist generated dependencies at the ignored root. Real launch proof uses the root menu. The Expo Go fast path must reuse a warm emulator and meet the accepted under-one-minute cold-start requirement on the measured workstation; custom-native proof uses the matching development client. Expo Go cannot prove unsupported native capabilities.

Portrait primary controls remain upright, visible and reachable. Tablet/foldable adaptations are separate supported layouts, not permission to replace the requested portrait presentation. No desktop release, paid device service, production signing change or publication is authorized by this PRD amendment.

## 19. Remaining explicit decisions and build readiness

This expansion makes approved screens and discussed workflows binding. It does not invent answers to questions the source material did not settle.

| ID            | Unresolved detail                                                                                                                                                               | Required resolution and owner                                                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPEN-PERF     | Exact absolute startup, frame, memory and caption-lag budgets, measurement durations and hysteresis thresholds for device qualification are incomplete in the approved sources. | #143 and #177 propose reproducible measured limits for review before qualification claims. The existing two-video floor, 43.11 MiB model, four-hour recording, 10% regression bound and section 14 limits remain binding. Do not substitute arbitrary mockup metrics. |
| RESOLVED-SEQUENCE | The user confirmed that all work stays before release. #143 delivers the complete measurement/degradation foundation; #196 performs full qualification after real media workflows exist. | #196 preserves full physical-device capacity, workload mitigation, recovery and artifact/UI evidence. It requires the media implementations and #177, finishes before #195's final completion, and directly blocks #178 through #181. #195 starts its continuous review immediately; #143 retains its foundation UI and proof. No issue is closed by this split and OPEN-PERF remains unresolved. |
| OPEN-CONTROLS | Some mockup control defaults, numeric limits or unsupported Platform choices are sample data rather than an approved rule.                                                      | Each owning feature resolves the entries identified in the screen and control contract from approved Desktop behavior and Android policy, or records a specific product decision. Do not remove the control silently or implement a sample value as policy.           |
| OPEN-PROOF    | Required physical-device and exact-candidate evidence may not yet exist.                                                                                                        | Feature owners record missing evidence honestly under section 6.7. #195 and release gates cannot turn it into a pass. Evidence collection is separate from the specification's completeness.                                                                          |

An unresolved detail blocks only the affected acceptance, unless the dependency graph makes it a prerequisite. Unaffected approved work continues in issue order. No feature closes with required UI deferred, an unresolved business rule hidden behind a working button, or missing proof labeled complete.
