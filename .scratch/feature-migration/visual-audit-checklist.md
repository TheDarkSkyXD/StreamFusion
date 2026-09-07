# Visual audit checklist

Source-derived inventory; not evidence that a live provider operation succeeded. English labels below match the existing UI. Route paths are hash-router paths. Scope locators to the main screen/dialog to avoid matching sidebar channel names.

## Routes and content controls

| Route | Existing controls to inspect |
|---|---|
| `/` | Home; Watch now; Chat; Load more live channels; Browse All Categories |
| `/following` | Platform buttons All / Twitch / Kick; content buttons Live / Videos / Clips / Categories / Channels; placeholder `Search followed channels…`; `Refresh following data`; Videos/Clips sort Views / Most Recent; clips `Filter clips by time range`: Last Day / Last Week / Last Month / All Time |
| `/categories` | `Filter categories` textbox; open category card |
| `/categories/$platform/$categoryId` | `Category content` navigation: Live / Videos / Clips; `Platform` group where offered; Language / Tag; live Viewer sort: Most viewers / Fewest viewers; clips `Filter clips by time range`; media sort `Sort Category videos` / `Sort Category clips`; Kick category-video unavailable state is intentional |
| `/search` | Global textbox placeholder `Search StreamFusion...`; suggestion Search type: Channels / Categories / Streams; results buttons All / Channels / Streams / Videos / Clips / Categories; platform All (accessible name `ALL`) / Twitch / Kick; open a clip dialog and channel/video results |
| `/stream/$platform/$channel` | Related-content links Home / Videos / Clips (`tab=home/videos/clips`); video sort and clip time controls; `[data-testid="stream-chat-rail"]`; player menus; follow/account state; clip dialog |
| `/video/$platform/$videoId` | Video player, metadata, download controls, replay chat. No page-level tab strip implemented. |
| `/multistream` | MultiView navigation, MultiStream heading; Add Stream; Grid layout / Focus layout; Chat; see dialog/slot checklist below |
| `/history` | Watch History feed, populated/empty state, video navigation and clip dialog; Clear history is destructive. No tabs implemented. |
| `/downloads` | Status sections In progress / Needs attention / Finished; `#download-section-inProgress`, `#download-section-needsAttention`, `#download-section-finished`; `[aria-label="Download queue"]`; completed/open/reveal/delete and partial cancel/remove confirmation states. No tabs implemented. |
| `/settings` | All subpages below |
| `/mod` | Moderation channel index and global retention; signed-out/empty/authority states |
| `/mod/twitch/$channel`, `/mod/kick/$channel` | Authority-gated workspace; widget inventory below |

## Settings

Use Settings sidebar buttons, scoped to the Settings screen. Its search is `Search settings`.

| Group | Exact subpage labels (route tab ids) |
|---|---|
| General | General (`general`) |
| Viewing | Playback (`playback`); Player controls (`player-controls`); Buffer (`buffer`); Multiview (`multiview`) |
| Experience | Notifications (`notifications`); Chat (`chat`); Predictions (`predictions`) |
| Accounts & Network | Ad-Block (`adblock`); Proxy (`proxy`); Integrations (`integrations`); API / Tokens (`api-tokens`) |
| System & Support | Updates (`updates`); Diagnostics (`diagnostics`); Logs (`logs`); Report Bug (`report-bug`); About (`about`) |

Diagnostics has a `Diagnostics sections` tablist: Overview (`#diagnostics-tab-overview`), Resources (`#diagnostics-tab-resources`), I/O (`#diagnostics-tab-io`), Traces (`#diagnostics-tab-traces`), Logs & Reports (`#diagnostics-tab-logs-reports`), Developer Tools (`#diagnostics-tab-developer-tools`). Active content is `#diagnostics-active-panel`.

Resources includes `Resource history range`, `End time for resource history`, `Previous period`, `Next period`, `Pause live updates` / `Resume live updates`. Logs includes `Log file`, `Filter by level`, `Filter by tag`, and `Lines to fetch`. Inspect Report Bug/report export controls without treating an unsubmitted report as sent.

## MultiView dialogs and chat

- Add Stream opens dialog `Add Stream to Layout`; tablist `Add stream source`: Search / Favorites. Search placeholder `Search live Twitch and Kick channels...`; Favorites empty/loading/retry states; Close.
- Scope exact result to this dialog; follower count/live badge are dynamic. Favorite control names use `Add {channel} to favorites` / `Remove {channel} from favorites`.
- Scope stream identity checks to `[data-diagnostics-stream-slot]`; controls Drag to move, Show chat, Mute / Unmute, Remove stream. Check layout/identity after route navigation.
- Chat rail `[data-testid="multistream-chat-rail"]`; tablist `MultiChat views`: Merged / exact channel display names.
- Inspect live chat settings/emote UI without sending: `[data-testid="chat-rich-input"]`, `[data-testid="chat-input-action-row"]`, `[data-testid="chat-emote-action-row"]`, `[data-testid="chat-send-blocker"]`, `[data-testid="twitch-verification-card"]` where relevant.

## Moderation gates and fixture evidence

- Gate selectors: `mod-channel-authority-checking`, `mod-channel-authority-hidden`, `mod-channel-authority-unverifiable`, `mod-channel-reconnect-required`, `mod-channel-resolving`, `mod-channel-resolve-failed` (all data-testid).
- Ready selectors: `mod-channel-heading`, `mod-channel-platform-pill`, `mod-workspace`.
- Existing both-platform tools: Stream, Chat, Mod Actions, Retention. Twitch: AutoMod Queue; authority additionally enables pending unban requests and banned users; own broadcaster additionally enables moderators, VIPs, engagement. Inspect widget visibility by actual authority; do not infer Kick parity.
- Workspace controls include `Moderation tools`, `Resize panels`, `Reset layout`; tool buttons use their widget titles.
- Fixture visual coverage: `frontend/features/moderation/tests/stories/pages/Mod/channel/ModChannelPage.stories.tsx`, Storybook title `Pages/Moderation/Channel/ModChannelPage`: TwitchChannelResolving, TwitchChannelResolutionFailed, TwitchBroadcasterReady, TwitchModeratorReady, KickChannelResolving, KickChannelResolutionFailed, KickBroadcasterReady, ModerationAccessRequired, AuthorityUnavailable, MissingPermissionsRequireReconnect.
- Additional stories exist for ChannelBannedList, ChannelEngagement, ChannelModeratorsTable, ChannelModLogFeed, ChannelUnbanRequests, ChannelVipsTable, RetentionCard, Mod index/ChannelList/GlobalRetention. Auth stories: LoginDialog, AccountConnect, GuestMode, ProfileDropdown, ReconnectForModDialog.
- Existing component tests: `frontend/features/moderation/tests/pages/Mod/channel/ModChannelPage.test.tsx`, sibling panel tests, `workspace/{ModWorkspace,ModLivePanels,AutoModQueue}.test.tsx`; auth hooks `useModerationAuthority.test.tsx` / `useRequireModScopes.test.tsx`. These exercise mocked gates and UI contracts, not live Twitch/Kick success.

Paths above are relative to `apps/desktop/src` unless otherwise stated. Primary inventory sources: `frontend/routes/router.tsx`, each feature's `components/screens`, English i18n catalogs, and named stories/tests. No production files changed for this checklist.
