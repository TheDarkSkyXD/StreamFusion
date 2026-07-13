# Twitch first-party Chat Replay source proof

Observed on 2026-07-12 against Twitch's platform-owned web GraphQL endpoint,
`POST https://gql.twitch.tv/gql`, using the anonymous Client ID already used by
StreamFusion. No OAuth token, community archive, or locally recorded live chat was used.

The tested raw operation is `VideoCommentsByOffsetOrCursor`. Public Video and user
identifiers and all chat text were discarded after each probe. The committed JSON
fixtures preserve the observed response shape with synthetic redacted identifiers and
content.

## Observations

| Behavior | Observed response | Contract decision |
| --- | --- | --- |
| Video lookup and offset | A recent public Video requested at 60 seconds returned HTTP 200 and 59 comments spanning offsets 16-126. | Supported per Video; every normalized message retains `contentOffsetSeconds`. |
| Stable IDs | Two identical offset requests returned 59/59 comments with identical message IDs and offsets in order. | Use the Twitch comment ID as the stable replay-message ID. |
| Cursor pagination | The last cursor from page one returned 59 further comments spanning offsets 128-228 with no message-ID overlap. | Use the last edge cursor as `nextCursor` while `hasNextPage` is true. |
| Sender, badge, and content fidelity | Responses contained commenter ID/login/display name, badge ID/set/version, and ordered text/emote fragments. | Preserve those fields in the narrow normalized contract. |
| Authentication | Anonymous request: HTTP 200. The same request with a deliberately invalid OAuth header: HTTP 401. | Do not send `Authorization`; classify 401/403 as authentication failure. |
| Rate limit | Successful responses exposed no `Ratelimit-Limit`, `Ratelimit-Remaining`, `Ratelimit-Reset`, or `Retry-After` headers. A 429 was not intentionally induced. | The limit is undocumented/unknown. Classify HTTP 429 as rate-limited and honor numeric `Retry-After` when Twitch supplies it; callers must avoid unbounded prefetch. |
| Deletions | Across 118 comments on two pages, no null commenter or empty-fragment tombstone appeared. A schema probe for `VideoComment.deletedAt` returned HTTP 200 with `Cannot query field "deletedAt" on type "VideoComment".` | The source does not expose deletion events or tombstones. Deleted/removed comments are therefore absent, not representable as a replay state. Do not synthesize deletion markers. |
| Empty | An offset beyond the Video duration returned zero comments plus an in-band `service error`. | A clean zero-edge response is `empty`; an in-band source error without comments is retryable, not empty. |
| Unsupported | A nonexistent Video ID returned HTTP 200 with `data.video: null`. | Classify as `unsupported` with `video-not-found`; do not render unfinished UI. |
| Transient failure | An older public Video returned HTTP 200 with the matching Video ID, null comments, and in-band `service error`. | Classify as `transient-failure`; HTTP 5xx is also transient. |

## Capability decision

**Supported, capability-gated:** Twitch can supply historical Chat Replay messages by
Video, playback offset, and cursor through its first-party web GraphQL endpoint. The
source is internal and undocumented, so it must remain behind the replaceable contract
in `twitch-chat-replay-source.ts` and be disabled per Video when the response is
unsupported or structurally invalid.

This proof does not register IPC, preload, renderer state, or UI. It does not establish
Kick support. It does not claim deletion-event support or a known request quota.

## Executable evidence

- `apps/desktop/tests/backend/api/platforms/twitch/fixtures/chat-replay-*.json` contains
  redacted, synthetic-content fixtures matching the observed response shapes.
- `apps/desktop/tests/backend/api/platforms/twitch/twitch-chat-replay-source.test.ts`
  pins lookup, offsets, pagination, fidelity, capability outcomes, anonymous request
  shape, and transport failure classification.

