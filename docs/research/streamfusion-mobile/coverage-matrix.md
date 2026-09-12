# Mobile coverage matrix

This matrix is the #195 inventory. It is not a claim that every feature is done.
Specification, implementation, and verification stay separate. Feature owners keep their screens.

Source revisions are the files in this commit. The checker fails when a contract screen, tab, panel, action, or shell route appears or disappears without a matching row.

## Totals

| Status | Count |
| --- | ---: |
| Implemented | 12 |
| Partial | 13 |
| Placeholder | 23 |
| Missing | 134 |
| Discovered | 182 |

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
| `screen:search` | placeholder | #130, #132, #133, #147, #149 | — | missing |
| `screen:home` | placeholder | #130, #131, #132, #147, #148 | — | missing |
| `screen:categories` | placeholder | #130, #132, #133, #147, #150 | — | missing |
| `screen:category-detail` | missing | #130, #132, #133, #147, #150 | — | missing |
| `screen:following` | placeholder | #134, #147, #151 | — | missing |
| `screen:channel` | placeholder | #130, #132, #133, #147, #148, #151 | — | missing |
| `screen:watch` | placeholder | #152, #153, #156, #157, #167 | — | missing |
| `screen:video` | missing | #133, #153, #154 | — | missing |
| `screen:multi` | placeholder | #143, #160, #167 | — | missing |
| `screen:history` | placeholder | #155 | — | missing |
| `screen:activity` | implemented | #141, #151, #172, #173, #174 | apps/mobile/src/features/activity/components/activity-screen.tsx | tests |
| `screen:moderation-home` | placeholder | #159, #168 | — | missing |
| `screen:moderation` | missing | #159, #168 | — | missing |
| `screen:settings` | placeholder | #167, #168, #170 | — | missing |
| `screen:accounts` | partial | #135, #145, #146, #151 | apps/mobile/src/features/auth/components/twitch-accounts-panel.tsx | missing |
| `screen:system` | partial | #143, #170, #171 | apps/mobile/src/features/capability-profile/components/capability-profile-panel.tsx | missing |
| `screen:more` | implemented | #139, #141 | apps/mobile/src/features/shell/components/app-shell.tsx | tests |
| `screen:settings-appearance` | missing | — | — | missing |
| `screen:settings-playback` | missing | — | — | missing |
| `screen:settings-player-controls` | missing | — | — | missing |
| `screen:settings-buffer` | missing | — | — | missing |
| `screen:settings-multiview` | missing | — | — | missing |
| `screen:settings-notifications` | missing | — | — | missing |
| `screen:settings-chat` | missing | — | — | missing |
| `screen:settings-predictions` | missing | — | — | missing |
| `screen:settings-adblock` | missing | — | — | missing |
| `screen:settings-proxy` | missing | — | — | missing |
| `screen:settings-integrations` | missing | — | — | missing |
| `screen:settings-api-tokens` | missing | — | — | missing |
| `screen:settings-updates` | missing | — | — | missing |
| `screen:settings-diagnostics` | missing | — | — | missing |
| `screen:settings-logs` | missing | — | — | missing |
| `screen:settings-report-bug` | missing | — | — | missing |
| `screen:settings-about` | missing | — | — | missing |
| `panel:appearance` | missing | — | — | missing |
| `panel:playback` | missing | — | — | missing |
| `panel:player-controls` | missing | — | — | missing |
| `panel:buffer` | missing | — | — | missing |
| `panel:multiview` | missing | — | — | missing |
| `panel:notifications` | missing | — | — | missing |
| `panel:chat` | missing | — | — | missing |
| `panel:predictions` | missing | — | — | missing |
| `panel:adblock` | missing | — | — | missing |
| `panel:proxy` | missing | — | — | missing |
| `panel:integrations` | missing | — | — | missing |
| `panel:api-tokens` | missing | — | — | missing |
| `panel:updates` | missing | — | — | missing |
| `panel:diagnostics` | missing | — | — | missing |
| `panel:logs` | missing | — | — | missing |
| `panel:report-bug` | missing | — | — | missing |
| `panel:about` | missing | — | — | missing |
| `tab:search:all` | missing | — | — | missing |
| `tab:search:channels` | missing | — | — | missing |
| `tab:search:streams` | missing | — | — | missing |
| `tab:search:videos` | missing | — | — | missing |
| `tab:search:clips` | missing | — | — | missing |
| `tab:search:categories` | missing | — | — | missing |
| `tab:following:live` | missing | — | — | missing |
| `tab:following:videos` | missing | — | — | missing |
| `tab:following:clips` | missing | — | — | missing |
| `tab:following:categories` | missing | — | — | missing |
| `tab:following:channels` | missing | — | — | missing |
| `tab:category-detail:live` | missing | — | — | missing |
| `tab:category-detail:clips` | missing | — | — | missing |
| `tab:category-detail:videos` | missing | — | — | missing |
| `tab:channel:home` | missing | — | — | missing |
| `tab:channel:videos` | missing | — | — | missing |
| `tab:channel:clips` | missing | — | — | missing |
| `tab:watch:chat` | missing | — | — | missing |
| `tab:watch:info` | missing | — | — | missing |
| `tab:watch:related` | missing | — | — | missing |
| `tab:video:details` | missing | — | — | missing |
| `tab:video:comments` | missing | — | — | missing |
| `tab:video:related` | missing | — | — | missing |
| `tab:activity:all` | implemented | — | — | tests |
| `tab:activity:channels` | implemented | — | — | tests |
| `tab:activity:jobs` | implemented | — | — | tests |
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
| `action:player-play-pause` | missing | — | — | missing |
| `action:player-seek-back` | missing | — | — | missing |
| `action:player-seek-forward` | missing | — | — | missing |
| `action:player-mute` | missing | — | — | missing |
| `action:player-speed` | missing | — | — | missing |
| `action:player-quality` | missing | — | — | missing |
| `action:player-theater` | missing | — | — | missing |
| `action:player-stats` | missing | — | — | missing |
| `action:player-fullscreen` | missing | — | — | missing |
| `action:player-pip` | missing | — | — | missing |
| `action:player-captions` | missing | — | — | missing |
| `action:toggle-chat` | missing | — | — | missing |
| `action:chat-emotes` | missing | — | — | missing |
| `action:chat-context` | missing | — | — | missing |
| `action:chat-send` | missing | — | — | missing |
| `action:channel-follow` | missing | — | — | missing |
| `action:multistream-add` | missing | — | — | missing |
| `action:job-record` | missing | — | — | missing |
| `action:job-download` | missing | — | — | missing |
| `action:job-details` | missing | — | — | missing |
| `action:watch-tab` | missing | — | — | missing |
| `action:video-tab` | missing | — | — | missing |
| `action:audio-owner` | missing | — | — | missing |
| `action:multistream-edit` | missing | — | — | missing |
| `action:multi-chat-mode` | missing | — | — | missing |
| `action:restore-slot` | missing | — | — | missing |
| `action:cool-device` | missing | — | — | missing |
| `action:multi-chat-channel` | missing | — | — | missing |
| `action:history-remove` | missing | — | — | missing |
| `action:history-clear` | missing | — | — | missing |
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
| `action:mini-player-pause` | missing | — | — | missing |
| `action:dismiss-player` | missing | — | — | missing |
| `action:demo-option` | missing | — | — | missing |
| `action:close-sheet` | missing | — | — | missing |
| `action:confirm-sheet` | missing | — | — | missing |
| `action:sheet-fixture-action` | missing | — | — | missing |
| `shell-route:search` | placeholder | — | — | missing |
| `shell-route:search/result-preview` | placeholder | — | — | missing |
| `shell-route:following` | placeholder | — | — | missing |
| `shell-route:following/channel-preview` | placeholder | — | — | missing |
| `shell-route:watch` | placeholder | — | — | missing |
| `shell-route:watch/session-preview` | placeholder | — | — | missing |
| `shell-route:activity` | implemented | — | apps/mobile/src/features/activity/components/activity-screen.tsx | tests |
| `shell-route:activity/alert-preview` | implemented | — | — | tests |
| `shell-route:activity/job-preview` | placeholder | — | — | missing |
| `shell-route:more` | implemented | — | — | tests |
| `shell-route:more/home` | placeholder | — | — | missing |
| `shell-route:more/categories` | placeholder | — | — | missing |
| `shell-route:more/multistream` | placeholder | — | — | missing |
| `shell-route:more/history` | placeholder | — | — | missing |
| `shell-route:more/moderation` | placeholder | — | — | missing |
| `shell-route:more/settings` | placeholder | — | — | missing |
| `shell-route:more/diagnostics` | partial | — | — | missing |
| `shell-route:more/accounts` | partial | — | — | missing |

## Gap register

| Id | Status | Finding | Owners |
| --- | --- | --- | --- |
| `GAP-195-01` | escalated | More destination order conflicts. The contract lists Accounts before Settings and Diagnostics. SHELL MORE_ROUTE_IDS keeps Accounts last. This PR does not change navigation order. | #104, #139, #195 |
| `GAP-195-02` | owned-elsewhere | Search, Following, Watch, Home, Categories, History, Moderation, and Settings remain placeholders. Feature issues own those screens. | #147, #148, #149, #150, #152, #155, #159, #167 |
| `GAP-195-03` | owned-elsewhere | The 17 Settings panels and six Diagnostics tabs have no Mobile routes or tab components. | #143, #167, #170, #171 |
| `GAP-195-04` | owned-elsewhere | Guest and account notification delivery, FCM, and job producers are absent. Activity is a local inbox only. | #151, #163, #172, #173, #174 |
| `GAP-195-05` | open | More order is recorded, not changed. Physical-device and live-provider evidence remain missing for unfinished features. | #195, #196 |

## This increment

The Activity destination shows an unread badge. Android Back cancels an Activity dismissal confirmation before it pops a route. Reselecting Activity scrolls the inbox to the top. Search, Following, Watch, Settings, and Diagnostics tabs stay with their owners.

Run `node docs/research/streamfusion-mobile/coverage-matrix-check.mjs` after a contract or shell-route change.
