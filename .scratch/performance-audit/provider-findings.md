# Provider findings — perf-final-20260906

This note preserves sanitized observations from the disposable run artifacts. It
does not establish a provider-side root cause where the application did not log
the failing request.

## Evidence retained

- Original run-log location (removed during cleanup): `.scratch/verify-streamfusion/runs/perf-final-20260906/dev-artifacts/.logs/streamfusion-2026-09-06T17-29-05-794Z.log`
- Original network-log location (removed during cleanup): `.scratch/verify-streamfusion/runs/perf-final-20260906/dev-artifacts/.logs/streamfusion-network-2026-09-06T17-29-05-794Z.log`
- Live reports: `.scratch/verify-streamfusion/evidence/perf-final-20260906/lirik-videos-final/report.json` (17:37:57Z) and `lirik-videos-settled/report.json` (17:38:24Z)
- VOD success: `.scratch/verify-streamfusion/evidence/perf-final-20260906/vod-final-settled/report.json` (17:38:59Z)
- Moderation reports: `.scratch/verify-streamfusion/evidence/perf-final-20260906/mod-final/report.json` (17:39:32Z), `mod-channels-final/report.json` (17:42:44Z), and `mod-twitch/report.json` (17:43:10Z)
- Kick moderation report: `.scratch/verify-streamfusion/evidence/perf-final-20260906/mod-kick/report.json`

## Sanitized log excerpts

```
17:29:08Z  Auth:Twitch  Twitch refresh token rejected by Twitch; clearing stored credentials and prompting re-login
                    TokenRefreshError: Invalid refresh token (HTTP 400)
17:31:15Z  CertVerify  nel.twitch.tv  net::ERR_CERT_COMMON_NAME_INVALID / net_error -200
17:37:28Z  Twitch:StreamResolver  resolved live playback URL for lirik; host usher.ttvnw.net; 150ms
17:37:59Z  IPC:Category  Failed to search Twitch categories: fetch failed
17:38:09Z  IPC:Video  Failed to resolve Twitch video game data via GQL: 10s timeout
17:38:39Z  Network  Twitch VOD playlist request completed HTTP 200 after 6392ms
17:41:16Z  Kick:Endpoints:Follow  followed-list collection completed: 125 channels
17:42:23Z  Kick:Endpoints:Follow  followed-list collection completed: 125 channels
```

These are retained redacted excerpts. The original logs have been removed; no
playback URL, credentials, cookie values, or request headers are retained.

## Observed outcomes

LIRIK's live page resolved a Twitch playback URL, but the two live reports
observed `paused: true`, `readyState: 0`, `time: 0`, and `width: 0`. The first
report was 29 seconds after the Videos tab click and the settled report was 56
seconds after the live URL resolver entry. The later VOD report observed normal
media playback (`readyState: 4`, width 1920, time about 13.5 seconds). This
rules out a general failure of the Twitch resolver or media pipeline in this
run, but it does not identify why that live manifest did not yield media.

The VOD's Chat Replay showed the retry panel. Replay is a separate anonymous
Twitch GQL comments request with a 10-second timeout. The run contains a GQL
metadata timeout but no request-specific replay error record, so the timeout is
supporting evidence of transient GQL trouble, not proof of the replay failure's
cause.

Moderation initially listed the signed-in Twitch channel
`DarkSkyFullOfStars`. At 17:43:11Z the runner opened it and
`mod-twitch/report.json` rendered `Couldn't resolve Twitch channel
"darkskyfullofstars".` The resolver intentionally returns null for a 401, a
network error, or an absent channel, then falls back to Twitch's public channel
reader. Both failures are swallowed, so this run has no direct status proving a
deleted/renamed provider account. The earlier failed token refresh and the
other Twitch read failures make expired credentials or transient provider
connectivity more likely than an application-created account mutation.

The sidebar count moved from 672 in `mod-final` to 142 in
`mod-channels-final` and `mod-twitch`. The 400 refresh-token rejection occurred
at launch, before either report. The 142 view coincides with completed Kick
follow collection of 125 rows; it is consistent with loss of authenticated
Twitch follows after the client cleared invalid credentials. There is no remote
write in the run log and no evidence that the app unfollowed channels. The
exact remaining-row composition was not logged, so this is not proof of the
count calculation.

The Kick moderation report rendered the retention controls and an empty
observed mod-log state. Its banned-users section says that Kick has no public
banned-users-list endpoint. This is an explicit capability state, not a failed
or destructive moderation action.

## Diagnostics regression audit

Relative to `8d15fdc`, the Diagnostics workspace hook test grew from one test
(`opens each effect lifetime with a unique document instance`) to three tests:
the existing Strict Mode case plus two deferred async view-switch regressions.
The added cases cover a view change before lease open completes and a second
rapid change whose earlier configure reply resolves last.

The exact recorded green command was:

```
npm test -- --run tests/hooks/use-diagnostics-workspace.test.tsx \
  tests/hooks/use-diagnostics-resource-history.test.tsx \
  tests/pages/Settings/diagnostics-workspace.test.tsx
```

It passed 3 files and 6 tests. `npm run typecheck` (desktop) and `git diff
--check` also passed. Historical note, superseded by the source-diff result
below: the initial audit had no recorded executable red run against `8d15fdc`,
because that base revision contains only the single Strict Mode test.

### Source-diff red/green verification (2026-09-06)

With the app closed, only
`apps/desktop/src/frontend/features/settings/data/use-diagnostics-workspace.ts`
was temporarily restored to its `8d15fdc` contents. The current regression
test file was retained unchanged.

```
npm exec -- vitest run tests/hooks/use-diagnostics-workspace.test.tsx
```

The synthetic base-source run failed as expected: 1 file, 3 tests, **2 failed /
1 passed**. The failing cases were `configures a lease with the latest view
when the user switches tabs during opening` (no configure call) and `ignores a
stale configure reply after a second tab switch` (no configure call). The
current source was then restored and the identical command passed: 1 file, 3
tests, **3 passed** (200ms test time).

The actual retained outputs are `diagnostics-regression-red.log` and
`diagnostics-regression-green.log` in this directory.

The restored source SHA-256 is
`11C6F1536F05DDF34ADC465EB44F592EE64703CC144B18B43E76797EAA61471C`,
which matches its SHA-256 before the temporary source swap. `git diff --check`
for that source passed after restoration.
