# StreamFusion desktop performance and reliability audit

Date: 2026-09-06. Base revision: `8d15fdc`. The Electron app ran through the repository's checked development launcher with isolated copies of the development profile. Three disposable runs were cleaned up; screenshots, action records, and reports remain under `.scratch/verify-streamfusion/evidence/`.

## Changes

- Following Channels renders a window of cards instead of mounting every followed channel. Categories data and thumbnail preloads now wait until the Categories tab opens.
- Category filtering responds locally while remote searches debounce for 250 ms. Old search responses cannot supply results for the current query.
- Diagnostics resource charts reuse locale date formatters. Workspace configuration waits for its lease and discards responses for older tabs.
- Kick image recovery stops after four delayed retries. Changing an image source cancels its prior retry state.
- History thumbnails, category autocomplete artwork, and enlarged chat badges use the shared image fallback. Chat badges retain their original URL to avoid resolving the image protocol twice.
- The notification routing integration test uses the existing complete Electron bridge mock, fixing the sole stale fixture discovered by the full suite.

## Measured results

| Interaction | Before | After | Evidence |
| --- | --- | --- | --- |
| Following Channels rendered cards | 672 | 56 | First run `following-channels/report.json`; final run `channels-final/report.json` |
| Channels renderer task time in interaction sample | 1,251.2 ms | 187.4 ms | Same reports; approximately 85% less work |
| Diagnostics Resources frame p95, 20-second trace | 166.6 ms | 16.8 ms | `resources-before.json`, `resources-final.json` |
| Diagnostics resource budgets | CPU, frame, and memory-growth failures | Pass | Same profiles; final trace saved without data loss, zero renderer exceptions |

These are development-build samples from this machine, not release benchmarks or guarantees for every account. Channels task time includes the action and following observation interval; controller process duration is not presented as pure UI latency. Profiles were taken with a visible renderer. Early post-fix captures interrupted by hot reload or targeting Playback were rejected. Hidden-window frame samples are inconclusive.

## Coverage and observed states

The first evidence run is `perf-audit-20260906`; the second is `perf-final-20260906`. Each interaction folder contains `report.json` and `screen.png`; `actions.ndjson` records controller actions. `drive.mjs` adds CDP wheel and keyboard actions, frame sampling, DOM/media assertions, and screenshots. Those extra actions are identified by the labeled report folders and this script rather than the controller action log.

| Surface | Checked | Result and evidence |
| --- | --- | --- |
| Home | Featured stream, sidebar navigation and avatars | Twitch Caedrel playback and chat; first run `home-before.png`, `baseline-home` |
| Following | Live, Videos, Clips, Categories, Channels | Content rendered; first run `following-*`; final run `channels-final`, `channels-bottom`, `channels-filter`, `channels-filter-clear`, `channels-keyboard`, `channels-resize` |
| Channels interaction | Scroll to final channel, filter from bottom, clear filter, keyboard traversal beyond initial window, maximize | Tail channel zynkah reachable; LIRIK filter resets scroll; Tab reaches BoostBri beyond initial window |
| Categories | Catalog, chess filter, Chess detail Live/Clips/Videos, Kick filter | Provider content rendered; final run `chess-search-final`, `chess-detail`, `chess-kick`, `chess-clips`, `chess-videos` |
| Search | xqc results All/Channels/Streams/Videos/Clips/Categories; chess autocomplete Categories | Mixed provider data; empty xqc category result; first run `search-*`, final `autocomplete-categories` |
| Settings | All 17 sections | General, Playback, Player Controls, Buffer, MultiView, Notifications, Chat, Predictions, Adblock, Proxy, Integrations, API Tokens, Updates, Diagnostics, Logs, Report Bug, About; first run `settings-*` |
| Diagnostics | Overview, Resources, I/O, Traces, Logs & Reports, Developer Tools | All six tabs rendered; final Resources trace passed |
| MultiView | Add dialog Search/Favorites, grid/focus layouts, two providers, merged and individual chat | LIRIK on Twitch and Blame on Kick both played; first run `multiview-*`, final `multi-visible-final`, `multi-playback-proof` |
| Twitch channel | Live/Home/Videos/Clips, clip modal | LIRIK live and clip playback succeeded in first run; final single-live load stalled, later MultiView playback succeeded |
| Video | Open VOD, wait for actual playback, seek forward | Twitch VOD 2856121455 played at 1920 px, readyState 4; final `vod-final-settled`, `vod-seek` |
| History | Empty and populated views after playback | Saved VOD card and thumbnail rendered; first run empty and populated artifacts; final `history-verified` |
| Downloads | Existing completed items and artwork | Three existing completed items rendered; first run `baseline-downloads`; no new download or deletion |
| Moderation | Landing and own Twitch/Kick channel pages | Twitch channel could not resolve; Kick retention controls and empty observed log rendered, unsupported banned-list capability explained; final `mod-*` |
| Chat images | Live emotes and badges; category artwork | Visible images rendered. Badge tooltip hover attempt did not establish a visible tooltip. Failure recovery is covered by component tests. |

## Remaining limits and findings

- MultiView does **not** pass every budget: the visible 30-second run recorded frame p95 33.4 ms against a 20 ms limit, CPU p95 3.1%, zero exceptions, and passing memory budgets (`multiview-visible-final.json`). No app-specific cause was established. Its window was maximized, unlike the earlier normal-size run. The earlier traced run exceeded the memory budget and trace size limit; this is not evidence of a confirmed leak. Later hidden-window profiles are not valid frame comparisons.
- The copied Twitch token was rejected with HTTP 400 at startup. The app cleared credentials in the disposable profile. The sidebar count later changed from 672 to 142; no remote follow deletion or write was observed. Authenticated Twitch moderation could not be verified.
- Twitch metadata requests intermittently timed out. VOD playback succeeded, but chat replay showed its retry state. The stalled single-stream LIRIK load did not have enough request-specific evidence to identify a cause. See `provider-findings.md` for redacted observations and explicit uncertainty.
- The Kick degraded banner persisted even while Kick browsing and playback worked. External provider health was not claimed fixed.
- Live provider content and the available account do not expose every component state. No chat messages, moderation writes, follows, recordings, or downloads were sent to providers. This audit does not certify every possible UI state or every bottleneck.

## Verification

- Full desktop Node and DOM suite: **623 files, 7,520 tests passed**, 103.75 seconds (`desktop-tests-final.log`).
- Checked Electron launch passed desktop typecheck and ESLint. Feature boundary check passed. Changed notification test passed Prettier and ESLint.
- Regression failures were verified by retaining current tests while restoring only the affected source from `8d15fdc`, then restoring the fix. Diagnostics: 2 failures / 1 pass before, 3 passes after (details in `provider-findings.md`). Image regressions and discovery results are recorded in `decisions.tsv`.
- Independent code review found and resolved virtual row-height drift, keyboard reachability, and stale Diagnostics responses. Final review covers the complete artifact trail.

The final grid uses a React key to reset on filter changes and `useSyncExternalStore` for viewport changes. Focused discovery tests passed again: 51/51. With the new tests retained and base source restored, 3 failed and 48 passed; exact final source was restored afterward. The full 7,520-test run predates this small final grid correction.

The third checked Electron run, `perf-grid-final-20260906`, verified the corrected grid mounts, reaches the remaining list's tail, and resets scroll when filtering to LIRIK (`channels`, `tail`, `filter`). Its copied session lost Twitch authorization and the dataset changed during the check; the final keyboard attempt therefore did not repeat the earlier 672-channel traversal. The original keyboard proof and focused tests cover the unchanged focus-range algorithm. Backgrounded samples from this last run supply functional assertions, not performance claims.

Comparable isolated React Doctor scans of Following/Categories and their tests scored 92/100 before and 91/100 after adding the grid: 11 existing warnings plus one warning about recalculating state after a prop change. The independent reviewer classified the new warning as DOM range remeasurement, not a demonstrated correctness bug. The earlier render-ref error and manual subscription warning were fixed. React Doctor is not reported as clean. Logs: `react-doctor-isolated-baseline-files.log`, `react-doctor-isolated-comparable-final-files.log`.

Reviewed by GPT-5.5. Remaining attention: MultiView frame budget, provider/authentication limits, the documented React Doctor warning, and the limits of the final keyboard recheck. Commit and push results will be appended after completion.

Performance fixes committed and pushed to main as a73b2a8. The repository pre-commit hook passed its compiled Electron E2E smoke test in an isolated checkout, including renderer/preload and SQLite health; smoke cleanup succeeded. Initial isolated build failed because its desktop dependency junction was missing; correcting that environment setup made the unchanged source pass. Original telemetry and scratch artifacts remain untouched.
