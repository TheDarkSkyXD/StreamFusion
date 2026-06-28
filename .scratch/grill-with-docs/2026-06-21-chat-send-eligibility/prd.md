# Chat Send Eligibility PRD

## Problem Statement

StreamFusion's chat composer currently treats `canSend` as both "can type" and "can send." That breaks the intended chat experience: viewers should be able to type drafts even when authentication, channel restrictions, verification, subscriber-only chat, or slow mode prevents the current send.

The app also lacks a unified Chat Send Eligibility model. Twitch and Kick already expose room-state modes, but send failures are flattened into plain errors and the UI cannot present polished, platform-aware blockers above the input.

## Solution

Add a Chat Send Eligibility layer for Twitch and Kick that evaluates whether the viewer can send the current draft right now, while always allowing draft editing unless the composer is genuinely disabled for non-eligibility reasons.

The composer should:

- Keep draft editing enabled for unauthenticated and restricted users.
- On send, show exactly one blocker above the input using this priority: auth, Twitch verification, follower-only, subscriber-only, emote-only, slow mode.
- Preserve the draft and focus the input when a send is blocked.
- Clear the draft only after a successful send.
- Use platform-like wording where possible.
- Provide blocker-specific actions that open platform-owned pages or auth flows.

## User Stories

- As a signed-out Twitch or Kick viewer, I can type a chat draft, and when I try to send it StreamFusion opens the correct platform auth flow.
- As a viewer in follower-only chat, I see a clear follower-only blocker instead of silently failing or sending a doomed message.
- As a viewer in subscriber-only chat, StreamFusion checks my subscription state where possible before blocking, and does not false-block me when Kick subscription state is unknown.
- As a Twitch viewer blocked by phone/email verified chat, I see Twitch-specific verified-chat wording after Twitch rejects the send.
- As a viewer subject to slow mode, I see slow mode active and get a countdown-style blocker if I try to send too early.
- As a mod, VIP, broadcaster, or other known bypass role, StreamFusion does not pre-block me for restrictions I can bypass.

## Implementation Decisions

- `ChatInput` needs separate concepts for draft editing and send eligibility. Do not use a single `canSend` flag for both.
- Room-state source of truth remains `useRoomStateStore`, fed by existing Twitch/Kick settings sync and WebSocket events.
- Twitch follow preflight uses the current user token with `user:read:follows`.
- Twitch subscription preflight uses the current user token with `user:read:subscriptions`.
- Existing Twitch tokens missing a required preflight scope should produce a "Reconnect Twitch" blocker on send, not interrupt passive viewing.
- Kick subscription preflight should be robust and tri-state: `subscribed`, `notSubscribed`, `unknown`.
- Kick `unknown` must not block. The send attempt proceeds and only a server rejection becomes a blocker.
- Twitch verified-chat hard-blocking is server-rejection-driven. Account preflight may improve copy/readiness, but must not block before Twitch rejects the send.
- Twitch/Kick send rejections should be mapped into structured blocker types before reaching the composer.
- Slow mode should display from room state and locally track this viewer's cooldown after successful sends when the interval is known. Server rejection remains the correction source.
- Blocker actions should use platform-owned flows:
  - Auth: open Twitch/Kick login.
  - Twitch scope upgrade: reconnect Twitch.
  - Follow: open the channel page.
  - Subscribe: open the most specific stable subscribe/channel page available.
  - Verification: open Twitch account/security/help page where stable.
  - Slow mode: no external action.

## Acceptance Criteria

- A signed-out viewer can type in the chat input and attempting to send opens the correct Twitch/Kick auth flow.
- A blocked send does not clear the draft, emote slots, or reply state, and returns focus to the input.
- The above-input popup shows only the highest-priority active blocker.
- Follower-only, subscriber-only, emote-only, and slow-mode room states are read from the existing room-state store.
- Twitch missing-scope preflight failures show a reconnect action instead of raw API errors.
- Twitch verified phone/email blockers are shown only after Twitch rejects a send, with specific phone/email wording when available.
- Kick subscriber-only preflight does not block when subscription state is unknown.
- Known role bypasses prevent false pre-blocking.
- Slow mode displays the configured interval and locally blocks early repeat sends after a successful send.
- Platform send failures are classified into structured eligibility blockers or non-eligibility errors.

## Testing Decisions

- Add unit tests for blocker priority and copy/action mapping.
- Add unit tests for Twitch/Kick send rejection classification.
- Add unit tests for Kick subscription tri-state behavior.
- Add component tests for `ChatInput` draft retention, auth blocker, and above-input popup rendering.
- Add tests for slow-mode local cooldown after a successful send.
- Run the repo quality gates: lint, type-check, and build.
- Because this is UI-facing, manually verify the composer in the app/browser surface after implementation.

## Out of Scope

- Building Twitch or Kick payment, follow, or verification flows inside StreamFusion.
- Adding Twitch verified-chat preflight hard-blocking before a server rejection.
- Adding Kick Twitch-style verified-chat support unless Kick actually rejects sends for that reason.
- Handling Kick account-age mode beyond existing room-state/server-rejection behavior unless it proves to block chat in practice.
- Resolving the stale chat instruction that says there is no Send button.

## Further Notes

- `CONTEXT.md` now defines Chat Send Eligibility as distinct from draft editing.
- Existing docs drift remains: `apps/desktop/src/components/chat/AGENTS.md` says "No Send button", but `ChatInput.tsx` currently renders a footer `Chat` button.
- Recommended next step: run `/to-issues` on this PRD to create independently grabbable implementation issues in this session folder.
