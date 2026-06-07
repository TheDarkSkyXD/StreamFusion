---
name: streamfusion-debug
description: Read and analyze StreamFusion log files and bug reports. Use when the user references a StreamFusion bug report, asks to diagnose a StreamFusion log, says "fix this bug report", "what's wrong in this log file", "the app crashed", "Twitch chat won't load", "login is broken", "stream doesn't play", or hands you a `bug-report-*.md` or `streamfusion-*.log` file. Knows the on-disk log paths (dev vs prod-win vs prod-mac/linux), the `[ISO] [level] [Tag] message` line format, the tag catalog (Auth, Twitch, Kick, Chat, Player, IPC, Service, Emote, Adblock, CrashHooks, ProcessMonitor, …), and a symptom-to-tag cheat sheet.
---

# StreamFusion Debug

The job: take a StreamFusion log or bug-report file and figure out what broke. This skill teaches you the file layout, the line format, the tag namespaces the codebase emits, and a symptom-to-search cheat sheet so you can go from "Twitch chat won't load" to the offending log line in a couple of greps.

## TL;DR

- A bug report is a markdown file at `bug-reports/bug-report-<ISO>.md` that already embeds the tail of the main + noise logs and points at the full files on disk.
- A log line looks like `[2026-06-07T14:22:11.482Z] [error] [Twitch:EventSub] connection lost {"code":1006}`.
- Tags are namespaced (`Subsystem:Module`), so once you know the symptom, grep the namespace.
- Tokens / secrets are already redacted by `redactor.ts` — read freely.

## Where the logs live

Three deploy targets, three locations. The dev case is the one you'll usually see in a repo; the prod cases matter when a user emails you a zip.

| Environment | Main log | Noise log | Bug reports |
|---|---|---|---|
| Dev (`!app.isPackaged`) | `<repo-root>/logs/streamfusion-<ISO>.log` | `<repo-root>/logs/streamfusion-noise-<ISO>.log` | `<repo-root>/bug-reports/bug-report-<ISO>.md` |
| Prod Windows | `<install-dir>/logs/streamfusion-<ISO>.log` | `<install-dir>/logs/streamfusion-noise-<ISO>.log` | `<install-dir>/bug-reports/bug-report-<ISO>.md` |
| Prod macOS | `~/Library/Logs/StreamFusion/streamfusion-<ISO>.log` (+ noise sibling) | same dir | `~/Library/Logs/bug-reports/bug-report-<ISO>.md` (sibling of the logs dir) |
| Prod Linux | `~/.config/StreamFusion/logs/streamfusion-<ISO>.log` (+ noise sibling) | same dir | `~/.config/StreamFusion/bug-reports/bug-report-<ISO>.md` |

Notes:

- On Windows the install dir defaults to `%LOCALAPPDATA%\Programs\StreamFusion\` but the user customizes it in the NSIS wizard. **Do not hard-code the path**; locate `bug-reports/` and `logs/` as siblings of the `StreamFusion.exe` the user is actually running.
- mac/linux prod uses `app.getPath('logs')` because the install bundle is read-only.
- ISO timestamps in filenames have `:` and `.` replaced with `-` (Windows-safe), e.g. `streamfusion-2026-06-07T14-22-11-482Z.log`.
- Files rotate: only the newest 10 sessions are kept. If the user reports a bug from "last week" and only today's session is on disk, say so.

### Finding the current session's log (pointer files)

Each `initLogger` / `initNoiseLogger` writes a one-line text file alongside the session logs containing the absolute path of the active log file. Read these instead of globbing for the newest timestamp:

- `<logsDir>/streamfusion-current.log.path` — absolute path of the active main log.
- `<logsDir>/streamfusion-noise-current.log.path` — absolute path of the active noise log.

They survive shutdown (not deleted), so the most recent session's path is always discoverable — equivalent to Valo's "newest log" symlink without the symlink portability headaches.

```bash
# Tail the current main log in real time
tail -f "$(cat <logsDir>/streamfusion-current.log.path)"
```

## Log line format

Every line emitted by `apps/desktop/src/backend/logging/logger.ts` has the shape:

```
[<ISO-timestamp>] [<level>] [<Tag>] <message>[ <meta-json>]
```

- `level` is one of `debug | info | warn | error`.
- `Tag` is a colon-namespaced identifier (e.g. `Twitch:EventSub`, `IPC:Stream`). Treat the first segment as the subsystem.
- `<meta-json>` is optional; when present it's a single-line `JSON.stringify(meta)` blob.

Session boundaries are explicit:

```
=== Debug started 2026-06-07T14:22:11.482Z (level=info) ===
=== Debug closed 2026-06-07T15:48:02.117Z ===
```

The noise log uses the same format with its own `=== Noise debug started … ===` header.

Example lines:

```
[2026-06-07T14:22:11.482Z] [info]  [App] startup complete {"durationMs":812}
[2026-06-07T14:24:55.901Z] [error] [Twitch:EventSub] subscription failed {"type":"channel.chat.message","status":403}
[2026-06-07T14:25:00.044Z] [warn]  [Player:HLS] manifest parse error {"url":"https://...","status":200}
```

## Tag catalog

Tags are grouped by subsystem. Each prefix maps to a directory under `apps/desktop/src/backend/` (main process) or `apps/desktop/src/renderer/` (renderer). When you see a tag, you know roughly where to open the SUT file.

### Auth (`apps/desktop/src/backend/auth/`)

OAuth flows for Twitch + Kick, token exchange, the in-app auth BrowserWindow, custom protocol callback handler.

Tags: `Auth:Window`, `Auth:Twitch`, `Auth:Kick`, `Auth:OAuthCallback`, `Auth:TokenExchange`, `Auth:Protocol`, `Auth:DeviceCode`.

### Twitch platform (`apps/desktop/src/backend/api/platforms/twitch/`)

Helix REST, GQL, EventSub WebSocket, stream-resolver, manifest fetching.

Tags: `Twitch:EventSub`, `Twitch:GQL`, `Twitch:Helix:*` (`:Chat`, `:Moderation`, …), `Twitch:Client`, `Twitch:Requestor`, `Twitch:StreamResolver`, `Twitch:Manifest`.

### Kick platform (`apps/desktop/src/backend/api/platforms/kick/`)

Kick REST endpoints, send-window throttler, network-health monitor, stream-resolver.

Tags: `Kick:Client`, `Kick:SendWindow`, `Kick:Health`, `Kick:Endpoints:*` (`:Category`, `:Channel`, `:Chat`, `:Follow`, `:Search`, `:Stream`, `:User`, `:Video`), `Kick:StreamResolver`.

### Chat (`apps/desktop/src/backend/chat/` + renderer chat services)

IRC/WebSocket chat sessions, badge/emote merging, pinned messages, predictions.

Tags: `Chat:Twitch`, `Chat:Kick`, `Chat:Badges`, `Chat:Pin`, `Chat:Predictions`.

### Player (`apps/desktop/src/renderer/components/player/` + player hooks)

HLS playback, ad-replacement, lifecycle, per-platform player wrappers.

Tags: `Player:HLS`, `Player:Twitch:*`, `Player:Kick:*`, `Player:Lifecycle`, `Player:Hook:*`.

### IPC (`apps/desktop/src/backend/ipc/`)

Every main-renderer handler is namespaced under `IPC:`. The second segment maps directly to the handler file.

Tags: `IPC:Auth`, `IPC:Stream`, `IPC:Video`, `IPC:Chat`, `IPC:Channel`, `IPC:Category`, `IPC:Search`, `IPC:Update`, `IPC:Adblock`, `IPC:Proxy`, `IPC:TokenStatus`, `IPC:System`, `IPC:Bootstrap`, `IPC:Bug`, `IPC:Logging`.

### Backend services (`apps/desktop/src/backend/services/`)

Long-lived singletons: storage, DB, updater, mod-log, HTTP server, VAFT, network adblock, cosmetic injection, stream proxy.

Tags: `Service:Storage`, `Service:DB`, `Service:Updater`, `Service:ModLog`, `Service:HTTP`, `Service:Vaft`, `Service:TwitchManifest`, `Service:NetworkAdblock`, `Service:CosmeticInject`, `Service:StreamProxy`.

### Emotes (`apps/desktop/src/backend/emotes/` or renderer emote services)

Third-party emote providers and the merge/cache manager.

Tags: `Emote:7TV`, `Emote:BTTV`, `Emote:FFZ`, `Emote:Twitch`, `Emote:Kick`, `Emote:Manager`.

### Adblock (`apps/desktop/src/backend/adblock/`)

Tags: `Adblock`, `Adblock:*` (rule-loader, request-filter, cosmetic-injector).

### Stores / hooks / pages (renderer)

Zustand stores, React hooks, route-level pages.

Tags: `Store:Auth`, `Store:Emote`, `Store:Follow`, `Hook:*` (`:Updater`, `:StreamPlayback`, …), `Page:Stream`, `Page:Video`.

### Diagnostic / framework

The bones of the logging subsystem itself + the catch-all `console` tag for unmigrated call sites.

Tags: `Main`, `App`, `Renderer`, `console`, `Renderer:console`, `CrashHooks`, `ProcessMonitor`, `LogIPC`, `Lib:Utils`, `Lib:ApiClient`.

### Quick anchor table

| Tag prefix | Subsystem | SUT directory |
|---|---|---|
| `Auth:*` | OAuth + auth window | `apps/desktop/src/backend/auth/` |
| `Twitch:*` | Twitch API + EventSub | `apps/desktop/src/backend/api/platforms/twitch/` |
| `Kick:*` | Kick API + endpoints | `apps/desktop/src/backend/api/platforms/kick/` |
| `Chat:*` | Chat sessions, badges | `apps/desktop/src/backend/chat/` + renderer chat |
| `Player:*` | HLS player + hooks | `apps/desktop/src/renderer/components/player/` |
| `IPC:*` | Main-renderer handlers | `apps/desktop/src/backend/ipc/` |
| `Service:*` | Backend singletons | `apps/desktop/src/backend/services/` |
| `Emote:*` | Emote providers | `apps/desktop/src/backend/emotes/` |
| `Adblock:*` | Adblock pipeline | `apps/desktop/src/backend/adblock/` |
| `Store:*` / `Hook:*` / `Page:*` | Renderer state + UI | `apps/desktop/src/renderer/` |
| `CrashHooks` / `ProcessMonitor` / `LogIPC` | Diagnostic plumbing | `apps/desktop/src/backend/logging/` |
| `console` / `Renderer:console` | Unmigrated call sites | grep the codebase — could be anywhere |

## How to read a bug report

The bug-report file (`bug-reports/bug-report-<ISO>.md`) is a single self-contained markdown file. Layout:

```
# StreamFusion Bug Report

- Timestamp: <ISO>
- App version, Platform, Electron, Node
- Log file: <path>
- Noise log: <path>

## Description
<user description>

## Recent Main Log (last 500 lines)
<fenced code block — main log tail>

## Recent Noise Log (last 200 lines)
<fenced code block — noise log tail>
```

Three-step flow when you open one:

1. **Read the Description.** Anchor on the user's words; they tell you which subsystem to suspect. Note the timestamp at the top — it bounds your search window in the embedded log tail.
2. **Scan the Recent Main Log for `[error]` and `[warn]`** near the report timestamp. Anything within ~30 seconds before the report is your prime suspect; older noise is usually unrelated.
3. **Dive into matching tags.** Map the user's complaint to a tag prefix using the cheat sheet below, grep the included log section for that prefix, and follow the trail.

Tokens, refresh tokens, client secrets, JWTs, `Bearer …` headers, OAuth `code=` callbacks, and `authorization:` headers are already scrubbed to `[REDACTED]` by `apps/desktop/src/backend/logging/redactor.ts` before the line hits disk. You can paste a bug report into a public issue, share it with another agent, or read it aloud — it's safe.

If the embedded tail doesn't cover enough history (the bug happened > 500 lines before the report was filed), ask the user for the full `Log file:` path called out at the top of the report.

## Common symptoms → where to look

A cheat sheet from user phrasing to grep targets. Always grep the full log file, not just the embedded tail.

| User says | Search |
|---|---|
| "Twitch chat won't load" / "chat is silent" | `[Chat:Twitch]` and `[Twitch:EventSub]`; look for `connection lost`, `subscription failed`, `auth failed`, status 401/403 |
| "Kick chat is broken" | `[Chat:Kick]` and `[Kick:Client]`; look for `pusher` errors, `Kick:SendWindow` throttle saturation |
| "Login is broken" / "can't sign in" | `[Auth:*]`; check `token expired`, redirect URI mismatch, `Auth:OAuthCallback` errors, `Auth:TokenExchange` non-200 |
| "I keep getting logged out" | `[Auth:TokenExchange]` (refresh failure), `[Store:Auth]` (clearing the session), `[IPC:Auth]` (renderer-side logout) |
| "Stream doesn't play" / "black screen" | `[Player:HLS]`, `[Player:Twitch:*]` / `[Player:Kick:*]`, `[Service:TwitchManifest]`; look for HLS manifest 404, ad-replacement failure, manifest parse error |
| "Stream stalls / buffers" | `[Player:HLS]`, `[Player:Lifecycle]`, `[Player:Hook:*]`; look for `decoder stalled`, buffer-underrun, fragment download failures |
| "App crashed" / "white screen" / "renderer died" | `[CrashHooks]` — you'll see `uncaughtException`, `unhandledRejection`, `render-process-gone`, `child-process-gone`. Also check `[Renderer]` immediately before |
| "Memory leak suspicion" / "slows down over time" | `[ProcessMonitor]` — RSS climbing monotonically across hours = leak signal; sawtooth = normal GC |
| "Emote not showing" / "emotes broken" | `[Emote:*]` (especially `Emote:7TV`, `Emote:BTTV`, `Emote:FFZ`); look for provider 404/5xx, parse errors, `Emote:Manager` cache misses |
| "Updater failed" / "won't update" | `[Service:Updater]` and `[Hook:Updater]`; look for download error, signature verification failure |
| "Ads are leaking through" / "adblock not working" | `[Adblock:*]` and `[Service:NetworkAdblock]`; look for rule-load failures, `Service:CosmeticInject` errors |
| "Search is broken" | `[IPC:Search]`, `[Twitch:Helix:*]` or `[Kick:Endpoints:Search]` |
| "Followed channels don't show" | `[Store:Follow]`, `[Twitch:GQL]` / `[Kick:Endpoints:Follow]` |
| "Renderer error" / "JS error in console" | `[Renderer:*]` and `[console]`; the console intercept captures everything not yet migrated to a real tag |
| "VOD won't load" | `[IPC:Video]`, `[Twitch:GQL]`, `[Page:Video]` |
| "Bug report didn't get written" | `[IPC:Bug]`, `[IPC:Logging]` |

## Search recipes (bash)

Copy-paste against the repo root or the user's logs dir.

```bash
# Newest main log
ls -t logs/streamfusion-*.log | grep -v noise | head -1

# Newest noise log
ls -t logs/streamfusion-noise-*.log | head -1

# All errors in the newest main log
grep "\[error\]" "$(ls -t logs/streamfusion-*.log | grep -v noise | head -1)"

# Warnings + errors only
grep -E "\[(warn|error)\]" "$(ls -t logs/streamfusion-*.log | grep -v noise | head -1)"

# Everything tagged Twitch:EventSub
grep "\[Twitch:EventSub\]" "$(ls -t logs/streamfusion-*.log | grep -v noise | head -1)"

# Anything in the Auth namespace
grep -E "\[Auth:" "$(ls -t logs/streamfusion-*.log | grep -v noise | head -1)"

# 5-line context around every error
grep -B 5 -A 5 "\[error\]" "$(ls -t logs/streamfusion-*.log | grep -v noise | head -1)"

# All session boundaries (cross-check with user's reported time)
grep -E "=== Debug (started|closed)" logs/streamfusion-*.log

# Newest bug report
ls -t bug-reports/bug-report-*.md | head -1

# All bug reports sorted newest-first
ls -t bug-reports/bug-report-*.md
```

On Windows / PowerShell substitute `Get-ChildItem` + `Select-String`:

```powershell
# Newest main log
Get-ChildItem logs\streamfusion-*.log | Where-Object { $_.Name -notlike '*noise*' } | Sort-Object LastWriteTime -Desc | Select-Object -First 1

# Errors in that file
Select-String -Pattern '\[error\]' -Path (Get-ChildItem logs\streamfusion-*.log | Where-Object { $_.Name -notlike '*noise*' } | Sort-Object LastWriteTime -Desc | Select-Object -First 1).FullName
```

## Workflow when fixing a bug report

1. **Read the bug-report `.md` file end-to-end.** Capture the timestamp, app version, platform, and the user's description verbatim.
2. **Pick the suspect subsystem.** From the description, map to a tag prefix using the cheat sheet (Auth, Chat, Player, …). If the description is vague ("it's broken"), fall back to scanning every `[error]` in the embedded tail.
3. **Search the included log section for `[error]` and `[warn]` lines** with that tag prefix, within the timestamp window. Note: errors that appear long before the user's report are usually unrelated noise.
4. **Open the SUT file** at the path implied by the tag. Examples:
   - `[Twitch:EventSub]` → `apps/desktop/src/backend/api/platforms/twitch/twitch-eventsub-client.ts`
   - `[Kick:Endpoints:Chat]` → `apps/desktop/src/backend/api/platforms/kick/endpoints/chat-endpoints.ts`
   - `[Auth:TokenExchange]` → `apps/desktop/src/backend/auth/token-exchange.ts` (or similar)
   - `[Player:HLS]` → `apps/desktop/src/renderer/components/player/hls-player.tsx` (or the hook under `Player:Hook:HLS`)
   - `[CrashHooks]` → `apps/desktop/src/backend/logging/crash-hooks.ts`
5. **Form 2–3 hypotheses, ranked.** Cross-reference the log line's `meta` JSON (status codes, URLs, counts) — that's the structured evidence the author left for you.
6. **If you need more signal,** ask the user to:
   - Set `STREAMFUSION_LOG_LEVEL=debug` (or `STREAMFUSION_NOISE_LOG_LEVEL=debug` for HLS / per-message chat detail) and reproduce.
   - Send the *full* `streamfusion-<ISO>.log` file (the bug report only embeds the last 500 lines).
   - Send the matching noise log if the symptom is playback- or chat-throughput-related.
7. **Propose a minimal fix** and reference the exact log line(s) in your explanation so the maintainer can verify the chain from symptom → cause → patch.

For deeper diagnosis (need to build a feedback loop, bisect, instrument), hand off to `.agents/skills/diagnose/SKILL.md`.

## What NOT to do

- **Don't try to scrub the log further** — `redactor.ts` already strips OAuth tokens, refresh tokens, client secrets, client IDs, JWTs, `Bearer …` headers, OAuth callback `code=`, and `authorization:` headers before they touch disk. Anything that looks suspicious is either already `[REDACTED]` or genuinely not a secret.
- **Don't dismiss `[console]` as junk.** It's the catch-all for `console.log`/`warn`/`error` call sites that haven't been migrated to a real tag yet. The signal is real, the location is just less obvious — grep the codebase for the message text to find the call site.
- **Don't assume the main log is comprehensive.** High-volume events — HLS segment requests, per-message chat throughput, player ticks — go to `streamfusion-noise-<ISO>.log`, not the main log. If your hypothesis hinges on per-segment or per-message behavior, you need the noise log too.
- **Don't trust an old log if rotation has cycled past it.** Only the newest 10 sessions are kept on disk. If the user's reported time is older than the oldest session file, the log is gone — say so instead of guessing.
- **Don't blame the first error you see.** A single `[error]` 30 minutes before the user filed the report is almost certainly noise. Anchor on the report timestamp and walk backwards.
- **Don't conflate main and noise logs in a search.** They have separate session boundaries, separate filenames (`streamfusion-` vs `streamfusion-noise-`), and separate level configs (`STREAMFUSION_LOG_LEVEL` vs `STREAMFUSION_NOISE_LOG_LEVEL`).
