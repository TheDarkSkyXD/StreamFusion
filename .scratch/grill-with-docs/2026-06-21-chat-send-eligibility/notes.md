# Chat Send Eligibility: Grilling Session Notes
Date: 2026-06-21 · Goal: Define how StreamFusion blocks or allows chat sends across Twitch and Kick when auth, verification, follow, subscriber, and slow-mode rules apply.

## PRD
- Local PRD: `prd.md`

## Issues
- `issues/01-auth-blocker-and-draft-editing-foundation.md`
- `issues/02-follower-and-emote-only-send-blockers.md`
- `issues/03-subscriber-only-preflight-blockers.md`
- `issues/04-structured-send-rejection-classification.md`
- `issues/05-slow-mode-cooldown-and-priority-integration.md`

## Summary / key decisions
- Users who are not authenticated can still type a draft. Sending opens the platform-specific auth popup.
- Restricted users can type drafts; blocking happens on send with a popup above the input.
- Twitch verification failures should use Twitch-specific phone/email wording when Twitch returns a phone-only or email/phone-specific rejection.
- Only one strict blocker should be shown at a time, ordered by what the user must solve first.
- Subscriber-only should keep the existing action button pattern and redirect to Twitch in the browser for Twitch subscription rather than adding an in-app Twitch payment dialog.
- Kick should not add Twitch-style verified-chat support unless Kick actually blocks chatting for account verification or account age in the existing workaround path.
- Code inspection: `ChatInput` currently disables editing when `canSend` is false, so the feature needs separate draft-editing and send-eligibility concepts.
- Code inspection: Twitch and Kick room-state sync already feeds `slowMode`, `followersOnly`, `subscribersOnly`, `emoteOnly`, and Kick `accountAge` into `useRoomStateStore`.
- Code inspection: Twitch send failures currently bubble as plain errors from tmi.js, so Twitch phone/email/follow/sub rejection handling needs structured error mapping before `ChatInput` can show polished blocker copy.
- Code inspection: Twitch has an existing Helix subscription-check pattern in `UserPopout`; Kick has a legacy/internal hidden-session user-subscriptions endpoint for emote inventory but no first-class chat eligibility state.
- Decision: subscriber-only detection should preflight both Twitch and Kick, but the Kick path must be made more robust rather than depending on a brittle direct reuse of the hidden-session subscription call.
- Decision: Kick subscription preflight has three states: subscribed, not subscribed, unknown. Unknown must not block the draft or send attempt; send proceeds and only a server rejection becomes a blocker.
- Decision: strict blocker order is auth, Twitch verification, follower-only, subscriber-only, emote-only, then slow mode.
- Decision: popup actions should be blocker-specific. StreamFusion's current Twitch scope list already covers the intended follow/subscriber preflights, while existing tokens may need reconnect for scope upgrade.
- Scope inspection: StreamFusion's canonical Twitch scope list already includes `user:read:follows`, `user:read:subscriptions`, `user:read:email`, `chat:read`, and `chat:edit`. Twitch docs confirm these are the follow/subscription scopes needed for viewer follow and subscription preflight. Kick subscription preflight is not an OAuth-scope problem in this app; it relies on the hidden kick.com web session.
- Decision: if an existing Twitch token is missing the scope required for a restriction preflight, block the attempted send with a "Reconnect Twitch" action rather than sending blindly or forcing reconnect on chat open.
- Decision: Twitch verified-chat handling is hybrid. Account preflight may improve copy/readiness for exposed facts, but Twitch failed-send verification rejections are the authoritative source of truth, especially for phone verification.
- Decision: Twitch verified-chat hard blocking only happens after a Twitch send rejection. Account preflight may improve copy or readiness, but must not block before send.
- Decision: above-input blocker popup copy should stay close to Twitch/Kick platform wording where possible, even when this means platform-specific phrasing instead of one uniform StreamFusion voice.
- Decision: slow mode should be both displayed and locally tracked after successful sends when the interval is known, but platform/server rejection remains the correction source when the local cooldown is missing or wrong.
- Decision: blocked sends keep the draft intact and focus the input. The message is cleared only after a successful send.
- Decision: blocker popup actions should use platform-owned pages, choosing the most specific stable URL available and falling back to the channel page when a subscribe/verify URL is not reliable.
- Decision: known role bypasses should prevent false pre-blocking. Unknown role state falls back to server rejection rather than blocking.

## Q&A log
### Q0 — Baseline answers
- Asked: Follow-up clarification on Twitch verification copy, typing while restricted, blocker priority, subscribe action behavior, and Kick account-age scope.
- Captured: Use specific Twitch phone/email wording when Twitch returns it; users keep typing drafts and get blocked on send; show one strict blocker because the user should resolve follow/sub/auth before slow mode; keep the action button and redirect Twitch subscription to browser; do not add Kick account-age handling unless it affects actual chat sending and the current Kick workaround cannot cover it.
- Doc updates: none.
- Flags: Need to inspect current StreamFusion chat/auth state and existing action-button behavior before naming implementation seams.

### Q1 — Subscriber-only detection
- Asked: Whether subscriber-only chat should preflight Twitch only, preflight both Twitch and Kick, or rely on server rejection.
- Captured: User chose preflight both Twitch and Kick, with an explicit requirement that the Kick check be made more robust so it is not brittle.
- Doc updates: `CONTEXT.md` term added for Chat Send Eligibility.
- Flags: Need to decide what the UI should do when Kick subscription preflight returns unknown/unavailable.

### Q2 — Kick unknown subscription state
- Asked: If Kick subscriber-only preflight cannot confidently determine whether the viewer is subscribed, should StreamFusion allow send, block with an unverifiable-subscription message, or open Kick.
- Captured: Allow the send attempt. Model Kick subscription preflight as subscribed / not subscribed / unknown. Unknown is not a blocker because false-blocking paid subscribers is worse than letting Kick reject.
- Doc updates: none.
- Flags: none.

### Q3 — Strictest blocker order
- Asked: When multiple restrictions are active, what exact order should the send blocker use.
- Captured: Use auth -> verified -> follower -> subscriber -> emote-only -> slow mode. Slow mode should be visible only once the viewer is otherwise allowed to chat.
- Doc updates: none.
- Flags: none.

### Q4 — Popup actions and scopes
- Asked: What action should the popup above the input expose for each blocker.
- Captured: User leans toward blocker-specific actions, but flagged that StreamFusion needs all required OAuth/API scopes before relying on those checks.
- Doc updates: none.
- Flags: Verify current Twitch/Kick auth scopes and decide how to handle missing scopes.

### Scope inspection — current app state
- Asked: Codebase inspection following the user's concern that StreamFusion needs all scopes.
- Captured: Twitch app scopes already include the required follow and subscription read scopes for the intended preflights. Existing user tokens may still be missing newly added scopes and need reconnect/scope-upgrade handling. Kick does not expose a current app OAuth scope for viewer subscription preflight in this codebase; its robust path should use hidden-session status with unknown fallback.
- Doc updates: none.
- Flags: Decide how the popup should behave when an existing Twitch token is missing required scopes.

### Q5 — Missing Twitch scopes
- Asked: If an existing Twitch login is missing `user:read:follows` or `user:read:subscriptions`, should chat reconnect, send anyway, or force reconnect when chat opens.
- Captured: Show a blocker with a "Reconnect Twitch" action on the affected send attempt. Users can keep typing; passive watching is not interrupted.
- Doc updates: none.
- Flags: none.

### Q6 — Twitch verified-chat detection
- Asked: How StreamFusion should learn that the viewer is blocked by Twitch phone/email verified chat.
- Captured: User asked whether StreamFusion can combine failed-send detection with account preflight. Recommended framing is a hybrid: preflight exposed account facts where reliable, but failed-send Twitch verification rejections remain authoritative because phone verification and channel-specific verification policy are not fully exposed through current chat state.
- Doc updates: none.
- Flags: Decide which account preflight facts are allowed to produce a blocker versus only a warning/hint.

### Q7 — Verified preflight blocking
- Asked: Whether Twitch verified-chat preflight should hard-block before send, partially block for email, or only hard-block after server rejection.
- Captured: Only Twitch server/send rejection hard-blocks verified chat. Preflight may improve copy but must not prevent the send attempt.
- Doc updates: none.
- Flags: none.

### Q8 — Popup copy style
- Asked: Whether popup copy should be plain/action-first, more explanatory, or closer to platform wording.
- Captured: Use wording closer to Twitch/Kick platform wording where possible.
- Doc updates: none.
- Flags: none.

### Q9 — Slow mode timer
- Asked: Whether slow mode should track a local cooldown, only display and let the server reject, or disable the Chat button during cooldown.
- Captured: Use a hybrid of local cooldown and server rejection. After a successful send, locally block only this viewer's next send until the known slow-mode interval expires. Keep showing the active slow-mode banner. If Twitch/Kick rejects an early send, update the popup from the server rejection.
- Doc updates: none.
- Flags: none.

### Q10 — Draft retention on blocked send
- Asked: What should happen to the draft when a send is blocked.
- Captured: Keep the draft and focus the input. Blockers do not clear the message.
- Doc updates: none.
- Flags: none.

### Q11 — External action targets
- Asked: Where blocker popup actions should send the user.
- Captured: Use platform pages with the most specific stable URL available. Twitch follow/sub blockers open the channel or a reliable subscribe URL; Kick opens the channel page; Twitch verification opens account/security/help where stable. Fall back to channel page when a specific URL is brittle.
- Doc updates: none.
- Flags: none.

### Q12 — Role bypasses
- Asked: Should StreamFusion account for roles that bypass restrictions, like broadcaster, moderator, VIP, and subscriber.
- Captured: Use known role bypasses to avoid false pre-blocking. If role state is unknown, do not block preflight solely on that unknown; let the platform/server rejection decide.
- Doc updates: none.
- Flags: none.

### Q13 — Close the grill
- Asked: Whether to close the grill and write a PRD, keep grilling edge cases, or pause.
- Captured: Close the grill and write the PRD.
- Doc updates: `prd.md` added in this session folder.
- Flags: none.

## Open flags (pending input)
- Chat docs drift: `apps/desktop/src/components/chat/AGENTS.md` says "No Send button", but `ChatInput.tsx` already renders a footer `Chat` button -> maintainer.
