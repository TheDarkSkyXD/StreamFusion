# Slice 10 — Telemetry JSONL log to disk

Status: ready-for-agent

## Parent
PRD: https://github.com/TheDarkSkyXD/StreamFusion/issues/50

## What to build

Every state transition in the platform-health module appends one JSONL line to a dedicated log file under the app's log directory. Used for diagnosing user reports — "why did my streams disappear at 3am?" becomes answerable by reading this file.

Behavior:
- New file at the app's standard log directory: `platform-health.log`. JSONL — one event per line.
- Each line:
  ```
  { "ts": <ISO 8601>, "platform": "kick" | "twitch", "fromState": "healthy" | "degraded" | "down", "toState": "healthy" | "degraded" | "down", "sampleSize": <number>, "failureRate": <number 0-1>, "source": "internal" | "status-page" }
  ```
- `source` is `"internal"` for transitions driven by the failure-rate counter, `"status-page"` if the transition was nudged by status-page signal (slice 08).
- File is append-only. No rotation, no retention, no upload in v1 (out of scope per PRD).
- Write is best-effort — if the disk is full or the file is locked, log a single warn and continue. Never crash the app or block a state transition on a failed log write.
- Subscribe to `onPlatformHealthChanged` for both platforms; same listener pattern as the IPC emitter.

## Acceptance criteria

- [ ] File `platform-health.log` is created at the app's log directory on the first transition (lazy creation; no empty file at startup).
- [ ] Every state transition produces exactly one JSONL line with the documented schema.
- [ ] `source: "status-page"` is recorded when slice 08's nudge influenced the transition; `"internal"` otherwise.
- [ ] Failed log write does NOT crash the app or block the transition; a single warn is logged.
- [ ] File contents are valid JSONL (each line parses as JSON, lines are newline-separated, no trailing comma drama).
- [ ] Test asserts the file write via a mocked fs layer following existing patterns in the codebase.

## Blocked by

- 01-kick-degraded-banner-mvp.md
