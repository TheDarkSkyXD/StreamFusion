# Twitch EventSub/mod-log attribution enrichment follow-up
Status: done
Type: HITL

## Parent

`.scratch/grill-with-docs/2026-06-29-deleted-message-moderation-chat/prd.md`

## What to build

Investigate whether Twitch EventSub/mod-log data can reliably enrich live chat deleted-message, timeout, and ban rows with moderator attribution. The investigation must validate whether enrichment can correlate EventSub/mod-log records to live chat rows without races, duplicates, stale attribution, or visible flicker. If the correlation is reliable, implement the enrichment. If it is not reliable, document the limitation and keep the live-payload unknown-moderator fallback.

## Acceptance criteria

- [x] The investigation identifies the available Twitch EventSub/mod-log fields for delete, timeout, and ban attribution.
- [x] The investigation proves whether those records can be correlated to live chat rows safely.
- [x] If safe, Twitch deleted-message, timeout, and ban rows enrich from EventSub/mod-log moderator attribution. N/A - correlation is not safe enough for this slice.
- [x] If unsafe, the issue records why enrichment is not implemented and preserves the unknown-moderator fallback.
- [x] Tests or proof artifacts cover the chosen outcome, including race/duplicate handling if enrichment is implemented.

## Blocked by

- `.scratch/grill-with-docs/2026-06-29-deleted-message-moderation-chat/issues/01-deleted-message-display-dropdown.md`

## Comments

- Outcome: do not implement Twitch attribution enrichment in this slice.
- Twitch IRC `CLEARMSG` gives StreamFusion the target message id and deletion timestamp path used for Frosty-style local retention, but not the moderator username. The implemented UI therefore shows retained content with `unknown moderator` for Twitch direct deletes.
- Twitch EventSub has moderator-attributed moderation event families, but correlating a separate moderation/mod-log event stream back onto an already-rendered live chat row would need async matching by channel/user/message/time. That can race the IRC delete, duplicate visible updates, or assign stale attribution when multiple moderation actions land close together.
- Evidence: Twitch EventSub subscription-type docs describe chat/moderation event payloads separately from the live chat row lifecycle: https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/
- Tests/proof: focused regression tests cover the chosen fallback path through `ChatMessage`, `TwitchChat`, `KickChat`, `chat-store`, Settings, and Chat Sim.
