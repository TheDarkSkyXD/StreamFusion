# Mobile screen and control contract

This document is a normative companion to [the mobile implementation specification](streamfusion-mobile-implementation-specification.md). It defines the Android UI contract that feature issues must deliver before they close. It does not make the HTML prototype's sample accounts, measurements, option values, defaults, or status labels into product policy.

The source mockup is [android-navigation-prototype.html](prototypes/android-navigation-prototype.html). Run `node docs/research/streamfusion-mobile/mobile-screen-and-control-contract-check.mjs` to compare its declared screens, tabs, settings panels, and `data-action` names with this contract. The revised inventory includes 34 screens, 42 tabs, 17 panels, and an expanded action set reported by the checker. Sheets expose secondary tools without adding primary destinations.

## Authority and delivery rule

Run `node docs/research/streamfusion-mobile/mobile-mockup-fixture-check.mjs` for pure JavaScript fixture checks across the 67 review scenarios and selected state transitions. This check generates HTML strings without a browser; it cannot establish visual layout, focus behavior, provider integration or native Android correctness.

The target is the complete Desktop feature set with mobile-ready interaction, not a reduced feature set that happens to match this mockup. Feature owners compare the current Desktop screen, menus, controls, settings and workflow tests against the Mobile contract. An omitted Desktop outcome must be added to the mockup and this contract, or mapped to a specifically approved Android adaptation. Small screens move secondary tools into accessible sheets, menus, tabs and nested routes; they do not remove tools. PRD section 4.1 governs this comparison before each feature closes.

The implementation specification and approved grilling decisions control business rules. This contract controls the required Android UI, interaction states, and navigation. Where the prototype conflicts with either, the later approved rule wins.

Each owning issue must include the complete UI and UX for its controls, transitions, accessibility labels, success state, loading state, empty state, failure state, permission state, and lifecycle state before closure. A feature cannot defer its screen or settings panel to a release milestone. Issue #195 verifies the cross-feature result. It does not postpone implementation that an owner issue already specifies.

The owner references below identify existing issue scopes. A shared control requires coordination among every listed owner. A reference does not create a new feature or change dependency order.

## Shared shell and state rules

### Desktop outcomes that must remain reachable on Mobile

This comparison supplements the page inventory; it is not permission to omit other Desktop controls discovered during implementation. The HTML interactions are simulated fixtures, not provider or Android integration evidence.

| Desktop source                                                                                                                          | Required mobile-ready outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Owners                       |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `apps/desktop/src/frontend/features/playback/components/player/player-controls.tsx` and `settings-menu.tsx`                             | Touch-accessible transport, seek, volume, quality, speed, fullscreen/theater adaptation, PiP, caption track selection, local model install/cancel/remove/retry, caption text size/background opacity, and video statistics. Unsupported controls explain the actual media/provider/device limitation.                                                                                                                                                                            | #152, #153, #154, #166, #167 |
| `apps/desktop/src/frontend/features/multistream/components/screens/MultiStream/index.tsx` and `chat/components/chat/MergedChatFeed.tsx` | Configured-slot editing and measured active-video limits; merged and per-channel chat views with visible source identity, source-to-channel navigation, and a channel-specific composer. Switching presentation does not duplicate connections or bypass Android hidden-chat rules.                                                                                                                                                                                              | #156, #157, #160             |
| `apps/desktop/src/frontend/features/moderation/components/screens/Mod/channel/workspace/ChannelWorkspace.tsx`                           | A reachable mobile tools chooser for AutoMod queue/policy, Shield Mode, blocked terms, stream information, activity, suspicious users, community, whispers, rewards, active moderators, channel navigation, and provider-native tools in addition to the existing moderation tabs. Preserve role/scope checks, destructive confirmation, retryable provider failures, and explicit handoffs where the provider requires them. Do not copy Desktop window docking onto the phone. | #159, #168                   |
| `apps/desktop/src/shared/diagnostics-types.ts` and `settings/components/screens/Settings/diagnostics/DiagnosticsWorkspace.tsx`          | Real time, 5-minute, 30-minute, 1-hour, 24-hour, 7-day, 30-day, and 90-day views; observed peaks with timestamps, incidents, app-owned contributors, and explicit collection gaps/unavailable data. Recovery acts on managed app runtimes, never arbitrary operating-system processes. Fixture history does not prove Android retention or hardware qualification.                                                                                                               | #143, #171                   |

Paths abbreviated after a complete feature path refer to the same Desktop frontend feature tree. Each owning feature records its source revision, control/state comparison, approved Android adaptations, and observed Mobile evidence before closing.

### Navigation and lifecycle

The shell has a top app bar, destination content, a movable mini-player only during active playback after navigation, a search dock when applicable, and five primary destinations: Search, Following, Watch, Activity, and More. There is no persistent currently-playing strip. The selected destination uses both a visual selected state and an accessible selected state. Nested routes show a back control that returns to their parent without losing the parent list position or selected tab.

Search, Following, category detail, channel detail, Watch, Video, Activity, Moderation, and Diagnostics use the tab sets in this document. A tab switch changes only that screen's selected tab. It must not silently start playback, mutate a remote provider, or discard an unsent local form.

Every actionable control has an accessible name, visible pressed, selected, disabled, and busy state where applicable. A control that starts work disables duplicate activation until the operation reaches a terminal state. A failed operation keeps the user input, states what failed without exposing a secret, and offers a retry when retry is safe. A success state names the result and the current destination.

Lists support these states when their data source applies:

- Loading. Show a bounded skeleton or progress state. Keep prior data visible as stale data when it is safe to do so.
- Empty. Explain why no rows exist and provide a route or action that can change the condition.
- Error. Show the failed source and a retry control. Preserve filters, query text, and selected tab.
- Offline. Mark cached data with its age. Remote mutations fail visibly unless their workflow has an approved idempotent retry contract.
- Partial provider result. Show the usable provider result and identify the unavailable provider without erasing usable rows.

Permission requests occur in context. Notification permission follows PRD 12.3. A denial leaves Activity available and exposes a settings retry path. Android installer permission states explain the capability, request platform access only after user intent, and show a recoverable denied state. Captions never request microphone permission. StreamFusion does not request broad storage permission.

On background, process death, reboot, and offline transitions, the UI follows PRD 10.3. In particular, restoring a route never silently restarts playback. The user must start playback again. Long-running media work shows its durable job state after restoration. Destructive local-data operations remain separate confirmed actions.

## Screen hierarchy

The following routes are the complete prototype screen set. `settings-<panel>` is a route, not an inline overlay. The `system` route is the Diagnostics overview entry. Parentage specifies Back behavior.

| Contract route                                            | Label                 | Parent and required content                                                                                                                  | Existing owners                    |
| --------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| <!-- contract:screen:search -->`search`                   | Search                | Primary destination. Query, result-type tabs, platform filters, live-only filter, recent local searches, and results.                        | #130, #132, #133, #147, #149       |
| <!-- contract:screen:home -->`home`                       | Home                  | More. Combined discovery sections and provider-aware recovery states.                                                                        | #130, #131, #132, #147, #148       |
| <!-- contract:screen:categories -->`categories`           | Categories            | More. Browse games and topics. A row opens category detail.                                                                                  | #130, #132, #133, #147, #150       |
| <!-- contract:screen:category-detail -->`category-detail` | Category detail       | Categories or Search. Category identity, provider context, content tabs, filters, and paginated results.                                     | #130, #132, #133, #147, #150       |
| <!-- contract:screen:following -->`following`             | Following             | Primary destination. Account and Guest Follow results with explicit sign-in and sync states.                                                 | #134, #147, #151                   |
| <!-- contract:screen:channel -->`channel`                 | Channel detail        | Search, Home, Categories, Following, Activity, or notification route. Channel identity, live or ended state, follow state, and content tabs. | #130, #132, #133, #147, #148, #151 |
| <!-- contract:screen:watch -->`watch`                     | Live stream viewer    | Primary destination and deep destination. Player, channel context, selected audio owner, chat/info/related tabs, and safe playback errors.   | #152, #153, #156, #157, #167       |
| <!-- contract:screen:video -->`video`                     | Video and clip viewer | Channel, Search, History, or deep destination. Player, media metadata, seek state, and details/comments/related tabs.                        | #133, #153, #154                   |
| <!-- contract:screen:multi -->`multi`                     | Multistream           | More. Configured slots, measured active-limit feedback, audio ownership, degradation, and recovery.                                          | #143, #160, #167                   |
| <!-- contract:screen:history -->`history`                 | History               | More. Durable local history with remove and clear confirmations. Reopening media does not autoplay after restoration.                        | #155                               |
| <!-- contract:screen:activity -->`activity`               | Activity              | Primary destination. Durable local notification and job inbox with read state, tab filters, and safe event routes.                           | #141, #151, #172, #173, #174       |
| <!-- contract:screen:moderation-home -->`moderation-home` | Managed channels      | More. Eligible workspaces only, with clear account and provider eligibility states.                                                          | #159, #168                         |
| <!-- contract:screen:moderation -->`moderation`           | Moderation room       | Managed channels. Channel identity, permissions, moderation tabs, confirmation, result, and provider-failure states.                         | #159, #168                         |
| <!-- contract:screen:settings -->`settings`               | Settings              | More. The 17 panels below, grouped by their declared section.                                                                                | #167, #168, #170                   |
| <!-- contract:screen:accounts -->`accounts`               | Accounts              | More. Connected account, guest mode, notification eligibility, connect, refresh, callback failure, and disconnect states.                    | #135, #145, #146, #151             |
| <!-- contract:screen:system -->`system`                   | Diagnostics           | More. Diagnostics overview and an entry to the Diagnostics settings panel.                                                                   | #143, #170, #171                   |
| <!-- contract:screen:more -->`more`                       | More                  | Primary destination. Cards for Home, Categories, Multistream, History, Moderation, Accounts, Settings, and Diagnostics.                      | #139, #141                         |

### Settings routes

| Contract route                                                                                                     | Panel label        | Parent and owner                             |
| ------------------------------------------------------------------------------------------------------------------ | ------------------ | -------------------------------------------- |
| <!-- contract:screen:settings-appearance --><!-- contract:panel:appearance -->`settings-appearance`                | App and appearance | Settings. #167, #170                         |
| <!-- contract:screen:settings-playback --><!-- contract:panel:playback -->`settings-playback`                      | Playback           | Settings. #152, #153, #154, #166, #167       |
| <!-- contract:screen:settings-player-controls --><!-- contract:panel:player-controls -->`settings-player-controls` | Player controls    | Settings. #153, #167                         |
| <!-- contract:screen:settings-buffer --><!-- contract:panel:buffer -->`settings-buffer`                            | Buffer             | Settings. #152, #153, #167                   |
| <!-- contract:screen:settings-multiview --><!-- contract:panel:multiview -->`settings-multiview`                   | Multiview          | Settings. #143, #160, #167                   |
| <!-- contract:screen:settings-notifications --><!-- contract:panel:notifications -->`settings-notifications`       | Notifications      | Settings. #141, #151, #169, #172, #173, #174 |
| <!-- contract:screen:settings-chat --><!-- contract:panel:chat -->`settings-chat`                                  | Chat               | Settings. #156, #157, #158, #168             |
| <!-- contract:screen:settings-predictions --><!-- contract:panel:predictions -->`settings-predictions`             | Predictions        | Settings. #156, #157, #168                   |
| <!-- contract:screen:settings-adblock --><!-- contract:panel:adblock -->`settings-adblock`                         | Ad blocking        | Settings. #161, #169                         |
| <!-- contract:screen:settings-proxy --><!-- contract:panel:proxy -->`settings-proxy`                               | Proxy              | Settings. #162, #169                         |
| <!-- contract:screen:settings-integrations --><!-- contract:panel:integrations -->`settings-integrations`          | Integrations       | Settings. #135, #145, #146, #168             |
| <!-- contract:screen:settings-api-tokens --><!-- contract:panel:api-tokens -->`settings-api-tokens`                | API and tokens     | Settings. #135, #145, #146, #168             |
| <!-- contract:screen:settings-updates --><!-- contract:panel:updates -->`settings-updates`                         | Updates            | Settings. #170, #175, #176, #178             |
| <!-- contract:screen:settings-diagnostics --><!-- contract:panel:diagnostics -->`settings-diagnostics`             | Diagnostics        | Settings. #143, #170, #171                   |
| <!-- contract:screen:settings-logs --><!-- contract:panel:logs -->`settings-logs`                                  | Logs               | Settings. #143, #170, #171                   |
| <!-- contract:screen:settings-report-bug --><!-- contract:panel:report-bug -->`settings-report-bug`                | Report a bug       | Settings. #170, #171                         |
| <!-- contract:screen:settings-about --><!-- contract:panel:about -->`settings-about`                               | About              | Settings. #167, #170                         |

## Tab contract

Each tab is a labeled, keyboard-accessible tab with a matching tab panel. The first tab in each group is the initial UI selection only. It is not a policy default for data retention, playback, quality, notifications, or provider behavior.

| Screen          | Tabs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Required behavior                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Search          | <!-- contract:tab:search:all -->All, <!-- contract:tab:search:channels -->Channels, <!-- contract:tab:search:streams -->Streams, <!-- contract:tab:search:videos -->Videos, <!-- contract:tab:search:clips -->Clips, <!-- contract:tab:search:categories -->Categories                                                                                                                                                                                                                                                 | Scope the same query and selected provider filters to the selected result kind.                         |
| Following       | <!-- contract:tab:following:live -->Live, <!-- contract:tab:following:videos -->Videos, <!-- contract:tab:following:clips -->Clips, <!-- contract:tab:following:categories -->Categories, <!-- contract:tab:following:channels -->Channels                                                                                                                                                                                                                                                                             | Show only items the current guest or account follow source permits.                                     |
| Category detail | <!-- contract:tab:category-detail:live -->Live, <!-- contract:tab:category-detail:clips -->Clips, <!-- contract:tab:category-detail:videos -->Videos                                                                                                                                                                                                                                                                                                                                                                   | Keep category identity and filters. Videos must not include live streams.                               |
| Channel detail  | <!-- contract:tab:channel:home -->Home, <!-- contract:tab:channel:videos -->Videos, <!-- contract:tab:channel:clips -->Clips                                                                                                                                                                                                                                                                                                                                                                                           | Keep the selected channel. An ended channel routes to a valid ended detail rather than a broken player. |
| Watch           | <!-- contract:tab:watch:chat -->Chat, <!-- contract:tab:watch:info -->Info, <!-- contract:tab:watch:related -->Related                                                                                                                                                                                                                                                                                                                                                                                                 | Opening or closing Chat changes chat visibility. Chat disconnects when not visible under PRD 10.3.      |
| Video           | <!-- contract:tab:video:details -->Details, <!-- contract:tab:video:comments -->Comments, <!-- contract:tab:video:related -->Related                                                                                                                                                                                                                                                                                                                                                                                   | Keep the current media identity and playback position.                                                  |
| Activity        | <!-- contract:tab:activity:all -->All, <!-- contract:tab:activity:channels -->Channels, <!-- contract:tab:activity:jobs -->Jobs                                                                                                                                                                                                                                                                                                                                                                                        | Filter the durable inbox without changing read state.                                                   |
| Moderation      | <!-- contract:tab:moderation:chat -->Chat, <!-- contract:tab:moderation:retention -->Retention, <!-- contract:tab:moderation:mod-log -->Mod log, <!-- contract:tab:moderation:banned -->Banned, <!-- contract:tab:moderation:engagement -->Engagement, <!-- contract:tab:moderation:unban -->Unban, <!-- contract:tab:moderation:moderators -->Moderators, <!-- contract:tab:moderation:vips -->VIPs, <!-- contract:tab:moderation:activity -->Activity, <!-- contract:tab:moderation:active-mods -->Active moderators | Enforce channel-specific provider permissions for each panel and action.                                |
| Diagnostics     | <!-- contract:tab:settings-diagnostics:overview -->Overview, <!-- contract:tab:settings-diagnostics:resources -->Resources, <!-- contract:tab:settings-diagnostics:io -->I/O, <!-- contract:tab:settings-diagnostics:traces -->Traces, <!-- contract:tab:settings-diagnostics:logs-reports -->Logs and reports, <!-- contract:tab:settings-diagnostics:developer-tools -->Developer tools                                                                                                                              | Show bounded, redacted local diagnostic data. Android does not expose arbitrary process control.        |

## Page layout and control contract

The prototype supplies the following component order. Sample names, viewer counts, stream state, device state, and metrics are fixtures. Each route uses a vertical scroll container with the shell above it. A row is never the only representation of its content identity: live rows show channel, title, category, Platform, and live status; recorded rows show content type, title, channel, duration or position when known, and Platform.

Each prototype `data-screen` control is the assigned `navigate:<route-id>` action. It validates that the destination has the required typed identity before navigation. The source builders are `searchScreen`, `homeScreen`, `categoriesScreen`, `categoryDetailScreen`, `followingScreen`, `channelScreen`, `watchScreen`, `videoScreen`, `multistreamScreen`, `historyScreen`, `activityScreen`, `moderationHomeScreen`, `moderationScreen`, `settingsScreen`, `accountsScreen`, `systemScreen`, and `moreScreen`. Settings panel declarations are in `settingsDefinitions` and `settingDetailScreen`. Tab declarations are in `tabReviewGroups`. Toggle, choice, range, and field declarations are in `settingToggle`, `settingChoice`, `settingRange`, and `settingField`.

### Search

Source anchors: `searchScreen`, `searchResults`, and `searchHistory`.

`search` renders, in order, a title, the local thumb-reachable Search dock or a focused field, result-type tabs, Platform and Live-only filters, a local-history heading and clear control, history rows, a result heading, and the selected result composition. All-results uses a best-match channel row, live stream cards, and category cards. Channels uses channel rows. Streams uses stream cards. Videos and Clips use recorded rows. Categories uses category cards.

`submit-search`, `clear-search-field`, and `open-search-dock` are assigned controls. They preserve the current query context and use the normal stale-request cancellation path. `repeat-search`, `remove-search`, `clear-search-history`, `search-tab`, `search-platform`, and `toggle-live-only` use the declared action contract. Search history rows contain a type marker, local-device source, repeat action, and remove action. The clear operation affects only search history.

### Home

Source anchor: `homeScreen`.

`home` renders a title row with a Categories route action, then a Recommended live heading and a vertical stream-card feed. Each stream card has a 16:9 thumbnail, live and viewer metadata, title, channel avatar and name, category, Platform badge, and language tag. Activating the card routes to Watch with that stream identity.

`open-categories` is an assigned route action. Refresh, pagination, recommendation order, language tags, and provider recovery use the Home owner workflow. The prototype has no Home refresh button. A production refresh affordance needs an explicit owner decision and must not be represented by a fixture count.

### Categories

Source anchor: `categoriesScreen`.

`categories` renders a title row, a Language button, then a grid of category cards. A category card contains 3:4 artwork, category name, and a compact live or viewer summary. `open-category` carries the selected category identity into `category-detail`.

The prototype renders `Language` without an action name or handler. `category-language-filter` is an assigned filter control. Its supported languages, whether it is single or multi-select, and its initial selection are unresolved. It remains visibly unavailable until #150 records that decision.

### Category detail

Source anchor: `categoryDetailScreen`.

`category-detail` renders a category identity header with artwork, title, cross-Platform summary, and Follow control. It then renders category tabs, the ordered Platform, Language, Tags, and Sort filters, a result heading, and the selected content list. Live uses stream cards. Clips and Videos use recorded rows. The Videos tab must exclude live streams.

`follow-category`, `category-platform-filter`, `category-language-filter`, `category-tags-filter`, and `category-sort` are assigned controls. The prototype does not declare their handlers or option policy. #150 and the follow owner must define their permitted values, persistence, and provider support. Before then, a rendered button must show unavailable state rather than simulate a selection.

### Following

Source anchor: `followingScreen`.

`following` renders a title row with Manage, Following tabs, ordered All, Live, Twitch, and Kick filter chips, then selected content. Live uses a notification-status notice followed by stream cards. Videos and Clips use recorded rows. Categories uses category cards. Channels uses channel rows that identify Guest Follow or account origin and notification state.

`manage-follows`, `following-source-filter`, and `following-live-filter` are assigned controls. They open the follow-management route or change only the visible source filter. The prototype does not settle the management sheet layout, filter defaults, or account-sync write behavior. #134, #147, and #151 own those decisions.

### Channel detail

Source anchor: `channelScreen`.

`channel` renders a channel identity header with avatar, follower and Platform identity, Guest Follow or account relationship, and a Follow or Following control. It renders channel tabs, selected content, then an About card. Home renders current live or offline notice before recent broadcasts. Videos and Clips render recorded rows with their respective order label.

`set-channel-follow` is an assigned control. It follows PRD 18.3: account writes require an approved official path; otherwise the UI offers Guest Follow and an explicit provider-page action. `open-channel-about` is a read-only route or disclosure action. The prototype's Follow and Following labels do not prove provider mutation support.

### Watch

Source anchors: `watchScreen`, `videoStage`, and `chatPanel`.

`watch` renders the player stage before the selected Chat, Info, or Related supporting sheet. Compact Watch uses closed, peek, and expanded sheet states. Only one supporting sheet or pane is active. A wide layout may place the selected sheet beside the player without losing the stream identity or playback state.

The player stage contains preview or video surface, live or media state, effective quality, channel identity, title, viewer or media metadata, and mute state. It requires `play-pause`, `seek-back`, `seek-forward`, `set-quality`, `set-volume`, `toggle-mute`, `enter-fullscreen`, `enter-pip`, and `toggle-captions` controls when the current media and capability support them. The revised mockup exposes transport and player-settings controls, with sheets for secondary operations. Its simulated controls do not prove playback integration. Unsupported operations must explain their actual limitation. Player-controls Settings governs visibility only. It does not bypass capability policy.

The Info sheet renders channel and stream identity, Follow, Add to Multistream, Start recording, and local-caption status. `set-channel-follow`, `add-multistream-slot`, `start-recording`, and `manage-local-captions` are assigned controls. Recording opens a confirmation sheet that names foreground-service behavior and the active stream. Local captions opens model install, removal, unavailable, and resource-impact states. Captions use decoded program PCM only. They never request microphone permission, upload audio, or offer cloud fallback.

The Chat sheet renders a connection header, message list, composer, Send action, and close action. It also requires `open-emote-picker` and `chat-message-action` controls when the provider supports them. `send-chat-message` validates login, scope, message content, and current channel before one direct send. The prototype's "Message as Guest" placeholder does not authorize guest Twitch chat. Closed or hidden chat disconnects while playback remains. The list shows reconnect state and a gap marker after an unrecoverable replay gap. Message actions are provider-scoped and never notification actions or offline queued mutations.

The Related sheet renders a heading and recorded rows. Selecting one opens Video with its typed media identity. `dismiss-player` pauses or closes the current session before removing the movable mini-player. The mini-player appears only while active playback survives in-app navigation, never as a permanent strip, and is mutually exclusive with Android PiP.

### Video and Clip viewer

Source anchor: `videoScreen`.

`video` renders a video surface, playback overlay, scrubber with current position and duration, channel and media identity row, Video tabs, then selected panel content. Details contains Download, Share, Save, and an About card. Comments contains a count, message list, composer, and Send action. Related contains typed recorded rows.

`play-pause`, `seek-to-position`, `enter-fullscreen`, `set-quality`, `download-media`, `share-media`, and `save-media` are assigned controls. Download creates a durable media job only after the user chooses it. Share uses an explicit Android destination and never presents incomplete output as complete. Save has no implied provider write until its owner records whether it means a local list, Guest Follow relation, or approved provider action. The prototype renders a comment composer, but no approved provider-comment workflow exists in this contract. `send-video-comment` remains disabled with an explanation until an owner approves a provider path.

### Multistream

Source anchors: `multistreamScreen` and `slot`.

`multi` renders a title with configured-slot count and active-video count, Edit, a visible degradation notice when applicable, a six-slot grid, then recovery controls. Each slot has stream identity, thumbnail, active or paused mode, and audio-owner state. Selecting a capable active slot uses `audio-owner`.

`edit-multistream`, `add-multistream-slot`, `remove-multistream-slot`, `reorder-multistream-slot`, and `set-multistream-mode` are assigned controls. Edit opens a sheet with configured slots separate from active-video capacity. Add and reorder retain typed stream identity. Remove asks for confirmation if it ends active playback. Mode changes show the effective result after qualification. `restore-slot` and `cool-device` remain requests, not guarantees. The revised mockup adds slot-edit and merged/channel-chat interactions; #160 must deliver their real validation and lifecycle behavior before shipping.

### History

Source anchor: `historyScreen`.

`history` renders a title row with Clear, then local history rows. Each row has a typed Stream, Video, or Clip marker, thumbnail, title, channel, Platform, watched time, and watched-progress indicator when progress exists. A Stream row opens Watch. A Video or Clip row opens Video. Reopening a row restores route and saved position where valid. It never silently resumes playback after process restoration.

`clear-history`, `remove-history-row`, and `resume-history-item` are assigned controls. Clear and remove use a confirmation sheet and affect only History. The prototype lacks per-row removal and progress UI. #155 must add both rather than treating the fixture rows as complete history behavior.

### Activity

Source anchor: `activityScreen`.

`activity` renders a title row with unread count and Mark read, Activity tabs, then typed Activity rows. A row includes stable event identity, visual, title, timestamp, source or Platform, read state, and a current safe route. All combines channel, job, and system events. Channels and Jobs filter the same durable inbox.

`mark-all-activity-read` and `open-activity-item` are assigned controls. Opening an item may mark that item read after its route resolves. It does not reset other read state. An ended stream opens ended Channel or detail state. A malformed or stale destination fails safely. The prototype's Mark read control has no handler, so it is not evidence that bulk read is implemented.

### Managed channels

Source anchor: `moderationHomeScreen`.

`moderation-home` renders a title, eligible managed-channel rows, a Global retention summary, and a Platform-permission notice. A row contains channel identity, Platform, current live or room status, and routes to its Moderation room. The page shows only workspaces for which the selected account has a supported moderation session.

`select-managed-channel` and `open-global-retention` are assigned controls. The latter opens the Retention tab for the selected scope. A missing scope, expired session, or unsupported provider renders an explanation rather than an editable room.

### Moderation room

Source anchor: `moderationScreen`.

`moderation` renders a room title with selected channel and Platform, Switch channel, moderation tabs, then the selected panel. Chat contains current moderator-session state, typed message cards, Delete, Timeout, Ban, room-health controls, and Clear chat. Retention contains channel and global choice controls. Mod log contains filters and typed log rows. Banned contains typed rows and Unban. Engagement contains poll and prediction status with create actions. Unban contains request detail, Deny, Review log, and Approve. Moderators and VIPs contain typed membership rows and Remove.

The revised mockup adds a managed-channel chooser and channel-tools sheets. The assigned controls in the Moderation controls table define their minimum production result, including membership removal and log filtering. Each remote action opens the relevant confirmation or input sheet, validates current scope and channel authority, submits once, and reports success, rejection, rate limit, cancellation, or provider failure. None is queued offline. No fixture result counts as a provider mutation.

### Settings

Source anchors: `settingsScreen`, `settingsDefinitions`, and `settingDetailScreen`.

`settings` renders grouped panel cards in this order: App, Viewing, Experience, Accounts and network, then System and support. A card shows the panel label, summary, and route action. It does not expose a setting's sample state as the actual effective device or provider state. Each panel route returns to Settings without losing scroll position.

The individual panel layouts and controls are normative in Settings-control contract. Each inline field provides label, description, current safe value or state, validation feedback, and save result. Secret fields never prefill or reveal their stored value.

### Accounts

Source anchor: `accountsScreen`.

`accounts` renders account rows for connected and guest mode, then Account notifications. Each row states connection mode, available features, and Platform identity. The notification area shows Live alerts and Moderation alerts as summaries of their authoritative preference and registration state. It must not render a local switch that claims delivery is enabled when Android permission, registration, or relay reconciliation has failed.

`connect-account`, `manage-account`, `disconnect-account`, `account-live-alerts`, and `account-moderation-alerts` are assigned controls. Connect opens the OAuth flow. Manage opens scopes, expiry, supported features, and refresh state without secret values. Disconnect requires confirmation and preserves unrelated Guest Follows, History, Activity, settings, and private media. Account alert controls route to the authoritative notification preference when a separate per-account preference exists. The revised mockup's account and permission sheets are fixtures, not authenticated sessions.

### Diagnostics overview

Source anchors: `systemScreen` and `diagnosticsTabContent`.

`system` renders a Diagnostics title and Run check, a capability and device-health notice, Playback and chat status, then cards for device and media health, the latest diagnostic report, and accounts and notifications. It also renders one Installation and capability policy card with separately labeled registration and effective-policy states. The card shows only safe environment, generation, issued, reconciliation, verification, expiry, checked time, and age-at-last-check metadata; it never displays installation identifiers, credentials, keys, FCM tokens, or raw signed payloads. A Product-store presence marker distinguishes a later missing credential from first installation without storing identity material. Existing development data with neither marker nor credential remains an unavoidable legacy first-install ambiguity. `run-check` opens bounded progress and result state. Report Share routes to the redacted report review. The cards route to the Diagnostics, Logs, Report a bug, or Accounts settings panels as appropriate.

The Diagnostics settings tabs render these distinct content sets: Overview shows qualification, active-slot, storage, and degradation state; Resources shows bounded CPU and memory observations plus `diagnostic-window`; I/O shows bounded read and write observations plus `diagnostic-io-window`; Traces shows bounded redacted operation traces; Logs and reports shows report and runtime-log actions; Developer tools shows the Android-safe warning and `diagnostic-detail`. Android never exposes arbitrary process control, other-app inspection, or production logcat. Prototype metrics are fixtures, not qualification proof.

### More

Source anchor: `moreScreen`.

`more` renders a title, then cards in this order: Home, Categories, Multistream, History, Moderation, Accounts, Settings, and Diagnostics. A card has an icon, label, concise purpose, and route action. More is the parent for all of these secondary routes. The account avatar in the app bar opens More. It does not skip directly to a hidden account page.

## Sheets, confirmations, and lifecycle paths

Only one supporting sheet or pane is active in Watch. Android Back dismisses the nearest open sheet, then returns through route history, then leaves the task. The keyboard moves the local Search dock above it and does not obscure the active field or submit control.

| Path                          | Required sheet or terminal path                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OAuth and account connection  | Show verification destination or callback waiting, cancel, expiry, denial, and retry. Commit account state only after validated credentials.                                         |
| Notification enable           | Explain the alert capability, request Android permission after explicit intent, preserve Activity after denial, then show registration and reconciliation state.                     |
| Download, recording, captions | Show destination or durable job intent, capacity or model requirement, progress, cancellation, failure, and recovery. Recording states foreground-service implications before start. |
| Multistream edit              | Show configured slots, active capability result, add, remove, reorder, and mode actions. Preserve configured slots when active capacity is lower.                                    |
| Destructive local action      | Name the exact affected data, give Cancel and confirm, and report completion or failure. Clear history, remove media, disconnect accounts, and reset app are separate paths.         |
| Remote moderation action      | Show selected channel, user or message, scope, and any required input before one submission. Show provider result or safe retry state.                                               |
| Update install                | Show validation result, download progress, cancellation, storage error, rejected artifact, and explicit Android PackageInstaller consent.                                            |

## Action contract

The following table retains the original 25 `data-action` values; the expanded interactions table adds the new controls. When a feature implements or claims an action, it maps the action to the stated effect, exposes busy and terminal feedback, and records no secret in UI state or logs. This declaration inventory does not prove that a native workflow exists or is complete.

| Action                                                              | Effect and terminal behavior                                                                                                                                                                            | Owners                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| <!-- contract:action:activity-tab -->`activity-tab`                 | Select the requested Activity tab. Invalid values retain the current tab.                                                                                                                               | #141, #151            |
| <!-- contract:action:audio-owner -->`audio-owner`                   | Make the selected eligible active Multistream slot the one audio owner. Reject an unavailable slot with an explanation.                                                                                 | #143, #160            |
| <!-- contract:action:category-tab -->`category-tab`                 | Select the requested category tab and retain category identity.                                                                                                                                         | #130, #150            |
| <!-- contract:action:channel-tab -->`channel-tab`                   | Select the requested channel tab and retain channel identity.                                                                                                                                           | #130, #151            |
| <!-- contract:action:clear-search-history -->`clear-search-history` | Ask for confirmation, then remove only local search history. Report success or failure.                                                                                                                 | #149, #170            |
| <!-- contract:action:cool-device -->`cool-device`                   | Re-evaluate device capability after a user signals recovery. The measurement, thresholds, and hysteresis remain unresolved. Do not promote suspended streams solely from this signal.                   | #143, #160            |
| <!-- contract:action:cycle-setting -->`cycle-setting`               | Change one enumerated setting to the next allowed value after validation, persist it, and announce the new value. The prototype option lists are not approved value sets unless an owner issue says so. | owning settings issue |
| <!-- contract:action:diagnostics-tab -->`diagnostics-tab`           | Select the requested Diagnostics tab. Invalid values retain the current tab.                                                                                                                            | #143, #171            |
| <!-- contract:action:dismiss-player -->`dismiss-player`             | Pause or close the existing playback session, then dismiss the mini-player. It must not leave hidden audible playback.                                                                                  | #152, #153            |
| <!-- contract:action:following-tab -->`following-tab`               | Select the requested Following tab and retain guest or account context.                                                                                                                                 | #134, #151            |
| <!-- contract:action:moderation-tab -->`moderation-tab`             | Select the requested moderation tab after eligibility checks. Show an unavailable state when the account lacks permission.                                                                              | #159, #168            |
| <!-- contract:action:open-category -->`open-category`               | Navigate to category detail with the selected category identity.                                                                                                                                        | #130, #150            |
| <!-- contract:action:remove-search -->`remove-search`               | Remove one local search-history entry. Do not change remote search results.                                                                                                                             | #149                  |
| <!-- contract:action:repeat-search -->`repeat-search`               | Put the selected saved query into Search and submit it through the normal query workflow.                                                                                                               | #149                  |
| <!-- contract:action:restore-slot -->`restore-slot`                 | Request restoration of one configured Multistream slot. Capability qualification may decline the request and must explain why.                                                                          | #143, #160            |
| <!-- contract:action:refresh-capability-policy -->`refresh-capability-policy` | Refresh the signed capability policy. While busy the control says Refreshing policy and is disabled. Failure preserves a verified unexpired cache or baked safe fallback with a typed visible reason. | #144 |
| <!-- contract:action:retry-installation-registration -->`retry-installation-registration` | Retry only the persisted installation registration or rotation operation. While busy the control says Retrying installation and is disabled. Terminal corrupt or expired-replay states preserve Product data and do not offer retry. | #144 |
| <!-- contract:action:run-check -->`run-check`                       | Start a bounded diagnostics qualification or collection run. Show progress, result, artifacts, and retry eligibility.                                                                                   | #143, #171            |
| <!-- contract:action:search -->`search`                             | Focus the visible Search input or navigate to Search and focus it. It does not add a sixth primary destination.                                                                                         | #139, #149            |
| <!-- contract:action:search-platform -->`search-platform`           | Select All, Twitch, or Kick as a query filter. A provider failure remains visible after selection.                                                                                                      | #132, #149            |
| <!-- contract:action:search-tab -->`search-tab`                     | Select the requested Search result type.                                                                                                                                                                | #132, #149            |
| <!-- contract:action:toggle-chat -->`toggle-chat`                   | Open or close Watch chat. Closing disconnects chat when it is not visible.                                                                                                                              | #156, #157            |
| <!-- contract:action:toggle-density -->`toggle-density`             | Toggle the explicit compact-chat-density preference, persist it, and update the visible message spacing.                                                                                                | #167, #168            |
| <!-- contract:action:toggle-live-only -->`toggle-live-only`         | Add or remove the live-only Search filter and refresh the current result set.                                                                                                                           | #132, #149            |
| <!-- contract:action:toggle-setting -->`toggle-setting`             | Toggle one boolean setting after validation, persist it, and show an unavailable reason when the capability cannot take effect.                                                                         | owning settings issue |
| <!-- contract:action:video-tab -->`video-tab`                       | Select the requested Video tab and retain media identity.                                                                                                                                               | #154                  |
| <!-- contract:action:watch-tab -->`watch-tab`                       | Select the requested Watch tab and apply chat visibility lifecycle behavior.                                                                                                                            | #152, #156            |

### Expanded mockup interactions

The `data-player-volume` range is the mockup binding for assigned `set-volume`. It displays its current percentage and changes the focused player's volume only. It is an input event control, not a `data-action` button, so the action-declaration count does not include it.

<!-- contract:action:activity-mark-read -->

`activity-mark-read` implements the assigned bulk-read action for Activity (#141, #172). The fixture must visibly mark its items read; production preserves existing read timestamps during duplicate ingest.

<!-- contract:action:sheet-fixture-action -->

`sheet-fixture-action` dispatches the selected contextual fixture operation with visible result or an explicit unavailable/rejected state. It must not send provider requests. Production replaces this demonstration dispatcher with each owning feature's validated workflow.

These action IDs extend the original inventory. A fixture demonstrates the shape of the interaction, not a completed Android or provider workflow. Controls that remain unmodeled must say so instead of reporting a successful operation.

| Prototype action                                                          | Required interaction                                                                                                         | Owners               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| <!-- contract:action:player-play-pause -->`player-play-pause`             | Toggle transport and announce the resulting state.                                                                           | #152, #153           |
| <!-- contract:action:player-seek-back -->`player-seek-back`               | Seek backward within the current seekable range; unavailable for non-seekable live playback.                                 | #153, #154           |
| <!-- contract:action:player-seek-forward -->`player-seek-forward`         | Seek forward within the current seekable range.                                                                              | #153, #154           |
| <!-- contract:action:player-mute -->`player-mute`                         | Change mute state without transferring audio focus.                                                                          | #153                 |
| <!-- contract:action:player-speed -->`player-speed`                       | Select a supported media playback rate and show the effective rate.                                                          | #153, #154           |
| <!-- contract:action:player-quality -->`player-quality`                   | Select quality with a visible effective value and provider fallback.                                                         | #152, #153           |
| <!-- contract:action:player-theater -->`player-theater`                   | Adapt player emphasis without replacing the active session.                                                                  | #152                 |
| <!-- contract:action:player-stats -->`player-stats`                       | Show measured playback statistics and unavailable fields.                                                                    | #153, #171           |
| <!-- contract:action:player-fullscreen -->`player-fullscreen`             | Enter and leave the Android fullscreen presentation while retaining session identity.                                        | #152, #153           |
| <!-- contract:action:player-pip -->`player-pip`                           | Request supported Android PiP, mutually exclusive with the in-app mini-player.                                               | #153                 |
| <!-- contract:action:player-captions -->`player-captions`                 | Choose available tracks/local captions and reach caption appearance and model management.                                    | #166                 |
| <!-- contract:action:caption-model -->`caption-model`                     | Install, cancel, retry or remove the local English model with state and resource feedback.                                   | #166                 |
| <!-- contract:action:chat-emotes -->`chat-emotes`                         | Open the picker and insert the selected emote into the current local draft without sending.                                  | #156, #157, #158     |
| <!-- contract:action:chat-context -->`chat-context`                       | Open message-specific reply, profile and eligible moderation actions.                                                        | #156, #157, #159     |
| <!-- contract:action:chat-send -->`chat-send`                             | Validate channel/account eligibility; submit once or preserve the draft with the failure reason.                             | #156, #157           |
| <!-- contract:action:channel-follow -->`channel-follow`                   | Distinguish Guest Follow from provider follow/handoff.                                                                       | #151                 |
| <!-- contract:action:multistream-add -->`multistream-add`                 | Add the current typed stream within the configured-slot bound.                                                               | #160                 |
| <!-- contract:action:multistream-edit -->`multistream-edit`               | Select, add, remove, reorder and focus configured slots independently of measured active-video capacity.                     | #160                 |
| <!-- contract:action:multi-chat-mode -->`multi-chat-mode`                 | Select merged or channel chat without duplicating connections.                                                               | #156, #157, #160     |
| <!-- contract:action:multi-chat-channel -->`multi-chat-channel`           | Use a message's source identity to select its channel view and composer.                                                     | #156, #157, #160     |
| <!-- contract:action:job-record -->`job-record`                           | Confirm an explicit recording start with foreground service, capacity and durable-job states.                                | #165                 |
| <!-- contract:action:job-download -->`job-download`                       | Start a supported VOD/Clip download, or explain unsupported live media without creating a job.                               | #164                 |
| <!-- contract:action:job-details -->`job-details`                         | Inspect the selected media job and its eligible pause, resume, cancel, retry, playback and export actions.                   | #164, #165           |
| <!-- contract:action:history-clear -->`history-clear`                     | Confirm clearing History only, then render its empty state.                                                                  | #155                 |
| <!-- contract:action:history-remove -->`history-remove`                   | Remove only the selected typed History entry after confirmation.                                                             | #155                 |
| <!-- contract:action:moderation-switch -->`moderation-switch`             | Choose an eligible managed channel and re-evaluate role/scope/provider policy.                                               | #159                 |
| <!-- contract:action:moderation-tools -->`moderation-tools`               | Reach the complete touch-accessible channel tools workspace described above.                                                 | #159, #168           |
| <!-- contract:action:connect-account -->`connect-account`                 | Select Twitch Device Code or Kick PKCE, including pending, denied, expired and retry states; Guest mode remains separate.    | #145, #146           |
| <!-- contract:action:manage-account -->`manage-account`                   | Inspect scope/expiry/refresh status without showing secrets.                                                                  | #145, #146           |
| <!-- contract:action:disconnect-account -->`disconnect-account`           | Confirm a targeted disconnect while preserving Guest and unrelated data.                                                     | #145, #146           |
| <!-- contract:action:copy-account-code -->`copy-account-code`             | Copy only the public Device Code user code.                                                                                    | #145                 |
| <!-- contract:action:open-account-verification -->`open-account-verification` | Open the validated provider verification page.                                                                              | #145                 |
| <!-- contract:action:cancel-account-connect -->`cancel-account-connect`   | Cancel and fence the active account connection attempt.                                                                       | #145, #146           |
| <!-- contract:action:retry-account-connect -->`retry-account-connect`     | Supersede a terminal or safely retryable account connection attempt.                                                          | #145, #146           |
| <!-- contract:action:notification-permission -->`notification-permission` | Request alerts in context, show denial/retry, and keep local Activity available.                                             | #172, #173, #174     |
| <!-- contract:action:check-updates -->`check-updates`                     | Check the latest stable release manually; do not bypass validation or Android installer consent.                             | #170, #175, #176     |
| <!-- contract:action:mini-player-pause -->`mini-player-pause`             | Pause/resume the existing session without navigating or spawning another player.                                             | #152, #153           |
| <!-- contract:action:demo-option -->`demo-option`                         | Select a fixture sheet option. Production replaces fixture dispatch with typed feature workflows.                            | #195; owning feature |
| <!-- contract:action:close-sheet -->`close-sheet`                         | Cancel/dismiss the sheet, retain the appropriate draft, and return focus to the invoking control.                            | #139; owning feature |
| <!-- contract:action:confirm-sheet -->`confirm-sheet`                     | Validate and apply the specific fixture operation; production must expose busy and terminal states for the actual operation. | #195; owning feature |

`Build report`, `Share`, `Open`, and local-data controls also require the typed workflows below. A visible button or explanatory fixture sheet alone is not proof of an implementation.

## Settings-control contract

Every setting and supporting action has a stable ID, visible label, value presentation, terminal result, and unavailable state. A setting change validates at the boundary. If a requested preference cannot take effect on the current provider or device, retain the preference only when the owner workflow supports deferred application, then explain the current effective state. Otherwise reject the change without overwriting the saved value.

The prototype supplies keys for toggles, choices, and ranges. This document assigns IDs to its unlabeled field controls. Assigned IDs are marked `assigned`. Numeric bounds, choice lists, initial values, and sample text in the prototype are examples only until the owning issue records approved values and validation rules.

### Caption appearance and model selection

| ID                           | Required behavior                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `caption-track`              | Choose an available provider track, the supported local English model, or Off. Do not imply additional local language support. |
| `caption-text-size`          | Adjust caption text size with a readable preview and accessible value.                                                         |
| `caption-background-opacity` | Adjust caption background opacity with a legible preview; preserve contrast over moving video.                                 |

The local model manager exposes installed, installing, canceled, failed/retry and removed states. No fixture selection proves decoding, download integrity or native model execution. Numeric appearance bounds remain owned by #166.

### App and appearance controls

| ID and label                           | Control and required behavior                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `theme` Theme                          | Choice. Apply the selected supported Android theme and persist the preference. Supported values and fallback policy are unresolved. |
| `density` Content density              | Choice. Apply list, chat, and control spacing without changing content order.                                                       |
| `language` Language                    | Choice. Change the app interface language after available translation resources load. The supported locale list is unresolved.      |
| `restore-session` Restore last session | Toggle. Restore a valid prior route and its local UI state after process restart. Do not restore playback.                          |
| `resume-playback` Resume playback      | Toggle. This must never cause silent restart. Any user-confirmed resumption flow and metered-network behavior remain unresolved.    |

### Playback

| ID and label                                   | Control and required behavior                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quality` Default quality                      | Choice. Request the preferred quality when the provider offers it. Show the effective quality and a provider fallback.                                                |
| `carousel` Featured carousel timing            | Range. Change the local discovery carousel interval. Bounds and default are unresolved.                                                                               |
| `captions` Local captions                      | Toggle. Enable local captions only when a required model and compatible playback session are available. Route to model setup or show a recoverable unavailable state. |
| `token-player` Access-token player type        | Choice. Select an eligible player-token strategy. Provider eligibility and values belong to #161 and #169.                                                            |
| `hevc` Allow HEVC (H.265)                      | Toggle. Allow a compatible HEVC stream. Show the effective codec and fallback reason.                                                                                 |
| `stream-device-id` Stream device ID `assigned` | Protected field. Display only a safe identifier state. Never expose a credential. Regeneration and override policy are unresolved.                                    |

### Player controls

| ID and label                | Control and required behavior                                                    |
| --------------------------- | -------------------------------------------------------------------------------- |
| `control-0` Quality         | Toggle visibility of the applicable player Quality control.                      |
| `control-1` Playback speed  | Toggle visibility of the applicable player Playback speed control.               |
| `control-2` Volume          | Toggle visibility of the applicable player Volume control.                       |
| `control-3` Fullscreen      | Toggle visibility of the applicable player Fullscreen control.                   |
| `control-4` Theater         | Toggle visibility of the applicable player Theater control.                      |
| `control-5` Video Stats     | Toggle visibility of the applicable player Video Stats control.                  |
| `rewind` Rewind             | Choice. Select the approved backwards seek interval for Video and Clip playback. |
| `fast-forward` Fast forward | Choice. Select the approved forwards seek interval for Video and Clip playback.  |

### Buffer

| ID and label                         | Control and required behavior                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `low-latency` Low-latency mode       | Toggle. Request live-edge tracking. Show when provider, network, or device safety limits override it.             |
| `target-latency` Target live latency | Range. Set the requested segment distance behind the live edge. Bounds and capability interaction are unresolved. |
| `forward-buffer` Forward buffer      | Range. Set the requested ahead-of-playback buffer. Bounds and memory policy are unresolved.                       |
| `max-buffer` Maximum buffer          | Range. Set the requested buffer cap. The runtime must show an effective lower cap when safety rules require it.   |

### Multiview

| ID and label                                   | Control and required behavior                                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `multiview-cap` Maximum concurrent Streams     | Range. Limit configured slots. The measured active video limit can be lower while retaining configured slots. Exact thresholds and hysteresis remain unresolved. |
| `background-quality` Background-Stream quality | Choice. Request quality behavior for non-focused slots. Show effective state after device and provider qualification.                                            |

### Notifications

| ID and label                                  | Control and required behavior                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `android-notifications` Android notifications | Toggle remote Android delivery. On first enable, request permission in context. Denial leaves Activity active and shows a retry path. |
| `live-activity` Live Notification history     | Toggle durable Activity creation for eligible live events. It does not grant Android notification permission.                         |
| `toast` In-app banners                        | Toggle foreground in-app banners. Activity writes remain independent.                                                                 |
| `sound` Sound                                 | Toggle notification sound for eligible delivered alerts. Respect Android channel settings.                                            |
| `notify-twitch` Twitch                        | Toggle eligible Twitch live-alert coverage.                                                                                           |
| `notify-kick` Kick                            | Toggle eligible Kick live-alert coverage.                                                                                             |
| `notify-guest` Guest Follow notifications     | Toggle eligible Guest Follow alert coverage without creating account ownership.                                                       |
| `favorites-only` Favorites only               | Toggle restriction to selected followed channels. The selection source is unresolved.                                                 |
| `restart-grace` Restart grace                 | Choice. Set the approved duplicate or restart-alert cooldown. Exact values are unresolved.                                            |

### Chat and predictions

| ID and label                        | Control and required behavior                                                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat-font` Font size               | Range. Apply message-text size while preserving accessibility scaling.                                                                                                                               |
| `emote-size` Emote size             | Range. Apply rendered emote size without overflow or hidden controls.                                                                                                                                |
| `chat-density` Message density      | Choice. Apply vertical message spacing.                                                                                                                                                              |
| `bttv` BetterTTV                    | Toggle provider-supported BetterTTV emotes. Show unavailable asset or provider state.                                                                                                                |
| `ffz` FrankerFaceZ                  | Toggle provider-supported FrankerFaceZ emotes. Show unavailable asset or provider state.                                                                                                             |
| `seventv` 7TV                       | Toggle provider-supported 7TV emotes. Show unavailable asset or provider state.                                                                                                                      |
| `message-limit` Message limit       | Range. Bound the locally retained in-memory chat window. It does not create a durable hosted chat transcript. The approved reconnect gap-marker rule remains in effect. Exact bounds are unresolved. |
| `chat-polls` Polls                  | Toggle display of eligible poll events.                                                                                                                                                              |
| `chat-predictions` Predictions      | Toggle display of eligible prediction events.                                                                                                                                                        |
| `deleted-messages` Deletion notices | Toggle display of eligible deletion and chat-clear events.                                                                                                                                           |
| `prediction-style` Style            | Choice. Select the approved prediction-card presentation. It must not change provider settlement or moderation rules.                                                                                |

### Ad blocking and proxy

| ID and label                         | Control and required behavior                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `adblock` Enable ad blocking         | Toggle provider-specific eligible ad-block handling. It must state unsupported-provider and fallback behavior.                       |
| `adblock-method` Method              | Choice. Choose an approved token strategy. Values and availability belong to #161 and #169.                                          |
| `proxy-enabled` Enable proxy         | Toggle selected eligible request classes through a validated proxy configuration.                                                    |
| `proxy-host` Host `assigned`         | Text field. Validate hostname or IP address before saving. Do not attempt a connection until the user chooses a connection workflow. |
| `proxy-port` Port `assigned`         | Numeric field. Validate the port range before saving.                                                                                |
| `proxy-username` Username `assigned` | Protected text field. Save through the approved credential boundary when credentials are supported.                                  |
| `proxy-password` Password `assigned` | Secret field. Mask input and save only through the native credential adapter. Never render, log, or export the value.                |
| `proxy-token` Playback access token  | Toggle whether eligible token requests use the proxy.                                                                                |
| `proxy-master` Multivariant playlist | Toggle whether eligible master-playlist requests use the proxy.                                                                      |
| `proxy-media` Media playlist         | Toggle whether eligible media-playlist requests use the proxy.                                                                       |

### Accounts and API status

| ID and label                               | Control and required behavior                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `integration-manage` Manage `assigned`     | Action. Open the connected account's management view. It shows account, scopes, supported features, refresh result, and disconnect action without exposing token values. |
| `integration-connect` Connect `assigned`   | Action. Start the supported platform OAuth flow with cancel, callback failure, and account-selection states.                                                             |
| `api-token-status` Token status `assigned` | Read-only status. Show provider connection, expiry state, and scopes. Never show a token, refresh token, or secret.                                                      |

### Updates

| ID and label                                                                           | Control and required behavior                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `update-status` Current version `assigned`                                             | Read-only status. Show installed version and whether a checked stable release is available, invalid, unavailable, or rejected.                                                                                                                                                                            |
| `check-for-updates` Check now `assigned`                                               | Action. Check only the latest stable GitHub release. Validate schema, application ID, monotonic version, expected signer, and APK digest before offering a resumable app-private download. Native code revalidates the completed artifact. Android PackageInstaller always requires explicit user action. |
| `automatic-foreground-update-checks` Check automatically while foregrounded `assigned` | Toggle. Permit optional automatic checks only while the app is foregrounded. When enabled, automatic checks run no more than once per 24 hours. They do not block startup.                                                                                                                                |

The revised prototype uses `automatic-foreground-updates` for the assigned automatic foreground check preference. The old `prerelease`, `startup-updates`, and `update-frequency` controls are superseded and removed. PRD 13.4 permits a manual stable-release check and optional automatic foreground checks no more than once per 24 hours. There is no prerelease channel, hourly cadence, daily or weekly user cadence, or background startup check. This rule is owned by #170, #175, #176, and #178.

### Diagnostics, logs, report, and about

| ID and label                                           | Control and required behavior                                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diagnostic-window` Observation window                 | Choice. Select Real time, 5m, 30m, 1h, 24h, 7d, 30d or 90d resource history; show missing collection intervals explicitly.                                        |
| `diagnostic-io-window` Observation window              | Choice. Select the corresponding bounded I/O history window, preserving explicit gaps and unavailable measurements.                                               |
| `diagnostic-detail` Detailed collection                | Toggle bounded selected-subject detail. Android never offers arbitrary process control.                                                                           |
| `log-level` Minimum level                              | Choice. Filter visible local log entries. It does not change redaction rules.                                                                                     |
| `log-source` Source                                    | Choice. Filter visible local log entries by source.                                                                                                               |
| `report-description` What happened? `assigned`         | Text field. Keep the user's report locally until Build report or explicit discard.                                                                                |
| `attach-logs` Attach redacted logs                     | Toggle inclusion of redacted logs. The report preview must show that redaction ran.                                                                               |
| `attach-profile` Attach Capability Profile             | Toggle inclusion of the Capability Profile and runtime-degradation state.                                                                                         |
| `build-report` Build report `assigned`                 | Action. Build a local diagnostic report. It uploads nothing automatically. Show report contents, redaction result, output state, and safe share or export action. |
| `share-diagnostic-report` Share `assigned`             | Action. Open Android sharing only after the user reviews the redacted report artifact. Report an unavailable share target without losing the artifact.            |
| `open-runtime-logs` Open `assigned`                    | Action. Open the filtered, redacted local runtime-log view. It must not expose production logcat, credentials, or private provider content.                       |
| `open-source-licenses` Open-source licenses `assigned` | Route to bundled license notices. It works offline.                                                                                                               |
| `privacy` Privacy `assigned`                           | Route to the app privacy notice. It identifies local and remote data handling.                                                                                    |
| `clear-history` Clear history `assigned`               | Separate destructive action. Confirm, remove only History, then report result.                                                                                    |
| `remove-media` Remove media `assigned`                 | Separate destructive action. Select media, confirm, remove only selected app-private media, then report result.                                                   |
| `disconnect-accounts` Disconnect accounts `assigned`   | Separate destructive action. Confirm each account, revoke or remove local credentials as supported, then report result.                                           |
| `reset-app` Reset the app `assigned`                   | Separate destructive action. Confirm after explaining Product Store, cache, credentials, and recoverable media handling. Follow PRD 10.2.                         |

### Moderation controls

| ID and label                                      | Control and required behavior                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `channel-retention` Channel retention             | Choice. Set one managed channel's moderation-log retention override after permission and provider validation. Approved values and retention limits are unresolved. |
| `global-retention` All managed Channels           | Choice. Set the default moderation-log retention used only when a channel has no override. Approved values and retention limits are unresolved.                    |
| `delete-message` Delete `assigned`                | Action. Confirm when policy requires, delete only the selected eligible message, and show the provider result.                                                     |
| `timeout-user` Timeout `assigned`                 | Action. Collect an approved duration, validate authority, submit once, and show the provider result.                                                               |
| `ban-user` Ban `assigned`                         | Action. Confirm the selected eligible user and scope, submit once, and show the provider result.                                                                   |
| `set-slow-mode` Slow mode `assigned`              | Action. Change eligible channel slow-mode state after scope validation and show the effective value.                                                               |
| `set-followers-mode` Followers `assigned`         | Action. Change eligible channel follower-only mode after scope validation and show the effective value.                                                            |
| `clear-chat` Clear chat `assigned`                | Destructive action. Confirm the selected eligible channel, submit once, and show the provider result.                                                              |
| `moderation-log-filter` Mod log filter `assigned` | Filter the local visible moderation-log view without mutating provider data.                                                                                       |
| `unban-user` Unban `assigned`                     | Action. Confirm the selected eligible banned user, submit once, and show the provider result.                                                                      |
| `create-poll` New poll `assigned`                 | Action. Collect valid poll input and submit only when the provider and account permit it.                                                                          |
| `create-prediction` New prediction `assigned`     | Action. Collect valid prediction input and submit only when the provider and account permit it.                                                                    |
| `deny-unban-request` Deny `assigned`              | Action. Confirm and record the eligible unban-request decision.                                                                                                    |
| `review-unban-log` Review log `assigned`          | Route to the selected requester's relevant moderation history.                                                                                                     |
| `approve-unban-request` Approve `assigned`        | Action. Confirm and submit the eligible approval once.                                                                                                             |
| `switch-managed-channel` Switch `assigned`        | Action. Open the eligible managed-channel selector and retain the current room until the user chooses another channel.                                             |
| `remove-moderator` Remove moderator `assigned`    | Destructive action. Confirm the selected eligible membership and show the provider result.                                                                         |
| `remove-vip` Remove VIP `assigned`                | Destructive action. Confirm the selected eligible membership and show the provider result.                                                                         |

All Moderation controls belong to #159 and #168. They have permission-denied, signed-out, unsupported-provider, busy, result, retry, and provider-failure states. The prototype's sample durations, retention values, users, and messages are not approved policy.

## Screen-specific state obligations

Search cancels stale requests when query, tab, or platform changes. It keeps the latest query visible. Search history is local, bounded, and independently clearable.

Discovery, categories, and Following preserve usable provider results when another provider fails. Sign-in availability, Guest Follow availability, account-sync status, and pagination errors must be distinct states.

Watch and Video show loading, live or VOD state, ended or unavailable state, recovery state, and user-visible quality or codec fallback. PiP and fullscreen transitions retain the selected item and do not duplicate playback. Chat reports connection, reconnect, gap-marker, send-eligibility, and failure state.

Multistream retains configured slots when qualification reduces active playback. It shows the selected audio owner, every paused or degraded slot, the reason, and a safe recovery action. The user cannot infer hardware qualification from prototype sample counts or labels.

Activity preserves event identity, timestamp, delivery source, read state, and relevant channel or job route across restart. Duplicate delivery must not create a duplicate entry or reset an item from read to unread.

Diagnostics reports live device and job evidence with collection age and redaction result. A successful check must identify what it measured. A failed check must retain bounded failure evidence. A diagnostic card is not proof that a capability is qualified unless its owner issue provides the required measured evidence.

## Prototype linkage and unresolved decisions

The mockup supplies layout, labels, navigation IDs, tab IDs, settings keys, and action names. It does not approve any sample account, selected provider, numerical limit, timer value, option list, default value, media state, device metric, status claim, or test result.

These decisions remain open and must be recorded by their owners before implementation claims completion:

- Capability qualification thresholds, duration, hysteresis, and recovery policy for Multistream and diagnostics. #143 and #160.
- Supported settings option sets, numeric ranges, defaults, migrations, and reset behavior where this document marks them unresolved. The panel owner and #167, #168, or #170 as applicable.
- The user-confirmed resume flow after route restoration. It must remain compatible with PRD 10.3's no-silent-playback rule. #152, #153, and #155.
- Favorites selection semantics, notification restart cooldown values, and supported notification combinations. #141, #151, #172, #173, and #174.
- Proxy connection-test workflow and provider request eligibility. #162 and #169.

This contract deliberately rejects stale update mockup behavior. It does not treat a prototype's appearance as authorization to implement a product rule.
