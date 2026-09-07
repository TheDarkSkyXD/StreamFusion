# Mod View backend/shared completion

Implemented the backend/shared increment; no live messages or moderation actions were performed.

- `shared/moderation-types.ts`: normalized schemas/DTOs for Shield, AutoMod settings, blocked terms, chatters, active moderators, rewards/redemptions, suspicious decisions and typed bounded-feed events. Existing Twitch execute/EventSub preload entrypoints remain the only renderer bridge.
- Added actor/scoped commands: get-shield-mode; get/update-automod-settings; get/add/remove-blocked-term; get-chatters; get-active-moderators; get-manageable-rewards; get-reward-redemptions; update-reward-redemption; set-suspicious-user-status.
- Main lease validates current Twitch token subject/scopes, checks requested actor, rechecks the account around provider requests, and subscribes to credential changes. Feed restart validates a rotated grant; a different account cannot restore the old channel feed. Renderer-owner feed IDs and window cleanup prevent cross-window stop/disposal mistakes. Pending starts are cancellable, the feed map caps at 64, and dedupe retains at most 512 event IDs per feed.
- Explicit EventSub catalog covers legacy moderate/AutoMod/online/offline plus follow, subscriptions/gifts/messages, cheers, inbound raids, suspicious message/update, whispers, redemption add/update. Follow uses v2; raid and whisper notifications now route through their actual condition fields. Legacy moderate/AutoMod payloads remain unchanged; new events are normalized before crossing IPC.
- Reward decisions verify broadcaster subject, manage:redemptions and app-manageable reward ID, then require matching provider confirmation. Suspicious status decisions use ID-based POST/DELETE with confirmed response. Corrected legacy slash POST field from `low_trust_status` to documented `status` and updated its existing regression assertion.
- All additions remain under feature responsibility roots except shared DTOs, cross-feature provider EventSub transport/catalog and preload declarations. The auth repository owns credential-change observation.

Verification:
- Six focused files passed 92 tests; added transport-level follow/raid/whisper proof then reran affected two files: 54 tests passed (combined current focused set: 93).
- Focused ESLint passed for all edited production/new-test paths before the final transport-only test addition; final changed file was formatted.
- Feature layout and 19 ESLint boundary proofs passed.
- Full desktop `tsc --noEmit`: no backend/shared diagnostics. Active frontend panel/i18n/test errors remained at run time; saved `.scratch/feature-migration/mod-view-backend-typecheck.log`. Root/other agents own those active files.

Limits deliberately preserved: activity/whispers/suspicious feeds cover received events only, with coverageStartedAt; no old inbox or Twitch history claim. Membership is a delayed provider snapshot. Active-mod output intersects the current chatter page with a bounded authorized roster and reports rosterComplete; it is not an exhaustive presence assertion. Reward history and decisions cover app-created rewards only; broader reward events are observable but do not confer decision authority. No remote provider mutation was used for testing.

Official references checked: [Helix reference](https://dev.twitch.tv/docs/api/reference/), [EventSub subscription types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/). Existing AutoMod policy update follows PUT semantics: caller must send all desired category fields; overall_level and category levels are mutually exclusive. Read permissions accept documented read/manage alternatives.

Terminal EventSub rejections stay feed-local and are not overwritten by global socket state. Explicit restart cleans up the old feed before subscribing. Shared transport retains its existing rejection quarantine while another consumer still owns the same rejected subscription pair; reconnecting with updated credentials revalidates grants, and normal last-consumer teardown removes the quarantined pair.
