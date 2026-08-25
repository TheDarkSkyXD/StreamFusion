# Kick follow-page parser and reconciliation

## Usage

`tryWebSessionFollowCollection` remains the only caller of the private page parser. It receives a normalized page or treats the response as a parse failure before any local follow rows change.

```ts
const page = parseKickWebFollowPage(parsed);
if (!page) return { status: "error", reason: "parse-error" };

for (const channel of page.channels) {
  collected.set(channel.username, channel);
}

if (page.nextCursor === 0) break;
if (seenCursors.has(page.nextCursor)) {
  return { status: "error", reason: "parse-error" };
}
seenCursors.add(page.nextCursor);
cursor = page.nextCursor;
```

The normal sync caller keeps its current result contract. It does not learn Kick's response fields or parser rules.

```ts
const result = await getAllFollowedChannels({ allowBrowserWindowFallback: true });
if (result.status === "error") return reportKickFollowSyncFailure(result);

const outcome = await syncKickFollowsAfterLogin(
  () => Promise.resolve(result),
  storageService,
  resumePendingWrites,
  getKickAccountFollowState,
  getKickAccountFollowStates
);
```

## Shape

Keep the parser private in `follow-endpoints.ts`. No new transport type, public API, scraper, or module is needed.

```ts
type KickWebFollowPage = {
  channels: UnifiedChannel[];
  nextCursor: number;
};

function parseKickWebFollowPage(payload: unknown): KickWebFollowPage | null;
```

The parser accepts an object with these required boundary facts.

| Input | Required rule | Why |
| --- | --- | --- |
| `channels` | An array. | The collection boundary must be known. |
| `nextCursor` | A non-negative safe integer. `0` is terminal. | The loop must have a safe, finite continuation value. |
| each channel | A non-array object with a non-empty string `channel_slug`. | This is the only identity emitted by this endpoint. |
| `is_live` | A boolean. | `UnifiedChannel` requires a truthful live-state value. |

The parser trims and lowercases `channel_slug` before using it as `id` and `username`. It maps `displayName` from a string `user_username` when present and non-empty, otherwise the normalized slug. It maps `avatarUrl` from a string `profile_picture` when present, otherwise `""`.

It ignores all other properties. That includes `session_title`, `category_name`, `is_reserved`, `show_view_count`, and `viewer_count`, whether absent, `null`, or a different type. It also ignores unknown fields at both the page and item levels. Therefore `session_title: null` and `future_metadata` cannot invalidate a follow page.

The parser rejects the whole page when the envelope, cursor, identity, or required live-state value is unsafe. A malformed item must not be silently admitted or skipped because the endpoint carries no independent broadcaster ID with which to prove its identity. Existing collection rules remain in force. The loop rejects a repeated cursor, enforces the 100-page cap, and deduplicates normalized slugs with its `Map`.

This is a deep boundary with one small interface. It hides all untrusted-wire decisions inside the endpoint and exposes only `UnifiedChannel[]` plus a cursor. It does not leak a Kick transport shape into reconciliation or storage. The choice follows boundary discipline and type-system discipline.

## Module map

`apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts` owns parsing and collection safety. Change only `parseKickWebFollowPage` and, if clarity needs it, private field readers beside that function. Do not add a schema module for one local endpoint.

`apps/desktop/src/backend/ipc/handlers/auth-handlers.ts` keeps the current reconciliation policy. It consumes only `FollowedChannelsResult` and must not inspect page fields.

`apps/desktop/src/backend/services/kick-account-reconciliation-coordinator.ts` remains only the activity guard. It needs no parser or storage knowledge.

`apps/desktop/tests/backend/api/platforms/kick/follow-endpoints.test.ts` owns the wire-boundary regression. Keep the existing red test as the primary proof.

`apps/desktop/tests/backend/ipc/handlers/auth-handlers.test.ts` remains the proof for destructive reconciliation rules.

## Background reconciliation

The full-page endpoint is discovery-only. It contributes channels to the union but always returns `canPruneAbsent: false`. It never makes an absent channel safe to delete.

The identity-checked `/api/v2/channels/followed` collection is authoritative only after `verifyKickWebViewerIdentity` matches the stored Kick viewer. It can return `canPruneAbsent: true` when used alone. If a successful full-page result is unioned into it, the combined result remains additive and has `canPruneAbsent: false`.

When a result is additive, `syncKickFollowsAfterLogin` keeps the current reconciliation path.

1. Verify every discovered channel against the stored viewer relationship before it becomes an account-sourced row. A relationship result of `followed` admits it.
2. For every prior Kick account row missing from discovery, retain it unless the same viewer-specific relationship read returns `not-followed`.
3. Treat `unavailable` as no evidence. Preserve a verified prior row and do not adopt a new row. The existing migration exception for unverified legacy rows remains valid.
4. Only after that reconciliation, call `upsertSyncedFollows` with `pruneAbsent: true`. The reconciled set is then an explicit per-row settlement, not an interpretation of incomplete discovery.
5. On a parser error, HTTP failure, or viewer mismatch, return an error before `upsertSyncedFollows`. The previous local rows remain untouched.

The existing batch verifier is the right reconciliation mechanism. It makes one viewer-bound relationship read for the candidate set and falls back to a bounded concurrency of four only when the batch path is unavailable. This preserves idempotence. Repeating a successful sync converges to the same rows, while repeated uncertainty cannot delete rows. The policy follows make-operations-idempotent and separate-before-serializing-shared-state.

## Rationale

The bug is boundary over-validation. `parseKickWebFollowPage` currently makes every presentation field and the exact property set part of an account-follow contract, even though only a slug, live state, and pagination drive the result. Kick can legitimately make `session_title` nullable or add a field, which turns a valid page into a failure and loses the page's discoveries.

Candidate A changes no ownership boundary. It narrows validation to identity and pagination facts that can create an unsafe account row or an unbounded request loop. Presentation values become optional normalization inputs. This is the smallest design under the laziness protocol and minimizes reader load because the caller still has one result type and one reconciliation decision.

The current reconciliation structure is deliberately more conservative than the parser. A parser can establish that a response is structurally safe to read. It cannot establish that a partial projection is exhaustive or viewer-authoritative. The existing `canPruneAbsent` tag carries that distinction to the only code allowed to mutate storage. This models the real domain rather than asking callers to infer trust from an endpoint name.

## Synthesis decision

This candidate uses the local-parser base. It rejects an alternative that introduces a reusable Kick schema layer because there is one endpoint and no second consumer. That layer would expose transport vocabulary without hiding enough complexity.

It also rejects permissive best-effort item skipping. Skipping a record with an invalid slug hides identity corruption and makes page completeness unknowable. Rejecting unsafe identity or cursor data is the right failure mode, while accepting presentation drift fixes the reported regression.

It rejects a design that treats a fully parsed full-page response as prune-authoritative. That would expose endpoint completeness assumptions to storage and could delete valid follows. Per-row relationship reconciliation hides that uncertainty from every caller.

## Verification

Keep the existing regression that passes a valid item with `session_title: null` and an added `future_metadata` field. It must return an additive successful result.

Add table-driven endpoint cases that reject a missing or blank `channel_slug`, a non-array `channels`, and negative, fractional, or non-numeric `nextCursor` values. Keep the repeated-cursor and 100-page-cap tests.

Retain the auth-handler tests that prove an additive result cannot delete a prior row without an identity-matched `not-followed` relationship result. Add no DOM tests and no new scraping path.

## Open questions and risks

- Does Kick document a slug character set that would let this parser reject syntactically impossible but non-empty slugs? Until a source contract proves one, non-empty normalization is the safe minimum.
- Should `is_live` also default to `false` on presentation drift? It is a required `UnifiedChannel` field, but it is not account identity. The smallest change retains the current boolean requirement until a product need says stale live-state is preferable to an additive-page error.

## Next implementation step

Replace the exact-key and presentation-field checks in `parseKickWebFollowPage` with the narrow envelope, cursor, slug, and live-state checks, then run the focused follow-endpoints and auth-handler test files.
