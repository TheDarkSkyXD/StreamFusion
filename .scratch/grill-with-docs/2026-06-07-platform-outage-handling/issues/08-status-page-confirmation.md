# Slice 08 — Status-page secondary confirmation (Twitch + Kick)

Status: ready-for-agent

## Parent
PRD: https://github.com/TheDarkSkyXD/StreamFusion/issues/50

## What to build

While a platform is `degraded`, periodically poll its official status page (https://status.twitch.com, https://status.kick.com) and use the result to NUDGE the recovery cooldown — never to override the internal failure-rate signal. A confirming status page lets us recover faster; a status page reporting an ongoing incident holds us in `degraded` for one extra cycle.

Behavior:
- A new isolated status-page poller per platform. Runs only while the platform is `degraded` — NOT polled while `healthy`.
- Twitch: https://status.twitch.com/ exposes an Atlassian Statuspage JSON API at `/api/v2/status.json` and `/api/v2/incidents.json`. Use these. Filter to API-affecting components only (Helix, GQL, EventSub) — Player/Chat/Subs incidents are ignored.
- Kick: https://status.kick.com/posts/dashboard. Implementation verifies whether a JSON/RSS feed is exposed; if HTML-only, parse minimally. If parsing is unreliable, fall back to "no signal" — never to a positive or negative confirmation.
- Poll cadence while degraded: 60s.
- Result feeds back via `recordStatusPageSignal(platform, signal)` where `signal: "confirmed-outage" | "all-clear" | "no-signal"`. Module uses it to:
  - `confirmed-outage` while internal rate <40% → hold `degraded` for one extra recovery window (30s → 60s).
  - `all-clear` while internal rate <40% → shorten recovery cooldown (30s → 15s).
  - `no-signal` or fetch failure → use the default 30s cooldown.
- Never escalates state on its own. A status page reporting an incident while we see no internal failures does NOT trip `degraded`.
- Telemetry log (slice 10) records whether each recovery was nudged by status-page signal — useful for tuning.

## Acceptance criteria

- [ ] Poller does NOT run while a platform is `healthy`.
- [ ] Poller starts on `healthy → degraded` transition, stops on `degraded → healthy` transition.
- [ ] Twitch status-page JSON correctly parses `status.json` and filters incidents to API-affecting components.
- [ ] Kick status-page parser produces `no-signal` on any failure (timeout, malformed response, layout change) — never wrongly confirms.
- [ ] `recordStatusPageSignal("kick", "all-clear")` while internal rate <40% causes recovery in 15s (vs default 30s).
- [ ] `recordStatusPageSignal("kick", "confirmed-outage")` while internal rate <40% extends recovery to 60s.
- [ ] Status-page signal NEVER causes a `healthy → degraded` transition on its own (internal rate is sole authority for tripping).
- [ ] Status-page parser tests cover fixture JSON for status.twitch.com and HTML/JSON for status.kick.com, including malformed cases.
- [ ] Integration test demonstrates the cooldown nudge end-to-end with fake timers.

## Blocked by

- 02-recovery-flush-negative-caches.md
