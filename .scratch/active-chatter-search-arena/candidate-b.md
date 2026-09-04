# Candidate B: panel-local roster projection

## Problem

Active Chatters is an overlay shared by Twitch and Kick. It reads the raw per-channel `Record<string, ChatKnownUser>` roster from `useChatStore`, derives exactly Moderators and Chatters, and separately presents a monotonic session total. Search must narrow rendered rows and group counts by case-insensitive `username` or `displayName` without changing that session total, the store shape, callers, group taxonomy, badges, sorting, collapses, scroll preservation, Escape close, or focus restoration.

## Usage (caller's view)

No caller learns about search. The panel remains a self-contained overlay.

```tsx
// TwitchChat.tsx
{showRecentChatters ? (
  <RecentChattersPanel
    key={channelKey}
    id={recentChattersPanelId}
    channelKey={channelKey}
    onClose={() => setShowRecentChatters(false)}
  />
) : null}
```

```tsx
// KickChat.tsx
<RecentChattersPanel
  key={channelKey}
  id={recentChattersPanelId}
  channelKey={channelKey}
  onClose={() => setShowRecentChatters(false)}
/>
```

```tsx
// RecentChattersPanel.tsx, the only new consumer interaction
const [searchTerm, setSearchTerm] = useState("");
const visibleGroups = useMemo(
  () => projectActiveChatters(chatters, searchTerm),
  [chatters, searchTerm]
);

<input
  type="search"
  value={searchTerm}
  onChange={(event) => setSearchTerm(event.target.value)}
  aria-label="Search active chatters"
  placeholder="Search chatters"
/>
{searchTerm ? <button aria-label="Clear search" onClick={clearSearch} /> : null}
```

`RecentChattersPanelProps` stays `{ id, channelKey, onClose }`. The raw store selector stays inside the panel. Twitch and Kick continue to pass only lifecycle concerns, while the overlay owns its ephemeral view state.

## Shape

```ts
type ActiveChatterGroupId = "moderators" | "chatters";

type ActiveChatterGroups = Readonly<Record<ActiveChatterGroupId, readonly ChatKnownUser[]>>;

function normalizeActiveChatterSearch(term: string): string {
  return term.trim().toLocaleLowerCase();
}

function matchesActiveChatterSearch(user: ChatKnownUser, normalizedTerm: string): boolean {
  if (normalizedTerm === "") return true;
  return (
    user.username.toLocaleLowerCase().includes(normalizedTerm) ||
    user.displayName.toLocaleLowerCase().includes(normalizedTerm)
  );
}

/**
 * Produces the panel's two stable display groups from the authoritative raw roster.
 * It never changes roster membership, tracked totals, or group identities.
 */
function projectActiveChatters(
  chatters: Readonly<Record<string, ChatKnownUser>>,
  term: string
): ActiveChatterGroups {
  // Normalize once, place each matching user into the existing role group,
  // then retain the current descending-lastSeen order within each group.
  throw new Error("not implemented");
}

function countActiveChatters(groups: ActiveChatterGroups): number {
  return groups.moderators.length + groups.chatters.length;
}
```

`projectActiveChatters` is a pure, same-module helper. Its input is the existing raw roster and its output has both group keys even when either, or both, has no match. Filtering occurs before rendering and before each group count is derived. Its dominant accesses are one linear pass over roster users, two string checks per user, and the existing two in-group `lastSeen` sorts. No store index, cached normalized fields, or new persisted state is warranted for a roster capped at 500 rows.

The React shell owns only:

```ts
const [searchTerm, setSearchTerm] = useState("");
const searchInputRef = useRef<HTMLInputElement | null>(null);

const clearSearch = useCallback(() => {
  setSearchTerm("");
  searchInputRef.current?.focus();
}, []);
```

The existing `collapsedGroups`, per-group scroll refs, saved scroll offsets, and return-focus ref are unchanged. Do not reset collapse or scroll state when the query changes. The existing `key={channelKey}` means a channel replacement creates a fresh panel and therefore a fresh empty search term. This is correct because the search belongs to the old channel view, not the shared chat session.

Layout changes remain in `RecentChattersPanel.tsx`:

1. Keep the title and unchanged unfiltered `total` in the header.
2. Add a compact `role="search"` row directly below that total, still inside the header's bordered region. Use the design-system dark input surface, neutral placeholder, and existing purple `focus-visible:ring` treatment.
3. Render the existing empty-roster experience when `total === 0`. The input remains available but no empty search result is announced for an actually empty roster.
4. When `total > 0`, always render both existing group sections. Their row arrays and visible counts come from `visibleGroups`.
5. When `searchTerm` is non-empty and `countActiveChatters(visibleGroups) === 0`, show one concise inline `role="status"` message above the two sections: `No active chatters match "{searchTerm}".` The two zero-count headers remain so the panel keeps exactly two groups. The message is not a substitute third group.

The input is a controlled native `type="search"` with `aria-label="Search active chatters"`. Its clear control exists only for a non-empty term, has `type="button"` and `aria-label="Clear search"`, clears the same local state, then returns focus to the input. Escape retains its current global meaning: close the overlay and restore focus to the opener. It must not first clear the query. The group toggle `aria-label`s keep their current format but use filtered counts. Provider badges and username rendering map only the projected users, preserving their current exact badge and color behavior.

This is a deep public surface. Callers retain one component with three lifecycle props while the panel hides matching, normalization, search focus, clearing, empty-result presentation, and filtered count derivation. Per `principle-model-the-domain`, `ActiveChatterGroups` explicitly encodes the invariant that the view has only two sections. Per `principle-boundary-discipline`, typed internal `ChatKnownUser` records require no defensive parsing. Per `principle-type-system-discipline`, the closed group-id union makes a third group impossible without an intentional type change. Per `principle-minimize-reader-load` and `principle-laziness-protocol`, the pure helper stays beside its single caller rather than becoming a feature utility or store API.

## Module map

| Module | Responsibility | Change |
| --- | --- | --- |
| `apps/desktop/src/frontend/features/chat/components/chat/RecentChattersPanel.tsx` | Owns raw roster selection, local search term, pure projection, rendering, a11y, and existing overlay lifecycle. | Add the helper and compact search UI only. |
| `apps/desktop/src/frontend/features/chat/components/chat/twitch/TwitchChat.tsx` | Opens and closes the overlay for Twitch. | No change. |
| `apps/desktop/src/frontend/features/chat/components/chat/kick/KickChat.tsx` | Opens and closes the overlay for Kick. | No change. |
| `apps/desktop/src/frontend/store/chat-store.ts` | Owns per-channel authoritative roster and unfiltered monotonic total. | No change. |
| `apps/desktop/tests/components/chat/RecentChattersPanel.test.tsx` | Tests observable panel behavior. | Add search-specific tests. |
| `apps/desktop/src/frontend/features/chat/components/chat/RecentChattersPanel.stories.tsx` | Visual interaction coverage. | Add populated-search and no-match stories if story scope is desired. |

## Test seams

Keep the public component test seam. No test-only props are necessary. Test through the search input, native clear button, group buttons, lists, and existing store setup.

- Match username and display name case-insensitively. Include a case where only `displayName` matches.
- Assert that the header still says the original session total while each of the two group buttons reports its filtered count.
- Assert both groups remain present and zero-count when a non-empty roster has no match. Assert one no-results status and no user rows.
- Assert Clear search restores all rows and filtered counts, remains focused in the input, and does not change collapse state.
- Search while a group is collapsed and confirm it stays collapsed. Search after setting a list scroll offset and confirm the same list node and saved position survive filtering and clearing.
- Focus the input, press Escape, and confirm `onClose` runs, the panel unmounts, and the opener regains focus. This protects the existing Escape and focus-restoration contract.
- Re-run badge and raw-roster tests with a matching user in each group. A filtered row must keep its exact provider badge behavior and username color.
- Add Storybook interaction coverage for a matching search and no-match state only if this project expects interaction stories to accompany the test update.

## Synthesis decision

Arena synthesis pending. Candidate B recommends a single panel-local pure projection as the base. It keeps the established ownership boundary and produces only one source edit plus focused tests.

## Tradeoffs accepted

- We accept re-normalizing two short strings per displayed roster user on each typed character in exchange for keeping the authoritative chat store free of presentation-only search state and cache invalidation.
- We accept rendering two empty group headers beside one no-results message in exchange for preserving the product invariant that Active Chatters has exactly Moderators and Chatters.
- We accept a persistent search field when the roster is empty in exchange for stable layout and a predictable place to search as chatters arrive.
- We accept clearing the query only through the explicit clear control in exchange for reserving Escape for the existing close-and-restore-focus behavior.

## Alternatives considered

- Store-backed `activeChatterSearchByChannel`: rejected. It leaks a one-overlay transient into cross-panel state, needs per-channel reset semantics, and exposes state coordination to callers without hiding more complexity.
- A reusable `useActiveChatterSearch` hook in `features/chat`: rejected. With one panel caller it would add a module boundary and a public contract while hiding almost no additional capability. The same-module pure projection is deeper for this scope.
- Replacing the group area with a no-results card: rejected. It hides the two section identities and their filtered zero counts, forcing a caller or user to infer that groups still exist.
- Search in the host `TwitchChat` and `KickChat` headers: rejected. It duplicates UI and state across platform callers and makes overlay-specific focus, clearing, and result semantics their responsibility.

## Open questions and risks

- Should matching use `toLocaleLowerCase()` as proposed, which follows current user locale, or `toLowerCase()` for deterministic cross-locale snapshots? Either meets case-insensitive matching for current usernames. The project should choose one convention and test it.
- Should a Search shortcut focus the input? It is not required by the feature. Adding one would need an explicit conflict audit because the panel already captures document-level Escape.
- Does the visual review prefer the search row inside the header's existing border, as proposed, or a separately bordered toolbar? The former keeps total and filtering context together and avoids another panel band.

## Next implementation step

Implement `projectActiveChatters` and its controlled search row in `RecentChattersPanel.tsx`, then add the listed component tests before visual verification.
