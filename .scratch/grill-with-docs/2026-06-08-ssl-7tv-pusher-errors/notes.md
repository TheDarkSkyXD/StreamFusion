# Diagnose SSL + 7TV + Pusher errors: Grilling Session Notes
Date: 2026-06-08 · Goal: Identify root cause and minimal-risk fix for three error classes in the StreamFusion log: SSL handshake -202 storms, 7TV KICK 404, Pusher WebSocket "already CLOSING/CLOSED".

## PRD
- Published as GitHub issue: https://github.com/TheDarkSkyXD/StreamFusion/issues/62
- Local copy: `.scratch/grill-with-docs/2026-06-08-ssl-7tv-pusher-errors/prd.md`
- Labelled `ready-for-agent`

## Implementation issues (local-markdown tracker)
Per the grill-with-docs + local-markdown convention, issue files live in the `issues/` subfolder of this session.

| File | Title | Status | Blocked by |
|---|---|---|---|
| `issues/01-pusher-race-fix.md` | Pusher race fix in Kick chat | ready-for-agent | None |
| `issues/02-7tv-main-service-ipc.md` | 7TV emote main-side service + IPC plumbing | ready-for-agent | None |
| `issues/03-7tv-renderer-rewrite-adr.md` | 7TV renderer rewrite + ADR-0004 | ready-for-agent | Slice 2a |
| `issues/04-emote-picker-popover-rename-prefetch.md` | EmotePickerPopover: rename + ARIA + prefetch tuning | ready-for-agent | None |

User chose to split slice 2 (7TV migration) into 2a (main side) + 2b (renderer rewrite + ADR), accepting the interim state where 2a leaves seams unused until 2b lands. The other slices are independent.

## Summary / key decisions
(running synthesis, updated as you go)

## Root-cause map (post-investigation)

### 1. SSL -202 storm
- Trust is **not** bypassed anywhere. `cert-verify-diagnostics.ts:20` registers a `setCertificateVerifyProc` on every session (`attachCertVerifyDiagToAllSessions`) that always returns `callback(-3)` (defer to platform verifier).
- That proc DOES log the failing hostname when verification fails — at `warn` level, tag `[CertVerify]`, with diagnostic prefix `[cert-debug-r8a2]`.
- The user-supplied log dump is filtered to `[error]` only — the `[warn] [CertVerify]` lines that would carry the hostname are not visible. **The host identity is recoverable from the unfiltered log.**
- Strongest external candidate, by signal pattern (bursts at startup + ~90s later, constant PID, no user-visible failure): `ws-us2.pusher.com` (Kick chat via pusher-js with `forceTLS: true`). Auto-reconnect on transient cert validation failures matches the burst pattern. Other candidates ranked lower: gql.twitch.tv, 7tv.io, BTTV/FFZ CDNs.
- The errors are arriving from the native Chromium net stack — pre-HTTP, so they reach `chromium-log-tailer.ts` (which forwards them to the session log) **before** the URL is attached.

### 2. 7TV KICK 404
- ApiClient (`apps/desktop/src/lib/api-client.ts:36-40`) logs every non-2xx response at `error` level in its `afterResponse` ky hook. The comment explicitly tells callers to "suppress their own line rather than asking the client to silently downgrade" — but the ApiClient itself is the noisy logger, and the call site has no hook to suppress it.
- The 7TV provider (`apps/desktop/src/backend/services/emotes/7tv-emotes.ts:186-204`) already catches the 404 and logs at `info` level — but the ApiClient `[error]` log fires first.
- Spec contract from `apps/desktop/src/backend/services/emotes/AGENTS.md`: "Do not throw from `fetchChannelEmotes`" — missing third-party emote sets degrade to `[]`. Behaviour is correct; only the log line is wrong.

### 3. Pusher "WebSocket already CLOSING/CLOSED"
- `kick-chat.ts:576` `leaveChannel()` has no idempotency guard. If called twice with the same channel (or while an earlier leave is still in flight), the second call hits `pusher.unsubscribe()` on a socket that's already closing.
- Pattern matches React 18 Strict Mode (`renderer.tsx:30`) double-mount/cleanup in dev — particularly likely in multiview where `KickChat` components share the singleton `kickChatService`. `release(channel)` line 397–410 calls `leaveChannel()` without holding any "leaving" lock.
- Three warnings then 60s silence matches: three channels leaving once each from a Strict-Mode cleanup pass, then steady state.
- The Pusher singleton itself recovers — this is a log/teardown hygiene bug, not a chat-broken bug.

## Symptom inventory (from user-supplied log, 2026-06-08 14:17–14:20Z)
1. **`[Chromium] handshake failed; returned -1, SSL error code 1, net_error -202`** — recurring (~70 hits in 2 minutes), bursty. `-202` maps to `ERR_CERT_AUTHORITY_INVALID`. No URL captured at this log level (Chromium fires before HTTP layer). Source process pid 24796 is consistent across the burst → single renderer / utility / net service.
2. **`[Renderer:Lib:ApiClient] request failed {"method":"GET","url":"https://7tv.io/v3/users/KICK/58371235","status":404}`** — single occurrence. 7TV's v3 endpoint expects the connection alias `KICK` and a Kick user id; a 404 means 7TV does not know that user (no emote set configured for them). This is a "no data" response, not a bug, but it currently logs at `error`.
3. **`[WebContents] WebSocket is already in CLOSING or CLOSED state.` (from pusher-js.js:1282)** — three in rapid succession. Indicates pusher-js attempted `socket.send` (or `close`) after the socket was already closing — typically a stale reference outliving a disconnect, or two cleanup paths racing.

## Q&A log

### Q1 — SSL approach
- Asked: How do you want to handle the SSL -202 storm given the host is unknown?
- Captured: User chose **"Identify host first"** — share the `[CertVerify] [cert-debug-r8a2]` warn lines so we can target the real host before deciding on a fix.
- Doc updates: none yet (waiting on the host identity)
- Flags: need user to share unfiltered log lines from the same time window — *open* until they paste.

### Q2 — 7TV ApiClient 404 fix [SUPERSEDED]
- Asked: How should we fix the 7TV ApiClient double-log?
- Captured: User initially chose "Per-call opt-out in ApiClient".
- **Superseded by Q2b** after user pointed at KickTalk + DevTools screenshot proved the noise is also coming from the browser's own network log, which our ApiClient hook cannot suppress.

### Q2b — 7TV 404 fix, take two
- Context: The DevTools red `Failed to load resource: ... 404` line is emitted by Chromium's renderer fetch instrumentation, NOT by our logger. Silencing our ApiClient hook only removes our `[error]` line; DevTools keeps logging because `ky` runs in the renderer and uses browser `fetch`.
- KickTalk evidence: `KickTalkOrg/KickTalk` calls `axios.get('https://7tv.io/v3/users/kick/{id}')` from `src/preload/index.js`. Node-side `axios` uses Electron's `net`, not Chromium's fetch stack — so the 404 never appears in DevTools. Same URL, same 404, zero visible noise.
- Verified: `apps/desktop/src/backend/services/emotes/7tv-emotes.ts:11-15` self-documents as "imported by renderer code via the emotes barrel" — confirms our 7TV calls happen in the renderer despite the `backend/` folder name.
- Verified: 7TV has no 200-empty alternative to `/v3/users/{ALIAS}/{id}` — researched the public v3 API surface, route is `users.by-connection.go` server-side and always returns ErrUnknownUserConnection (404).
- Captured: User chose **"Move to main process + IPC"** — fits this codebase's existing IPC pattern; keeps preload thin.
- Doc updates: warrants an ADR? Yes — it's hard-to-reverse (every renderer call site changes shape), surprising without context (folder name `backend/services/emotes/` already implies main; this clarifies the actual transport), result of a real trade-off (main+IPC vs preload; we picked main). **Will write ADR-0004** at implementation time.

### Q2c — 7TV migration scope
- Asked: BTTV + FFZ have the same renderer-fetch DevTools-noise problem. Migrate all three at once?
- Captured: User chose **"7TV now, BTTV+FFZ follow-up"** — smaller PR, single-symptom focus.
- Doc updates: flag a follow-up issue.
- Flags: BTTV + FFZ migration → follow-up issue under `.scratch/<feature-slug>/`.

### Q3 — Pusher race fix
- Asked: How to fix the "WebSocket already CLOSING/CLOSED" warning?
- Captured: User chose **"Skip unsubscribe when shutting down + state guard"** — drop per-channel `pusher.unsubscribe()` from `disconnect()`/`forceShutdown()` (server cleans up on socket close anyway), keep `unbind_all()` for local memory hygiene; guard `leaveChannel()`'s `pusher.unsubscribe()` with `pusher.connection.state === 'connected'`.
- Doc updates: none — no ADR needed (reversible, no surprising trade-off, just a bugfix).
- Flags: none.

### Q4 — Implementation plan + HTTP layer
- Asked: Confirm plan + HTTP client choice for the new main-process 7TV service.
- Captured: User confirmed **plan is right**, chose **Electron `net.request`** as HTTP layer (no new dep, respects user proxy/session config, acceptable API for 2 endpoints).
- Doc updates: will write ADR-0004 during implementation.
- Flags: none.

### Q6 — Test seams + rename scope
- Asked: Seams match expectations + bundle the EmoteDialog → EmotePickerPopover rename?
- Captured: User chose **"Add an EmoteDialog test"** (vitest unit that asserts pump never opens more than `PREFETCH_BATCH_SIZE` concurrent Image() requests) AND **"Bundle the rename with this PRD"**. The rename includes file rename, export renames, importer updates (4 source/test files), `data-testid` change, and `role="dialog"` → `role="region"` ARIA correctness.
- Doc updates: PRD will get a 5th acceptance criterion for the rename + ARIA fix.
- Flags: none.

### Q5 — 7TV CDN ERR_CONNECTION_RESET 200 (NEW error class user surfaced)
- Symptom: 17+ `GET https://cdn.7tv.app/emote/<id>/2x.webp net::ERR_CONNECTION_RESET 200 (OK)` lines in DevTools, sourced from `EmoteDialog.tsx:630` (the `pump()` prefetch loop). Status 200 means CDN sent headers, but the TCP connection was RST mid-body — classic burst / connection-reuse-after-close behaviour with image CDNs.
- Code site: `apps/desktop/src/components/chat/EmoteDialog.tsx:624-633`. `pump()` issues 16 parallel `new Image()` requests per tick, paced by `requestIdleCallback` (or `setTimeout(32)` fallback). For a fresh open with many providers, that's hundreds of images shoved at the CDN in seconds.
- Asked: How to fix?
- Captured: User chose **"Smaller batch + onerror retry"** — drop batch from 16 to 4–6 parallel; add `img.onerror` that retries once after a short jittered delay; second failure is silent. Keeps the prefetch UX; removes most RSTs.
- Doc updates: none — implementation detail, not ADR-worthy.
- Flags: none.

## Open flags (pending input)
- SSL host identity — user to paste `[CertVerify] [cert-debug-r8a2]` warn lines from the same time window as the -202 burst. Until then, the SSL fix is deferred.

## Implementation plan
**Commit 1 — Pusher race fix (small)**
- `apps/desktop/src/backend/services/chat/kick-chat.ts`:
  - `disconnect()` (~line 353): remove `pusher.unsubscribe()` calls; keep `unbind_all()` + `pusher.disconnect()`.
  - `forceShutdown()` (~line 442): same.
  - `leaveChannel()` (~line 576): guard each `pusher.unsubscribe()` with `pusher.connection.state === 'connected'`.
- `apps/desktop/tests/backend/services/chat/kick-chat.test.ts`:
  - Add test: `leaveChannel()` when pusher connection state is `'disconnected'` does not call `pusher.unsubscribe()`.
  - Add test: `disconnect()` calls `unbind_all()` and `pusher.disconnect()` but NOT `pusher.unsubscribe()` per channel.

**Commit 2 — 7TV main-process migration**
- New: `apps/desktop/src/backend/services/emotes/7tv-emotes-service.ts` — main-side using `electron.net.request`. Two functions: `fetch7TVUserByConnection(platform, identifier)` and `fetch7TVGlobalEmoteSet()`. Returns raw JSON shape; transform stays in renderer for now.
- New IPC channels in `shared/ipc-channels.ts`: `EMOTES_7TV_GET_USER_BY_CONNECTION`, `EMOTES_7TV_GET_GLOBAL_EMOTE_SET`.
- Register handlers in main bootstrap.
- Expose on `electronAPI.emotes.*` in `preload/index.ts`; add types in `shared/electron-api-types.ts`.
- Rewrite `apps/desktop/src/backend/services/emotes/7tv-emotes.ts` — replace `api.get(...).json()` with `electronAPI.emotes.get7TVUserByConnection(...)`. Keep transform logic in the renderer. The 404 path returns a sentinel (e.g. `null`) so renderer logs `info` and returns `[]`.
- `apps/desktop/tests/backend/services/emotes/7tv-emotes.test.ts`: mock the IPC surface instead of `nock` / fetch.
- New: `docs/adr/0004-7tv-rest-in-main-process.md`.

**Commit 3 — EmoteDialog CDN burst fix**
- `apps/desktop/src/components/chat/EmoteDialog.tsx:624-633`:
  - Reduce per-tick batch from 16 to 4 (configurable constant `PREFETCH_BATCH_SIZE = 4`).
  - Add `img.onerror` that retries once after `200ms + jitter`; second failure is silent.
  - Drop the retried URL from a `retried` Set so we don't loop forever.
- Test: hand-verify by opening EmoteDialog and observing DevTools — RST count should drop dramatically.

**Deferred — SSL**
- Waiting on user to share `[CertVerify]` warn lines so we can identify the failing host and decide the right fix.

## Open flags (pending input)
(filled in by the grill loop)
