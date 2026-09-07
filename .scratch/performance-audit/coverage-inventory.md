# Remaining UI coverage inventory

Inventory snapshot: commit `3617b39`. This is a source inventory against the
existing evidence in [`report.md`](./report.md); it does not claim that any
listed behavior is broken. “Gap” means the existing report did not exercise the
branch or control. Remote writes and chat sends remain out of scope without an
authorized test account, as required by the verification recipes.

## Top-level route matrix

| Route / entry point | Existing evidence | Remaining user-visible coverage and concrete entry points |
|---|---|---|
| `/` | Featured stage, sidebar, avatars, and basic navigation were observed. | Exercise featured-stage rotation/selection and its loading, unavailable-chat, and retry branches; open a featured stream card and verify the resulting player/chat handoff. In the shell, cover `Sync`, `Retry`, `Show more/Less`, followed-channel links, sidebar collapse, search clear/history suggestions, profile menu, notification empty/populated states, and title-bar maximize/restore. |
| `/following` | All five tabs, channel filtering/search, keyboard/maximize path, and live cards were observed. | On each relevant tab, exercise All/Twitch/Kick filters; `Search followed channels/content...`; video sort; clip time range and sort; refresh failure → `Retry refresh`; tab-specific error → `Retry loading`; infinite/load-more sentinels; and opening a followed clip. Source entry points: `Following/index.tsx` controls around lines 724–769 and 914–1032. |
| `/categories` | Catalog, chess filter, category detail navigation, and detail content tabs were observed. | Verify category filter empty/recovery (`Filter categories`, `Try again`), card routing for both providers, and the catalog loading/error branches. |
| `/categories/$platform/$categoryId` | Detail tabs and platform scope were observed. | Exercise every content control: `Live streams`/`Clips`/`Videos`, All/Twitch/Kick, Language, Tag, viewer sort, clip time range, tab sort, pagination/infinite sentinel, and per-provider retry. Entry points are `CategoryDetail/index.tsx` controls around lines 513–648 and 763. |
| `/search` | Global search for `xqc` across all result tabs and category autocomplete were observed. | Exercise unified-search clear, search-history remove/re-run, keyboard suggestion selection, channel vs stream vs category search tabs, live-only toggle, favorite star/remove, provider filters, and result-card routing. On results, use the six buttons (`All`, `Channels`, `Streams`, `Videos`, `Clips`, `Categories`), All/Twitch/Kick, `Live only`, infinite loading, and a clip modal. `SearchResults/index.tsx` currently gives result-tab buttons no `role="tab"`/`aria-selected`; this is an accessibility hypothesis requiring runtime review. |
| `/stream/$platform/$channel` | Twitch channel Live/Home/Videos/Clips, clip modal, chat rail, and MultiView playback were observed; the final standalone live stream stalled. | Recheck both providers’ offline/metadata/playback-error paths (`Check again`/`Retry`), player controls (play/pause, volume, quality, speed, captions, stats, PiP, theater, fullscreen), chat width/position preference, recent-chatters panel, chat quick settings, rich input/auth blocker/emote/mention completion, username popout, pinned/prediction/poll cards, role-gated Twitch `Mod log`/`Engagement` tabs, in-chat moderation controls, recording setup/session/recovery, and RelatedContent tabs/cards/load-more. Do not send chat or perform provider writes. |
| `/video/$platform/$videoId` | A VOD played and seek was observed. | Exercise VOD retry/details retry, share, download-ready/duplicate confirmation and queue handoff, `Watch live`, related VOD/clip cards, full player settings (quality/speed/captions/local caption model/stats/PiP/theater/fullscreen), and synchronized chat replay. Chat replay selectors include `[aria-label="Open Chat Replay"]`, `[aria-label="Collapse Chat Replay"]`, return-to-live, and per-message `[aria-label^="Seek to"]`; cover loading, unsupported, transient-error → `Retry`, empty-window, drawer collapse/close, and seek synchronization. |
| `/settings` | All 17 settings sections were rendered; Diagnostics tabs/resources trace was exercised. | Exercise writes and reset/persistence for General, Playback, Notifications (including followed-channel expansion/search), Player controls, Buffer, Multiview, Chat appearance/emotes/events/behavior, Adblock, Proxy validation/save, Predictions style, Integrations, API tokens, Updates, and About. Diagnostics still needs each time window, history range, end-time/previous/next, pause/resume, CPU/RAM bucket/incident/zoom, copy trace IDs, DevTools, Logs/report bug. Dev-only tabs are `logs` and `report-bug`; use `?tab=<name>` deep links. |
| `/multistream` | Empty and populated Add/Search/Favorites, Grid/Focus, two providers, merged/individual chat, and 30-second playback were observed. The parent runtime sweep additionally found a layout/focus remount bug. | Exercise the remaining slot contract after that finding: drag reorder with pointer and keyboard, Ctrl+1..6 focus, side-rail activation, per-slot `Show chat`, `Mute`/`Unmute`, `Remove stream`, suspended `Activate stream`, offline `Retry`, Twitch `Retry playback`, WCV crash retry (where enabled), Raid handoff, playback-budget overflow/lazy mounting, merged/channel chat tabs, and chat-rail close/reopen. Useful selectors: `[data-diagnostics-stream-slot]`, `[data-testid="multistream-chat-rail"]`, `title="Drag to move"`, `title="Show chat"`, `title="Mute"`, `title="Remove stream"`. |
| `/history` | Empty and populated history card/thumbnail states were observed. | Open a stream/VOD/clip from history, verify unavailable-item recovery, remove one item, and `Clear history` confirmation/persistence. VOD cards expose `aria-label="Watch <title>"`; remove is a hover-only button titled `Remove from history`. |
| `/downloads` | Existing completed downloads rendered. | Create a controlled local download only if authorized, then cover queue progress/cancel, open file, show in folder, remove from list, delete-from-disk confirmation, failed-delete → `Retry delete`, and load failure → page `Retry`. Existing row selectors are accessible names `Cancel <title>`, `Open <title>`, `Show <title> in folder`, `Delete <title>`, and `Remove <title>`. |
| `/mod` | Moderation landing, channel discovery, and refresh surface were observed. | Exercise landing refresh/error recovery and channel-card entry for each provider, then verify retention summary across empty/loaded/error states. |
| `/mod/twitch/$channel` | Twitch authority remained unresolved; page structure was observed. | With authorized moderator fixtures, cover checking/hidden/unverifiable/reconnect-required authority states, `Back to moderation index`, `Refresh data`, live video/chat widgets, dock open/close/reopen, resize separator (pointer + keyboard), lock/unlock/reset layout and persistence, widget options/hide, AutoMod queue retry/reconnect plus Allow/Deny (write actions require authorization), filters, and all populated channel tables. |
| `/mod/kick/$channel` | Kick retention and empty log were observed. | Cover the same authority/workspace/error states where supported, plus populated/empty/failed mod log, `Load more`, retention days/forever/save, and Kick unsupported tables. |

## Cross-route component coverage

The persistent shell is present on most rows above. Remaining shell controls are
the sidebar toggle, global search modes/history/clear, profile connect/reconnect
and disconnect controls, notification mark-read/clear/dismiss/open behavior,
network/offline status, global recording indicator/details, mini-player restore,
and title-bar minimize/maximize/close. These should be checked after navigation
from a route that has a mounted player so transitions do not hide the shell.

Chat has a larger state space than the existing report demonstrated. The useful
entry points are `[data-testid="chat-rich-input"]`, `[aria-label="Chat settings"]`,
Recent Chatters, message hover actions, username popouts, pinned-message
expand/hide/unpin/options, prediction expand/dismiss, poll expand/dismiss,
`[role="tab"][data-tab-id="modlog"]`, and the broadcaster-only
`data-tab-id="engagement"`. Cover viewer/authenticated/mod/broadcaster and
Kick/Twitch branches structurally; keep sends, pin/unpin, ban/timeout, raid,
and chat-mode writes disabled unless explicitly authorized.

## Emote picker performance diagnosis

The parent runtime sweep measured fresh third-party provider tab switches in the
visible Electron renderer. These values are evidence of a regression risk, not a
proof of one particular cause:

| Action | Action time | Frame p95 / max | Script / task | DOM images |
|---|---:|---:|---:|---:|
| BTTV tab | 115 ms | 133 / 233 ms | 1.045 / 1.528 s | 172 |
| 7TV tab | 126 ms | 233 / 300 ms | 1.059 / 1.434 s | 129 |
| FFZ tab | 130 ms | 16.8 / 33.3 ms | 0.217 / 0.562 s | 125 |
| Filter (`peepo`) | 224 ms | 16.8 / 16.8 ms | 0.236 / 0.423 s | 103 |

Evidence is in `.scratch/verify-streamfusion/evidence/perf-cont-20260906/chat-emotes-{bttv,7tv,ffz,filter}/report.json`.
The counts include hidden/offscreen image nodes, so they are useful for mount
pressure but do not establish that every image was painted. The frame samples
are refresh-quantized; compare traces and repeated runs rather than treating a
single p95 as a budget verdict.

Ranked falsifiable hypotheses for the next runtime sweep:

1. **Per-item Radix Tooltip setup is a major fresh-mount cost.**
   `EmotePickerPopover.tsx:617-681` wraps every `EmotePickerItem` in its own
   `Tooltip`, `TooltipTrigger`, and `TooltipContent`, even though the button
   already has an accessible `aria-label` and `EmoteImage` is passed
   `showTooltip={false}`. The BTTV CPU profile contains repeated Radix tooltip
   frames (including tooltip module line 107 and `TooltipTrigger2`) alongside
   `EmotePickerItem`/`EmoteSection` frames. A profiling A/B that replaces only
   the per-item wrapper with the same button plus `title={emote.name}` should
   reduce fresh-tab frame p95 roughly with the number of newly mounted items.
   A shared single tooltip is the smallest visual-preserving candidate if the
   native title is not acceptable; retain button labels, lock semantics,
   favorite hover, and selection behavior.

2. **The preload window mounts the complete normal-sized provider lists.**
   `EmotePickerPopover.tsx:378-416` sets `WINDOW_PRELOAD_PX` to 360 px, equal
   to the default 360 px viewport. With seven columns and a 48 px row pitch,
   the initial 720 px window can mount 105 items; the observed 98-item 7TV
   list and 50-item BTTV list therefore fit entirely in the window. Compare
   DOM emote-button/image counts after switching tabs while varying preload
   to one or two row pitches, leaving tooltip code unchanged. If mount count
   and p95 fall together, lower the overscan or derive it from a small row
   budget; preserve keyboard reachability and smooth subsection navigation.

3. **Independent image source/load state updates add mount churn.**
   Each `EmoteImage` (`EmoteImage.tsx`) owns source-attempt state and an async
   load/error transition. The profile includes repeated `EmoteImage` frames,
   while BTTV/7TV create many image nodes. Compare a fresh tab with the same
   item DOM but deferred image attachment outside the active/overscan rows (or
   a local image-source stub in the profile build). A p95 drop without a
   tooltip-frame drop would support this hypothesis. Keep the existing cache,
   error fallback, and 7TV IPv4 recovery contract.

4. **Scroll snapshot state causes avoidable rerenders during navigation.**
   `EmotePickerPopover.tsx:1277-1304` allocates a new `scrollSnapshot` object
   on every scroll event; `EmoteSection` is not memoized. This is a scroll and
   smooth-subsection risk, not an explanation for a tab click with no scroll.
   Profile a subsection click and manual wheel scroll, then compare one-RAF or
   row-range-only snapshot updates. Candidate fix: refs plus a throttled RAF,
   while retaining active-subsection updates and the 700 ms programmatic-scroll
   release.

5. **QuickEmoteActionBar repeats measurement when ChatInput rerenders.**
   `QuickEmoteActionBar.tsx:60-131` creates `quickEmotes` on every render and
   reruns its layout measurement/possible `node.animate()` effect. Freeze the
   derived list for an A/B picker-open profile; discard this hypothesis if
   render count or p95 is unchanged. Candidate fix is memoizing by the emote
   inputs, preserving animation when the actual key/order list changes.

The profile's `(program)` (471 ms), garbage collector (69 ms), and many
URL-less React development `run` frames cannot identify a component by
themselves. `chat-store.ts:75` `mergeKnownUsers` also appears at 12.4 ms and
may be concurrent chat work; TwitchChat uses narrowed selectors, so this is
not evidence that the picker caused it. Do not call any item above a proved
failure without the listed A/B observation.

## Prioritized source-backed hypotheses to verify

These are reproducible audit candidates from the current source, not proved
failures:

1. **Several settings switches/selects may be unnamed to assistive technology.**
   The generic notification switches around lines 1880–1909 and Buffer’s
   low-latency switch around line 2313 lack `aria-label`/an explicit label
   association. Predictions’ Style `SelectTrigger` around line 2455 likewise
   has nearby visual text but no explicit accessible name. Inspect by role on
   `?tab=notifications`, `?tab=buffer`, and `?tab=predictions`.
2. **Player icon buttons may expose tooltip text only.**
   `play-pause-button.tsx`, `player-controls.tsx` theater/fullscreen buttons,
   and `volume-control.tsx` mute button have no `aria-label` in the button
   source; the visible label is supplied by a tooltip. Check keyboard and
   accessibility-tree names in a mounted stream/VOD player.
3. **Notification rows may be mouse-only.**
   `TopNavBar/NotificationsDropdown.tsx` renders each notification as a
   clickable `<div>` without keyboard role/tabIndex; only its dismiss child is
   a button. Open a populated Notifications menu and test tab/Enter behavior.
4. **Following may subscribe to the entire auth store.**
   `Following/index.tsx` around lines 207–225 destructures several fields from
   `useAuthStore()` rather than using narrow selectors. This is a performance
   hypothesis for unrelated auth updates on the large Following surface; use
   render/diagnostics evidence before changing it.

Do not convert any hypothesis into a defect without the corresponding runtime
observation. The existing performance report’s measured wins and limitations
remain the source of truth for already-evidenced behavior.
