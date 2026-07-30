# Slice 01 — Twitch identity-first dialog and truthful profile data

Status: done

## Parent

PRD: [../prd.md](../prd.md)

## What to build

Deliver the complete public Twitch path from clicking a username to seeing a responsive, identity-first dialog with truthful Platform data. The dialog opens immediately from chat-known identity, then independently resolves avatar, account-created date, follow relationship, and Channel information through typed privileged seams. Official Platform data is preferred; validated first-party Twitch data is an isolated fallback; unsupported or failed lookups remain explicitly unavailable.

This slice establishes the shared centered dialog shell used by later slices: structured header, fixed header/footer around one scrolling body, responsive compact-window behavior, Lucide section/action icons, field-level loading and Retry states, focus restoration, and the same component in Electron development and the browser development harness. It also brings every Twitch connect, reconnect, device-code, validation, and refresh path onto the canonical StreamFusion scope set.

The field model must distinguish loading, known, confirmed negative, reconnect required, unavailable, and failed. A failed follow lookup must never become `Not following`, and no account/follow date may be estimated. Do not expose moderation tools in this slice.

This covers the PRD stories for public identity, Guest-safe inspection, truthful follow state, keyboard accessibility, and development-surface parity.

## Acceptance criteria

- [x] Clicking a Twitch username opens the centered identity-first dialog immediately using chat-known identity without waiting for remote profile requests.
- [x] The dialog shows avatar, display name, handle, `Account created`, and `Following since`; it contains no banner, bio, or moderation controls.
- [x] Profile reads use a typed privileged Platform/IPC seam rather than direct renderer Helix or first-party fetches.
- [x] Official Twitch data is attempted first and any first-party website fallback is isolated, schema-validated, and mapped to the same explicit field-state contract.
- [x] `Following since` shows an exact date when verified, `Not following` only after a positive authoritative negative result, and `Unavailable · Retry` when the relationship cannot be verified.
- [x] `Account created` never uses an invented or stale undocumented field without successful fallback validation; failure shows `Couldn’t verify · Retry`.
- [x] Visible dates are absolute and their hover/focus tooltips provide the relative age.
- [x] Avatar, dates, Channel resolution, and relationship state load independently; late content never steals focus and one failed field does not fail the dialog.
- [x] The dialog targets approximately 560px width and 80% viewport height with fixed header/footer and one scrolling body; compact windows retain safe gutters and a visible Close control.
- [x] Close restores focus to the username that opened the dialog or, if virtualization removed it, the nearest stable chat container.
- [x] Close and external-link-style icon-only controls have accessible names/tooltips; labelled actions and section headings use the existing Lucide family.
- [x] The canonical Twitch scope set includes `moderator:read:followers`, `moderator:read:blocked_terms`, `moderator:read:chat_settings`, `moderator:read:moderators`, and `moderator:read:vips` in every initial and renewal authorization path.
- [x] Existing valid manage scopes remain canonical where Twitch documents them as satisfying the corresponding event permission category; redundant read scopes are not added.
- [x] Component and adapter tests cover known, negative, reconnect-required, unavailable, retry-success, fallback-schema-drift, compact-window, and focus-restoration states.
- [x] The same production dialog component renders real Platform responses in Electron development and the browser development harness; only the explicit unavailable state may be forced, and production packaging remains Electron-only.
- [x] Electron MCP proof captures the Twitch public dialog with real loaded data from the normal development URL and the unavailable/retry state from `?userProfileFixture=unavailable`.
- [x] Lint, type-check, relevant tests, React diagnostics, and production build pass.

## Proof URLs

- Loaded real data: use the normal development URL with no `userProfileFixture` query parameter.
- Forced failure/retry: append `?userProfileFixture=unavailable`.
- `userProfileFixture=loaded` is intentionally unsupported and passes through to the real typed Platform readers.

## Blocked by

None — can start immediately.

## Comments

- Completed 2026-07-29.
- Real loaded Electron proof and development-only unavailable/Retry proof are
  recorded in
  [`../evidence/01-twitch-truthful-user-info-proof.md`](../evidence/01-twitch-truthful-user-info-proof.md).
- The main StreamFusion Twitch OAuth, reconnect, device-code, validation, and
  refresh paths share `TWITCH_APP_SCOPES`. The isolated follow-write credential
  uses a different client ID and remains least-privilege; it is not a
  StreamFusion Platform connection and intentionally does not receive moderator
  scopes.
- Final gates: 17 focused files / 163 tests, 33-file exact Biome, scoped React
  Doctor with zero issues, workspace type-check, and production build.
