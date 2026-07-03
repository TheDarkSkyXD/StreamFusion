Status: ready-for-human

# Plan hosted Kick webhook relay follow-up

## Parent

.scratch/grill-with-docs/2026-06-30-live-stream-notifications/prd.md

## What to build

Create a follow-up plan for a hosted Kick webhook relay that can receive Kick `livestream.status.updated` events through a public callback URL and feed the existing StreamFusion Live Notification source seam. This issue should decide hosting ownership, auth/security, event delivery guarantees, and rollout strategy.

## Acceptance criteria

- [ ] A proposed relay architecture is documented.
- [ ] Hosting ownership, environment, and deployment expectations are identified.
- [ ] Relay authentication, event verification, and abuse controls are specified.
- [ ] Delivery semantics are defined, including retry, dedupe, and stale event handling.
- [ ] The plan explains how relay events feed the existing Kick Live Notification source seam.
- [ ] The plan identifies what remains local-only and what requires cloud infrastructure.
- [ ] The plan ends with implementation issues or an ADR recommendation.

## Blocked by

- .scratch/grill-with-docs/2026-06-30-live-stream-notifications/issues/06-kick-bounded-polling-relay-ready-source.md

