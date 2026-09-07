# Moderation workspace verification

Completed 2026-09-06. Base a73b2a8. All UI actions used the isolated Electron renderer. Twitch reference was the open T3 moderator/tenhq tab.

## Behavior

- Twitch-style compact mod workspace with platform colors. Kick retains Retention; Twitch uses AutoMod Queue.
- Pinned Retention/AutoMod has no move/hide controls. Mod Actions can only move left/right beside it; invalid persisted vertical pairs reset safely.
- Chat can dock to the outer right edge at full canvas height. Moving panels preserves the live video/chat hosts.
- Pointer previews, keyboard menus, resize, lock, reset, hide/restore, account/channel-scoped saved layouts, and narrow-window stacking.
- Own authenticated channel can render while remote permissions are checked. Stable scope-effect dependencies prevent role updates from repeating the access check and unmounting chat.
- Filters match the reference's 14 categories plus All. SQL action selection runs before pagination.
- AutoMod uses Twitch EventSub v2 hold/update and the Helix manage-held-message endpoint. Main derives the actor from the authenticated token. Per-feed subscription failures cannot appear as a healthy empty queue. Retry/reconnect and virtualized held messages are covered.

## Evidence

`.scratch/verify-streamfusion/evidence/mod-final-20260906/` has before/preview/after JSON and PNG captures.

- `kick-right`: Mod Actions moved from x64 to x556.39 beside Retention. Green preview. Video/chat host identity unchanged.
- `kick-no-top`: top drop produced no preview and did not change geometry.
- `chat-left` and `chat-restored-right`: chat moved between outer edges, height800px throughout.
- `resize-button`: trusted pointer input changed first split from74% to68%, exactly80px. Live hosts unchanged.
- `restored-layout`: same resized layout after renderer reload.
- `locked`: no splitters or drag handles.
- `hidden-actions` / `restored-actions`: restored Mod Actions beside Retention, not above it.
- `narrow`: 700px window stacked without horizontal overflow; live hosts preserved.
- `filter-native-real`: 14 named categories plus All. Menu accent #53fc18. `filters-none` exercises All off.
- `no-access-flash/observation.json`: 15 seconds, zero verification flashes, same connected chat host.
- `reset-layout`: restored default74% split and Mod Actions left of Retention.
- `twitch-own`: actual unresolved-channel state with unavailable Twitch session, not a successful AutoMod delivery claim.
- Doctor healthy, isolated database quick_check=ok, required tables present. All driver action error lists empty. Run cleaned; evidence retained.

The driver initially omitted button:left during resize moves. Corrected input proved resizing without changing production code. Earlier resize captures do not prove a product failure. Reload invalidates DOM object handles; use the separate restored-layout capture for persistence. HMR-only captures were not used for component continuity claims across reloads.

## Checks

- Full desktop Node+DOM suite: 628 files, 7579 tests passed.
- Full desktop typecheck and lint passed. Architecture feature boundaries passed. All50 display-language catalogs complete. Changed-file Prettier and diff checks passed.
- Access regression was red against a73b2a8 (two token checks) and green here (one).
- React Doctor scanned52 changed files,88/100,16 warnings,0 errors. Reviewed warnings: bounded arrays (at most10 widgets/four edges) do not justify hash indexes; component size/export warnings describe organization, not a reproduced behavior failure; chat state-count warnings predate the workspace; Zod strict remains supported and schema tests pass. No suppressions added. New-file score is not comparable to the earlier partial scan.

## Limits

Live Twitch AutoMod delivery and remote Allow/Deny were not exercised because a valid scoped Twitch session was unavailable. No remote chat or moderation writes were performed. AutoMod does not backfill messages held before subscription. Filter categories operate on observed stored actions; several Twitch event families are not yet ingested, and Roles overlaps Mods/VIPs. This is not full Twitch history parity.

Earlier performance commit a73b2a8 reduced Following mounted cards672 to56 and measured interaction task time1251.2 to187.4ms. Diagnostics p95 improved166.6 to16.8ms. Two-stream MultiView p95 remains33.4ms against a20ms budget; that bottleneck is still unresolved.

Principles applied: Fix Root Causes stabilized the scope check instead of hiding the loading text. Model the Domain made pinned anchors and legal dock edges explicit. Prove It Works required native Electron movement, persistence, and identity evidence.

Committed and pushed e4a520d to main. Compiled Electron pre-commit smoke passed healthy and cleaned its run. Evidence copied to .scratch/verify-streamfusion/evidence/mod-commit-smoke-20260906. User telemetry and unrelated scratch files remain untouched.
