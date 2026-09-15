# Android parity record: `diagnostics-logs-and-bug-reports`

- Capability ID: `diagnostics-logs-and-bug-reports`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Diagnostics section
- Observed `main` at branch start: `5ebd06b`
- Android owner: Mobile Settings Diagnostics, Logs, Report a bug, and About panels
- Progress: `implemented` for searchable Settings plus scoped maintenance confirmation; `deferred` for the six-tab Diagnostics workspace (M09)
- Delivery: `adapted`
- Adaptation: Diagnostic windows, log level/source, and redacted local reports persist in `support-settings.v1`. Share uses `Share.share({ message })`; dismissed or missing targets keep the local report. Open Diagnostics navigates to the existing `more/diagnostics` route. About licenses and privacy stay readable offline. Clear history, remove media, disconnect, and reset require in-panel Cancel or Confirm. Guest disconnect does not start OAuth. Reset preserves guest follows. Appearance stays dark-only.
- Freshness: `current` at `verification/evidence/issue-170-settings.json` on APK `sha256:b13cd849694b15e45d369601d69092c7737695040191af66a977237c81c55c92`

## Desktop outcome

Inspect diagnostics, filter logs, and build a bug report from Settings.

## Android outcome

More Settings hosts searchable Diagnostics, Logs, Report a bug, and About panels. Reports stay redacted and local until the user shares them. Destructive maintenance is scoped and confirmed. The six-tab Diagnostics workspace remains M09.

## Required evidence

- `local-search`
- `destructive-confirmation`
- `data-boundary`
- `accessibility`

## Evidence residuals

TalkBack was not enabled. Diagnostics six-tab workspace remains M09. Share was not driven past the native sheet.

## Blocking for public release

OAuth stays on #145 and #146. Diagnostics six-tab workspace stays on #171.
