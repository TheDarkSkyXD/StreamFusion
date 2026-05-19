---
date: 2026-05-18
topic: viewer-prediction-widget
---

# Viewer Prediction Widget — Per-Platform Native Parity, Voting From StreamForge, Real-Time Start Detection

## Summary

Add a viewer-facing prediction widget to chat on both Twitch and Kick channels in StreamForge. The widget renders three states — collapsed banner above chat input → expanded detail panel → ended-state recap — appears the instant a prediction starts on the channel, and lets the viewer cast a vote (channel points on Twitch, KCP on Kick) from inside the app. Per-platform native styling by default (Twitch purple with bubble visualization, Kick green/pink dot pairing), with a unified StreamForge style available as an opt-in settings toggle. Ships alongside debug-panel parity: prediction-injection helpers (live + ended) for both platforms, plus the missing Twitch poll-injection helpers that mirror Kick's existing pair.

---

## Problem Frame

Predictions are a first-class engagement surface on both Twitch and Kick — viewers see a prominent banner above chat the moment a streamer starts one, expand to see who's winning and how points are flowing, and place a vote without leaving the page. In StreamForge today, that surface is invisible. The only prediction-aware code is `apps/desktop/src/components/chat/mod/tabs/EngagementPredictions.tsx`, a broadcaster-only console for *creating* predictions on the user's own Twitch channel via Helix polling. Viewers watching anyone else's stream — on either platform — see no indication that a prediction is even happening, can't track it, and can't vote without switching to twitch.tv or kick.com.

The asymmetry hurts both directions. Twitch viewers lose the bubble-chart payoff that's part of the platform's native experience. Kick viewers lose the green-vs-pink dot tally that's a recognizable Kick signature. And StreamForge — which exists specifically so users don't have to context-switch between platform tabs — silently fails the moment any kind of audience engagement starts.

The dev experience has the same gap. `ChatSimTool` already lets a developer inject a synthetic Kick poll (live or ended) to verify the production banner renders correctly, but the equivalent injection paths for Twitch polls and for predictions on either platform don't exist. Building the prediction widget without closing those dev-tooling gaps would force visual testing through a live broadcast.

---

## Actors

- A1. Viewer: signed-in StreamForge user watching a Twitch or Kick stream. Sees the prediction banner when one becomes active, may cast a vote, sees the resolved result. Not a moderator on that channel.
- A2. Broadcaster (acting as viewer): user whose own channel has the prediction. Sees the same viewer widget on their own stream. Separate from their broadcaster console (the existing Engagement tab), which they reach via `/mod`.
- A3. Moderator (acting as viewer): mod on the channel being watched. Same widget, same capabilities as A1 from the widget's perspective — moderation actions on predictions live in the broadcaster console, not the viewer widget.

---

## Key Flows

- F1. Prediction starts on the active channel
  - **Trigger:** Broadcaster (out-of-band) starts a prediction. Real-time event arrives over Kick Pusher socket or Twitch PubSub.
  - **Actors:** A1, A2, A3
  - **Steps:** Widget receives a synthetic `predictionUpdate` event from the chat service; collapsed banner appears above chat input with title, two-option vote tally summary, and a "Predict" / "See Details" affordance.
  - **Outcome:** Banner is visible on the current slot's chat. Banner shows live tally updates as new viewer votes arrive.
  - **Covered by:** R1, R2, R12, R13

- F2. Viewer expands to see details
  - **Trigger:** Viewer clicks "Predict" (Kick) or "See Details" (Twitch) on the collapsed banner.
  - **Actors:** A1, A2, A3
  - **Steps:** Expanded panel replaces or overlays chat content in the slot. Shows title, total points contributed, all outcomes with per-outcome point/voter counts, payout odds, and (if viewer has already voted) their selected outcome highlighted.
  - **Outcome:** Detail panel is visible; viewer can return to chat via a back / close affordance.
  - **Covered by:** R3, R4, R5, R14

- F3. Viewer casts a vote
  - **Trigger:** Viewer selects an outcome in the expanded panel.
  - **Actors:** A1, A2, A3
  - **Steps:** Vote-amount control appears (point stake selector). Viewer's current channel-points (Twitch) or KCP (Kick) balance is shown. On submit, the vote is sent via Twitch GQL `MakePrediction` mutation or Kick's internal vote endpoint. Pending state is shown until the server acknowledges.
  - **Outcome:** On success, viewer's selection is highlighted; balance ticks down. On failure (insufficient balance, outcome locked, network error), an inline error explains why and the viewer can retry.
  - **Covered by:** R6, R7, R8, R9, R10, R11

- F4. Prediction resolves
  - **Trigger:** Broadcaster resolves (winner picked) or cancels the prediction. Real-time event arrives.
  - **Actors:** A1, A2, A3
  - **Steps:** Widget swaps to ended state. Resolved: shows winning outcome, final percentages, per-outcome payouts (Twitch shows top-contributor language, Kick shows "X go to user and N others"). Canceled: shows refund language. Ended state persists briefly (target ~60s, matches native windows), then auto-dismisses.
  - **Outcome:** Banner / panel disappears, returning the slot to its pre-prediction layout.
  - **Covered by:** R15, R16, R17, R30

---

## Requirements

**Banner / collapsed state**

- R1. A viewer-facing prediction banner SHALL render at the top of the chat area on Twitch and Kick chat slots when a prediction is active on that slot's channel. The banner SHALL be visually inset (not edge-to-edge), positioned above chat content and above the chat input.
- R2. The collapsed banner SHALL show: prediction title (truncated with ellipsis if needed), a compact two-outcome tally summary (point totals or percentages), and a primary affordance whose label matches the platform's native wording — **See Details** on Twitch, **Predict** on Kick.

**Expanded panel / detail view**

- R3. Tapping the primary affordance SHALL open an expanded detail panel that replaces or overlays chat content within that slot. A back / close control SHALL return the viewer to chat with the banner still visible.
- R4. The expanded panel SHALL display: title, total points / KCP contributed across all outcomes, all outcomes with per-outcome totals + voter count + payout odds (e.g. `1:1.9`), and the viewer's own pick if already voted.
- R5. When in **Twitch-native** style, the panel SHALL include a bubble-chart visualization of the active outcome leader's share (matching the Twitch.tv "X%" big-number + bubble cluster shown in native UI). The Kick-native and Unified styles SHALL omit the bubble chart and use a simpler bar / dot pairing.

**Voting**

- R6. From the expanded panel, the viewer SHALL be able to select an outcome and submit a vote without leaving StreamForge.
- R7. Before vote submission, the viewer's current spendable balance — channel points on Twitch, KCP on Kick — SHALL be visible alongside the vote-amount control.
- R8. Vote submission SHALL go through the platform's existing internal API surface: Twitch GQL (`MakePrediction` mutation, same auth context as the existing pin / search GQL traffic), Kick internal vote endpoint (same cookie-session pattern as `kick-mod-mutations.ts`).
- R9. When the viewer has already voted on this prediction (per the platform API's self-state field), their selected outcome SHALL be visually highlighted and the vote-submit control SHALL be hidden or disabled.
- R10. When a vote fails, an inline error message SHALL explain why. At minimum the widget SHALL distinguish: insufficient balance, outcome already locked, network failure. The viewer SHALL be able to retry without re-entering the expanded panel.
- R11. Vote submission SHALL show a pending state (button disabled, spinner or equivalent) between submit and server acknowledgment.

**Real-time event flow**

- R12. On Kick, prediction start / progress / lock / resolve / cancel events SHALL arrive over the existing Pusher socket subscribed by `apps/desktop/src/backend/services/chat/kick-chat.ts`. The widget SHALL react to `predictionUpdate`-style events emitted by `kickChatService` (parallel to the existing `pollUpdate` pattern).
- R13. On Twitch, prediction events SHALL arrive in real time via PubSub (`predictions-channel-v1.{channel_id}`), with GQL polling as a fallback path activated when PubSub is unavailable or has been sunset by Twitch. The widget SHALL react to `predictionUpdate`-style events emitted by a Twitch chat service in the same shape as Kick's emit pattern, so production and dev-injection paths converge.
- R14. On chat reconnect / channel switch / slot mount, the widget SHALL bootstrap state with a one-shot query for the channel's current prediction (a missed real-time event MUST NOT leave the banner empty when a prediction is in fact active).

**Ended state / resolution**

- R15. When a prediction is resolved, the widget SHALL swap to a resolved view that surfaces: the winning outcome with a clear "Winner" indicator, final percentages, and per-outcome final point / KCP totals.
- R16. The Twitch-native ended view SHALL include the "X points go to user and N others" payout line shown in Twitch's native ended panel, with per-outcome payout / voter / top-contribution stats. The Kick-native ended view SHALL match Kick's narrower ended summary.
- R17. The resolved state SHALL auto-dismiss after each platform's native display window — Twitch's resolved-prediction-card window on Twitch channels, Kick's on Kick channels. A canceled prediction SHALL surface refund language and auto-dismiss on the same per-platform window. Exact second counts are a planning-time lookup against current native behavior.

**Platform-native styling**

- R18. The Twitch-native style SHALL use `#9146ff` purple as the primary color, the bubble visualization (R5), and Twitch's native wording: "points," "See Details," "Winner."
- R19. The Kick-native style SHALL use Kick's green (`#53fc18`) and pink color pairing on the dual outcomes, the dot-tally visualization, and Kick's native wording: "KCP," "Predict."

**Unified StreamForge style (settings toggle)**

- R20. A unified StreamForge style SHALL be available as an alternative to the platform-native styles, selectable from a settings toggle. Default value is **native**.
- R21. The unified style SHALL use the existing `storm-accent` token (`#dc143c`) as primary, with consistent typography and spacing across both platforms. It SHALL preserve all three states (collapsed → expanded → ended).
- R22. The unified style SHALL operate on a normalized prediction model that abstracts both platforms' shapes — Twitch's `{ id, title, status, outcomes: [{ id, title, color, channel_points, users, top_predictors }], winning_outcome_id }` and Kick's `{ id, title, status, options: [{ id, label, total_amount, user_count }], winner_option_id }` reduce to a single component-internal shape. The normalization SHALL happen at the chat-service / platform boundary, not inside the widget.

**Settings**

- R23. A new dedicated **Predictions** section SHALL be added to app Settings, hosting the style toggle (R20). The setting SHALL persist across app launches.
- R24. Changing the setting SHALL re-render any active prediction widget without requiring a chat reconnect or channel switch.

**Multistream**

- R25. Each multistream chat slot SHALL show only its own channel's prediction. Prediction state SHALL NOT leak between slots even when multiple slots display the same channel.
- R26. Voting from a slot SHALL target the channel of *that slot*. The user's mod / auth context for voting SHALL be the per-channel auth used by the rest of that slot.
- R27. Dismiss / collapse state of the panel (where applicable) SHALL be per-slot.

**Dev tooling**

- R28. `apps/desktop/src/components/dev/ChatSimTool.tsx` SHALL gain a prediction-injection section with at minimum four buttons: **prediction (live)** and **prediction (ended)** for each platform (Twitch + Kick). Each button SHALL inject a synthetic event through the same chat-service emit point the production real-time path uses (parallel to the existing `kickChatService.emit("pollUpdate", ...)` pattern at lines 348 and 363).
- R29. The same dev section SHALL fill in the missing Twitch poll-injection pair — **poll (live)** and **poll (ended)** — that mirror the existing Kick poll-injection buttons (`injectPollKick` / `injectPollEndedKick`). Buttons SHALL be disabled when not viewing a channel of the relevant platform, matching the existing disabled-when-not-Kick pattern.

**Cleanup / lifecycle**

- R30. When the active channel changes (user navigates to a different stream), any active prediction widget for the prior channel SHALL be torn down before the new channel's bootstrap query (R14) fires.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R12, R18, R19.** Given a viewer is watching a Twitch channel in single-stream view, when the broadcaster starts a prediction on that channel via twitch.tv, then within ~1 second a `#9146ff` purple banner appears above chat input with the prediction title, a two-outcome tally summary, and a "See Details" button. Given the same scenario on a Kick channel, the equivalent banner uses Kick's green / pink dot pairing and a "Predict" button.
- AE2. **Covers R5, R18.** Given the viewer is in Twitch-native style and a prediction has ≥2 outcomes, when they tap "See Details", then the expanded panel shows a big-number percentage for the leading outcome with a bubble cluster visualization above an Options list with rank badges, point totals, and payout odds — matching the Twitch.tv native panel screenshot.
- AE3. **Covers R6, R7, R8, R10, R11.** Given a viewer with 500 channel points has expanded an active Twitch prediction, when they pick an outcome and attempt to stake 1000 points, then the submit control shows an "Insufficient channel points" inline error and does not call the API. When they reduce the stake to 250 and submit, the submit control enters a pending state, the GQL `MakePrediction` mutation fires, on success their pick is highlighted and the displayed balance decreases by 250.
- AE4. **Covers R9.** Given a viewer has already voted 100 KCP on outcome A of a Kick prediction earlier in the session, when they reopen the expanded panel, then outcome A is highlighted as their pick, no vote-submit control is offered for other outcomes, and the balance display omits the stake control.
- AE5. **Covers R13, R14.** Given a Twitch prediction has been active for 8 minutes by the time the viewer opens the channel in StreamForge, when the chat slot mounts, then the banner appears populated (point totals, current leader) within a reasonable bootstrap window without waiting for the next live PubSub event.
- AE6. **Covers R15, R16, R17.** Given an active Twitch prediction resolves in favor of outcome 1, when the resolved event arrives, then the widget swaps to the ended view showing a Winner badge on outcome 1, both outcomes' final percentages, the per-side stat block (point total / payout / voter count / top contribution), and the "X points go to user and N others" payout line. After Twitch's native ended-card display window the ended view auto-dismisses. The same scenario on a Kick channel uses Kick's native ended-display window.
- AE7. **Covers R20, R21, R22, R24.** Given the user has toggled the prediction style setting to "unified" and a prediction is active on a Kick channel, when the user views the banner, then it uses storm-accent (`#dc143c`) coloring with the same collapsed → expanded → ended state shapes; switching the setting back to "native" while the widget is open re-renders it to the green / pink Kick style without dropping or reconnecting the chat.
- AE8. **Covers R25, R26.** Given a multistream view with two slots — slot 1 on a Twitch channel with an active prediction, slot 2 on a Kick channel with an active prediction — when the viewer votes 50 channel points on slot 1, then only slot 1's widget updates and only the Twitch GQL mutation fires; slot 2 is unaffected and Kick's vote endpoint is not called.
- AE9. **Covers R28.** Given a developer has the debug panel open and is viewing a Twitch channel with no active prediction, when they click **prediction (live)** in the Twitch row of `ChatSimTool`, then the production Twitch prediction banner renders with the simulator's synthetic title and outcomes — using the same code path a real PubSub event would trigger — and clicking **prediction (ended)** swaps the widget to the resolved state.
- AE10. **Covers R29.** Given the same dev session on a Twitch channel, when the developer clicks **poll (live)** in the Twitch row, then the production Twitch poll banner renders with the simulator's synthetic data — closing the asymmetry where this affordance previously existed only for Kick.

---

## Success Criteria

- A viewer watching any Twitch or Kick stream in StreamForge sees an active prediction within ~1 second of it starting, can read its state without leaving the app, and can place a vote that registers on the platform's records — for both single-stream and multistream views.
- The Twitch and Kick widgets are visually recognizable as their respective platform's native experience (purple bubbles for Twitch, green / pink dots for Kick) when the style setting is "native," and become a single consistent StreamForge style when set to "unified."
- A developer can reproduce all three widget states (active, voted, ended) on either platform without needing a live broadcaster, by clicking buttons in `ChatSimTool`. The same dev path also covers Twitch polls, removing the existing Kick-only asymmetry.
- A downstream `ce-plan` agent reading this doc can identify which existing files to extend (`KickChat.tsx`, `TwitchChat.tsx`, `kick-chat.ts`, `twitch-gql-client.ts`, `ChatSimTool.tsx`), which API surfaces are in scope (PubSub on Twitch, Pusher events on Kick, GQL mutation on Twitch, internal vote endpoint on Kick), and which boundaries hold (broadcaster Engagement tab unchanged, no history scrollback, no system notifications).

---

## Scope Boundaries

- Prediction history / scrollback is out of scope. Only the most recent active or just-resolved prediction is shown; once the ended state auto-dismisses, the widget disappears.
- The existing broadcaster Engagement tab (`apps/desktop/src/components/chat/mod/tabs/EngagementPredictions.tsx`) is not refactored in this work. It stays Helix-polled with the create / lock / cancel / resolve controls it already has. The viewer widget is a separate component tree.
- No OS-level / system notification when a prediction starts. The in-app banner is the only surfacing.
- No multi-channel aggregate prediction view (e.g. "all predictions across all my followed channels"). Single channel per slot only.
- No support for prediction *creation* from the viewer widget. Starting / locking / resolving / canceling is broadcaster-only and lives in the existing Engagement tab.
- No custom flow for predictions that lock automatically after a duration vs ones the broadcaster locks manually. Both look identical from the viewer's side, which matches native behavior.
- No mobile / responsive layout work — desktop Electron only.
- AutoMod, Streamlabs, and giveaway-adjacent engagement features remain out per the 2026-05-18 channel-mgmt scope change.

---

## Key Decisions

- **Per-platform native parity as the default, unified style as a settings opt-in (R18-R21):** The user weighed three options (unified-only, native-only, both with toggle) and picked all three styles with native as the default. Rationale: viewers familiar with twitch.tv or kick.com pattern-match faster against their native UI; the unified option exists for users who prefer cross-platform consistency over platform faithfulness.
- **Voting included on both platforms (R6-R11):** Same internal-API risk class already accepted in this codebase (Twitch GQL is used for pins via `twitch-gql-pin-mutations.ts` and for search; Kick's informal API surface is used across `kick-mod-mutations.ts` and `kick-pin-mutations.ts`). Adding `MakePrediction` and the Kick vote endpoint does not introduce a new architectural risk category. Read-only fallback was considered and rejected — it would have made the unified-style toggle hard to justify since the platform styles could then be mostly CSS swaps.
- **PubSub on Twitch with GQL polling fallback (R13):** PubSub gives sub-second latency for viewers on channels they don't broadcast (the only Twitch path that works for viewers in real time without broadcaster-scope EventSub). Twitch has announced PubSub sunset, but it remains the path every comparable third-party client uses today. The GQL polling fallback is the future-proof path activated when PubSub is unreachable.
- **Real-time events flow through chat-service `emit` points, not direct widget polling (R12, R13, R28):** Producing the same emit-point pattern Kick already uses for poll updates means the production widget and the `ChatSimTool` dev injection converge on a single subscription path. Without this, dev-injection would need a parallel mock-data path that doesn't match production behavior.
- **Dev-tooling parity bundled with feature work (R28, R29):** The user explicitly added this scope mid-brainstorm after noticing the missing Twitch poll-injection buttons. Folding both kinds of injection (predictions live + ended for both platforms, plus the missing Twitch polls) into one body of work keeps the test surface in step with the production surface from day one.
- **Dedicated Predictions section in Settings (R23):** A standalone section rather than nesting under Appearance or a broader Engagement umbrella. Tightest naming; can grow later if predictions accrue more settings.
- **Ended-state window matches each platform exactly (R17):** Per-platform native duration rather than a flat ~60s. Preserves the native-parity intent (a Twitch viewer's muscle memory for how long the recap stays around stays correct). Exact second counts deferred to planning for verification.

---

## Dependencies / Assumptions

- The Kick chat service (`apps/desktop/src/backend/services/chat/kick-chat.ts`) already maintains the Pusher socket connection that prediction events would ride. Adding a `predictionUpdate` event type follows the existing `pollUpdate` pattern. **Assumption (verify in planning):** Kick's Pusher event name and payload shape for predictions match the pattern the existing poll events use.
- A Twitch chat service emitter (parallel to `kickChatService`) is assumed to either exist or be a planning-time addition. The codebase has `twitch-gql-client.ts`, `twitch-eventsub-client.ts`, and `twitch-gql-pin-mutations.ts`, but a unified emit point for chat-adjacent events that the production widget and `ChatSimTool` could both subscribe to is **unverified**. Planning should confirm whether to extend an existing service or introduce one.
- Twitch's GQL `MakePrediction` mutation accepts the app's existing user OAuth token context (same one used for pin / search GQL). **Unverified assumption.**
- Kick's internal prediction-vote endpoint exists at a path consistent with how `kick-mod-mutations.ts` reaches Kick's other write surfaces. **Unverified assumption** — planning needs to confirm the actual endpoint and payload shape.
- PubSub `predictions-channel-v1.{channel_id}` topic is still available on Twitch as of doc date. **Unverified at this granularity** but consistent with public knowledge; planning should re-verify if the team has any internal signal about an imminent sunset date.
- The viewer's currently-cast prediction (self-state field) is exposed on both platforms' read responses. Used for R9 highlight behavior. **Unverified at field-name level** but consistent with native UI behavior.
- The existing multistream slot isolation (per the `2026-05-17-twitch-pinned-messages-requirements.md` pattern in R17-R20 of that doc) is the model used for prediction-state isolation between slots.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R17][Needs research] Exact per-platform ended-state display windows. Planning should observe twitch.tv and kick.com directly (or check reference clients) to land the actual second counts.

- [Affects R8, R10][Technical] Exact Twitch GQL `MakePrediction` mutation shape — operation name, persistedQuery hash (if any), expected error codes for outcome-locked / insufficient-balance / already-voted. Planning will fetch via inspection of twitch.tv network traffic or reference clients in `reference/`.
- [Affects R8, R10][Technical] Exact Kick prediction-vote endpoint URL and request shape. Planning should inspect kick.com network traffic or check the reference KickTalk source.
- [Affects R12, R13][Technical] Exact event names for prediction events on Kick Pusher and Twitch PubSub, plus payload field mappings. Planning to verify against live traffic.
- [Affects R7][Technical] Channel-points and KCP balance fetch endpoints. May be already cached elsewhere in app state; planning to check before adding a fresh fetch path.
- [Affects R22][Technical] Where the normalized prediction model lives (in `shared/`, in a new `unified/predictions.ts` under `backend/api/unified/`, or in the widget itself). Architecture-tier decision.
- [Affects R13][Needs research] Twitch PubSub sunset timeline as of mid-2026. If a near-term sunset is announced, the GQL fallback may need to ship simultaneously rather than as a follow-up.
- [Affects R5][Needs research] Does the Twitch bubble-chart visualization need to faithfully reproduce the animated bubble physics, or is a static cluster approximation acceptable? Visual-design call.
- [Affects R3][Technical] When the expanded panel opens, does it replace chat (push chat content out of view) or overlay chat (with a semi-transparent backdrop)? Twitch's native behavior is a replace; matching that is the default assumption but worth confirming during design.
