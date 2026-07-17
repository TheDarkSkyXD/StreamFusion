# Issue 01 evidence — Category Clip discovery

Observed: 2026-07-16 20:25 CDT (`America/Chicago`)

## Decision

**BLOCKED — the Category Clips tab does not pass the cross-Platform parity gate.**

Both Platforms have an anonymous, native Category Clip surface and both were observed returning Clips from offline Channels. That is not enough to ship the contract:

- Twitch's anonymous Category GQL connection provides globally ordered `Views` pages for all four required ranges, but the same current resolver returns a GraphQL `server error` for `CREATED_AT_DESC` (`Most Recent`). The official Helix Category path also only promises descending View Count, requires an app or user token, and caps multi-request results at approximately 1,000.
- Kick's anonymous legacy Category route accepts both sorts and all four ranges, but consecutive `Views` pages contained 2–15 duplicate IDs and crossed the page boundary out of order. Consecutive `date` pages contained 15–16 publication-time ordering violations. A malformed cursor can silently restart page one, and the route has no official stability or rate-limit contract.

Therefore neither Platform proves the complete required contract, and the combined track fails the agreed parity rule. Do not implement Issues 04, 06, or 08 as a one-Platform feed, a live-Channel fan-out, or a client-sorted approximation.

No access token, cookie, playback URL, manifest body, media signature, or playback credential was captured in this evidence.

## Sources and current local surfaces

- Twitch official Get Clips reference: <https://dev.twitch.tv/docs/api/reference/#get-clips>. It defines native `game_id`, `started_at` / `ended_at`, cursor pagination, app-or-user-token authorization, descending View Count order, and an approximately 1,000-result multi-request ceiling.
- Twitch Clips guide: <https://dev.twitch.tv/docs/api/clips/>.
- Twitch API concepts: <https://dev.twitch.tv/docs/api/guide/>. This is the official token-bucket and `Ratelimit-*` header contract for Helix, not for anonymous web GQL.
- Kick official OpenAPI JSON: <https://api.kick.com/swagger/doc.json>. The observed document was 127,356 characters with SHA-256 `a6f78719f8c46038df7aeeceda9652421244ef4c23b94ed4192383813e3beca1`; its 25 paths contain zero Clip/Video/VOD routes. Its Category paths are `/public/v1/categories`, `/public/v1/categories/{category_id}`, and `/public/v2/categories`.
- Kick's official documentation repository: <https://github.com/KickEngineering/KickDevDocs>.
- Kick's Category Clip route is therefore explicitly legacy/internal: `GET https://kick.com/api/v2/categories/{subcategorySlug}/clips`.
- Existing StreamFusion readers are Channel-scoped. Twitch calls `gqlGetClipsByChannel()` / `getClipsByBroadcaster()`; Kick calls `/api/v2/channels/{slug}/clips`. Neither is a valid substitute for the Category route.

The official sources establish supported contracts. The observations below establish current anonymous wire behavior from this machine and US region.

## Reproduction shape

All observation requests omitted `Authorization` and cookies.

Twitch used either its current `ClipsCards__Game` persisted query by native Category slug or the equivalent raw Category connection below. The Client ID was Twitch's public anonymous Android Client ID already used by StreamFusion, represented here as a placeholder rather than copied into the evidence:

```http
POST https://gql.twitch.tv/gql
Client-Id: <public-anonymous-client-id>
Content-Type: application/json
```

```graphql
query CategoryClips(
  $gameName: String!
  $limit: Int
  $cursor: Cursor
  $criteria: GameClipsInput
) {
  game(name: $gameName) {
    id
    name
    clips(first: $limit, after: $cursor, criteria: $criteria) {
      banners
      pageInfo { hasNextPage }
      edges {
        cursor
        node {
          id
          slug
          title
          viewCount
          createdAt
          durationSeconds
          thumbnailURL
          url
          embedURL
          isPublished
          creationState
          broadcaster { id login displayName }
          game { id name }
          curator { id login displayName }
        }
      }
    }
  }
}
```

Kick used browser-identification headers but no account state:

```http
GET https://kick.com/api/v2/categories/{subcategorySlug}/clips
    ?sort={view|date}&time={day|week|month|all}&cursor={optionalCursor}
Accept: application/json
Referer: https://kick.com/
User-Agent: <browser user agent>
```

Only sanitized counts, IDs used for equality checks, cursor behavior, timestamps, View Counts, field presence, and status/error classes were retained. Media URLs were deliberately excluded.

## Twitch observations

### Native signed-out discovery, population, and offline Channels

The current `ClipsCards__Game` persisted query accepted `categorySlug: "just-chatting"` without viewer auth and returned native Category ID `509658`, 20 Clip edges, `hasNextPage=true`, and cursor `MjA=`. The raw connection returned the same Category identity and allowed the explicit sort/range probes below. Every sampled Clip's `game.id` matched the requested native Category.

Representative signed-out results:

| Population | Native Category | Range | Rows | Termination |
|---|---|---|---:|---|
| Populated | `509658` — Just Chatting | Last Day / Week / Month / All Time | 20 each | cursor present, `hasNextPage=true` |
| Sparse | `18278` — Big Rigs: Over the Road Racing | Last Week | 1 | no cursor, `hasNextPage=false` |
| Empty | `18278` — Big Rigs: Over the Road Racing | Last Day | 0 | no cursor, `hasNextPage=false` |

Ten distinct Channels from the populated Category sample were queried directly for current Stream state. **Six were offline and four were live.** The Category connection therefore demonstrably includes offline Channels and is not derived from the current live Stream list.

### Views ordering and ranges

Two consecutive 20-row pages were fetched for each range with `sort: VIEWS_DESC`; page 2 used page 1's final returned cursor.

| Range | Page 1 | Page 2 | First → last View Count | Duplicates | Global order violations | Cursor progression |
|---|---:|---:|---:|---:|---:|---|
| Last Day | 20 | 20 | 8,042 → 546 | 0 | 0 | `MjA=` → `NDA=` |
| Last Week | 20 | 20 | 171,073 → 8,248 | 0 | 0 | `MjA=` → `NDA=` |
| Last Month | 20 | 20 | 256,638 → 31,095 | 0 | 0 | `MjA=` → `NDA=` |
| All Time | 20 | 20 | 5,777,358 → 760,383 | 0 | 0 | `MjA=` → `NDA=` |

The 40 sampled rows in every range were globally non-increasing by View Count, not merely sorted within each page. The samples covered 24–34 distinct Channels per range.

### Most Recent is not available as required

The current GQL schema recognizes the documented internal `ClipsSort` enum. `VIEWS_DESC` works. `CREATED_AT_DESC` is accepted as an enum value but the resolver returned HTTP 200 with GraphQL error `server error` for **Last Day, Last Week, Last Month, and All Time** when paired with `period`.

Using the older composite `filter` input with `CREATED_AT_DESC` did not create a recent feed: it returned the same View-sorted rows. The official Helix Get Clips endpoint cannot fill the gap because its documented Category and broadcaster lists are only descending by View Count; it exposes no recent sort.

This fails the required `Most Recent` behavior before any cross-Platform merge is considered.

### Cursor and identity behavior

- Normal Views cursors advanced deterministically in the sampled pages and produced no duplicates.
- Sparse and empty range results terminated with `hasNextPage=false` and no cursor.
- A malformed cursor (`not-a-real-cursor`) returned HTTP 200 with GraphQL `service error`, not a typed HTTP cursor error. It is a pagination-integrity failure; the caller must not append the response.
- Cursor expiry was not observable. It remains unproven and must not be treated as ordinary exhaustion.
- No unchanged or all-duplicate page occurred in the valid samples. Those states still require consumer-side termination guards because the GQL path supplies no stable pagination contract.

The 20-row metadata sample had no missing Clip ID, Channel ID/login, Category ID/name, publication time, duration, thumbnail, View Count, public Clip URL, or embed URL. All sampled rows were `isPublished=true` and `creationState=CREATED`. The connection carried `MAY_CONTAIN_MATURE_CONTENT` as a connection-level banner.

The result does **not** expose a per-row authoritative playability, region entitlement, subscriber-only, private/deleted/pruned reason, or playback restriction state. Public/embed URLs and `CREATED` are useful identity but are not proof that playback will succeed for the current viewer. Playback resolution must remain separate, and playback credentials must never be stored with list rows.

### Twitch completeness statement

Twitch proves anonymous native Category discovery, offline-Channel coverage, stable core identity, all four Views ranges, and two-page global Views order in the sampled region. Twitch does **not** prove the shippable contract because:

1. `Most Recent` currently fails in the anonymous Category resolver;
2. the supported Helix alternative is Views-only, token-authenticated, and capped at approximately 1,000 results over multiple requests;
3. anonymous web GQL is internal, has no published completeness, stability, or rate-limit guarantee; and
4. region/account/restriction/playability permutations remain unproven.

Twitch alone must therefore be treated as incomplete for this PRD, not as a feasible half of a partial release.

## Kick observations

### Native signed-out discovery, population, and offline Channels

The legacy Category route accepted a native subcategory slug and returned Category-wide Clips without viewer auth:

| Population | Native Category | Rows | Cursor |
|---|---|---:|---|
| Populated | `15` — Just Chatting | 20 | present |
| Sparse | `6866` — Laika: Aged Through Blood | 2 All Time, 0 Last Day | absent |
| Empty | `4611` — Disgaea: Hour of Darkness | 0 All Time | absent |

The populated sample was separate from the Fortnite Category sample: the two default pages had zero overlapping IDs and preserved their own top-level Category IDs.

Ten distinct Channels from a Just Chatting Views/Week sample were resolved through the public Channel route. **Eight were offline and two were live.** Kick's Category route also demonstrably covers offline Channels.

### Sorts, ranges, and multi-page ordering

Both query sorts and all four range values were accepted. Sparse-category controls showed that the range was active: Laika returned zero rows for Last Day and two January 2025 rows for All Time for both `view` and `date`.

However, consecutive populated pages failed the exact global-order contract.

`sort=view`:

| Range | Page 1 | Page 2 | Duplicate IDs across pages | Global View-order violations | Cursor advanced |
|---|---:|---:|---:|---:|---|
| Last Day | 19 | 20 | 8 | 1 | yes |
| Last Week | 20 | 20 | 5 | 1 | yes |
| Last Month | 20 | 19 | 2 | 1 | yes |
| All Time | 20 | 20 | 15 | 1 | yes |

`sort=date`:

| Range | Page 1 | Page 2 | Duplicate IDs | Global publication-time violations | Cursor advanced |
|---|---:|---:|---:|---:|---|
| Last Day | 20 | 20 | 0 | 15 | yes |
| Last Week | 20 | 20 | 0 | 15 | yes |
| Last Month | 20 | 20 | 0 | 16 | yes |
| All Time | 20 | 20 | 0 | 16 | yes |

These are observed upstream results using the returned `nextCursor`; they are not a client merge bug. Local deduplication would hide duplicates but cannot recover the omitted rows or prove exact global rank. Locally re-sorting fetched pages would likewise produce only an approximation of an unknown/incomplete upstream set.

### Cursor, identity, and restriction behavior

- Normal populated requests returned `nextCursor` as a Clip ID and advanced on the next request.
- Sparse and empty results terminated with no cursor.
- The arbitrary malformed cursor `not-a-real-cursor` returned HTTP 200 and a populated page, effectively behaving like an ignored/reset cursor.
- A structurally Clip-like nonexistent cursor returned HTTP 200 with an empty page. The endpoint does not distinguish malformed/expired cursors from true exhaustion.
- Valid page progression already produced 2–15 duplicate IDs. An all-duplicate page was not forced, but the observation makes a defensive all-duplicate stop mandatory.
- No `Retry-After` or rate-limit header was present in the sampled successful, empty, malformed-cursor, or 404 responses.

The raw response supplies Clip ID, top-level Category ID, Channel ID/slug/name, publication time, duration, thumbnail, View Count, `privacy`, `is_mature`, public Clip path, and media path. Nineteen of 20 sampled Channel blocks had an avatar; one did not. All sampled privacy values were `public`, and the Week/Views page contained five mature Clips.

There is a response-integrity inconsistency: the requested Just Chatting page kept top-level `category_id=15`, but nested `category.id` values included `15` and `445`. A production contract would have to define the top-level ID as authoritative and treat nested disagreement as upstream drift. The response still has no authoritative current-viewer region entitlement, subscriber-only state, deleted/private/pruned reason, or playability status.

### Kick completeness statement

Kick proves anonymous native Category discovery, offline-Channel coverage, both requested query sorts/ranges, and useful raw identity. Kick does **not** prove the shippable contract because valid pagination duplicates rows, violates both global sort orders, and does not safely classify malformed/expired cursors. The route is also absent from Kick's official API, has no published completeness/rate-limit/stability contract, and does not supply the required restriction/playability matrix.

The Category source is therefore not safe to normalize into an exact complete feed.

## Restriction and account-state matrix

| Case | Twitch | Kick | Contract status |
|---|---|---|---|
| Signed out | Native Category data observed | Native Category data observed | proven for current machine/region |
| Signed in / login or logout | Not exercised; GQL list is public | Not exercised; legacy list is public | unproven; invalidate account-sensitive queries |
| Current US region | Observed | Observed | proven only for this region |
| Other/limited region | Not exercised | Not exercised | unproven blocker |
| Mature | Connection-level mature banner observed | per-row `is_mature`; 5/20 in one sample | metadata observed, entitlement/playback not proven |
| Subscriber-only | no list field | no list field | unproven blocker |
| Deleted/private/pruned | absent from samples; no exclusion reason | sampled `privacy=public`; no exclusion reason | exclusion semantics unproven |
| Unplayable/processing | sampled Twitch rows were `CREATED`; no authoritative playability | no authoritative playability field | unproven blocker |

“Not returned” is not evidence of a reliable exclusion rule. These permutations were not fabricated with mocks and were not inferred from ordinary public rows.

## Error and retry classification

| Condition | Observed/source | Actionable classification |
|---|---|---|
| Twitch missing/invalid public Client ID | HTTP 400 | permanent client configuration; do not retry unchanged |
| Twitch recent sort | HTTP 200 + GraphQL `server error` for all ranges | unsupported/resolver failure; do not ship or silently fall back to Views |
| Twitch malformed cursor | HTTP 200 + GraphQL `service error` | pagination-integrity failure; stop append, explicit page-one refresh only |
| Twitch unknown Category | `game` resolves null | permanent/not-found |
| Twitch Helix no/invalid bearer token | official `401` contract | auth-required; obtain/refresh app token, not viewer login |
| Twitch Helix `429` | official token-bucket contract | rate-limited; honor `Ratelimit-Reset` with jitter |
| Twitch GQL `429` / limit | no published header or budget; none observed | uncontracted; bounded backoff cannot establish reliability |
| Kick unknown Category slug | HTTP 404 JSON | permanent/not-found |
| Kick arbitrary malformed cursor | HTTP 200 populated/reset-like page | pagination-integrity failure; never append as continuation |
| Kick nonexistent Clip-like cursor | HTTP 200 empty page | ambiguous expired/malformed/exhausted; stop and require explicit refresh |
| Kick legacy web security block | non-browser request path returned security-policy denial; browser-identification request succeeded | access/integrity enforcement; not an empty feed |
| Kick `429` / limit | no official route contract or response headers; none observed | uncontracted; cannot claim reliable retry timing |
| Either timeout/network/5xx | not intentionally forced against production | transient; bounded exponential backoff, retain explicit stale rows |

Production rate limits, region changes, account transitions, and forced upstream 5xx responses were deliberately not manufactured. Their absence is recorded as missing proof, not assumed success.

## Acceptance-criterion audit

| Criterion | Evidence status |
|---|---|
| Native Category discovery on both Platforms, not live-Channel fan-out | **proven** for sampled current upstreams; offline Channels directly observed on both |
| Signed-out populated, sparse, and empty Categories | **proven** for representative sampled Categories on both |
| `Most Recent`, `Views`, and all four ranges on both | **failed** — Twitch `Most Recent` returns resolver errors; Kick accepts controls but exact order fails |
| Globally correct multi-page order for every sort/range | **failed** — Twitch Views passed samples but recent is unavailable; Kick pages duplicate and reorder |
| Cursor progression/termination/malformed/expired/duplicate characterization | **failed as a shippable contract** — behavior is documented, but Kick malformed/expired semantics are ambiguous and valid pages overlap; expiry remains unproven on Twitch |
| Stable mixed-feed identity including restriction/playability | **failed** — core identity is mostly present, but authoritative restriction/playability is absent and Kick nested Category identity drifts |
| Signed-in, region, mature, subscriber-only, deleted/private/pruned/unplayable matrix | **failed** — only signed-out/current-region and partial mature metadata were observed |
| Rate/auth/transient/permanent classifications | classifications documented, but **reliable rate/auth-change behavior remains unproven** for both internal anonymous routes |
| Separate completeness statements and sanitized request/response evidence | **complete** |
| Final parity decision with no partial fallback | **BLOCKED** |

The failed and unproven rows are release blockers, not implementation follow-ups. Under the PRD's parity rule, the Category Clips tab must remain unshipped.

## Commands used

All commands were read-only network or repository-inspection probes except creation of this evidence file:

- `rg` / `Get-Content` over existing Twitch/Kick Clip readers and unified types.
- Anonymous `Invoke-RestMethod` / `.NET HttpClient` POSTs to Twitch GQL with sanitized summaries.
- Anonymous `curl.exe` GETs to Kick Category Clip and Channel routes with browser-identification headers and sanitized summaries.
- In-memory scan and SHA-256 of Kick's current official OpenAPI JSON.
- No production source, test, issue status, account state, or external data was modified.
