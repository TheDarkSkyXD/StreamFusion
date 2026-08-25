# Follow Sync Design Candidate B

## Usage

Caller usage stays the same. The parser gets smaller and more selective about what it treats as unsafe.

```ts
const pageResult = await _tryWebSessionFollowedPageFetch();

if (pageResult.status === "ok") {
  pageResult.canPruneAbsent; // false
  pageResult.channels; // valid rows only
}
```

```ts
const result = await _tryWebSessionFetch();

if (result.status === "ok") {
  // true only when pagination is complete, viewer identity matches,
  // and every accepted row had safe identity data.
  result.canPruneAbsent;
}
```

```ts
const outcome = await syncKickFollowsAfterLogin(
  () => getAllFollowedChannels({ allowKickBrowserWindowFallback: true }),
  storageService,
  () => kickFollowWriteService.resumePendingWrites(),
  getKickAccountFollowState,
  getKickAccountFollowStates
);

// No new reconciliation service.
// Existing reconcileKickMissingFollowRows remains the downgrade path
// whenever canPruneAbsent is false.
```

## Types And Signatures

Keep the public result type unchanged.

```ts
export type FollowedChannelsResult =
  | { status: "ok"; channels: UnifiedChannel[]; canPruneAbsent: boolean }
  | { status: "error"; reason: ErrorReason };
```

Replace the current exact-key parser with an internal two-stage parser.

```ts
type KickFollowPageParseResult =
  | {
      status: "ok";
      nextCursor: number;
      channels: UnifiedChannel[];
      discardedIdentityRows: number;
    }
  | {
      status: "reject";
      reason: "invalid-envelope" | "invalid-cursor";
    };

type KickFollowRowParseResult =
  | { status: "accept"; channel: UnifiedChannel }
  | { status: "discard"; reason: "invalid-record" | "missing-slug" };

function parseKickWebFollowPage(payload: unknown): KickFollowPageParseResult;
function parseKickWebFollowRow(value: unknown): KickFollowRowParseResult;
```

Collection flow keeps the same entry points.

```ts
async function tryWebSessionFollowCollection(
  basePath: string,
  verifyViewer: boolean
): Promise<FollowedChannelsResult>;
```

Row rules:

- Required. `channel_slug` must be a non-empty string after trim/lowercase.
- Required. `nextCursor` must be a safe non-negative integer.
- Optional. `user_username` may be missing or non-string. Fallback to slug.
- Optional. `profile_picture` may be missing or non-string. Fallback to `""`.
- Optional. `is_live` may be missing or non-boolean. Fallback to `false`.
- Ignored. `session_title`, `category_name`, `viewer_count`, `show_view_count`, `is_reserved`, and any future additive keys.
- Enrichment only. If `profile_picture` contains a canonical Kick avatar user id, populate `kickUserId` and prefer it for `id`. Otherwise fall back to slug.

## Module Map

`apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts`

- Keep `parseKickWebFollowPage` private.
- Add a private `parseKickWebFollowRow`.
- Make page parsing strict only on envelope and cursor safety.
- Ignore additive top-level keys and additive row keys.
- Discard only rows whose identity is unsafe.
- If any row is discarded, return the page as usable but downgraded.
- In `tryWebSessionFollowCollection`, convert that downgrade into `canPruneAbsent: false`.
- Keep `parse-error` for invalid envelope, invalid cursor, repeated cursor, invalid JSON, and transport failure.

`apps/desktop/src/backend/ipc/handlers/auth-handlers.ts`

- No new reconciliation algorithm.
- Keep `syncKickFollowsAfterLogin` and `reconcileKickMissingFollowRows` as the only settlement path.
- When `canPruneAbsent` is false, continue the existing verify-before-prune flow.
- Optional. Add one debug log when an authenticated API read was downgraded from prune-safe to additive.

## Rationale

### Problem

The current parser treats the wire shape as exact. One nullable presentation field such as `session_title: null`, or one additive key, rejects the whole page. That is too brittle for an internal Kick web endpoint whose payload mixes identity data with presentation metadata. The destructive risk is not extra keys. The destructive risk is trusting missing or malformed identity and pagination data strongly enough to prune local follows.

### Shape

This design moves the trust boundary to the smallest safe contract.

- Page acceptance depends only on an object envelope, a `channels` array, and a safe `nextCursor`.
- Row acceptance depends only on safe channel identity. In practice that is a usable slug, with optional enrichment from avatar-derived broadcaster id.
- Presentation drift is ignored at the parser boundary because it does not affect account identity or pagination completeness.
- Identity drift downgrades trust instead of aborting discovery. Valid rows still enter the additive set. Pruning waits for the existing background reconciliation pass.

That keeps the public surface deep enough to matter. Callers still receive one `FollowedChannelsResult`. The parser hides wire drift and trust classification internally. The auth layer still owns follow reconciliation policy.

### Synthesis Decision

Candidate B keeps the external contract unchanged and uses the existing reconciliation branch as the safety net. It rejects only what can make the result unsafe to prune against. It does not introduce a new queue, a new scraper path, or a second follow-settlement service.

### Tradeoffs Accepted

- We accept dropping a malformed row in exchange for preserving the rest of a valid additive page.
- We accept more `canPruneAbsent: false` outcomes in exchange for never pruning against ambiguous identity drift.
- We accept losing optional presentation metadata in exchange for a boundary that follows actual ownership.
- We accept count-based diagnostics instead of raw payload logging in exchange for keeping followed-channel data out of logs.

### Alternatives Considered

- Patch only `session_title` to allow `null`. Rejected because the real bug is exact-key parsing. The next harmless additive field would break the same path again.
- Keep failing the entire page when any row drifts. Rejected because a non-authoritative additive feed should not discard valid discoveries due to one presentation-only mismatch.
- Return partial pages as prune-safe when cursor or pagination state is invalid. Rejected because pagination completeness is the boundary that protects deletions.
- Add a new reconciliation service or persisted retry queue. Rejected because `syncKickFollowsAfterLogin` plus `reconcileKickMissingFollowRows` already owns the downgrade path.

### Open Questions And Risks

- Does any downstream caller rely on `isLive` from the followed-page response strongly enough that defaulting non-boolean values to `false` would be misleading.
- Should the downgraded-path log include `discardedIdentityRows` so the next contract drift is visible without leaking payload contents.
- If Kick starts sending explicit user ids in this payload later, should the parser prefer them over avatar-derived ids in the same boundary function.

### Next Implementation Step

Refactor `parseKickWebFollowPage` into envelope parsing plus row parsing, downgrade prune trust on discarded identity rows, and keep the new test around nullable `session_title` plus additive fields red-to-green.
