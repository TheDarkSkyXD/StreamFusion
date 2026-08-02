# Slice 07 — State-aware Ban and Unban

Status: ready-for-agent

## Parent

PRD: [../prd.md](../prd.md)

## What to build

Extend the verified mutation lifecycle from Timeout to Ban and Unban on Twitch and Kick. The dialog shows only the action valid for the target's freshly verified state: Ban and Unban are mutually exclusive. Ban uses explicit destructive confirmation; Unban submits immediately after deliberate selection.

Both actions reuse the exact authority, attempt-correlation, revalidation, pending, safe-error, success-refresh, and dismissal behavior proven by slice 06. Unsupported or unverifiable Platform state remains locked rather than inferred from local history.

This covers the PRD stories for state-aware moderation, stale-state protection, clear action feedback, accessibility, and development parity.

## Acceptance criteria

- [ ] A verified unbanned target exposes Ban and not Unban; a verified banned/timed-out target exposes Unban and not Ban.
- [ ] Unknown, stale, partial, or unverifiable state exposes neither active action and provides the approved Retry state.
- [ ] Ban requires explicit destructive confirmation that names the target and action.
- [ ] Unban acts immediately after deliberate selection without an additional confirmation dialog.
- [ ] Each submission revalidates the exact Platform, Channel, target user, authenticated moderator authority, and current state before mutation.
- [ ] A state change between rendering and confirmation cancels the request, refreshes the dialog, and prevents the wrong action.
- [ ] Twitch and Kick use their documented privileged mutation paths and the authenticated moderator's correct identity.
- [ ] Submitted work prevents duplicates and dialog dismissal and provides visible/accessibly announced progress.
- [ ] Success keeps the dialog open, swaps to the newly valid action state, refreshes Moderation history, and shows a brief toast.
- [ ] Failure preserves any supported reason input, shows the sanitized exact Platform error inline, and offers Retry.
- [ ] Local Platform-originated history is never promoted into authoritative current ban state when the Platform cannot verify that state.
- [ ] Tests cover mutual exclusivity, confirmation severity, immediate Unban, changed-state cancellation, correct identity, pending behavior, safe failure, and success refresh for Twitch and Kick.
- [ ] Browser-development fixtures and Electron MCP proof demonstrate Ban, Unban, unavailable-state, failure, and success transitions.
- [ ] Lint, type-check, relevant tests, React diagnostics, and production build pass.

## Blocked by

- [Slice 06 — State-aware Timeout](06-state-aware-timeout.md)
