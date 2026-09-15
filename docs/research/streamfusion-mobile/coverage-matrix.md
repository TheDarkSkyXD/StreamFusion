# Mobile coverage matrix

This matrix is the #195 inventory. It is not a claim that every feature is done.
Specification, implementation, and verification stay separate. Feature owners keep their screens.

Source revisions are the files in this commit. The checker fails when a contract screen, tab, panel, action, or shell route appears or disappears without a matching row.

## Totals

| Status | Count |
| --- | ---: |
| Implemented | 99 |
| Partial | 13 |
| Placeholder | 4 |
| Missing | 69 |
| Discovered | 185 |

Implemented means the current candidate has a working control or screen for that row.
Placeholder means the shell can open a saved-place route.
Missing means no route or control exists yet.

## Source register

| Source | Role |
| --- | --- |
| #104 approved prototype B and later amendments | Navigation model |
| [Screen and control contract](mobile-screen-and-control-contract.md) | Screens, tabs, panels, actions |
| [Implementation specification](streamfusion-mobile-implementation-specification.md) | Business rules |
| `apps/mobile/src/features/shell/domain/shell-navigation.ts` | Current shell routes |
| #110 updater policy | Supersedes mockup prerelease and hourly update choices |

## Inventory

| Id | Status | Owners | Implementation | Verification |
| --- | --- | --- | --- | --- |
| `screen:search` | implemented | #130, #132, #133, #147, #149 | apps/mobile/src/features/discovery/components/unified-search-screen.tsx | tests |
| `screen:home` | implemented | #130, #131, #132, #147, #148 | apps/mobile/src/features/discovery/components/home-live-discovery-screen.tsx | tests |
| `screen:categories` | implemented | #130, #132, #133, #147, #150 | apps/mobile/src/features/discovery/components/categories-screen.tsx | tests |
| `screen:category-detail` | implemented | #130, #132, #133, #147, #150 | apps/mobile/src/features/discovery/components/category-detail-screen.tsx | tests |
| `screen:following` | implemented | #134, #147, #151 | apps/mobile/src/features/follows/components/following-workspace.tsx | tests |
| `screen:channel` | implemented | #130, #132, #133, #147, #148, #151 | apps/mobile/src/features/discovery/components/channel-detail-screen.tsx | tests |
| `screen:watch` | implemented | #152, #153, #156, #157, #167 | apps/mobile/src/features/watch/components/watch-screen.tsx | tests |
| `screen:video` | implemented | #133, #153, #154 | apps/mobile/src/features/watch/components/watch-screen.tsx | tests |
| `screen:multi` | implemented | #143, #160, #167 | apps/mobile/src/features/multistream/components/multistream-view.tsx | tests |
| `screen:history` | implemented | #155 | apps/mobile/src/features/media-library/components/history-screen.tsx | tests |
| `screen:activity` | implemented | #141, #151, #163, #172, #173, #174 | apps/mobile/src/features/activity/components/activity-screen.tsx | tests |
| `screen:moderation-home` | placeholder | #159, #168 | — | missing |
| `screen:moderation` | missing | #159, #168 | — | missing |
| `screen:settings` | implemented | #167, #168, #169, #170 | apps/mobile/src/features/settings/components/settings-workspace.tsx | tests |
| `screen:accounts` | partial | #135, #145, #146, #151 | apps/mobile/src/features/auth/components/twitch-accounts-panel.tsx | missing |
| `screen:system` | partial | #143, #170, #171 | apps/mobile/src/features/capability-profile/components/capability-profile-panel.tsx | missing |
| `screen:more` | implemented | #139, #141 | apps/mobile/src/features/shell/components/app-shell.tsx | tests |
| `screen:settings-appearance` | implemented | #167 | apps/mobile/src/features/settings/components/settings-workspace.tsx | tests |
| `screen:settings-playback` | implemented | #167 | apps/mobile/src/features/settings/components/settings-workspace.tsx | tests |
| `screen:settings-player-controls` | implemented | #167 | apps/mobile/src/features/settings/components/settings-workspace.tsx | tests |
| `screen:settings-buffer` | implemented | #167 | apps/mobile/src/features/settings/components/settings-workspace.tsx | tests |
| `screen:settings-multiview` | implemented | #167 | apps/mobile/src/features/settings/components/settings-workspace.tsx | tests |
| `screen:settings-notifications` | implemented | #169 | apps/mobile/src/features/settings/components/settings-workspace.tsx, apps/mobile/src/features/settings/components/notifications-settings-panel.tsx | tests |
| `screen:settings-chat` | missing | — | — | missing |
| `screen:settings-predictions` | missing | — | — | missing |
| `screen:settings-adblock` | implemented | #161, #169 | apps/mobile/src/features/ad-blocking/components/adblock-settings-panel.tsx, apps/mobile/src/features/shell/components/app-shell.tsx | tests |
| `screen:settings-proxy` | implemented | #162, #169 | apps/mobile/src/features/connectivity/components/proxy-settings-panel.tsx | tests |
| `screen:settings-integrations` | missing | — | — | missing |
| `screen:settings-api-tokens` | missing | — | — | missing |
| `screen:settings-updates` | implemented | #170, #176 | apps/mobile/src/features/settings/components/settings-workspace.tsx, apps/mobile/src/features/settings/components/support-settings-panels.tsx | tests |
| `screen:settings-diagnostics` | implemented | #170, #171 | apps/mobile/src/features/settings/components/settings-workspace.tsx, apps/mobile/src/features/settings/components/support-settings-panels.tsx | tests |
| `screen:settings-logs` | implemented | #170, #171 | apps/mobile/src/features/settings/components/settings-workspace.tsx, apps/mobile/src/features/settings/components/support-settings-panels.tsx | tests |
| `screen:settings-report-bug` | implemented | #170, #171 | apps/mobile/src/features/settings/components/settings-workspace.tsx, apps/mobile/src/features/settings/components/support-settings-panels.tsx | tests |
| `screen:settings-about` | implemented | #170 | apps/mobile/src/features/settings/components/settings-workspace.tsx, apps/mobile/src/features/settings/components/support-settings-panels.tsx | tests |
| `panel:appearance` | implemented | #167 | apps/mobile/src/features/settings/components/settings-panels.tsx | tests |
| `panel:playback` | implemented | #167 | apps/mobile/src/features/settings/components/settings-panels.tsx | tests |
| `panel:player-controls` | implemented | #167 | apps/mobile/src/features/settings/components/settings-panels.tsx | tests |
| `panel:buffer` | implemented | #167 | apps/mobile/src/features/settings/components/settings-panels.tsx | tests |
| `panel:multiview` | implemented | #167 | apps/mobile/src/features/settings/components/settings-panels.tsx | tests |
| `panel:notifications` | implemented | #169 | apps/mobile/src/features/settings/components/notifications-settings-panel.tsx | tests |
| `panel:chat` | missing | — | — | missing |
| `panel:predictions` | missing | — | — | missing |
| `panel:adblock` | implemented | #161 | apps/mobile/src/features/ad-blocking/components/adblock-settings-panel.tsx | tests |
| `panel:proxy` | implemented | #162 | apps/mobile/src/features/connectivity/components/proxy-settings-panel.tsx | tests |
| `panel:integrations` | missing | — | — | missing |
| `panel:api-tokens` | missing | — | — | missing |
| `panel:updates` | implemented | #170, #176 | apps/mobile/src/features/settings/components/support-settings-panels.tsx | tests |
| `panel:diagnostics` | implemented | #170, #171 | apps/mobile/src/features/settings/components/support-settings-panels.tsx | tests |
| `panel:logs` | implemented | #170, #171 | apps/mobile/src/features/settings/components/support-settings-panels.tsx | tests |
| `panel:report-bug` | implemented | #170, #171 | apps/mobile/src/features/settings/components/support-settings-panels.tsx | tests |
| `panel:about` | implemented | #170 | apps/mobile/src/features/settings/components/support-settings-panels.tsx | tests |
| `tab:search:all` | implemented | #147, #149 | apps/mobile/src/features/discovery/components/search-results-view.tsx | tests |
| `tab:search:channels` | implemented | #147, #149 | apps/mobile/src/features/discovery/components/search-results-view.tsx | tests |
| `tab:search:streams` | implemented | #147, #149 | apps/mobile/src/features/discovery/components/search-results-view.tsx | tests |
| `tab:search:videos` | implemented | #147, #149 | apps/mobile/src/features/discovery/components/search-results-view.tsx | tests |
| `tab:search:clips` | implemented | #147, #149 | apps/mobile/src/features/discovery/components/search-results-view.tsx | tests |
| `tab:search:categories` | implemented | #147, #149 | apps/mobile/src/features/discovery/components/search-results-view.tsx | tests |
| `tab:following:live` | implemented | #147, #151 | apps/mobile/src/features/follows/components/following-tab-body.tsx | tests |
| `tab:following:videos` | implemented | #147, #151 | apps/mobile/src/features/follows/components/following-tab-body.tsx | tests |
| `tab:following:clips` | implemented | #147, #151 | apps/mobile/src/features/follows/components/following-tab-body.tsx | tests |
| `tab:following:categories` | implemented | #147, #151 | apps/mobile/src/features/follows/components/following-tab-body.tsx | tests |
| `tab:following:channels` | implemented | #147, #151 | apps/mobile/src/features/follows/components/following-tab-body.tsx | tests |
| `tab:category-detail:live` | implemented | #147, #150 | apps/mobile/src/features/discovery/components/category-detail-view.tsx | tests |
| `tab:category-detail:clips` | implemented | #147, #150 | apps/mobile/src/features/discovery/components/category-detail-view.tsx | tests |
| `tab:category-detail:videos` | implemented | #147, #150 | apps/mobile/src/features/discovery/components/category-detail-view.tsx | tests |
| `tab:channel:home` | implemented | #147, #148 | apps/mobile/src/features/discovery/components/channel-tabs.tsx | tests |
| `tab:channel:videos` | implemented | #147, #148 | apps/mobile/src/features/discovery/components/channel-tabs.tsx | tests |
| `tab:channel:clips` | implemented | #147, #148 | apps/mobile/src/features/discovery/components/channel-tabs.tsx | tests |
| `tab:watch:chat` | implemented | #152, #156 | apps/mobile/src/features/watch/components/watch-tabs.tsx | tests |
| `tab:watch:info` | implemented | #152, #154 | apps/mobile/src/features/watch/components/watch-tabs.tsx | tests |
| `tab:watch:related` | implemented | #152, #154 | apps/mobile/src/features/watch/components/watch-tabs.tsx | tests |
| `tab:video:details` | missing | — | — | missing |
| `tab:video:comments` | missing | — | — | missing |
| `tab:video:related` | missing | — | — | missing |
| `tab:activity:all` | implemented | — | — | tests |
| `tab:activity:channels` | implemented | — | — | tests |
| `tab:activity:jobs` | implemented | #141, #163 | — | tests |
| `tab:moderation:chat` | missing | — | — | missing |
| `tab:moderation:retention` | missing | — | — | missing |
| `tab:moderation:mod-log` | missing | — | — | missing |
| `tab:moderation:banned` | missing | — | — | missing |
| `tab:moderation:engagement` | missing | — | — | missing |
| `tab:moderation:unban` | missing | — | — | missing |
| `tab:moderation:moderators` | missing | — | — | missing |
| `tab:moderation:vips` | missing | — | — | missing |
| `tab:moderation:activity` | missing | — | — | missing |
| `tab:moderation:active-mods` | missing | — | — | missing |
| `tab:settings-diagnostics:overview` | missing | — | — | missing |
| `tab:settings-diagnostics:resources` | missing | — | — | missing |
| `tab:settings-diagnostics:io` | missing | — | — | missing |
| `tab:settings-diagnostics:traces` | missing | — | — | missing |
| `tab:settings-diagnostics:logs-reports` | missing | — | — | missing |
| `tab:settings-diagnostics:developer-tools` | missing | — | — | missing |
| `action:search` | missing | — | — | missing |
| `action:open-category` | missing | — | — | missing |
| `action:repeat-search` | missing | — | — | missing |
| `action:remove-search` | missing | — | — | missing |
| `action:search-tab` | missing | — | — | missing |
| `action:search-platform` | missing | — | — | missing |
| `action:toggle-live-only` | missing | — | — | missing |
| `action:clear-search-history` | missing | — | — | missing |
| `action:category-tab` | missing | — | — | missing |
| `action:following-tab` | missing | — | — | missing |
| `action:channel-tab` | missing | — | — | missing |
| `action:player-play-pause` | implemented | #152, #153 | apps/mobile/src/features/watch/components/player-controls.tsx | tests |
| `action:player-seek-back` | implemented | #154 | apps/mobile/src/features/watch/components/player-controls.tsx | tests |
| `action:player-seek-forward` | implemented | #154 | apps/mobile/src/features/watch/components/player-controls.tsx | tests |
| `action:player-mute` | implemented | #153 | apps/mobile/src/features/watch/components/player-controls.tsx | tests |
| `action:player-speed` | missing | — | — | missing |
| `action:player-quality` | implemented | #152, #153 | apps/mobile/src/features/watch/components/player-controls.tsx | tests |
| `action:player-theater` | missing | — | — | missing |
| `action:player-stats` | missing | — | — | missing |
| `action:player-fullscreen` | implemented | #152, #153 | apps/mobile/src/features/watch/components/player-controls.tsx | tests |
| `action:player-pip` | implemented | #153 | apps/mobile/src/features/watch/components/player-controls.tsx | tests |
| `action:player-captions` | missing | — | — | missing |
| `action:toggle-chat` | missing | — | — | missing |
| `action:chat-emotes` | missing | — | — | missing |
| `action:chat-context` | missing | — | — | missing |
| `action:chat-send` | missing | — | — | missing |
| `action:channel-follow` | implemented | #151 | apps/mobile/src/features/discovery/components/channel-header.tsx | tests |
| `action:multistream-add` | implemented | #160 | apps/mobile/src/features/multistream/components/multistream-view.tsx | tests |
| `action:job-record` | missing | — | — | missing |
| `action:job-download` | missing | — | — | missing |
| `action:job-details` | missing | — | — | missing |
| `action:watch-tab` | missing | — | — | missing |
| `action:video-tab` | missing | — | — | missing |
| `action:audio-owner` | implemented | #160 | apps/mobile/src/features/multistream/components/multistream-slot.tsx | tests |
| `action:multistream-edit` | implemented | #160 | apps/mobile/src/features/multistream/components/multistream-view.tsx | tests |
| `action:multi-chat-mode` | missing | — | — | missing |
| `action:restore-slot` | implemented | #160 | apps/mobile/src/features/multistream/components/multistream-view.tsx | tests |
| `action:cool-device` | implemented | #160 | apps/mobile/src/features/multistream/components/multistream-view.tsx | tests |
| `action:multi-chat-channel` | missing | — | — | missing |
| `action:history-remove` | implemented | #155 | apps/mobile/src/features/media-library/components/history-row.tsx | tests |
| `action:history-clear` | implemented | #155 | apps/mobile/src/features/media-library/components/history-view.tsx | tests |
| `action:activity-dismiss-item` | implemented | — | — | tests |
| `action:activity-mark-read` | implemented | — | — | tests |
| `action:activity-clear-completed` | implemented | — | apps/mobile/src/features/activity/domain/activity-inbox-workflow.ts | tests |
| `action:activity-tab` | implemented | — | — | tests |
| `action:moderation-switch` | missing | — | — | missing |
| `action:moderation-tools` | missing | — | — | missing |
| `action:moderation-tab` | missing | — | — | missing |
| `action:toggle-setting` | missing | — | — | missing |
| `action:cycle-setting` | missing | — | — | missing |
| `action:caption-model` | missing | — | — | missing |
| `action:check-updates` | missing | — | — | missing |
| `action:diagnostics-tab` | missing | — | — | missing |
| `action:connect-account` | partial | — | — | missing |
| `action:manage-account` | partial | — | — | missing |
| `action:copy-account-code` | partial | — | — | missing |
| `action:open-account-verification` | partial | — | — | missing |
| `action:cancel-account-connect` | partial | — | — | missing |
| `action:retry-account-connect` | partial | — | — | missing |
| `action:disconnect-account` | partial | — | — | missing |
| `action:notification-permission` | missing | — | — | missing |
| `action:run-check` | missing | — | — | missing |
| `action:toggle-density` | missing | — | — | missing |
| `action:retry-installation-registration` | partial | — | — | missing |
| `action:refresh-capability-policy` | partial | — | — | missing |
| `action:mini-player-pause` | implemented | #152, #153 | apps/mobile/src/features/watch/components/mini-player.tsx | tests |
| `action:dismiss-player` | implemented | #152, #153 | apps/mobile/src/features/watch/components/mini-player.tsx | tests |
| `action:demo-option` | missing | — | — | missing |
| `action:close-sheet` | missing | — | — | missing |
| `action:confirm-sheet` | missing | — | — | missing |
| `action:sheet-fixture-action` | missing | — | — | missing |
| `shell-route:search` | implemented | — | apps/mobile/src/features/discovery/components/unified-search-screen.tsx | tests |
| `shell-route:search/result-preview` | placeholder | — | — | missing |
| `shell-route:following` | implemented | — | apps/mobile/src/features/follows/components/following-workspace.tsx | tests |
| `shell-route:following/channel-preview` | placeholder | — | — | missing |
| `shell-route:following/manage` | implemented | — | apps/mobile/src/features/follows/components/following-workspace.tsx | tests |
| `shell-route:watch` | implemented | — | apps/mobile/src/features/watch/components/watch-route.tsx | tests |
| `shell-route:watch/session-preview` | implemented | — | apps/mobile/src/features/watch/components/watch-route.tsx | tests |
| `shell-route:activity` | implemented | — | apps/mobile/src/features/activity/components/activity-screen.tsx | tests |
| `shell-route:activity/alert-preview` | implemented | — | — | tests |
| `shell-route:activity/job-preview` | implemented | #163 | apps/mobile/src/features/media-jobs/components/media-job-screen.tsx | tests |
| `shell-route:more` | implemented | — | — | tests |
| `shell-route:more/home` | implemented | — | apps/mobile/src/features/discovery/components/home-live-discovery-screen.tsx | tests |
| `shell-route:more/channel` | implemented | — | apps/mobile/src/features/discovery/components/channel-detail-screen.tsx | tests |
| `shell-route:more/categories` | implemented | — | apps/mobile/src/features/discovery/components/categories-screen.tsx | tests |
| `shell-route:more/multistream` | implemented | #160 | apps/mobile/src/features/shell/components/app-shell.tsx, apps/mobile/src/features/multistream/components/multistream-screen.tsx | tests |
| `shell-route:more/history` | implemented | #155 | apps/mobile/src/features/shell/components/app-shell.tsx, apps/mobile/src/features/media-library/components/history-screen.tsx | tests |
| `shell-route:more/moderation` | placeholder | — | — | missing |
| `shell-route:more/settings` | implemented | #162, #167, #169 | apps/mobile/src/features/shell/components/app-shell.tsx, apps/mobile/src/features/settings/components/settings-workspace.tsx | tests |
| `shell-route:more/diagnostics` | partial | — | — | missing |
| `shell-route:more/accounts` | partial | — | — | missing |
| `shell-route:more/category-detail` | implemented | — | apps/mobile/src/features/discovery/components/category-detail-screen.tsx | tests |

## Gap register

| Id | Status | Finding | Owners |
| --- | --- | --- | --- |
| `GAP-195-01` | escalated | More destination order conflicts. The contract lists Accounts before Settings and Diagnostics. SHELL MORE_ROUTE_IDS keeps Accounts last. This PR does not change navigation order. | #104, #139, #195 |
| `GAP-195-02` | owned-elsewhere | Watch and typed History cover guest live HLS, recorded Twitch/Kick video, Twitch clips, and local Stream/Video/Clip rows. Moderation remains a placeholder. Appearance, playback, player controls, buffer, and multiview Settings now persist and apply to Watch and Multistream. Chat and later Settings panels remain on M06+. | #147, #148, #149, #150, #152, #159, #167 |
| `GAP-195-03` | owned-elsewhere | Chat Settings remains M06. Diagnostics six-tab workspace remains M09. Updates/Logs/Report/About Settings persist locally. GitHub Check now inspects the latest stable release without APK download. Remote FCM stays N01. | #143, #168, #169, #170, #171 |
| `GAP-195-04` | owned-elsewhere | Guest notification preferences, Android permission status, and denial recovery live on Settings. Remote FCM registration and background delivery remain N01–N03. Activity is still a local inbox. | #151, #169, #172, #173, #174 |
| `GAP-195-05` | open | More order is recorded, not changed. Physical-device and live-provider evidence remain missing for unfinished features. | #195, #196 |

## This increment

Guest Search, Home, Channel Detail, Categories, Following, Watch, recorded video/clip playback, typed History, and Media Job preview land in this candidate. Moderation, remaining Settings panels, and remaining Diagnostics tabs stay with their owners.

Run `node docs/research/streamfusion-mobile/coverage-matrix-check.mjs` after a contract or shell-route change.
