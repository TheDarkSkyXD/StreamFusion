# Slice 04 — Suppress per-slug log noise during outage

Status: ready-for-agent

## Parent
PRD: https://github.com/TheDarkSkyXD/StreamFusion/issues/50

## What to build

When a platform is degraded, demote the per-slug `Failed to fetch public Kick stream <slug>` warnings to `debug`, and emit one platform-level warn at the start of each outage cycle and one at recovery. Once back to healthy, per-slug warn behavior resumes.

This is the user-visible "log file stays readable" promise from the PRD. Without it, an outage produces dozens of identical-looking warnings per cycle.

Behavior:
- When the state machine transitions `healthy → degraded`, log one warn: `[PlatformHealth] Kick degraded: N/M requests failed in last 60s. Backing off.` (N and M from the rolling-window counters.)
- While `degraded`, per-slug warnings inside the stream-endpoint failure paths are demoted to debug. The existing warn-once-per-slug Set still works but its warn calls become debug calls while degraded.
- When the state machine transitions `degraded → healthy`, log one warn: `[PlatformHealth] Kick recovered after Xs.`
- The warn-once-per-slug Set is cleared on recovery so subsequent failures warn again normally.
- This behavior applies to both Kick instrumentation (today) and any future Twitch instrumentation that emits per-call warnings.

## Acceptance criteria

- [ ] On `healthy → degraded` transition, exactly one platform-level warn line is logged with the documented format and the N/M counts.
- [ ] While degraded, per-slug warnings from the Kick stream-endpoints failure path are emitted at debug, not warn.
- [ ] On `degraded → healthy` transition, exactly one platform-level recovery warn is logged.
- [ ] Warn-once-per-slug state is cleared on recovery so a later failure warns again.
- [ ] When healthy, per-slug warn behavior matches today (no regression on existing log noise during isolated failures).
- [ ] Test asserts the warn-vs-debug logger calls via a logger mock (existing test pattern in stream-endpoints.test.ts).

## Blocked by

- 01-kick-degraded-banner-mvp.md
