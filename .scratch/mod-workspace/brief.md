# Twitch-style moderation workspace

User asked to redesign mod log, retention, and mod pages to match the open Twitch Mod View in T3. They confirmed live video and chat and explicitly require draggable widgets. User's visual direction supersedes DESIGN.md's anti-reskin sentence and the Mod tree's former admin-only composition rule; preserve other product/security contracts.

Reference: T3 tab_4, https://www.twitch.tv/moderator/tenhq, inspected at1440x900. Body #0e0e10, panel body near#18181b, compact panel headers near#252529, Inter14px, 8px gaps. A64px left icon dock,52px channel header, stream upper-left, Mod Actions and queue below, full-height chat right. Community far-right is not required without real capability.

Twitch drag behavior was exercised using HTML5 dragstart/dragenter/dragover/drop on its actual draggable header and drop zones. Dragging Mod Actions above AutoMod changed the lower row from side-by-side panels into two stacked panels; neighboring content expanded to fill the gap during drag, and the target showed a purple half-panel preview. Moving Mod Actions back to AutoMod's left restores the original side-by-side layout. It uses four edge drop zones, not just reorder by index. Resize separators are present; test them next. No moderation action or chat message was sent.

Current architecture: ModChannelPage resolves Twitch numeric or Kick canonical broadcaster identity and useModerationAuthority before mounting admin sections. Existing data owners: ChannelModLogFeed(query/filter/pagination), RetentionCard(get/set), ChannelBannedList, ChannelUnbanRequests, ChannelModeratorsTable, ChannelVipsTable, ChannelEngagement. All must preserve platform/role/IPC gates and scope keys. Existing Stream page composes useStreamPlayback, TwitchLivePlayer/KickLivePlayer and TwitchChat/KickChat. Reuse those public feature components through a small channel adapter; never embed StreamPage or clone player/chat internals.

Deliverable: compact moderation landing/log/retention UI plus authorized per-channel live workstation with draggable/resizable docked panels, local persistence, layout lock, reset, optional hide/restore tools, keyboard access, stable player/chat mounting while moving, useful empty/loading/error states. No fake AutoMod or unsupported Kick controls. Reference typography and layout take priority over decorative invention.

Design comparison rubric: exact edge-docking behavior; one valid layout representation with safe persistence; stable live media/chat state during drag; low implementation/dependency complexity; authority gates and existing data-owner reuse; keyboard/small-window usability.

Plan: [x] ground/reference, [ ] two distinct architecture sketches, [ ] cross-judge/synthesize, [ ] implement in bounded ownership units, [ ] focused tests + real Electron proof, [ ] review/commit/push main.
