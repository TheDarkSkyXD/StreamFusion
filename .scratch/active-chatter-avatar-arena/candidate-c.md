# Candidate C: Visible-first avatar hydration for Active Chatters

## Outcome

Keep `ChatKnownUser.avatarUrl` as the single avatar field and keep `ProxiedImage` as the only row renderer. Replace the current broad "first missing users in expanded groups" behavior with a bounded visible-first hydration pipeline:

- Render avatars immediately when `ChatKnownUser.avatarUrl` is already present.
- For rows missing an avatar, hydrate only the rows that are currently visible, plus a small overscan window.
- Preserve the moderator section heading badge exactly as it works today.
- Never do a roster-wide 500-user hydration pass.

## Why this shape

The panel is a viewport problem, not a roster-completeness problem.

- Kick often already gives avatar URLs in live message data, so most rows should fill passively from normal chat ingestion.
- Twitch avatar backfill already has a canonical path through `chat.enrichMentionUsers`, but that path is capped at 25 users and cached in the main process.
- Kick guest fallback is expensive, so any design that tries to fill every missing avatar in the 500-user roster will waste work and create worst-case stalls.

Visible-first keeps the expensive path aligned with what the user can actually see.

## Proposed data shape

Do not add a second avatar model. Extend the frontend panel state with request bookkeeping only.

```ts
type ActiveChatterAvatarStatus = "idle" | "requested" | "resolved" | "failed";

interface ActiveChatterAvatarRequestState {
  requestedKeys: Set<string>;
  failedKeys: Set<string>;
  lastVisibleKeys: string[];
}
```

Notes:

- Key by normalized platform identity, preferably `platform:userId`, fallback `platform:username`.
- Keep this state local to `RecentChattersPanel` or a dedicated hook; do not persist it into `ChatKnownUser`.
- `updateKnownUserProfiles` remains the only writer of resolved avatar URLs into the store.

## Module ownership

`apps/desktop/src/frontend/features/chat/components/chat/RecentChattersPanel.tsx`

- Own section expansion, visible row measurement, and rendering.
- Stop selecting hydration candidates by "all rows in first open groups".
- Pass visible candidate identities into a hook.

New frontend hook, e.g. `useActiveChatterAvatarHydration.ts`

- Own batching, dedupe, overscan, retry backoff, and cancellation.
- Accept the visible candidate list, `channelKey`, and `platform`.
- Call `window.electronAPI.chat.enrichMentionUsers`.
- Forward successful payloads into `updateKnownUserProfiles`.

Existing backend IPC/main-process enrich path

- Remains canonical.
- No new panel-specific backend API unless evidence shows `enrichMentionUsers` cannot distinguish safe Kick resolution from costly guest fallback.

If backend differentiation is needed later, add it as a narrow option on the existing enrich call, not as a second avatar endpoint.

## Hydration algorithm

1. Build the rendered row list from existing grouped/sorted chatters.
2. Measure the visible rows per expanded section using the existing scroll containers.
3. Produce candidates from:
   - rows intersecting the viewport
   - plus a small overscan, e.g. 8-12 rows
4. Filter out users that already have `avatarUrl`, are already requested, or recently failed.
5. Submit at most 25 users per request.
6. Prefer Twitch candidates first when mixed behavior ever becomes possible, because Twitch depends on explicit enrichment while Kick commonly self-fills from incoming messages.
7. Let successful enrich results write into `ChatKnownUser.avatarUrl`; rerender naturally via the store.

## Bounded behavior

- Per request cap: 25 users.
- Per panel session cap: keep the existing hard ceiling idea, but lower it to a visible-work budget, e.g. 50-75 instead of 100, because invisible rows should not consume quota.
- Retry policy: only retry failed users after they leave and re-enter the viewport, or after a modest cooldown.
- Collapse behavior: collapsed groups contribute zero hydration candidates.

## Tests

Frontend unit/component tests:

- Renders existing `avatarUrl` without hydration.
- Requests only visible missing-avatar rows, not the full group.
- Does not request rows from collapsed groups.
- Scroll changes trigger hydration for newly visible rows.
- Successful enrich updates the correct `ChatKnownUser` rows.
- Moderator header still shows the moderator badge.

Store tests:

- `updateKnownUserProfiles` merges avatar-only enrich results without regressing badges, role, color, or `lastSeen`.

IPC/backend tests:

- `enrichMentionUsers` still respects the 25-user cap.
- Twitch results remain cacheable and mergeable for repeated panel opens.

## Alternatives considered

Keep the current group-order sweep

- Simple, but it spends quota on off-screen rows and scales poorly with 500 chatters.

Hydrate the whole roster when the panel opens

- Worst match for the known constraints. Expensive on Kick guest paths and unnecessary on Twitch.

Add a dedicated active-chatter avatar endpoint

- Only justified if the current enrich path cannot cheaply express "visible subset only" or cannot avoid the costly Kick fallback. Start with the existing API.

## Recommendation

Choose this candidate if the goal is the smallest safe change with the best cost control: keep the canonical avatar field and render path, move selection to visible-first batching, and leave the moderator heading badge untouched.
