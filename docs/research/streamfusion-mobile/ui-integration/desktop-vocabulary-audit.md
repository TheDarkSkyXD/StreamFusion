# Mobile desktop vocabulary audit

Audited 2026-10-05. This is a read-only source audit. Production source is authoritative. Android navigation layout and sheets remain appropriate. No repository files were edited.

The audited tree is `E:/Codex/worktrees/streamfusion-mobile-ui-realdata`. `M` below means `apps/mobile/src`. `D` means `apps/desktop/src/frontend`. All file references are relative to that tree. The provider worker tree was not inspected, so this report does not claim that its pending fixes are absent.

Throughput checkpoint is n/a for a read-only investigation. The how investigation role supplied the source comparison. Prove It Works changed the audit to compare actual rendering and translation sources rather than mockup copy. Unslop and Technical Writing shaped this reference report.

## Shared controls and shell

| Priority | Mobile evidence | Desktop evidence | Finding |
| --- | --- | --- | --- |
| High | `M/design/tokens.ts:10`, `M/design/media-card.tsx:117`, `M/features/watch/components/player-controls.tsx:604` | `D/features/discovery/components/stream/stream-card.tsx:166`, `D/features/playback/components/player/player-controls.tsx:360`, `DESIGN.md:27` | Mobile live red is #dc143c. Actual desktop live badges use red-600, #dc2626. Keep danger #dc143c separate. Kick player's black/60 badge and green dot already match desktop. |
| High | `M/design/list-row.tsx:123` | `D/global.css:255`, `D/global.css:269`, `D/global.css:276`, `D/global.css:280` | Mobile unchecked switch uses #333333 track and #a0a0a0 thumb. Checked uses #404040 track and white thumb. Desktop unchecked uses #18181b track and white thumb. Checked uses #e4e4e7 track and #121214 thumb. Android switch rendering can remain native with these color values. |
| Medium | `M/design/select.tsx:140` | `D/components/ui/select.tsx:22` | Mobile select trigger uses surface #1a1a1a. Desktop select trigger uses tertiary #252525. |
| Medium, prior instruction dependent | `M/design/select.tsx:117`, `M/design/tokens.ts:72` | `D/components/ui/select.tsx:124` | Mobile selected indicator is a white dot. Desktop selected indicator is LuCheck. Existing mobile comments explicitly specify a radio dot, so preserve it if an earlier explicit user request owns this Android adaptation. |
| High | `M/features/shell/components/destination-icon.tsx:25` | `D/features/shell/components/layout/AppLayout.tsx:48` | Following uses Users. Desktop uses Heart. |
| High | `M/features/shell/components/destination-icon.tsx:26`, `M/features/shell/domain/shell-navigation.ts:119`, `M/features/shell/components/app-shell.tsx:2053` | `D/features/shell/components/layout/AppLayout.tsx:44`, `D/i18n/locales/en/core.ts:37` | Mobile discovery destination uses Watch and Radio. Desktop equivalent discovery destination is Home and House. Keep internal watch route IDs. Map its navigation label to navigation.home and use House. Active playback can still say Watch where that describes the action or session. |
| High | `M/features/shell/components/destination-icon.tsx:33` | `D/features/shell/components/layout/AppLayout.tsx:53` | Categories uses LayoutGrid. Desktop uses Grid3X3. |
| High | `M/features/shell/components/destination-icon.tsx:37`, `M/features/shell/domain/shell-navigation.ts:264` | `D/features/shell/components/layout/AppLayout.tsx:58`, `D/i18n/locales/en/core.ts:44` | Mobile uses LayoutGrid and Multistream. Desktop navigation uses LayoutDashboard and exact English MultiView. Desktop Settings separately spells its tab Multiview at en/settings.ts:77. |
| High | `M/features/shell/components/destination-icon.tsx:38`, `M/features/shell/components/app-shell.tsx:738` | `D/features/shell/components/layout/AppLayout.tsx:69`, `D/features/auth/components/auth/ProfileDropdown.tsx:505` | Settings navigation and header shortcuts use Lucide Settings. Desktop uses filled IoMdSettings. Mobile PlayerSettingsIcon already reproduces its path and can be reused for matching glyphs. |
| Medium | `M/features/shell/domain/shell-navigation.ts:288`, `M/features/shell/components/app-shell.tsx:1994` | `D/i18n/locales/en/core.ts:70`, `D/i18n/locales/en/settings.ts:178` | Accounts page header says Accounts and maintenance. More card says Accounts. Desktop account group is Connected Accounts. Desktop settings entry is Integrations, a separate concept. |

Exact desktop navigation is Home, Following, Categories, MultiView, History, Downloads, Settings. Sources are `D/i18n/locales/en/core.ts:37`, `:39`, and `:43-47`. Search, Activity, and More also exist in the shared navigation catalog at `:38`, `:41`, and `:42`, so mobile can keep them as Android destinations. Activity's Bell already matches desktop notifications at `D/features/shell/components/TopNavBar/NotificationsDropdown.tsx:106`.

The base backgrounds, border, primary and secondary text, tag values, and Twitch and Kick colors already match `D/global.css:10-34` and `DESIGN.md:4-30`. Mobile platform SVG paths match `D/components/icons/PlatformIcons.tsx:19` and `:37`. Avoid replacing those verified values with mockup colors or alternate logos.

## Settings hub

Mobile hardcodes its category titles and descriptions in `M/features/settings/domain/settings-categories.ts`. Desktop metadata is `D/features/settings/components/screens/Settings/index.tsx:419-506`. The English values are in `D/i18n/locales/en/settings.ts:67-105`. Rendering through the existing desktop translation keys prevents English and translated language drift together.

| Mobile evidence | Desktop evidence | Desktop vocabulary |
| --- | --- | --- |
| categories.ts:45 Appearance, :46 Density, language, and session restore | Settings/index.tsx:421-423; en/settings.ts:67-68 | General. Language and app preferences. General icon is SlidersHorizontal rather than mobile Palette at settings-workspace.tsx:67. |
| categories.ts:53 Quality, captions, HEVC, and device id | en/settings.ts:70 | Stream quality & preferences. |
| categories.ts:60 Chrome toggles and seek intervals | en/settings.ts:74 | Show or hide player buttons. |
| categories.ts:67 Forward buffer, max buffer, live sync | en/settings.ts:76 | Live latency & stability. |
| categories.ts:74 Display density and message chrome | en/settings.ts:80 | Appearance, emotes & events. |
| categories.ts:81 Overlay and participation preferences | en/settings.ts:86 | Chat prediction widget style. Apply only if this describes the actual mobile preference controls. |
| categories.ts:94 Ad-blocking, :95 Twitch playlist proxy and filters | en/settings.ts:81-82 | Ad-Block. Twitch ad-blocking settings. |
| categories.ts:109 Twitch and Kick account links | en/settings.ts:88 | Connected accounts & APIs. |
| categories.ts:115 API tokens, :116 Token status and rotation hints | en/settings.ts:89-90 | API / Tokens. Sign-in & token status. |
| categories.ts:123 GitHub release checks | en/settings.ts:92 | Auto update preferences only if mobile has auto update controls. Manual release lookup needs truthful mobile copy. |
| categories.ts:137 Local support log buffer | en/settings.ts:97 | In-app log viewer & diagnostics. |
| categories.ts:143 Report a bug, :144 Build a redacted diagnostic report | en/settings.ts:98-99 | Report Bug. Capture a bug report for sharing. |
| categories.ts:151 Licenses, privacy, and reset actions | en/settings.ts:101 | Version & info. |
| categories.ts:35 Customize, :36 Connections, :37 Support | Settings/index.tsx:512-527; en/settings.ts:67,102-105 | Desktop group names are General, Viewing, Experience, Accounts & Network, and System & Support. Android grouped rows can retain their layout using these names and grouping meanings. |
| settings-workspace.tsx:282 No settings match that search. | en/settings.ts:207-208 | Desktop uses No settings found and a query-specific No settings match message. |
| api-tokens-settings-panel.tsx:40 API AND TOKENS | en/settings.ts:89 | API / Tokens. |

Icons in `M/features/settings/components/settings-workspace.tsx:66-83` differ from desktop metadata as follows.

| Mobile line and glyph | Desktop line and glyph |
| --- | --- |
| :67 Palette | Settings/index.tsx:423 SlidersHorizontal |
| :68 MonitorPlay | Settings/index.tsx:428 Monitor |
| :72 Target | Settings/index.tsx:468 Trophy |
| :74 ShieldBan | Settings/index.tsx:458 ShieldCheck |
| :75 Wifi | Settings/index.tsx:463 Network |
| :76 Users | Settings/index.tsx:473 Link |

Player controls, Buffer, Chat, Notifications, API Tokens, Updates, Diagnostics, Logs, Report Bug, and About already use the corresponding desktop icon families.

Do not copy desktop-only descriptions verbatim into unsupported mobile controls. Specifically, Notifications desktop notices at en/settings.ts:72, Proxy default-session Chromium requests at :84, and diagnostics processes/traces at :95 describe different host capabilities. Their category labels and icons can match while their functional details stay accurate.

## Watch and library

| Mobile evidence | Desktop evidence | Finding |
| --- | --- | --- |
| `M/features/watch/components/watch-screen.tsx:439-444` | `D/features/playback/components/player/settings-menu.tsx:181`, `:189` | Secondary Watch settings shortcut says Player settings and uses Settings2. Desktop says Settings and uses IoMdSettings. Main player controls already use matching PlayerSettingsIcon. |
| `M/features/watch/components/player-tools.tsx:97`, `:106`, `:110` | `D/i18n/locales/en/playback.ts:50`, `D/features/playback/components/player/settings-menu.tsx:268-269` | Video stats is Video Stats on desktop. Desktop icon is Activity. Android placement in the tools sheet can remain. |
| `M/features/watch/components/player-tools.tsx:142`, `:149`, `:158`, `:170` | `D/i18n/locales/en/playback.ts:229-234` | Frame rate, Dropped frames, Buffered, Codec differ from desktop FPS, Skipped Frames, Buffer Size, Codecs. Align only equivalent measurements. A native dropped-frame counter must retain its actual meaning if it differs from desktop skipped frames. |
| `M/features/media-library/components/history-view.tsx:83` | `D/i18n/locales/en/mediaLibrary.ts:123` | Clear differs from Clear History. |
| `M/features/media-library/components/history-view.tsx:161`, `:175` | `D/i18n/locales/en/mediaLibrary.ts:168`, `:123` | Clear confirmation differs from Are you sure you want to clear your watch history? Action Confirm can name Clear History for this specific action. The mobile per-device detail can remain as supporting copy. |
| `M/features/media-library/components/history-view.tsx:219` | `D/i18n/locales/en/mediaLibrary.ts:124-125` | Nothing watched yet. differs from No watch history yet and Videos and clips you watch will appear here. Mobile also stores streams, so the explanation must reflect supported types. |
| `M/features/media-library/components/history-row.tsx:108` | `D/i18n/locales/en/mediaLibrary.ts:126` | Remove differs from Remove from history. |
| `M/features/media-jobs/components/downloads-screen.tsx:91` | `D/i18n/locales/en/mediaLibrary.ts:119-120` | Start one from Watch. differs from Download a playable Clip or Video. Its progress and file actions will appear here. Mobile additionally supports recording and should describe its actual entry actions. |
| `M/features/watch/components/watch-download-bar.tsx:71` | `D/i18n/locales/en/mediaLibrary.ts:3-6` | Duplicate download dialog says Download again? rather than Already in Downloads. Desktop's Download again and Cancel button labels are reusable. |

Matching controls were verified in source. Play, Pause, volume states, seek rotation icons, fullscreen, refresh, and ad-block shield match the desktop icon families. Kick live badge color also matches. Sources include `M/features/watch/components/player-controls.tsx:5-15,158-278`, `D/features/playback/components/player/play-pause-button.tsx:35-37`, volume-control.tsx:45-47, player-controls.tsx:317,341,446-448, and twitch/twitch-live-player-controls.tsx:38,58.

Local model size, English-only captions, rebuilding the native client, and Expo Go capability limits require truthful mobile details. Existing desktop keys such as playback.watch.startCaptions, stopCaptions, and installEnglishModel at `D/i18n/locales/en/playback.ts:290-293` provide reusable action names. Do not copy Coming soon over mobile captions that actually work.

## Accounts, chat, discovery, and moderation

| Mobile evidence | Desktop evidence | Finding |
| --- | --- | --- |
| `M/features/auth/components/twitch-accounts-panel.tsx:138` | `D/i18n/locales/en/settings.ts:374` | Not connected differs from Not signed in. for the same signed-out account status. |
| `M/features/auth/components/twitch-accounts-panel.tsx:279` | `D/i18n/locales/en/auth.ts:39-40` | Connected. Required features are available. differs from Connected and Connected as {{user}}. Prefer the identity-based desktop status and retain truthful missing-permission notices separately. |
| `M/features/auth/components/twitch-accounts-panel.tsx:308`, `M/features/auth/components/kick-account-card.tsx:232` | `D/i18n/locales/en/settings.ts:372` | Validate and refresh now differs from Validate now. Both workflows validate account state. Desktop spelling is reusable if refresh remains internal. |
| `M/features/chat/components/chat-panel.tsx:425-426` | `D/features/chat/components/chat/ChatInput.tsx:760`, `D/i18n/locales/en/chat.ts:22` | Send a message lacks desktop's ellipsis. Connect an account to chat differs from Log in to chat. These need no Android-specific wording. |
| `M/features/chat/components/chat-panel.tsx:381-382` | `D/i18n/locales/en/chat.ts:119` | Search emotes differs from Search emotes... |
| `M/features/chat/components/chat-panel.tsx:160` | `D/i18n/locales/en/chat.ts:8` | Retry differs from Retry chat for the Kick failed-chat action. |
| `M/features/discovery/components/categories-screen.tsx:128` | `D/i18n/locales/en/discovery.ts:5-6` | Search categories differs from Filter categories and Filter categories... |
| `M/features/discovery/components/categories-screen.tsx:167` | `D/i18n/locales/en/discovery.ts:7,21` | No matching categories. differs from desktop No categories found and the query-specific No categories matching {{query}}. |
| `M/features/discovery/components/category-detail-view.tsx:133` | `D/i18n/locales/en/discovery.ts:33-35` | Mobile tab.toUpperCase renders LIVE, CLIPS, VIDEOS. Desktop vocabulary is Live Streams, Clips, Videos. Use translated labels; presentation casing can remain only if it is a retained Android typography decision. |
| `M/features/discovery/components/category-filter-bar.tsx:45,61,131,155-156,162,176-179` | `D/i18n/locales/en/discovery.ts:24,26,29-30,74,78-83` | Tags differs from Tag. Clip time differs from Time. All language option differs from All languages. Viewers and Viewers (low) differ from Most viewers and Fewest viewers. Recent differs from Most Recent. All time, Day, Week, Month differ from All Time, Last Day, Last Week, Last Month. |
| `M/features/moderation/components/mod-workspace.tsx:214,291` | `D/i18n/locales/en/moderation.ts:308` | AutoMod review differs from AutoMod Queue. Mobile actually hands off the live queue and accepts known message IDs. Use AutoMod Queue for the destination, while describing the limited mobile workflow truthfully. |
| `M/features/moderation/components/mod-workspace.tsx:750,756` | `DESIGN.md:127-134` | Mobile moderation uses general #0f0f0f canvas and #1a1a1a panels. Desktop moderation explicitly uses #0e0e10 canvas, #18181b panels, #252529 headers. Android stacked panels can retain their arrangement using the desktop moderation palette. |

Connect Twitch, Connect Kick, Reconnect Twitch, Reconnect Kick, Disconnect Twitch, and Disconnect Kick already match desktop auth or profile vocabulary. Banned users, Moderators, VIPs, and Moderation labels also match. Device-code instructions, host availability notices, Android permission prompts, provider handoff buttons, and native workload restrictions have no direct desktop equivalent and need accurate mobile copy.

## Coverage limits

This report compares source definitions and actual translation keys. It does not claim pixel or runtime verification. It covers the shared design controls, shell, Settings metadata, Watch controls, history, downloads, accounts, chat composer, category discovery, moderation entry tools, and the moderation palette. The pending provider worker may already change discovery or category copy. Recheck those entries after integration. Production code should not adopt mockup literals when a desktop equivalent exists.

