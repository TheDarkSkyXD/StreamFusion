# MultiView rendering and update path

## What is established

MultiView has two separate observations that should not be merged into one diagnosis:

1. **A playback continuity bug was proven and the stable-host fix is verified.** Before the fix, Grid -> Focus, `Ctrl+2` while focused, and Focus -> Grid detached both original `<video>` nodes (`multi-focus-beforefix`, `multi-focus-select-beforefix`, and `multi-grid-beforefix`). A grid drag also restarted the moved stream. After the fix, the labeled media references for Kick Trainwreckstv, Twitch LIRIK, and Twitch sodapoppin all remained connected, `readyState=4`, unpaused, and advancing through drag, Focus entry, `Ctrl+3`, and return to Grid (`multi-canonical-drag`, `multi-canonical-focus`, `multi-canonical-ctrl3`, and `multi-canonical-grid`).
2. **The steady 30 FPS cadence is reproduced but its app cause is not proven.** Two live streams passed at fixed 1440x900 with host-renderer frame p95 16.8 ms, but a maximized run reached p95 33.4 ms against the 20 ms budget. Closing chat and returning to 1440 did not immediately remove that cadence. The maximized trace reported about 4.1% CPU, falling heap, and no errors. A layout-triggered playback restart briefly returned 60 FPS. This currently points the next probes toward decoder/compositor/presentation cadence, but it does not prove a decoder, GPU, React, chat, or timer defect.

The performance harness samples the host document's `requestAnimationFrame` intervals and aggregates `getVideoPlaybackQuality()` for `<video>` elements in that document (`apps/desktop/src/frontend/renderer/performance/performance-harness.ts:40-58`). Its `MutationObserver` wires video and route milestones, and its `PerformanceObserver` records long tasks (`performance-harness.ts:61-96`). Frame p95 is therefore a host-renderer presentation symptom, not a direct measure of HLS decode time.

## Entrypoint and ownership

The TanStack route `/multistream` is a lazy `MultiStreamPage` child of the authenticated app layout (`apps/desktop/src/frontend/routes/router.tsx:149-153`; lazy boundary in `features/multistream/routes/index.ts`).

`MultiStreamPage` owns page composition rather than media lifetime:

- It selects stream IDs, chat identity, layout, chat mode, and playback budget from the Zustand store (`apps/desktop/src/frontend/pages/MultiStream/index.tsx:17`).
- It starts or retains base chat sessions for every configured stream while the chat rail is open through `useMultiChatSessions` (`index.tsx:61`).
- It mirrors the playback budget to the main-process slot controller (`index.tsx:75-77`) and destroys main-side slot records when the route unmounts (`index.tsx:79-89`).
- It renders `MultiStreamGrid` once as the video surface (`index.tsx:149`). When chat is open, it renders either one `MergedChatFeed` or one selected-channel `ChatPanel` (`index.tsx:221-223`). Tab mode does not mount a hidden panel for every channel.

The persisted Zustand store is the owner of configuration, not frame-time state (`features/multistream/data/multistream-store.ts:240`):

- `streams` contains `{id, platform, channelName, isMuted, volume}`. IDs are canonical platform plus normalized lower-case channel.
- It owns `layout`, `focusedStreamId`, chat-open/selection/view, playback budget, and background quality (`multistream-store.ts:241-250`).
- Stream add/remove/reorder and mute/volume actions replace the `streams` array (`multistream-store.ts:253-345`, `389-398`). `MultiStreamGrid` subscribes to that full array, so those actions render the grid again. Healthy media playback does not mutate this store.
- Persistence deliberately restores `layout: "grid"` rather than a prior focus view (`multistream-store.ts:410-417`).

## Grid and focus rendering

`MultiStreamGrid` is the layout boundary (`features/multistream/components/multistream/grid-layout.tsx`):

- It queries `slot.isWcvEnabled()` once per grid mount (`grid-layout.tsx:80-101`) and asks main to re-emit existing slot presence once (`grid-layout.tsx:74-79`).
- It renders one keyed `SortableStreamSlot` list below one persistent `DndContext`, `SortableContext`, and `AspectAwareStreamGrid` in both Grid and Focus. Playback is active for visual indexes below the budget; Focus admits the focused stream plus the first `playbackBudget - 1` rail streams.
- The list's React/DOM order is canonical stream-ID order. Persisted user order is expressed through CSS grid `order` and explicit focus/rail placement. Dragging therefore changes visual order and the dnd-kit item order without moving existing media hosts in the DOM.
- Focus uses the same hosts: one wrapper becomes the sticky 16:9 stage and the others become fixed 16:9 cells in the horizontally scrolling rail. Sort behavior and drag handles are disabled in Focus; Ctrl+number still follows the user-visible/store order.

The earlier conditional layout replaced the complete player tree on Grid/Focus changes. The common stable list removes that lifetime boundary. `StreamSlot` also receives a placement key so the optional WCV branch republishes bounds after layout movement without destroying the slot.

`AspectAwareStreamGrid` computes the largest 16:9 cells up to three columns. It has one `ResizeObserver`, takes one initial bounding box, and updates React state only when the integer geometry changes (`adaptive-stream-grid.tsx:93`, `122`, `135-163`). A resize, maximize, or chat-width change can cause a geometry render. Stable bounds do not produce a continuing resize loop.

The reorder failure was not Twitch-specific. Labeled probes showed whichever logical stream moved was affected. Its `useStreamPlayback` subscription effect cleaned up and restarted with the same platform, identifier, hook instance ID, reload key, proxy flag, and stable timer identity. No shared reload, cache miss, or player recovery callback preceded it. The restarted subscription served the URL from memory and incremented `playbackRevision`, which deliberately rebuilt the player. The trigger was moving the keyed media subtree in DOM order. Keeping canonical DOM host order prevents that effect reconnection; the existing playback/manual-retry keys remain intact for real recovery.

## Per-slot playback path

Every `StreamSlot` owns its media and channel state (`features/multistream/components/multistream/stream-slot.tsx:45`):

1. `lazyMount` uses a one-shot `IntersectionObserver`; after reaching the 0.25 threshold it remains visible for the component lifetime (`stream-slot.tsx:68-88`). Only focus side-rail slots request this behavior.
2. `useStreamPlayback(platform, identifier)` obtains the URL when the slot is within the playback budget (`stream-slot.tsx:92`). The module cache is keyed by platform and normalized identifier, is valid for 90 seconds, reference counted, and evicted 100 ms after its last subscriber. Distinct cold instances stagger by 150 ms (`features/playback/data/useStreamPlayback.ts:15`, `22-52`, `331`, `539`). It does not poll; it refetches on initial load, explicit retry, bounded recovery, or network restoration.
3. `useChannelByUsername` supplies display/offline/raid metadata (`stream-slot.tsx:118`). TanStack Query uses the shared followed-channel-list cache policy; metadata is stale for five minutes and has no interval poll (`features/discovery/data/queries/useChannels.ts:50-69`). Slot, base chat session, and selected chat can deduplicate this query.
4. The default in-process branch renders `KickLivePlayer` or `TwitchLivePlayer` (`stream-slot.tsx:401-417`). The optional WCV branch renders only host chrome and a bounds placeholder.

The renderer calls `STREAMS_GET_PLAYBACK_URL` through preload. Main dispatches by platform (`backend/ipc/handlers/stream-handlers.ts:749-800`):

- Twitch creates `TwitchStreamResolver`, fetches the public playback access token, and constructs the usher HLS URL.
- Kick creates `KickStreamResolver`. Normal acquisition may reuse cached channel playback; recovery forces refresh. The legacy channel endpoint is checked for live status and `playback_url`/`livestream.source`. On a failed slug it can resolve a stale-follow replacement slug and retry.

Channel metadata separately reaches `CHANNELS_GET_BY_USERNAME`. Twitch resolves through its channel reader. Kick resolves through its reader with stale-follow and account/suspension fallbacks (`backend/ipc/handlers/channel-handlers.ts:154-207`). These are acquisition and recovery branches, not regular MultiView polling.

## Recurring work while streams play

For each in-process live stream, the common HLS layer performs normal manifest/segment work and runs a one-second fragment-arrival watchdog (`features/playback/components/player/hls-player.tsx:223-280`). Live memory cleanup is scheduled every 60 seconds in the current code; it trims old buffers and may request garbage collection (`hls-player.tsx:320-336`).

Both live players use `useLivePlaybackStallRecovery`: it registers one `requestVideoFrameCallback` chain per video and evaluates the controller every 500 ms (`features/playback/components/player/hooks/use-live-playback-stall-recovery.ts:38`, `107-124`). In the healthy path the frame callback updates refs/controller data, not React state. Player React state changes on discrete media events such as waiting, playing, quality, rate, and errors. Kick's uptime readout updates the progress-bar DOM at 1 Hz without rerendering the full player.

Those callbacks are real recurring work, but current measurements do not show that they cause the 33.4 ms cadence. A 30 FPS video can also make a host rAF sample cluster near 33.3 ms through Chromium scheduling/presentation behavior while CPU remains low. A trace and isolation matrix are needed to distinguish those cases.

## Chat path and render pressure

When the rail is open, `useMultiChatSessions` runs channel metadata queries for all configured streams and retains a `Map` of established sessions (`features/chat/data/use-multi-chat-sessions.ts:168-209`). Incremental reconciliation means a later metadata result does not restart already-established sessions. Twitch acquisition connects and joins IRC; Kick acquisition connects and joins Pusher. Closing the rail retires them.

The message router attaches one service listener per referenced platform, filters by registered channel route, decorates third-party emotes, and calls `useChatStore.getState().addMessageBatched` (`features/chat/data/chat-message-router.ts:16-70`). The store batches independently per channel with a 16 ms timeout (`frontend/store/chat-store.ts:288-293`, `502-572`). Each successful flush replaces the top-level `messagesByChannel` record.

`MergedChatFeed` subscribes to that entire record and recomputes its heap merge whenever any channel bucket changes (`features/chat/components/chat/MergedChatFeed.tsx:28-31`). It virtualizes rows, but a busy unrelated bucket still invalidates the merged selector. In tab mode the base sessions remain alive; only the selected `ChatPanel` mounts the full platform orchestrator. Twitch pin polling belongs to that full tab panel, not a merged-only view.

This makes chat a plausible, measurable source of React commits under message load, but the completed chat-closed run did not remove the 30 FPS cadence. It is not supported as the primary cause of that observation. The development render counters cover `ChatPanel`, `ChatMessageList`, and `MergedChatFeed`; they do not currently cover `MultiStreamGrid` or `StreamSlot`.

## Optional WebContentsView path

The slot feature is lazy loaded. WCV playback is enabled only when `STREAMFUSION_WEBCONTENTS_VIEW_SLOTS === "1"` (`backend/ipc/lazy-feature-loader.ts:203-210`); the slot controller defaults to disabled (`backend/api/unified/slot-controller.ts:125-159`). With it enabled, each active host slot creates a main-owned `WebContentsView`, and the host `StreamSlot` sends playback URL plus rounded bounds from a per-slot `ResizeObserver` and window scroll/resize listeners (`stream-slot.tsx:156-216`). The slot renderer owns its own HLS `<video>`.

This branch changes measurement: the host performance harness cannot discover `<video>` elements inside separate WCV documents, so its aggregate video quality is incomplete. It must be explicitly confirmed through `slot.isWcvEnabled()` before interpreting a run.

There is also an implementation gap in this optional path. The narrow slot preload exposes `onSetQuality` and `onSetBufferConfig`, and main emits them, but `frontend/slot-renderer/main.ts` subscribes only to load, mute, and unload (`slot-renderer/main.ts:109-129`). The WCV player therefore does not currently consume its background quality/buffer commands. This is unrelated to the measured default path unless the environment flag was enabled.

## Minimal stable-host designs

### A. One stable keyed slot list and CSS layout (selected and implemented)

Keep one keyed `SortableStreamSlot` list below one parent for both modes. Render that list in deterministic stream-ID order so existing host nodes never move; apply the user/store order through CSS placement. Each sortable wrapper always contains the same `StreamSlot`; layout, focus, rail placement, size, and visual order become wrapper styles. Keep `DndContext` and `SortableContext` mounted around that list in both modes and disable each sortable while focused.

This has the fewest lifetime boundaries and directly preserves `StreamSlot`, player, HLS, and `<video>` identity. It can preserve the logical contracts:

- grid still uses the adaptive 16:9 geometry and dnd-kit ordering;
- focus uses a tall main row and a fixed-height, horizontally scrolling rail;
- `playbackActive` remains focused=true plus the first `budget - 1` rail streams;
- side slots keep the one-shot lazy-mount policy;
- WCV bounds continue to come from the stable slot wrapper's actual rectangle.

The implemented focus presentation uses the common grid itself as the horizontal scroller. Side slots occupy row two at fixed 16:9 rail sizes. The focused slot occupies row one and uses `position: sticky; left: 0` with the observed container width, so it stays fixed while the rail scrolls. `AspectAwareStreamGrid`'s existing `ResizeObserver` supplies the main-stage geometry. A placement key makes the WCV bounds effect push again after grid/focus/rail movement, and the window capture-phase scroll listener continues to cover rail scrolling. This keeps the existing focus rail without a portal, DOM reparent, or separate layout registry.

The deliberate accessibility tradeoff is that browser Tab traversal follows canonical stream-ID order after a user drag, while visual placement, Ctrl+number, activation, and dnd-kit keyboard ordering follow the saved user order. With at most four slots, preserving uninterrupted live media was selected over physically reordering each slot's many focusable descendants.

### B. Lifetime-stable media hosts moved between layout targets (alternative)

Keep the existing layout branches as target/chrome trees:

- grid: `DndContext -> SortableContext -> AspectAwareStreamGrid -> SortableSlotTarget`;
- focus: main `AspectAwareStreamGrid -> SlotTarget` plus the existing horizontal rail targets.

Separately, render one keyed `PlayerHost` per stream. Each host creates one DOM container for its lifetime, portals its `StreamSlot` into that same container, and uses a layout effect to `appendChild` the container into the active grid/main/rail target. The portal target itself must never change: passing a new container to `createPortal` remounts the subtree. Only the stable container moves in the DOM. This is already the project's persistent mini-player pattern (`features/playback/components/player/mini-player.tsx:109-136`, portal at `mini-player.tsx:577`).

This adds an explicit target registry and retains the existing adaptive grid, independent horizontal rail, and dnd-kit transform behavior. Put the drag handle on `SortableSlotTarget` or publish its attributes/listeners through the registry. The stable host continues to own the current Kick/Twitch/offline/suspended/WCV branches. It was not selected because it touches more modules and `appendChild` media continuity would still require native proof.

For WCV, moving the placeholder preserves its ref and slot lifetime, but bounds need an immediate push after attachment/layout revision. A CSS transform during drag may not trigger `ResizeObserver`, so update bounds during drag animation and once on drag end. Grid/focus movement must not call `destroySlot`; actual stream removal or page exit still should.

Its likely impact would include `grid-layout.tsx`, `sortable-stream-slot.tsx`, `stream-slot.tsx`, and a co-located host/target-registry module. Page, store, and chat ownership would not need behavior changes.

Enabling WCV would also decouple decoder lifetime from much of the host React tree, but it is an opt-in architectural switch with the quality/buffer gap above. It is not a minimal fix for the proven layout remount.

## Falsifiable probes and fix verification

Run these independently and keep stream identities, source qualities, observation duration, and warm-up constant:

1. **Stable identity after the layout fix: completed.** Labeled slot/video references survived three-stream Grid drag, Focus entry, `Ctrl+3`, and Focus -> Grid while all media remained ready and advancing. Budget transitions remain an allowed exception only when a stream crosses active/suspended status.
2. **Reorder attribution: completed.** Temporary call-site and hook-lifecycle probes ruled out shared reload, URL cache miss, recovery callback, identifier change, and effect dependency change. The moved subtree reconnected the subscription effect; canonical DOM order removed that trigger. The probes were removed after diagnosis and `useStreamPlayback.ts` has no final diff.
3. **Measure the size boundary.** At fixed streams and chat state, sweep viewport sizes including 1440x900 and maximized. Record host rAF p50/p95/max, long tasks, per-video presented/dropped deltas, renderer/GPU CPU, and React commit counts. If the step follows rendered pixel area while commits/long tasks stay flat, compositor/decode scaling gains support. If commits or long tasks rise with it, inspect their stacks.
4. **Separate host cadence from media.** Pause one video at a time without changing layout, then both, and repeat at the failing size. Improvement tied to one provider/video supports its decode/presentation path. No change weakens that hypothesis.
5. **Keep chat falsifiable.** Compare chat closed, merged, and one selected tab at the same size. Capture `window.__chatStore` action counters when available and React render counters. Merged vs tab holds base sessions open and better isolates feed rendering; closed also removes sessions and transport work. The completed close-chat result already weakens chat as the cause of the persistent 30 FPS cadence.
6. **Confirm the backend mode.** Record `slot.isWcvEnabled()` for every run. If false, profile host `<video>`/HLS and GPU. If true, profile slot renderer and GPU processes separately because host video-quality aggregation misses WCV media.

## Closest tests and gaps

- `tests/components/multistream/grid-layout.test.tsx` covers empty state, slot count, focus structure, playback budget, and WCV query behavior. It mocks both `StreamSlot` and `SortableStreamSlot`, so it cannot detect player/video remounts.
- `tests/components/multistream/grid-layout-continuity.test.tsx` renders the real grid/adaptive/sortable topology with a stateful fake only at the player-slot boundary. It asserts one mount per active stream through layout/focus/reorder, canonical host DOM order with CSS visual order, hidden Focus drag handles, and 16:9 stage/rail geometry. Its DOM-order assertion failed before the reorder fix and passes after it.
- `tests/pages/MultiStream.test.tsx` covers toolbar layout actions, chat rail modes, and route-unmount slot destruction. It mocks the grid and chat components.
- `tests/components/multistream/stream-slot.test.tsx` covers platform routing, suspension, retry, and per-slot error isolation with mocked playback/player components.
- `tests/components/multistream/adaptive-stream-grid.test.ts` covers pure geometry selection.
- `tests/store/multistream-store.test.ts` covers actions and persistence migration.
- `tests/hooks/use-multi-chat-sessions.test.tsx`, `tests/components/chat/chat-message-router.test.ts`, and `tests/store/chat-store.test.ts` cover retained session lifecycle, routing, batching, and cleanup.
- `tests/backend/api/unified/slot-controller.test.ts` and the IPC handler test cover focus singleton, budget, WCV lifecycle, crash recovery, and emitted controls.
- HLS source reuse and stall watchdog have focused component tests. `tests/scripts/performance-soak.test.ts` tests runner/report logic, not a real maximum-window MultiView workload.

The implemented regression test renders a real `MultiStreamGrid` with a small stateful fake at the player boundary and records mount IDs. `stream-slot.test.tsx` separately proves the WCV slot is created once, not destroyed during placement changes, and receives updated bounds. Native labeled-media checks remain the final proof because jsdom cannot establish Chromium decoder continuity.

Verification checkpoint: 4 focused files / 21 tests passed, desktop typecheck passed, scoped ESLint and Prettier passed, `architecture:features` passed, and `git diff --check` passed before native verification.
