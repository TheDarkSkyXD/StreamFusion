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

## Verification

- Desktop TypeScript check: pass.
- Desktop ESLint: pass.
- Kick lifecycle/IPC/chat focused suites: 108 tests pass.
- Featured stream suite: 12 tests pass.
- Clean `npm start`: typecheck and lint ran before the picker, Electron rebuilt and opened.
- Live app: hidden Kick target and workers disappeared automatically after the background request burst.

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
- `artifacts/performance-baseline-renderer.png`
- `.audit/send-window-performance-design.md`
