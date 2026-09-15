# Android parity record: `diagnostics-logs-and-bug-reports`

- Capability ID: `diagnostics-logs-and-bug-reports`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Diagnostics section
- Observed `main` at branch start: `29202d1`
- Android owner: Mobile Diagnostics workspace under More plus Settings Diagnostics, Logs, Report a bug, and About
- Progress: `implemented` for six distinct Diagnostics tabs, Capability Profile, redacted reports, and safe recovery
- Delivery: `adapted`
- Adaptation: Mobile keeps six tabs (Overview, Resources, I/O, Traces, Logs and reports, Developer tools). Desktop Processes is omitted because mobile does not signal arbitrary processes. Failures fold into collection copy and traces. Reports stay redacted local copies. Appearance stays dark-only.
- Freshness: `current` at `verification/evidence/issue-171-diagnostics.json`

## Desktop outcome

Inspect diagnostics across eight workspace tabs, filter logs, and build a bug report from Settings.

## Android outcome

More Diagnostics hosts six app-owned tabs. Overview shows Capability Profile and installation policy. Resources repeats live resource observations. I/O shows connectivity and encrypted storage. Traces shows media jobs and captions. Logs and reports reuse the redacted Settings panels. Developer tools keep development proofs. Invalid tab ids retain the current tab. Run check retries Capability Profile collection.

## Required evidence

- `change-gate`
- `api30-device`
- `redaction-proof`
- `recovery-actions`
- `accessibility`

## Evidence residuals

TalkBack was not enabled. Physical-device evidence stays on #196. Share was not driven past the native sheet.

## Blocking for public release

OAuth stays on #145 and #146.
