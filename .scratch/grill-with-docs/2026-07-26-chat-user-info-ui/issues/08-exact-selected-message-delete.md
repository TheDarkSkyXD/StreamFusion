# Slice 08 — Exact selected-message Delete

Status: ready-for-agent

## Parent

PRD: [../prd.md](../prd.md)

## What to build

Deliver exact-message Delete for the currently selected Recent Chat Message on Twitch and Kick. The action is available only when the selected item is an undeleted message authored by the profile user. A reply authored by someone else, a deleted/tombstoned message, an absent selection, or unverifiable current state must never expose an active Delete action.

Delete uses explicit destructive confirmation and the mutation lifecycle established by Timeout. Immediate revalidation includes the exact selected message and its current deletion/author state, so live updates, list pruning, or a late Platform event cannot retarget or repeat deletion.

This covers the PRD stories for exact moderation targeting, stable live selection, stale-state protection, accessibility, and development parity.

## Acceptance criteria

- [ ] Delete appears only for an explicitly selected, undeleted message authored by the profile user.
- [ ] Replies addressed to the selected chatter but authored by another user never expose Delete for that reply.
- [ ] No selection, a tombstone, an already deleted message, or unverifiable message state exposes no active Delete action.
- [ ] The action targets the pinned selected message ID even after live insertion or visible-list pruning.
- [ ] Delete requires explicit destructive confirmation naming the target message/user context.
- [ ] Submission revalidates the exact Platform, Channel, target user, selected message ID, message author, deletion state, and authenticated moderator authority.
- [ ] Changed or missing message state cancels deletion, refreshes the dialog, and requires a new selection/confirmation.
- [ ] Twitch and Kick use their documented exact-message deletion paths and required scopes through privileged Platform/IPC seams.
- [ ] Submitted deletion prevents duplicates and dialog dismissal and provides visible/accessibly announced progress.
- [ ] Success keeps the dialog open, updates the selected message according to the deleted-message preference, removes the now-invalid Delete action, refreshes Moderation history, and shows a brief toast.
- [ ] Failure keeps the selection pinned, shows the sanitized exact Platform error inline, and offers Retry without retargeting.
- [ ] Tests cover authored versus addressed replies, tombstones, live pruning, stale deletion state, exact ID propagation, duplicate prevention, safe failure, and success refresh for Twitch and Kick.
- [ ] Browser-development fixtures and Electron MCP proof demonstrate eligible, ineligible, pending, failure, and success states.
- [ ] Lint, type-check, relevant tests, React diagnostics, and production build pass.

## Blocked by

- [Slice 03 — Live Recent Chat Messages and complete badge context](03-live-recent-chat-and-badges.md)
- [Slice 05 — Permission-gated Moderation history and one-flow reconnect](05-permission-gated-moderation-history.md)
- [Slice 06 — State-aware Timeout](06-state-aware-timeout.md)
