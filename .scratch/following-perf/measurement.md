# Following manual refresh measurement

Real Electron app, `npm start` mode 1, same connected Twitch/Kick accounts.

| Run | Button time |
| --- | ---: |
| Baseline | 37.1265 s |
| First implementation (diagnostic) | 34.1891 s |
| Final run 1 | 24.1582 s |
| Final run 2 | 23.9528 s |

Final median: 24.0555 s. Improvement from baseline: 13.0710 s (35.2%).

The final log shows Twitch and Kick sync starting at `02:44:55.188Z` and `02:44:55.190Z`. Twitch settled at `02:45:00.940Z`; Kick settled at `02:45:19.118Z`. Kick metadata repair was deferred during reconciliation and throttled on subsequent SQLite hydration.

## Unchanged-snapshot fast path

The next trace showed that uncertain Kick snapshots batch-verified all 122 fetched rows even when their membership matched SQLite. The optimized path compares the fetched and stored account sets one-to-one and skips relationship verification only when every row matches.

| Run | Button time |
| --- | ---: |
| Before fast path | 22.8020 s |
| Final run 1 | 8.5201 s |
| Final run 2 | 6.9922 s |
| Final run 3 | 7.5293 s |

Final median: 7.5293 s. Improvement from the original 37.1265-second baseline: 29.5972 s (79.7%).
