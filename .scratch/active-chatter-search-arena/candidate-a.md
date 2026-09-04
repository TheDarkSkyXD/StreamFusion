# Candidate A: local roster projection with a fixed search row

## Problem

Add fast name filtering to Active Chatters without changing the roster source or its lifecycle. `RecentChattersPanel` already owns the view policy for a raw `Record<string, ChatKnownUser>` from the chat store. It groups users into exactly `moderators` and `chatters`, sorts each group by `lastSeen`, preserves independent group scroll positions, handles collapse state, closes on Escape, and restores focus when it unmounts. The store also exposes a session count that can exceed the bounded roster. Search must project the bounded roster while leaving that session count untouched.

## Usage, from the caller's view

The production callers do not change. Search is an internal panel capability. Twitch and Kick continue to pass only panel identity, channel identity, and close behavior.

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
{showRecentChatters ? (
  <RecentChattersPanel
    key={channelKey}
    id={recentChattersPanelId}
    channelKey={channelKey}
    onClose={() => setShowRecentChatters(false)}
  />
) : null}
```

Storybook and component tests also keep the same component contract.

```tsx
<RecentChattersPanel
  id="recent-chatters-test"
  channelKey="twitch:alpha"
  onClose={onClose}
/>
```

The end user sees one fixed search row immediately below the title and session total. Typing filters rows and group counts as each character arrives. The title total stays the number seen during the session. A trailing clear button restores the full roster and returns focus to the textbox. Escape still closes the panel, including while the textbox has focus.

## Named data shape

```ts
type ActiveChatterGroupId = "moderators" | "chatters";

type ActiveChatterRoster = Readonly<Record<string, ChatKnownUser>>;

type ActiveChatterGroups = Record<ActiveChatterGroupId, ChatKnownUser[]>;

interface ActiveChatterRosterView {
  /** Both keys are always present, even when a group has no matches. */
  groups: ActiveChatterGroups;
  /** Number of rows represented by groups after filtering. */
  matchedCount: number;
  /** False for an empty or whitespace-only query. */
  searching: boolean;
  /** Sourced from the raw roster so the group icon does not change while filtering. */
  moderatorBadge: ChatKnownUser["badges"][number] | undefined;
}
```

`ActiveChatterGroups` encodes the two-group invariant. A third group cannot appear without changing the type and the static `ACTIVE_CHATTER_SECTIONS` registry. `ActiveChatterRosterView` keeps the filtered row count separate from the unfiltered session total. This prevents the header from accidentally adopting search semantics.

## Function and component sketch

```ts
function groupIdForRole(role: ChatKnownUserRole): ActiveChatterGroupId {
  return role === "broadcaster" || role === "moderator" ? "moderators" : "chatters";
}

function buildActiveChatterRosterView(
  roster: ActiveChatterRoster,
  rawQuery: string
): ActiveChatterRosterView {
  const query = rawQuery.trim().toLowerCase();
  const allGroups: ActiveChatterGroups = { moderators: [], chatters: [] };

  for (const user of Object.values(roster)) {
    const groupId = groupIdForRole(user.role ?? "viewer");
    allGroups[groupId].push(user);
  }

  for (const group of Object.values(allGroups)) {
    group.sort((left, right) => right.lastSeen.getTime() - left.lastSeen.getTime());
  }

  const matches = (user: ChatKnownUser) =>
    user.username.toLowerCase().includes(query) ||
    user.displayName.toLowerCase().includes(query);
  const groups: ActiveChatterGroups =
    query.length === 0
      ? allGroups
      : {
          moderators: allGroups.moderators.filter(matches),
          chatters: allGroups.chatters.filter(matches),
        };
  const moderatorBadge = allGroups.moderators
    .flatMap((user) => user.badges)
    .find((badge) => badge.setId.toLowerCase() === "moderator");

  return {
    groups,
    matchedCount: groups.moderators.length + groups.chatters.length,
    searching: query.length > 0,
    moderatorBadge,
  };
}
```

The helper stays private in `RecentChattersPanel.tsx`. It hides query normalization, dual-field matching, two-group assignment, stable role policy, moderator icon sourcing, and recency sorting behind one call.

```tsx
export function RecentChattersPanel({ id, channelKey, onClose }: RecentChattersPanelProps) {
  const chatters = useChatStore(
    (state) => state.usersByChannel[channelKey] ?? EMPTY_CHATTERS
  );
  const trackedTotal = useChatStore(
    (state) => state.chatterCountByChannel[channelKey]
  );
  const [searchQuery, setSearchQuery] = useState("");

  const rosterView = useMemo(
    () => buildActiveChatterRosterView(chatters, searchQuery),
    [chatters, searchQuery]
  );
  const sessionTotal = trackedTotal ?? Object.keys(chatters).length;

  // TODO: Render against rosterView without changing the existing collapse,
  // scroll, Escape, focus-restoration, badge, or row paths.
}
```

The production callers already key the panel by `channelKey`, so local search state resets when the user changes channels. The component does not synchronize query state to Zustand, props, URL state, or preferences.

The render sketch is intentionally local.

```tsx
<header>
  <h3>Active Chatters</h3>
  <p role="status" aria-live="polite">
    {sessionTotal === 0
      ? "People appear as messages arrive"
      : `${sessionTotal} seen in this chat`}
  </p>
</header>

{sessionTotal === 0 ? (
  <ExistingEmptyRoster />
) : (
  <>
    <div role="search" className="shrink-0 border-b ...">
      <BsSearch aria-hidden="true" />
      <input
        type="search"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        aria-label="Search active chatters"
        aria-controls={`${id}-groups`}
        aria-describedby={`${id}-search-results`}
        placeholder="Search chatters"
      />
      {searchQuery.length > 0 ? (
        <button
          type="button"
          aria-label="Clear active chatter search"
          onClick={() => {
            setSearchQuery("");
            searchInputRef.current?.focus();
          }}
        >
          <BsX aria-hidden="true" />
        </button>
      ) : null}
    </div>

    <div id={`${id}-groups`} aria-label="Active chatter groups">
      <p
        id={`${id}-search-results`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={rosterView.searching && rosterView.matchedCount === 0 ? "visible status" : "sr-only"}
      >
        {rosterView.searching
          ? rosterView.matchedCount === 0
            ? `No active chatters match "${searchQuery.trim()}".`
            : `${rosterView.matchedCount} matching chatters.`
          : "Showing all active chatters."}
      </p>

      {ACTIVE_CHATTER_SECTIONS.map(({ id: groupId, label }) => {
        const users = rosterView.groups[groupId];
        // Existing group toggle, count, collapse state, list scroller, badges,
        // username color, and row markup continue unchanged.
      })}
    </div>
  </>
)}
```

The actual JSX should use the existing Tailwind tokens. The search field uses the design system's dark surface, one-pixel divider border, eight-pixel radius, white focus ring, neutral placeholder, and fast color transitions. It suppresses WebKit's built-in search cancel control so the explicit accessible clear button is the only visible clear action. It does not use platform colors or add a resting shadow.

Do not add an input-level Escape handler. The existing document listener remains the only Escape policy. This keeps Escape closing and focus restoration identical whether focus is on the search field, clear button, a group toggle, or a row.

## Module map

| File | Responsibility after the change |
| --- | --- |
| `apps/desktop/src/frontend/features/chat/components/chat/RecentChattersPanel.tsx` | Owns local query state, private roster projection, fixed search row, filtered group rows and counts, clear behavior, and search-result feedback. |
| `apps/desktop/tests/components/chat/RecentChattersPanel.test.tsx` | Proves matching, unfiltered session total, zero-match behavior, clear focus, Escape restoration, collapse, scroll, badges, and empty-roster preservation through the public component. |
| `apps/desktop/src/frontend/features/chat/components/chat/RecentChattersPanel.stories.tsx` | Adds populated filtered and no-match states for visual and keyboard review. |
| `TwitchChat.tsx`, `KickChat.tsx`, `chat-store.ts`, shared contracts | No changes. They remain unaware of search. |

This is a one-component capability. A new hook, utility file, store slice, or shared type would add a layer without hiding more policy.

## Behavior comparison

| Decision | Chosen shape | Alternatives and why they lose |
| --- | --- | --- |
| Input placement | Fixed row below the header and above both groups. The title and session total remain stable while results scroll independently. | An input inside the header crowds the title and total at the existing 380-pixel story width. An input inside the groups scroller can leave the viewport while the user reviews results. An icon that reveals search hides the capability behind an extra click. |
| Clear behavior | Explicit trailing clear button, rendered only when the raw input is nonempty. Clicking it clears and refocuses the textbox. | The browser-provided search cancel control varies by Electron and is a weak test and accessibility seam. Escape-to-clear conflicts with the panel's established Escape-to-close behavior. Clearing on blur is surprising and destroys work. |
| No-results behavior | Keep both group headers, show filtered counts of zero, retain collapse state, and show one visible `No active chatters match` status above them. | Reusing `No active chatters yet` lies because the roster is not empty. Hiding the groups breaks the exactly-two-groups invariant and makes the layout jump. Repeating `No matches` inside both groups adds noise. |
| Accessibility | A labeled `type="search"` field in a `role="search"` region controls the groups container. A polite atomic status reports result count. The clear button has a specific accessible name. Placeholder text is only a hint. | Placeholder-only labeling disappears while typing. A silent visual filter gives screen-reader users no result feedback. Auto-focus is rejected because opening the roster should not move focus away from the existing toggle without an explicit product change. |
| Test seam | Keep the projection helper private and assert behavior through the component's existing DOM and store fixtures. Add Storybook states for visual review. | Exporting a helper solely for tests grows the module contract. A `useActiveChatterSearch` hook splits a small synchronous projection across files and forces tests to understand an implementation layer. End-to-end-only coverage makes exact group counts and focus behavior harder to diagnose. |

## Test seams and cases

Add focused component tests beside the current suite.

1. Seed users whose login and display name differ. Type mixed-case substrings into `Search active chatters`. Assert matching works through both `username` and `displayName` and all nonmatching rows disappear.
2. Seed moderators and chatters. Search for one chatter. Assert the header still says the original session total, `Moderators` reports zero, and `Chatters` reports one.
3. Search for an absent name. Assert both group toggles remain, both accessible names report zero chatters, the filtered no-results status is visible, and `No active chatters yet` is absent.
4. Click `Clear active chatter search`. Assert every row returns, raw group counts return, the button disappears, and the textbox has focus.
5. Focus the textbox, type a query, then press Escape. Extend the existing harness assertion so the panel closes and focus returns to `Open roster` without first clearing the query.
6. Collapse a group, type and clear a query, then assert its `aria-expanded` and `hidden` state do not change.
7. Scroll a group, trigger an unrelated live roster update that still matches the active query, and assert the existing list element retains its scroll position. The search implementation must not replace the list node or reset `savedGroupScrollRef`.
8. Give a matching row a provider badge. Assert the same image and platform proxy behavior remain. Search for a regular chatter while a moderator exists and assert the moderator group icon does not switch from its provider badge to the fallback shield.
9. Render a truly empty roster. Assert the existing empty-roster title and explanation remain and the search field is absent.

Add `Filtered` and `SearchNoResults` stories. Their play functions should type into the textbox and assert filtered accessible counts. The existing `CloseWithEscape` story should run with the textbox focused.

## Shape and interface depth

The public interface stays at three props. Callers do not coordinate query state, normalization, grouping, result counts, focus, or clear behavior. One private pure function compresses those rules into a single derived model, while the component remains the owner of transient interaction state. This is a deep enough local boundary because one call hides every roster projection rule and returns the exact render shape.

The core two-key record follows Foundational Thinking and Model the Domain. It makes the fixed group set visible in the type instead of repeating role branches in JSX. The unchanged caller contract and single-file runtime change follow the Laziness Protocol and Minimize Reader Load. The fixed placement, explicit clear button, stable header total, and honest no-results copy follow Experience First. The alternatives above satisfy Exhaust the Design Space with materially different interaction shapes, not cosmetic variants.

## Synthesis decision

Candidate A recommends the local projection shape as the base. It preserves every current ownership boundary and adds no caller or store API. The parent arena should compare this against candidates that separate search into a reusable UI primitive or derive search state elsewhere. Any synthesis should retain this candidate's unfiltered session total, raw-roster matching, stable moderator icon, explicit Escape policy, and two-key filtered group shape.

## Tradeoffs accepted

- We accept an O(n) projection and O(n log n) group sort on each query change in exchange for no cache or index state. The roster is currently bounded to 500 rows, so the simpler synchronous path is the right default.
- We accept substring matching only in exchange for predictable behavior. Fuzzy matching and ranking would reorder the established recency list.
- We accept a private helper with component-level tests in exchange for keeping the runtime contract small.
- We accept a visible 36-pixel search row in exchange for one-click discovery and a stable input while either group scrolls.
- We accept search state resetting when the keyed panel remounts in exchange for no cross-channel or persistent search state.
- We accept filtered zero counts in group headings while the header shows an unfiltered total. The two numbers answer different questions and the result status explains the filter state.

## Alternatives considered

### Search state in the chat store

This exposes a query setter and selector to every caller, adds channel cleanup policy, and turns ephemeral view state into shared mutable state. It hides no work that the panel cannot own, so its interface is shallower than the chosen local shape.

### Reusable `ActiveChatterSearch` hook and `SearchField` component

This splits one small interaction across extra files and makes readers trace state, projection, and rendering separately. The hook would mostly pass the roster and query through to a filter. The chosen private helper hides more policy behind a smaller boundary.

### Reveal-on-demand search icon in the title row

This saves vertical space but exposes mode switching, focus transfer, close-versus-clear rules, and extra animation state. It also makes a basic roster capability undiscoverable. The fixed row has fewer states and a shorter user path.

## Red-flag screen

- Shallow module. Pass. The public props do not grow, and the private projection hides all filtering and grouping policy.
- Information leakage. Pass. Store data remains raw and search policy lives only in the panel.
- Temporal decomposition. Pass. Filtering, grouping, sorting, and badge-source selection stay together because they describe one roster projection.
- Pass-through method. Pass. No wrapper component, hook, adapter, or forwarded callback is added.

## Open questions and risks

- Could the bounded roster grow far beyond 500 users? If so, profile the synchronous projection before adding an index or deferred query.
- Do product requirements later need accent-insensitive matching? This candidate intentionally implements only case-insensitive substring matching.
- Should a future keyboard-navigation pass move focus into the panel on open? This candidate preserves today's focus behavior and does not bundle that broader interaction change with search.

## Next implementation step

Add the private `ActiveChatterRosterView` projection and its mixed-case username and display-name component tests in `RecentChattersPanel.test.tsx`, then render the fixed search row against that model.
