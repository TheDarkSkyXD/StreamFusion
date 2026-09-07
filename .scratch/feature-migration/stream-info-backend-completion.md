# Edit Stream Info backend completion

Implemented `get-stream-info` and `update-stream-info` through the existing typed Twitch API bridge. Both require a validated current broadcaster lease and `channel:manage:broadcast`; the guarded transport checks account currency before and after each request.

Shared exports in `src/shared/moderation-types.ts`: `StreamInfo`, `StreamInfoUpdate`, `streamInfoSchema`, `streamInfoUpdateSchema`, `streamInfoUpdateResultSchema`, `EDITABLE_CONTENT_CLASSIFICATION_LABELS`.

Read returns title, category ID/name, language, tags, current classification labels, and the provider catalog filtered to the six editable labels. Twitch-managed labels remain visible in the current-label list. Partial updates preserve absent fields; explicit empty category/tags and disabled labels retain clear semantics. A successful update returns `{updated:true}` after PATCH 204; the frontend must reload before displaying current values. Category names are read-only; updates use category IDs. Native go-live notification and rerun fields are rejected by the strict request schema.

Official contracts verified: [Get Channel Information](https://dev.twitch.tv/docs/api/reference/#get-channel-information), [Modify Channel Information](https://dev.twitch.tv/docs/api/reference/#modify-channel-information), [Get Content Classification Labels](https://dev.twitch.tv/docs/api/reference/#get-content-classification-labels).

Validation: 54 tests passed across stream-info (7 new), Mod View contracts, OAuth config, and Twitch IPC handlers. Tests cover denied actors/grants without HTTP, stale account response rejection, exact channel selection, editable catalog filtering, partial PATCH mapping including clears, invalid success payloads, and strict field bounds/native-only rejection. Scoped ESLint and feature architecture checks (19 boundary proofs) passed. Full TypeScript reports only the ongoing frontend translation catalog mismatch; saved in `stream-info-typecheck.log`. Canonical OAuth expectations now include the shipped Mod View scopes, preserving unused chat-read denial.

Activity feed audit: the current six categories omit Hype Train v2, charity donations, Bits Power-ups (`channel.bits.use` v1), shoutouts, and ad breaks. Goal/poll/prediction lifecycle notifications also exist. [Official EventSub catalog](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/). Root was notified; no extra event types or scopes were added. No live channel updates or remote messages were performed.
