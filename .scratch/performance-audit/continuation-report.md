# Desktop audit continuation

This pass resumed MultiView and exercised more controls across the desktop app. It does not certify every authenticated or provider-error state.

## Changes

- MultiView keeps each player host mounted across Grid, Focus, Ctrl-number focus changes, and drag reordering. Hosts render in canonical stream-ID order; CSS expresses the user's saved visual order. This avoids moving live media DOM subtrees and restarting their effects. Native Tab order therefore follows canonical host order after dragging; dnd keyboard movement and Ctrl-number focus follow visual order.
- Focus mode hides the inactive drag grip. WCV bounds refresh when a slot changes placement. A deferred rail player can become active when focused.
- The emote picker shares one immediate hover/focus tooltip instead of mounting a Radix tooltip for every emote. Offscreen preload is three rows instead of a full viewport. Search, scroll boundaries, favorites, locked emotes, and provider grouping retain their existing contracts.
- Settings switches and the prediction style selector have accessible names. Video play/pause, mute, theater, and fullscreen controls have translated labels.
- Notifications close with Escape and return focus to the bell. Notification rows support keyboard activation, and dismiss buttons become visible on keyboard focus.
- A playable VOD without a verified public URL now explains why Share is unavailable. No public URL is fabricated from a numeric Kick ID.
- The verification CLI accepts an empty string value, allowing automation to clear a field. The AutoMod retry test waits for the rejected connection state instead of matching the earlier Connecting status.

## Runtime evidence

Evidence directory: `../verify-streamfusion/evidence/perf-cont-20260906/`.

| Check | Observation |
|---|---|
| MultiView layout and focus before fix | Both original video nodes disconnected on Grid/Focus and focus changes. |
| MultiView final three-stream drag and layout checks | Trainwreckstv on Kick, LIRIK and sodapoppin on Twitch retained their video nodes through drag, Grid/Focus, and Ctrl+3. See `multi-final-*` and the final deterministic-order recheck `multi-canonical-*`. |
| Emote BTTV profile | Baseline frame p95 249.9 ms and max 266.8 ms. Final three-row preload profile p95 49.9 ms. The two-second observation includes live chat and playback; it is not pure input latency. |
| Emote 7TV final profile | Frame p95 33.4 ms. |
| Emote scroll and filter | Frame p95 16.8 ms; videos retained; no renderer exceptions or broken visible artwork. `emote-scroll-*-final`, `emote-search-final`, `emote-clear-final`. |
| Visible tooltip | Actual pointer hover over puzzleFR displayed its tooltip within the viewport. `emote-tooltip-visible-final`. |
| Settings labels | Buffer, Notifications, Predictions, and Chat had zero unnamed switch/combobox controls after the running modules were refreshed. `settings-*-final`, `settings-chat-labels-final`. |
| Notifications | Native page Escape closed the panel and focused the bell. `notifications-open-final`, `notifications-escape-final`. Populated-row keyboard behavior is covered by component tests. |
| Kick VOD | SolRawr video 125915152 played at readyState 4. Pause/resume/mute, 1.5x speed, and fullscreen entry worked. The public-link message was verified in `vod-share-message-final`. Browser-reserved Escape exit is not proven by a synthetic page key. |
| Search | All six result tabs, Twitch/Kick/ALL filters, and empty search completed without renderer exceptions or broken visible artwork. |
| Category detail | Chess language, tag empty/clear, provider, clips, and videos controls completed without renderer exceptions. Clearing the tag through Node also verified the CLI empty-argument fix. |
| Home | Featured next/previous, load more, sidebar collapse/expand retained the expected UI. |
| History and Downloads | Empty and populated History rendered. Three existing completed downloads showed loaded images. Delete confirmation and Cancel were exercised without deleting a file. |
| Moderation | Landing retention controls rendered. The unauthenticated Kick route showed an authority requirement. The Twitch route showed a channel-resolution error. These are failure-state observations, not live moderator verification. |

No broken visible thumbnails or avatars were observed in this continuation. Hidden empty poster images under playing Twitch videos are excluded from that claim. Canceled network requests during route changes are recorded separately from renderer exceptions.

## Limits and remaining work

The long-lived development renderer still exceeded the MultiView frame and memory budgets. The final long-session sample was 33.5 ms frame p95, about 1,890 MiB maximum process RSS, and 3.2% CPU p95, with zero renderer exceptions. Memory grew about 24 MiB during that 30-second sample. Earlier before-change samples also alternated between 16.8 ms and 33.4 ms cadence. Closing chat and restoring window size did not establish a cause. Native foreground ownership was confirmed. These measurements do not establish a fixed frame-rate or memory regression, and this pass does not claim to have resolved them.

The audit uses an isolated profile without copied credentials. Live Twitch sign-in/restart, AutoMod delivery, authenticated moderator writes, and new download/recording output remain unverified. The source-only Kick VOD lacks a public share URL upstream. The detailed remaining inventory is in `coverage-inventory.md`.

## Review and checks

Independent review accepted the player continuity design and identified two issues that were corrected: the inactive Focus drag grip and invisible keyboard-focused notification dismissal. The final implementation also removed a render-time mutable host-order registry in favor of deterministic ID sorting.

React Doctor's comparable changed-source scope had 17 warnings versus 18 at baseline. One new warning concerns clearing tooltip state when the picker closes; the picker renders nothing while closed, and the independent review found no visible failure. This is recorded rather than called clean. JSON artifacts are `continuation-doctor-current.json` and `continuation-doctor-baseline.json`.

All 629 test files and 7,599 tests pass. The initial full run found one AutoMod test timing race; after changing the assertion to wait for the actual failure state, the complete suite passed. Desktop typecheck, full ESLint, scoped formatting, architecture checks, 50 i18n catalogs, and 11 verification-helper tests pass.

The fresh-renderer 30-second sample passed the frame and CPU budgets at 17 ms frame p95 and 6.8% CPU p95, with zero renderer exceptions. It still failed the 1,400 MiB memory budget, reaching about 1,808 MiB across Electron processes. Reloading only the renderer does not reset the entire app process tree. See `multi-cont-fresh-renderer.json`; sustained memory and cadence remain open.

The final Electron doctor reported healthy. The isolated run was cleaned up with evidence retained. The real user profile and its credentials were not changed by the continuation.

Committed and pushed to main as `5911cff`. The pre-commit compiled Electron smoke check passed renderer, preload, and database health, then cleaned up its disposable profile. Its evidence is copied to `compiled-electron-smoke/`. The verified commit tree matched the staged source tree before main was advanced. No PR was opened. Existing user telemetry and unrelated scratch work remain untouched.

The translation generator's one-line source snapshot update was committed and pushed separately as `7f37bb2`. Its required compiled Electron smoke check also passed. Main and origin/main point to this follow-up commit.

Fix Root Causes drove stable media hosts instead of suppressing player recovery. Model the Domain separated canonical host order from visual layout order. Prove It Works required retained native video nodes, real pointer actions, and the compiled Electron check. Sequence Work into Verifiable Units kept these fixes distinct from the unresolved sustained-memory investigation.
