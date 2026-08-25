# Electron performance audit — 2026-08-25

## Outcome

The Diagnostics Resources tab is the canonical CPU/RAM source. On the same development session, manually disposing the retained Kick helper reduced resident memory from 2.00 GB across 10 processes to 1.07 GB across 6 processes. The implemented lifecycle now performs that cleanup automatically after background work becomes idle.

Post-fix idle capture: 1023.0 MB, 6 processes, 0.4% current CPU, 0.00% collector CPU, and 0.22 ms collection time. Diagnostics frame pacing measured 16.666 ms average with a 17.1 ms maximum and no frames above 20 ms over the foreground sample.

## Bottlenecks and changes

| Bottleneck | Evidence | Change |
| --- | --- | --- |
| Hidden `kick.com` renderer retained IVS workers and third-party frames after background reads | 10 processes / 2.00 GB; manual teardown reclaimed about 930 MB | Added operation ownership, generation-safe idle cleanup, and chat-aware retention; removed deadline-triggered hard disposal race |
| Home immediately started featured HLS playback | Audio/video services and decoding work began without user intent | Featured preview remains a poster until pointer or keyboard intent |
| Development start skipped static quality checks | Invalid types/lint could reach runtime | Root start now runs desktop typecheck and lint before opening the start picker |
| Diagnostics collector suspected as overhead | 0.00% CPU and 0.22–4.01 ms collection samples | Kept it; evidence did not justify removing observability |
| Followed status was requested by multiple always-visible/page consumers | Sidebar, Following, and notifications could overlap the same expensive platform scan | Added backend in-flight collapse plus a five-second successful-result window; concurrent callers now share one scan |
| Cross-platform top-stream limits were applied once per provider | Home asked for 25 but received about 50 cards and thumbnails | Apply the limit after merging and viewer-count sorting, so 25 means 25 total |
| Optional dialogs and developer surfaces were in cold renderer graphs | Clip playback dialogs and global confirmation/developer UI loaded before use | Load developer UI only in development and defer download/clip dialogs until opened |
| Home featured media and chat had separate carousel ownership | Repeated timers and mismatched stream/chat identity risked reconnect churn | One stage owns selection/timing; chat and media share identity, and narrow layouts do not retain a hidden chat socket |

## Page responsiveness

Chromium-local measurements exclude Playwright/CDP round-trip time. After route chunks were warm, heading/shell feedback measured 21.0–27.9 ms for Downloads, Categories, and Following. Settings measured 52.8 ms. Stream navigation feedback after pointer-intent preloading measured 14.1 ms, with the real stream page and chat visible in the live app. Search measured 89.6 ms on a warm route and remains above the 50 ms target; its clip playback path is now deferred, but further search-result render work is warranted.

The first development navigation to a route remains slower (roughly 0.4–0.9 seconds in observed runs) because Vite transforms modules on demand. This is development tooling overhead and is not presented as packaged-app performance.

During an active Twitch stream followed by Diagnostics, Resources reported 6 processes, 1.5% aggregate CPU, 1.37 GB resident memory, 0.00% collector CPU, and 0.22 ms collection time. This active-stream reading is not comparable to the 1023 MB idle capture, but confirms the collector is not the source of the remaining memory footprint.

## Verification

- Desktop TypeScript check: pass.
- Desktop ESLint: pass.
- Kick lifecycle/IPC/chat focused suites: 108 tests pass.
- Featured stream suite: 12 tests pass.
- Clean `npm start`: typecheck and lint ran before the picker, Electron rebuilt and opened.
- Live app: hidden Kick target and workers disappeared automatically after the background request burst.
- Stream handler suite: 26 tests pass, including one-scan behavior for concurrent followed-status consumers and merged total limits.
- Home stage: 11 tests pass, including chat identity, responsive unmounting, and single timer ownership.
- Search, History, and Following dialog paths load on selection; their focused page suites pass.

The result proves the measured idle regression and foreground frame pacing. It does not yet prove a multi-day ceiling. A long soak should sample process count, resident memory, CPU peaks, request cadence, and long-frame counts at fixed intervals and fail on an upward trend rather than a single peak.

## Research applied

The implementation follows Electron's guidance to avoid loading work too early, keep expensive work off the critical path, and measure before optimizing. The user-supplied Electron performance guide was treated as the primary source; secondary articles were used as idea prompts, not proof. The code specifically favors lazy media startup, bounded background renderer lifetime, and measurement through the app's native process monitor.

- https://www.electronjs.org/docs/latest/tutorial/performance#2-loading-and-running-code-too-soon
- https://nearform.com/insights/architecting-electron-applications-for-60fps/
- https://www.electronjs.org/docs/latest/api/process-metric

## Evidence files

- `artifacts/performance-baseline-resources.png`
- `artifacts/performance-after-helper-dispose-resources.png`
- `artifacts/performance-postfix-idle-resources.png`
- `artifacts/performance-postfix-resources.png`
- `artifacts/performance-baseline-renderer.png`
- `.audit/send-window-performance-design.md`
