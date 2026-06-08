# 7TV REST calls run in the main process

7TV's `GET /v3/users/{ALIAS}/{id}` returns 404 for every Kick user who hasn't linked a 7TV account — by design, on the 7TV side. The renderer-side 7TV provider used to fetch via `ky` (which uses browser `fetch`), so Chromium's DevTools Network panel and `Lib:ApiClient` `[error]` hook both surfaced these benign 404s for every Kick channel a user opened. PRD #62 captures the four user-reported symptoms; this one is the most visible.

We're moving 7TV REST through the main process behind two new IPC channels (`EMOTES_7TV_GET_USER_BY_CONNECTION`, `EMOTES_7TV_GET_GLOBAL_EMOTE_SET`). The main-side service uses Electron's `net.fetch` (Node-side HTTP), which is not instrumented by Chromium DevTools — the 404 happens, the renderer never sees it. The 7TV provider in the renderer keeps owning the shape transform; main returns parsed JSON only, or `null` on 404 so callers can distinguish "no linked account" from a real failure without try/catch on response status.

Considered and rejected:
- **Per-call opt-out in ApiClient** (`expectedStatuses: [404]`). Silences our own `[error]` log line but does NOT remove the DevTools red `Failed to load resource` entry — Chromium's renderer fetch stack emits that regardless of consumer-side handling. The user explicitly flagged that DevTools entry as the problem.
- **Move 7TV REST to preload (KickTalk pattern).** Functionally equivalent to main: preload `axios` / `fetch` is Node-side, also DevTools-invisible. Rejected for consistency — the codebase already has a strong IPC pattern (`IPC_CHANNELS`, `register*Handlers`, `electronAPI.*` namespacing), and the preload should stay thin for security and bundle size. Putting REST in the preload deviates from that convention for no measurable upside.
- **A 7TV API endpoint that returns 200-with-empty for missing users.** Verified against `SevenTV/API` source (`users.by-connection.go`) and the public v3 Swagger: no such endpoint exists. The 404 is the contract.

Reversal cost is low — the consumer surface (`electronAPI.emotes.*`) is a thin handle. If a future maintainer wants to move 7TV back into the renderer (e.g. to share a token-aware HTTP client) they re-write two call sites and delete one main module. Slice 2b's renderer rewrite locks the seam in place; slices that migrate BTTV + FFZ to the same pattern follow the same template.

The same approach applies cleanly to BTTV and FFZ, which share the renderer-fetch DevTools-noise problem for channels without those emote sets. PRD #62 defers that migration to a follow-up; this ADR documents the pattern so the follow-up doesn't have to re-decide.
