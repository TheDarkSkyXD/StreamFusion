# Slice 06 — State-aware Timeout

Status: ready-for-agent

## Parent

PRD: [../prd.md](../prd.md)

## What to build

Deliver Timeout as the first complete mutation tracer through verified authority, Platform adapter/IPC, immediate state revalidation, confirmation UI, mutation, error recovery, and post-success refresh. The action appears only when the target's current Platform state permits it and must use the authenticated moderator's real identity rather than substituting the Channel ID.

Every submitted attempt is uniquely correlated to its Platform, Channel, target user, selected message when applicable, authenticated moderator, and requested action. If revalidation detects changed or unverifiable state, cancel the attempt, refresh the dialog, and require a new deliberate confirmation.

This slice establishes the pending/success/failure lifecycle reused by later Ban, Unban, and Delete slices.

## Acceptance criteria

- [ ] Timeout appears only for a positively authorized moderator/broadcaster when the target's current Platform state is verified and Timeout is valid.
- [ ] Twitch and Kick mutations run through privileged Platform/IPC seams; renderer components do not directly import backend mutation implementations.
- [ ] The authenticated moderator ID is sent to Twitch; the Channel/broadcaster ID is used only when the authenticated viewer is actually that broadcaster.
- [ ] Presets are `10s`, `1m`, `10m`, `30m`, `24h`, and `7d`, plus Custom; unsupported Platform durations are omitted.
- [ ] Custom duration validates against the current official Platform minimum/maximum and explains invalid values inline.
- [ ] `10m` is the default when supported; otherwise the picker selects a valid Platform-supported default.
- [ ] An optional reason appears and is submitted only when the active Platform supports it.
- [ ] Submitting Timeout immediately revalidates the exact Platform, Channel, target, authenticated moderator authority, and current target state.
- [ ] Revalidation is correlated to a unique attempt so a late response cannot authorize another user, Channel, or action.
- [ ] Changed, stale, or unverifiable state cancels the mutation, refreshes the dialog, and requires a new confirmation.
- [ ] While submitted, duplicate actions are prevented; Escape, outside-click, and Close are blocked; visible progress and an accessible status announcement are present.
- [ ] Success keeps the dialog open, refreshes current action state and Moderation history, and shows a brief success toast.
- [ ] Failure keeps the dialog open, preserves duration/reason input, renders the exact safe Platform error inline, and offers Retry.
- [ ] Platform errors are sanitized so credentials, raw request details, and sensitive internals never reach the UI.
- [ ] Confirmation can be dismissed before submission, and the dialog can close during post-success refresh.
- [ ] Tests cover Platform limits, optional reason support, correct moderator identity, state-change cancellation, attempt correlation, duplicate submission, blocked dismissal, sanitized failure/Retry, and success refresh for Twitch and Kick.
- [ ] Browser-development fixtures and Electron MCP proof demonstrate valid, unverifiable, pending, failure, and success states.
- [ ] Lint, type-check, relevant tests, React diagnostics, and production build pass.

## Blocked by

- [Slice 05 — Permission-gated Moderation history and one-flow reconnect](05-permission-gated-moderation-history.md)
