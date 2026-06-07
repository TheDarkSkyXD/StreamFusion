# Kick Stream Player Random Freeze: Grilling + Diagnose Notes
Date: 2026-06-06 · Goal: Diagnose why the Kick stream player freezes mid-stream while chat keeps working; switching streams and back un-freezes. Identify root cause and fix.

## Summary / key decisions
- **Top hypothesis:** H1 — Chromium video decoder silently stalls during long Kick sessions; existing fragment-heartbeat watches the INPUT side (`FRAG_LOADED`) so the OUTPUT side (`currentTime` advance) has no detection seam. Switching streams currently fixes it because remounting `<video>` rebuilds the decoder.
- **Fix:** Added a `currentTime` watchdog in `apps/desktop/src/components/player/hls-player.tsx` running every 2 s, escalating recovery after 8 s of no advance:
  1. nudge `currentTime += 0.1`
  2. `hls.startLoad(-1)`
  3. `hls.recoverMediaError()`
  4. fatal `{ code: "DECODER_STALL", shouldRefresh: true }` → routes through existing auto-retry path → fresh playback URL + remount, automating the user's manual workaround.
- **Tagged log prefix:** `[HLS-stall-w7d3]` — single grep removes if we cut later.
- **Regression test seam:** None for the original bug (Chromium decoder hang is not faithfully reproducible in vitest). Documented as a finding rather than writing a misleading test that only locks down the watchdog logic.

## Observed symptoms (from user)
- Stream player freezes randomly while watching a Kick stream.
- Chat continues to work normally during the freeze.
- Fix: navigate away to a different stream, then back to the same channel.
- Terminal logs at time of freeze include:
  - `ERROR:ssl_client_socket_impl.cc(877)] handshake failed; returned -1, SSL error code 1, net_error -202` (×2)
  - One follows-sync log: `Synced twitch follows (account=538, added=0, pending=0)` (unrelated)
- No renderer console errors observed in the user's report.

## Code review baseline (what already exists)
- `apps/desktop/src/components/player/kick/kick-live-player.tsx`: KickLivePlayer wraps HlsPlayer. Auto-retry up to **2 attempts** for `NO_FRAGMENTS | TOKEN_EXPIRED | STREAM_OFFLINE | shouldRefresh:true`, base delay 1500ms × attempt.
- `apps/desktop/src/components/player/hls-player.tsx`:
  - **Heartbeat** every 5s after `MANIFEST_PARSED`. Detects:
    - `!hasReceivedFirstFragmentRef && timeSinceManifest > 30000` → `NO_FRAGMENTS` (fatal, shouldRefresh).
    - `hasReceivedFirstFragmentRef && timeSinceLastFrag > 45000` → `STREAM_OFFLINE` (fatal).
    - `timeSinceLastFrag > 15000` → reload via `hls.startLoad(-1)`.
  - **Heartbeat skips while `video.paused`** — resets `lastFragLoadedTime` and returns.
  - `bufferStalledError` non-fatal: only fixes startup gap (`currentTime < 1`), otherwise relies on HLS.js auto-nudging (`nudgeMaxRetry: 5`).
  - Fragment errors increment `fragErrorCountRef`; ≥ 3 → `TOKEN_EXPIRED` fatal (shouldRefresh).
  - Memory cleanup every 30 min: trims backBuffer to 10s, forces GC.
- `KickStreamResolver.getStreamPlaybackUrl()`: Validates URL via Range GET before returning. Retries x2 on transient.
- `net_error -202` in Chromium = `ERR_CERT_AUTHORITY_INVALID` (SSL cert chain issue).

## Ranked hypotheses (to test)

### H1 — Video element decoder/MediaSource stuck while fragments still loading (no detection seam)
**Prediction:** During freeze, FRAG_LOADED events keep firing (so `lastFragLoadedTime` keeps updating) and the heartbeat never trips, but `video.currentTime` stops advancing while `!video.paused`. Switching the route unmounts the `<video>` element + Hls instance, freeing the Chromium decoder.
**Falsifier:** If we log `video.currentTime` every 1s during a freeze and it keeps advancing, H1 is wrong.

### H2 — `bufferStalledError` recovery exhausts (`nudgeMaxRetry: 5`) silently — no fatal escalation
**Prediction:** During freeze we see ≥5 `bufferStalledError` events in HLS internal logs followed by `bufferNudgeOnStall` fatal which the existing switch DOES handle (`HLS_FATAL`) — but only if logged. We currently rely on HLS.js's default; check the actual error type that fires.
**Falsifier:** No `bufferStalledError` events during freeze, OR the fatal-bufferNudge case triggers user-visible error overlay (it doesn't per user report).

### H3 — Kick CDN SSL handshake failures (`net_error -202`) starve fragments but `fragLoadError` retries succeed once
**Prediction:** Some fragments fail SSL handshake; HLS.js retries (`fragLoadingMaxRetry: 4`, delay 500ms) and one eventually succeeds, so the `fragErrorCountRef` resets on success (`fragErrorCountRef.current = 0`). The stream limps along but buffer empties faster than it can be refilled, and the video element stalls. The heartbeat's 15s reload threshold is too generous to recover quickly enough.
**Falsifier:** If we see no fragment errors and no SSL errors at all during the freeze, H3 is wrong.

### H4 — Cloudflare/Kick token in playback_url expires mid-stream; non-fatal fragLoadErrors recover only partially
**Prediction:** Single fragment 403 fires, `fragErrorCountRef` increments to 1 or 2 but not 3, then HLS.js retries with same URL (token still expired). Per-fragment retries don't trigger `TOKEN_EXPIRED` until 3 distinct fragments have failed — could take long enough that user perceives freeze.
**Falsifier:** Logs show `fragErrorCountRef` jumping to 3 quickly, or stream URL has no token-style query params.

### H5 — Adaptive quality switch to a broken level causes silent freeze
**Prediction:** `levelSwitchError` is in the silent list — if Kick's CDN serves a broken level (audio-only, codec mismatch), HLS.js logs it silently and never recovers; the user sees a frozen frame. Switching streams forces a fresh manifest fetch and a new level.
**Falsifier:** Quality level is `Source` (single level) at time of freeze, so no switching happens.

## Q&A log

### Q1 — What does the freeze look like, and is it Kick-side or app-side?
- Asked: When freeze happens, what do you see in the player area? Also flagged whether this is transient or recurring.
- Captured:
  - **Visual:** Last frame stuck, no spinner, no error overlay.
  - **Duration:** "ive been having this issue for awhile in the app its an app issue" → long-standing reproducible app bug, NOT a transient Kick CDN issue.
- Implication: Strong confirmation of H1. The video element is showing the last decoded frame while the UI thinks nothing is wrong (no loading, no error). This is the signature of a Chromium media decoder hang or a `<video>` element that has silently stopped advancing `currentTime` while `!video.paused`.
- Doc updates: re-ranked hypotheses below; dropped H3/H4 as primary suspects.
- Flags: none.

## Re-ranked hypotheses after Q1
1. **H1 (top, ~85% confidence)** — video element / decoder stuck while fragments may still be loading; no `currentTime` watchdog in place.
2. **H2** — `bufferStalledError` nudge exhaustion landing on silent fatal.
3. **H5** — adaptive level switch to broken level (less likely if usually single-level Source on Kick).
4. ~~H3 (Kick CDN SSL)~~ — demoted; user reports the bug is recurring across time, not a transient handshake issue.
5. ~~H4 (token expiry)~~ — demoted; same reasoning. Also auto-retry would fire on `TOKEN_EXPIRED` and user reports no error overlay.

### Q2 — Probe-only vs probe+recovery; stall threshold
- Asked: Ship probe-only first (safer) or probe+auto-recover (faster fix). Stall threshold 5s/8s/15s.
- Captured:
  - **Ship probe + auto-recovery in one** with tagged `[HLS-stall-w7d3]` logs.
  - **Threshold: 8 seconds** — longer than HLS.js's own 3s nudge watchdog, shorter than the 15s heartbeat reload window, so it kicks in only after HLS.js's own mechanisms have been given a chance.
- Doc updates: encoding the design below as part of the diagnose Phase 4+5 (probe + fix).
- Flags: none.

## Fix design (H1 watchdog) — to implement in `hls-player.tsx`

**Mechanism:** A 2s-tick watchdog (separate from the fragment heartbeat) that compares `video.currentTime` to the previous tick. Skips while `paused | ended | readyState < HAVE_FUTURE_DATA`. If currentTime is unchanged for ≥ 8s under play conditions, escalate recovery.

**Escalation ladder per stall event:**
1. **Nudge:** `video.currentTime += 0.1` — cheapest, often unsticks Chromium decoder.
2. **Reload:** `hls.startLoad(-1)` — resets HLS load position to live edge.
3. **Media recovery:** `hls.recoverMediaError()` — rebuilds MediaSource.
4. **Fatal escalation:** emit `{ code: "DECODER_STALL", fatal: true, shouldRefresh: true }`. The `shouldRefresh` flag routes through the existing `KickLivePlayer` auto-retry path (max 2 attempts) → forces a fresh playback URL fetch and re-mounts player. Functionally identical to the user's manual "switch streams" workaround.

**State:**
- `lastTimeRef`, `lastTimeAdvancedAtRef`, `stallRecoveryCountRef` (resets on advance), plus a `setStallWatchdogDelay` state to start/stop the interval via `useInterval`.

**Log prefix:** `[HLS-stall-w7d3]` — single grep removes if we cut later.

## Open flags (pending input)
_(none — awaiting real-world verification from user)_

## Verification status
- `npm run typecheck` — clean.
- `npx vitest run` — all 1719 tests pass.
- `npx biome check src/components/player/hls-player.tsx` — clean (the 23 errors in `npm run lint` are pre-existing in other files; flagged but out of scope for this fix).
- Live Electron verification: Vite HMR has reloaded the player module, but the active player instance was mounted before my edits. The watchdog will start on the next remount (navigating to a different stream once will activate it on every subsequent stream). On the next freeze, expect `[HLS-stall-w7d3]` logs and an in-place recovery; if all 4 rungs of the ladder fail, the existing auto-retry remounts the player (functionally identical to the manual "switch streams" workaround).

## Phase 6 post-mortem
- **What would have prevented this:** A `currentTime` watchdog was missing from day one because the existing heartbeat focused on the INPUT side (`FRAG_LOADED`). Whenever a media element drives playback, both input AND output need a freshness signal — input alone can mask decoder hangs. Worth adding to the player AGENTS.md as a coding rule.
