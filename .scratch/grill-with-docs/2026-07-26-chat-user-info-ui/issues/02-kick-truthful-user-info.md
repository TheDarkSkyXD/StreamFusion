# Slice 02 — Kick truthful profile and follow parity

Status: done

## Parent

PRD: [../prd.md](../prd.md)

## What to build

Extend the identity-first dialog from slice 01 to Kick without inventing parity that Kick cannot prove. Resolve Kick identity and profile fields through official Public API/event data first, then a validated isolated first-party Kick fallback. When neither source can verify account creation or follow relationship, retain the field with the approved unavailable/Retry state.

The Kick path must use the same explicit field-state contract, progressive UI, responsive layout, focus behavior, and development-surface component as Twitch. Add `events:subscribe` to the canonical Kick authorization set across every connection lifecycle path while preserving the existing read and moderation scopes.

This covers the PRD stories for cross-Platform public identity, Guest-safe inspection, truthful relationship states, accessibility, and browser-development parity.

## Acceptance criteria

- [x] Clicking a Kick username opens the same identity-first dialog shell and immediately displays chat-known identity.
- [x] Kick identity/avatar resolution prefers documented official data and event payloads before attempting a first-party website fallback.
- [x] First-party Kick responses are isolated behind a Platform adapter, schema-validated, and never described as an official Public API guarantee.
- [x] `Account created` and `Following since` show exact dates only when a validated source provides them; values are never estimated from event arrival or the current session.
- [x] `Not following` appears only after a source positively verifies the negative relationship; unsupported or unverifiable lookup shows `Unavailable · Retry`.
- [x] A field-level Kick failure does not block identity, recent-message context, external navigation, or normal dialog dismissal.
- [x] Loading, verified-empty, unavailable, reconnect-required, and failed states remain visually and programmatically distinct.
- [x] `events:subscribe` is part of the canonical Kick scope set used by initial connect, reconnect, token validation, refresh, and any device-code-equivalent path.
- [x] The canonical Kick set retains `user:read`, `channel:read`, `moderation:ban`, and `moderation:chat_message:manage`; this feature does not reintroduce `chat:write`.
- [x] Contract tests cover documented Kick responses/events, valid first-party fallback data, fallback schema drift, missing dates, and explicit unavailable behavior.
- [x] UI tests prove the Kick path uses the same responsive, accessible production component in Electron and browser development.
- [x] Electron MCP proof captures the Kick dialog with real known identity, an unavailable account date, and an exact validated follow date.
- [x] Lint, type-check, relevant tests, React diagnostics, and production build pass.

## Blocked by

- [Slice 01 — Twitch identity-first dialog and truthful profile data](01-twitch-truthful-user-info.md)

## Evidence

- [Slice 02 — truthful Kick User Info proof](../evidence/02-kick-truthful-user-info-proof.md)

## Comments

- Closed as a 40-path exact staged slice with no browser-relay foundation or
  tests and only the two final evidence-linked Electron proof screenshots.
- Exact checkout-index validation passed type-check, the full 622-file source
  Biome check, all 205 focused tests across 14 files, and the production build.
- Staged-only React Doctor completed with zero blocking errors. Its seven
  advisory warnings are pre-existing patterns outside the Issue 02 hunks.
- Electron MCP proof used a real Kick chatter and real Platform data: account
  creation remained truthfully unavailable, while the validated exact follow
  date rendered as Jan 3, 2025 and remained stable through Retry.
