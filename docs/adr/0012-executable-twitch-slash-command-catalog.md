# Twitch slash commands use an executable catalog

## Problem

StreamFusion previously described Twitch slash commands in `chat-command-registry.ts`, validated their arguments in a second table, and executed most of them through `tmi.js`. Twitch retired third-party IRC command execution in 2023, except for `/me`. The split design could therefore show a command in autocomplete even when its transport could not execute it.

The Twitch command guide contains 47 native commands with different role, OAuth, token-owner, and public-API constraints. Some commands have Helix equivalents. Some are available to moderators in Twitch's own UI but require the broadcaster's token through Helix. Purchase, voting, rules, goals, and Shared Chat flows have no public mutation API.

## Decision

Twitch command discovery and execution are defined by one typed executable catalog. Each catalog entry owns its name, usage, description, visible roles, required scopes, argument compiler, and effect. A command cannot appear in autocomplete without compiling to one of these effects:

- an IRC action for `/me` only;
- a semantic Twitch API action;
- a Channel-scoped local action;
- a StreamFusion panel action;
- an honest first-party Twitch handoff;
- a reconnect request for missing OAuth scopes.

The renderer runs only this small effect set. It does not switch over 47 command names. Unknown or unauthorized slash text remains fail-closed, and a rejected effect continues through the existing composer error path so the draft is restored.

Semantic Twitch API actions cross the existing validated `electronAPI.twitch.execute` boundary. The main process derives authenticated identity from stored Twitch credentials, resolves target logins, sequences Helix calls, and returns typed receipts. Renderer role checks shape command discovery only. Twitch remains the authorization authority.

The existing Kick catalog and executor remain unchanged. `/disconnect` leaves only the current Channel instead of disconnecting the shared Twitch `ChatConnection`. Editor-only discovery remains hidden until StreamFusion has a trustworthy editor-authority signal.

## Capability routing

- Moderation, chat settings, announcements, shoutouts, suspicious-user status, role changes, whispers, chat color, commercials, raids, and stream markers use public Helix operations when the current token satisfies Twitch's ownership rules.
- Broadcaster poll and prediction commands open StreamFusion's Engagement panel. Moderator variants open Twitch's first-party management surface because public mutations require a broadcaster-owned token.
- Gifting, voting, the complete viewer card, the general Channel Points request queue, rules, goals, and Shared Chat open a named Twitch surface with an explanation. StreamFusion does not report these as API successes.
- `/me` is the only command sent through IRC. The legacy `executeNativeCommand` path is deleted after all callers move.

## Tradeoffs accepted

- The catalog is data-heavy, but it makes command coverage and role policy auditable in one place.
- First-party handoffs are less seamless than native API calls, but they accurately represent Twitch's public capability gaps.
- Existing users may need one reconnect when new scopes are added. Tokens and Helix traffic remain main-process owned.
- A semantic main service overlaps some existing endpoint adapters. It delegates to them instead of duplicating request policy.
- Stable Twitch dashboard destinations require verification and a safe Channel-page fallback.

## Alternatives considered

- Keep separate metadata, validation, and executor switches. Rejected because the three lists can drift and the old IRC transport is no longer valid.
- Add one renderer handler per command. Rejected because username resolution, token-owner rules, and multi-call Helix workflows would stay outside the credential-owning process.
- Send raw slash text to the main process. Rejected because autocomplete would still need a second renderer grammar.
- Expose editor-group commands to moderators. Rejected because moderator status does not prove editor authority, and public Twitch token ownership is narrower than native UI permissions.

## Verification

Tests assert exact equality with the 47-command guide inventory, per-role discovery, every entry compiling to a non-dead effect, `/me` as the only IRC effect, unchanged Kick behavior, strict IPC validation, authenticated actor identity, endpoint sequencing, first-party fallbacks, Channel-scoped disconnect, and composer draft restoration. Real Electron verification covers viewer, moderator, and broadcaster previews plus representative low-risk actions.

