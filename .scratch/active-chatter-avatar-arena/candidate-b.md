# Candidate B. Bounded roster hydration

## Problem

Active Chatters already retains a `ChatKnownUser` per channel, including `avatarUrl`, but the row renders provider badges next to the name. Kick messages commonly supply an avatar. Twitch IRC and its history do not. The existing `chat.enrichMentionUsers` request resolves missing profile data in main, caches each result for 15 minutes, and accepts at most 25 users. The roster retains as many as 500 users. The design must improve the visible rows without turning a panel open into 500 Twitch or costly guest-Kick lookups. The moderator group heading keeps its badge.

## Usage

`RecentChattersPanel` owns avatar hydration while it owns the two scrollable groups. It asks for no more than 25 missing avatars at a time and merges successful answers into the existing channel roster.

```tsx
const { requestNextAvatarBatch } = useActiveChatterAvatarHydration({
	platform,
	channel,
	channelKey,
	groups: groupedChatters,
});

useEffect(() => {
	requestNextAvatarBatch("initial");
}, [requestNextAvatarBatch]);

<ul onScroll={() => requestNextAvatarBatch("chatters")}>...</ul>
```

The row has no provider badges. It uses the existing image primitive and the same initials fallback already used by mention autocomplete.

```tsx
<ProxiedImage
	src={user.avatarUrl}
	alt=""
	width={24}
	height={24}
	className="size-6 shrink-0 rounded-full object-cover"
	fallback={<ChatterAvatarFallback user={user} />}
/>
```

The hook uses a semantic chat-profile request. Mention autocomplete uses the same request and merges its responses into the store rather than its local `enrichedUsers` state.

```ts
const result = await window.electronAPI.chat.enrichKnownUsers({
	platform,
	channel,
	users: batch,
});

if (result.success && result.data) {
	useChatStore.getState().mergeKnownUserProfiles(channelKey, result.data);
}
```

## Shape

Keep `ChatKnownUser.avatarUrl?: string` as the sole renderer profile-image value. Do not add an avatar status field, a second cache, or a roster-specific model. A missing URL means the row may request enrichment and always renders a deterministic fallback. This preserves the store's existing merge rule, where a newly learned avatar does not erase a known one.

```ts
// shared/chat-types.ts
export interface ChatKnownUserProfile {
	readonly userId: string;
	readonly username: string;
	readonly displayName: string;
	readonly avatarUrl?: string;
}

// frontend/store/chat-store.ts
mergeKnownUserProfiles(
	channelKey: string,
	profiles: readonly ChatKnownUserProfile[]
): void;

// shared/ipc-channels.ts and preload/index.ts
enrichKnownUsers(request: {
	readonly platform: Platform;
	readonly channel?: string;
	readonly users: readonly Pick<ChatKnownUserProfile, "userId" | "username">[];
}): Promise<IpcResult<readonly ChatKnownUserProfile[]>>;
```

`mergeKnownUserProfiles` changes only users already present in `usersByChannel[channelKey]`. It indexes by lower-cased username, preserves roster recency, role, badges, and color, and writes a non-empty avatar URL. The action is idempotent. Replayed answers and concurrent mention and roster replies converge on the same URL.

`useActiveChatterAvatarHydration` is a local panel hook in `features/chat/components/chat/`. It has three local refs. `attempted` prevents duplicate panel requests. `inFlight` permits one request. `nextIndexByGroup` moves each group forward in recency order. The hook selects avatar-less users from the current grouped rows, adds up to 12 from each visible group for the initial request, and clamps the union to 25. When either internal group scroll reaches its bottom threshold, it requests that group's next unattempted users. Search does not trigger an eager new lookup. A search result gets a request only when its group reaches the scroll threshold. Closing the panel cancels state updates, not the safe main-process request.

The hook owns batching policy. `chat-handlers.ts` owns user-profile lookup, request validation, deduplication, the 25-user cap, the 15-minute cache, and Kick's fallback avatar policy. Rename the private `MentionUserLookup`, `MentionUserEnrichment`, and cache symbols to `KnownUserLookup`, `KnownUserProfile`, and `knownUserProfileCache`. The provider-specific lookup remains there. No new platform adapter is needed.

The public interface is one operation that returns presentation data for known chat identities. It hides cache hits, provider lookup, Kick guest costs, dedupe, and limits. The renderer exposes no backend cache flags or provider branches. This is a deeper interface than passing raw HTTP results or adding a second avatar store.

Validate the IPC payload in the handler. Deduplicate and cap it before network work. The store and UI trust the shared profile type. This follows boundary discipline and type-system discipline.

## Loading and fallback behavior

- The panel renders names immediately. Avatar images replace only the old row-badge cluster.
- A valid URL uses `ProxiedImage` at 24 by 24 pixels. It has an empty `alt` because the adjacent name already labels the user.
- A missing or failed Twitch image shows a colored initial. Kick uses the existing default avatar when no profile image is available. Neither state shows a spinner or an error row.
- The moderator group heading retains its moderator badge or shield fallback. User-row badges are removed.
- Each group keeps its current independent scroll behavior. Hydration never changes the user order, keys, list height, collapse state, focus behavior, or saved scroll position.
- A first request takes at most 25 identities. Every later bottom-edge request takes at most 25. Opening a roster with 500 avatar-less Twitch users causes one request, not twenty. Main cache hits make reopen requests cheap within 15 minutes.

## Synthesis decision

This is Candidate B. It chooses demand-driven visible-group batches over full-roster hydration and a separate avatar cache. The implementation should use this candidate only if the arena synthesis selects it.

## Tradeoffs accepted

- We accept initials or the Kick default avatar for offscreen and failed lookups in exchange for bounded network cost.
- We accept a repeated IPC call after reopening the panel in exchange for no renderer cache lifecycle. Main already owns the 15-minute cache.
- We accept a small hook with three local refs in exchange for keeping loading state out of the durable chat store.
- We accept no avatar refresh until cache expiry in exchange for deduplicated provider traffic.

## Alternatives considered

- **Hydrate the entire roster on panel open.** It hides the least complexity from the caller because the panel must coordinate pagination, cancellation, and 500 identities. It loses because it makes the expensive case the default.
- **Add `avatarLoadState` to every `ChatKnownUser` and a renderer avatar cache.** It exposes cache expiry, retry, and loading synchronization to the store and every caller. It loses because main already caches this same profile lookup.
- **Keep enrichment in `MentionAutocomplete` and let the roster read only message avatars.** It hides no reusable capability and gives Twitch roster rows no path to real avatars. It loses because the shared roster model already owns `avatarUrl`.

## Tests

Add focused component and store tests.

- `RecentChattersPanel` renders a 24-pixel proxied avatar and no user badge images when `avatarUrl` exists.
- It requests no more than 25 missing identities when it opens, merges returned profiles, and renders the resolved image.
- It requests the next batch only after an internal group reaches the bottom. It does not change either group's saved scroll position.
- It does not send duplicate identities while a request is pending or after the panel already attempted them.
- It shows the initial fallback for a Twitch user with no avatar and the existing Kick default for a Kick user with no avatar.
- The moderator heading still renders its moderator badge.
- `chat-store` merges a returned profile into the existing user without replacing `lastSeen`, role, badges, or color.
- Handler tests preserve the 25-user limit, case-insensitive dedupe, cache hit behavior, and Kick default-avatar behavior.
- Update mention-autocomplete tests to assert that enrichment writes the shared roster and both surfaces observe the same avatar.

## Migration plan

1. Generalize the existing IPC request and handler names from `Mention` to `KnownUser`. Preserve its channel parameter, cache, limit, and provider lookups.
2. Add `mergeKnownUserProfiles` to `chat-store` and move MentionAutocomplete's local response merge to that action.
3. Add the panel-only hydration hook and replace each row's badge cluster with `ProxiedImage` plus the existing fallback treatment.
4. Delete the obsolete local `enrichedUsers` state from MentionAutocomplete after its caller uses the shared store.
5. Run the focused store, panel, mention, and handler suites. Then exercise a Twitch and a Kick panel in Electron with a long roster.

## Next implementation step

Define `ChatKnownUserProfile` and `mergeKnownUserProfiles`, then migrate the existing mention enrichment call to that shared contract before touching the panel UI.

## Principles that changed the design

Laziness Protocol keeps the existing `avatarUrl`, cache, and IPC route instead of adding an avatar subsystem. Model the Domain puts profile enrichment into the known-user model and its merge action. Boundary Discipline keeps limits and validation in main. Experience First makes visible rows receive avatars without a loading jump. Minimize Reader Load keeps batching in one panel hook. Sequence Work into Verifiable Units gives the migration a store-first test boundary. Prove It Works requires both provider panels to be exercised after unit tests.
