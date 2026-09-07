# Twitch Mod View gap map

Reviewed 2026-09-06. Read-only source inventory plus current official Twitch documentation; no moderation actions, source edits, or live-account claims. Root owns the real Electron/browser audit. Paths below are relative to `apps/desktop/src/`.

## Outcome

The current workspace is a working foundation, but it is not a complete Twitch Mod View. Its ten widget identifiers cover video, chat, Mod Actions, local retention, bans, unban requests, AutoMod, moderator/VIP management, and a combined engagement display. Most missing tools require new presentation and data contracts; several cannot reproduce Twitch's entire native experience using the documented public API.

The best first increment is per-tool authorization and honest error states, followed by channel controls, Suspicious User Activity, and broadcaster poll/prediction management. Community, activity, whispers, and rewards require additional feeds and explicit coverage labels.

## Current panels and sidebar inventory

Twitch's documented desktop inventory includes the named surfaces below. Its layout supports movable widgets, a dock, community details, navigation, and a Shield Mode layout. The help page was available through the search index although direct opening returned a Help Portal CSS error. This is a documentation inventory, not a claim that every account currently shows identical controls. [Official Mod View guide](https://help.twitch.tv/s/article/mod-view)

| Surface | Current app evidence | Concrete gap / next step |
| --- | --- | --- |
| Video and Chat | `frontend/features/moderation/components/screens/Mod/channel/workspace/ChannelWorkspace.tsx:61` composes `ModVideoPanel` and public `ModChatPanel`. | Preserve shared player/chat lifecycle. The visual audit is separate. |
| Other moderated channels | `.../screens/Mod/ChannelList.tsx:36` provides the index and inserts the signed-in broadcaster. | No in-workspace channel switcher. Reuse verified discovery data, including own channel, with live-status enrichment. |
| Followed channels | Discovery/auth features already own follows; absent from `ChannelWorkspace`. | Add navigation presentation through their public capabilities, without copying provider reads into moderation. |
| Mod Actions | `.../channel/ChannelModLogFeed.tsx:50` filters action types/moderator and pages local stored entries. | Keep retention/coverage visible; it is recorded app history, not the whole Twitch historical log. |
| AutoMod Queue | `.../workspace/AutoModQueue.tsx:79` consumes held/resolved events; line 125 begins allow/deny handling. | No terms/settings menu. Held-message view contains only ID, name, text, and a coarse reason. Add normalized reason/boundary details, terminal-state handling and settings/terms surfaces. |
| Predictions / Polls | `.../channel/ChannelEngagement.tsx:35` fetches both, selects one current item, refreshes every 30 seconds. Backend `moderation/adapters/twitch/twitch-helix-{polls,predictions}.ts` already implements creation and lifecycle operations. | Workspace has no create, lock, resolve, cancel, terminate, or history controls. Compose existing workflows into separate usable panels; do not import chat-internal panels. |
| Suspicious User Activity | Absent from dock. `backend/features/chat/adapters/twitch/twitch-slash-command-service.ts:172` already executes suspicious-status commands. | Add typed suspicious-message/status feed, review list, monitor/restrict/remove controls and filtering. Existing status command can be reused through an owned capability. |
| Community | No workspace panel. `frontend/features/chat/components/chat/RecentChattersPanel.tsx:128` reads locally observed users; chat `UserPopout.tsx:140` shows profile/follow details and line 408 composes local moderation history. | A connected-chatters list needs a new provider read and paging. Reuse public profile presentation/contracts; label local message history and observed activity honestly. |
| Active Mods | Only broadcaster moderator-management roster exists. Recent chatters groups observed roles. | Do not relabel a configured roster or recently speaking users as all connected mods. Connected/observed status needs distinct fields and appropriate evidence. |
| Unban Requests | `ChannelWorkspace.tsx:112` registers the real request queue when authorized. | Add event-driven invalidation/counts and sidebar pending indicators; preserve existing status filters and per-row decisions. |
| Activity Feed | No widget/feed in moderation. | Add normalized event types, filtering, deduplication, connection status, bounded storage and coverage start time. Separate channel-wide authorized events from chat-observed notifications. |
| Whispers | No inbox widget. Chat command registry/service contains outgoing whispers. | Incoming events, conversation state, account-bound storage and UI are absent. Do not imply older inbox history has been loaded. |
| Reward Requests Queue | No widget, redemption contract, or feed found in feature sources. | New broadcaster-authorized event presentation and app-owned reward decisions are feasible; show native handoff for broader reward management. |
| Batch Reporting | No widget. Local bans/timeouts already give candidate records. | A local review/export list is feasible; reporting to Twitch needs a native handoff unless a supported endpoint is identified. Never simulate successful reports. |
| Shield / channel controls | `InlineModStrip.tsx:105` renders room modes and Shield; `TwitchChat.tsx:1994` performs Shield mutations. | No Shield workspace layout or authoritative Shield read/feed. No AutoMod settings, blocked terms, or complete channel-actions surface in workspace. |
| App extras | Ban list, moderator/VIP tables, local Retention exist. | Keep app retention clearly distinct from Twitch policy/history settings. |

Dock mechanics are implemented in `.../workspace/ModWorkspace.tsx`: side buttons, locking, reset, keyboard/pointer resizing, widget movement/hiding. `dock-layout.ts:1` has only the ten current IDs; line 136 pins AutoMod/Retention. Native-style previews, counts, content-specific menus, top navigation switching and a dedicated Shield layout are missing. Current saved layouts are keyed per account/channel (`ChannelWorkspace.tsx:177`), which is an intentional app behavior rather than native browser-wide layout parity.

## Real-data routes and permission facts

These are compact integration pointers; use the linked operation's full contract for validation and actor checks.

| Need | Documented public route / restriction |
| --- | --- |
| Community | [Get Chatters](https://dev.twitch.tv/docs/api/reference/#get-chatters): paginated, delayed membership; token subject equals moderator ID. |
| Active Mods roster | [Get Moderators](https://dev.twitch.tv/docs/api/reference/#get-moderators): broadcaster-token identity required. Intersect with chatters for connected roster. |
| AutoMod/terms | [Get/Update AutoMod Settings](https://dev.twitch.tv/docs/api/reference/#get-automod-settings), [blocked terms CRUD](https://dev.twitch.tv/docs/api/reference/#get-blocked-terms). |
| Shield | [Get Shield Mode Status](https://dev.twitch.tv/docs/api/reference/#get-shield-mode-status), [update](https://dev.twitch.tv/docs/api/reference/#update-shield-mode-status). |
| Suspicious status | [Add](https://dev.twitch.tv/docs/api/reference/#add-suspicious-status-to-chat-user) / [remove](https://dev.twitch.tv/docs/api/reference/#remove-suspicious-status-from-chat-user). |
| Rewards | [Redemption list](https://dev.twitch.tv/docs/api/reference/#get-custom-reward-redemption) and [decisions](https://dev.twitch.tv/docs/api/reference/#update-redemption-status): broadcaster token and reward created by this app required. |
| Engagement | [Polls](https://dev.twitch.tv/docs/api/reference/#get-polls) / [predictions](https://dev.twitch.tv/docs/api/reference/#get-predictions): broadcaster ID must match token subject. |

No documented public endpoint was identified in the reviewed [API reference](https://dev.twitch.tv/docs/api/reference/) for Twitch moderator comments, complete channel chat history, permitted-term CRUD, full old whisper inbox, batch reports, or shared-ban partnership administration. Treat these as research limitations, not proof that no private Twitch interface exists.

### Event subscriptions

| Integration | EventSub types / authorization |
| --- | --- |
| AutoMod | `automod.message.hold/update` v2, `moderator:manage:automod`. [Reference](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#automodmessagehold-v2) |
| Suspicious activity | `channel.suspicious_user.message/update`, `moderator:read:suspicious_users`; WebSocket moderator subject must match token. [Reference](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelsuspicious_usermessage) |
| Activity | `channel.follow` v2: `moderator:read:followers`; subscriptions: `channel:read:subscriptions`; cheers: `bits:read`. [Follow](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelfollow), [subscription](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelsubscribe), [cheer](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelcheer) |
| Whispers | `user.whisper.message`: `user:read:whispers` or `user:manage:whispers`. [Reference](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#userwhispermessage) |
| Rewards | `channel.channel_points_custom_reward_redemption.add/update`: `channel:read:redemptions` or manage counterpart. [Reference](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchannel_points_custom_reward_redemptionadd) |

Recommendation: extend the existing main-owned feed with typed events; keep account/channel leases, deduplication and bounded retention. Represent each event source's authorization separately. Broadcaster subscription/cheer permissions are not supplied merely by a moderator granting scopes for their own account. For histories without an initial read, label the observation interval.

The current `ModerationServices` capability only allows `channel.moderate` and the two AutoMod types (`frontend/features/moderation/capabilities/moderation-services.ts:21`). The backend feed repeats that restriction (`backend/features/moderation/adapters/twitch/twitch-eventsub-feed-service.ts:35`). Its shared client selects v2 only for those current types (`backend/api/platforms/twitch/twitch-eventsub-client.ts:93`) and otherwise assumes a broadcaster-only condition (`:97`). Adding an enum value alone would construct incorrect subscriptions for follows, suspicious users and whispers; version/condition/scopes must be explicit per type.

### Scope additions and existing authorization problem

`shared/auth-types.ts:47` already requests moderation actions, Shield management, outgoing/incoming-compatible whisper management, and poll/prediction management. Missing integration scopes include:

| New read/control | Scope |
| --- | --- |
| Connected chatters | `moderator:read:chatters` |
| Suspicious activity | `moderator:read:suspicious_users` |
| AutoMod settings | `moderator:read:automod_settings`, `moderator:manage:automod_settings` |
| Blocked-term editing | `moderator:manage:blocked_terms` |
| Broadcaster activity | `channel:read:subscriptions`, `bits:read` |
| Rewards | `channel:read:redemptions`, `channel:manage:redemptions` |

These mappings come from Twitch's [official scope catalog](https://dev.twitch.tv/docs/authentication/scopes/). Existing manage scopes can satisfy documented read alternatives, so avoid demanding unnecessary read grants.

`useModerationAuthority.ts:17` currently builds one required set from almost all `TWITCH_APP_SCOPES`, excluding only AutoMod. Line 287 compares that entire set with the token. Consequently missing whispers, commercial, email, or broadcaster poll scope can hide the banned-user/unban tools (`ChannelWorkspace.tsx:112`) despite sufficient permission for those specific tools. Recommend a role/identity result plus independent capability grants, with reconnect targeted to the selected action. Do not expand this global all-or-nothing gate as new widgets land.

Own-channel behavior is already correct structurally: `ChannelList.tsx:69` inserts the signed-in channel; `useModerationAuthority.ts:102` recognizes numeric user/broadcaster equality; `ModChannelPage.tsx:187` allows the resolved own workspace to render while authority checks run. Remote tools remain gated. Preserve this; an empty moderated-channel list must not deny broadcaster access. Other channels rely on a complete, fresh verified moderated-channel snapshot, not chat badges or development overrides.

Twitch's [poll guide](https://dev.twitch.tv/docs/api/polls/) and [prediction guide](https://dev.twitch.tv/docs/api/predictions/) describe moderator/editor use in Twitch's product. That does not override the endpoint token-subject requirements above. The current broadcaster-only workspace gate is justified for this app's single-account Helix calls. Offer a native Twitch handoff for remote-channel operations requiring broadcaster authorization, or explicitly design broadcaster delegation; do not simply remove the gate.

## Prioritized implementation slices

1. **P0: truthful availability and state.** Split role verification from tool scopes. Fix `ChannelEngagement.tsx:39` converting failed API results to empty lists: present authorization/network errors separately from no active engagement. Preserve authorized existing panels during partial scope grants.
2. **P1: complete existing tools.** Add poll/prediction lifecycle controls using existing moderation adapters; AutoMod settings/blocked terms; authoritative Shield status plus updates. Current room state defaults Shield to false (`chat/components/state/room-state-store.ts:44`); grep found only local success writes in `TwitchChat.tsx:2103`, no Shield-read command/feed. Reopening a channel must not present a locally assumed Shield state as server truth.
3. **P1: Suspicious Activity.** Real typed feed, normalized flags/reasons, filters and existing status mutations. Retain bounded events and explicit connected/error/reconnect states.
4. **P2: navigation, Community, Active Mods.** Add workspace switchers and real membership reads; expose limits where a moderator token cannot fetch the configured roster. Existing recent-chatters UI is useful but has different semantics.
5. **P2: Activity, Whispers, Rewards.** Add feed contracts/storage and broadcaster-specific capabilities. Hand off unsupported history/admin decisions to Twitch with clear labels. Do not put fake counters or empty-success placeholders in the dock.
6. **P3: presentation completeness.** Add dock previews/counts, per-panel menus, Shield layout, accessible narrow-window flows and native report handoff. Follow `DESIGN.md` Inter/tokens and keep Twitch accents platform scoped. Keep feature UI in components, workflows and bounds in domain, vendor mapping in adapters, persistence in data, and wiring in composition.

Verification recommendations: permission matrix (own broadcaster, remote moderator, viewer, partial grant, revoked grant); empty versus failed fetch; real feed connection without generating moderation events; captured provider-payload tests for event mapping; authoritative state after reconnect; per-account cleanup and bounded feed growth. Mutation verification requires the root's authorized test-channel flow, not incidental actions against live users.
