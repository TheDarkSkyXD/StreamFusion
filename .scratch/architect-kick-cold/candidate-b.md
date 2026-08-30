# Candidate B: Fast public channel identity, fresh chat settings off the route path

## Problem

`StreamPage` starts playback and `channels:get-by-username` independently. Playback can be ready while the info card and Kick chat rail wait for `UnifiedChannel`. Kick chat cannot mount until `UnifiedChannel.id`, `kickChannelId`, and `chatroomId` are present. For Kick, `getChannel` enriches official channel data with `getPublicChannel`, and `getPublicChannel` already gets the three required IDs from `/api/v2/channels/:slug`. It then waits for `/api/v2/channels/:slug/chatroom` before returning. That second settings read can consume the 10 second session timeout. If the first read falls back to a hidden `BrowserWindow`, page load can add another 10 seconds. The 25.4 second log gap proves late metadata and chat mount, but it does not prove the FIFO semaphore is the main cause.

The root fix is to stop making fresh chatroom settings a prerequisite for returning channel identity. Keep ID correctness strict. Keep hidden-window serialization intact. Move the fresh settings wait to the chat settings lifecycle that already runs after chat mounts.

## Usage

Existing route code should continue to call the same IPC surface:

```ts
await window.electronAPI.channels.getByUsername({
  platform: "kick",
  username: channel,
});
```

The backend default route lookup should return as soon as the v2 channel payload has valid identity and chatroom fields. It may include inline `chatroomSettings` derived from `data.chatroom`, but it must not await the separate `/chatroom` snapshot.

The mounted chat settings hook keeps its current call:

```ts
await window.electronAPI.channels.getByUsername({
  platform: "kick",
  username: channel,
  freshChatroomSettings: true,
});
```

That call still bypasses the channel cache and fetches the authoritative `/chatroom` snapshot. It runs after `KickChat` has mounted, so settings freshness no longer gates the card, chat service preload, Pusher join, or recent history seed.

Direct backend callers that need the historical `getPublicChannel` behavior can opt into it explicitly, or keep the default if compatibility is preferred:

```ts
await getPublicChannel(slug, {
  priority: "high",
  chatroomSettings: "inline",
});

await getPublicChannel(slug, {
  priority: "high",
  chatroomSettings: "fresh",
});
```

## Shape

Add one small policy option at the Kick public-channel boundary:

```ts
type BrowserWindowPriority = "high" | "normal";
type PublicChannelChatroomSettingsMode = "inline" | "fresh";

interface PublicChannelOptions {
  priority?: BrowserWindowPriority;
  chatroomSettings?: PublicChannelChatroomSettingsMode;
}

interface KickChannelLookupOptions {
  freshChatroomSettings?: boolean;
}

export async function getChannel(
  client: KickRequestor,
  slug: string,
  options: KickChannelLookupOptions = {}
): Promise<UnifiedChannel | null>;

export async function getPublicChannel(
  slug: string,
  options: PublicChannelOptions = {}
): Promise<UnifiedChannel | null>;
```

`getChannel` owns the policy translation:

```ts
const publicChannel = await getPublicChannel(slug, {
  priority: "high",
  chatroomSettings: options.freshChatroomSettings ? "fresh" : "inline",
});
```

`getPublicChannel` owns the transport detail:

```ts
const chatroomSettings =
  options.chatroomSettings === "fresh"
    ? win
      ? await fetchKickChatroomSettings(win, slug)
      : ((await fetchKickChatroomSettingsDirect(slug)) ??
          mapKickChatroomToSettings(data.chatroom))
    : mapKickChatroomToSettings(data.chatroom);
```

The data model stays `UnifiedChannel`. No renderer contract change is needed. The only new public surface is one backend option on an already backend-local endpoint function. `freshChatroomSettings` remains the IPC-level intent, and `getChannel` maps that intent to the lower-level public-channel setting mode.

This follows boundary discipline. Raw v2 payloads stay private to `channel-endpoints.ts`. The renderer receives the same parsed domain object. It also follows type-system discipline. The setting mode is a closed union, not another boolean whose meaning must be inferred from call-site timing.

## Why This Is The Smallest Root-Cause Fix

The critical path needs identity, not a fresh settings snapshot. `/api/v2/channels/:slug` is already the source for:

- `UnifiedChannel.id`
- `UnifiedChannel.kickChannelId`
- `UnifiedChannel.kickUserId`
- `UnifiedChannel.chatroomId`
- `subscriberBadges`
- useful card fields such as display name, avatar, banner, live state, category, title, and follower count

Only `chatroomSettings` needs the second `/chatroom` snapshot for account-age mode and stale flag correction. `KickChat` already calls `useChatSettingsSync`, and that hook already requests `freshChatroomSettings: true` on mount and reconnect. The existing hook is the right lifecycle owner for freshness. The route lookup is only the wrong owner because it blocks unrelated user-visible readiness.

This follows fix-root-causes. The wait is removed from the code path that delays chat mount instead of adding more frontend loading states or semaphore priority tweaks.

## Deterministic Regression Seam

Add a backend endpoint test in `apps/desktop/tests/backend/api/platforms/kick/channel-endpoints.test.ts`.

Test name:

```ts
it("returns public channel identity without awaiting the chatroom snapshot in inline mode", async () => {
  mockSessionFetch
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 12345,
          user_id: 67890,
          slug: "cold-route",
          user: { username: "ColdRoute" },
          chatroom: {
            id: 999,
            followers_mode: false,
            subscribers_mode: false,
            emotes_mode: false,
            slow_mode: false,
          },
          livestream: { session_title: "Live now" },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )
    .mockImplementationOnce(() => new Promise<Response>(() => undefined));

  const result = await getPublicChannel("cold-route", {
    priority: "high",
    chatroomSettings: "inline",
  });

  expect(result).toMatchObject({
    id: "12345",
    kickChannelId: "12345",
    kickUserId: "67890",
    chatroomId: 999,
  });
  expect(mockSessionFetch).toHaveBeenCalledTimes(1);
  expect(mockLoadURL).not.toHaveBeenCalled();
});
```

This fails against the current shape because there is no inline option and the second `/chatroom` request is always awaited. It is deterministic because the second request never resolves and the passing behavior is proven by call count and successful return.

Add a second test for `getChannel` policy:

```ts
it("uses inline public chatroom settings for the normal channel lookup", async () => {
  await getChannel(client, "cold-route");
  expect(mockSessionFetch).toHaveBeenCalledTimes(1);
});

it("uses the fresh chatroom snapshot when requested", async () => {
  await getChannel(client, "cold-route", { freshChatroomSettings: true });
  expect(mockSessionFetch).toHaveBeenCalledTimes(2);
});
```

The first test guards the route path. The second preserves the `useChatSettingsSync` freshness contract.

## Runtime Measurability

Keep the existing slow lookup log, but split the timing fields so regressions identify the stage:

```ts
logger.info("Kick:Endpoints:Channel", "Public Kick channel lookup slow", {
  slug,
  settingsMode,
  totalMs,
  queueWaitMs,
  channelReadMs,
  loadMs,
  extractMs,
  chatroomSettingsMs,
  hasChatroom: Boolean(data.chatroom),
  hasChatroomId: typeof chatroomId === "number",
  isLive: data.livestream !== null,
});
```

Expected route result after the fix:

- Normal stream route logs `settingsMode: "inline"` and `chatroomSettingsMs: 0`.
- Chat settings hook logs `settingsMode: "fresh"` only after chat has mounted.
- Existing `queueWaitMs` still shows whether the hidden-window FIFO is contributing.

## Alternatives Considered

### Alternative 1: Add a new `channels:get-kick-chat-ready` IPC

This would return `{ id, kickChannelId, chatroomId }` for route mounting and let the existing channel query finish later. It removes the wait, but it leaks Kick-specific identity assembly into a new renderer-facing contract. `StreamPage` would need to coordinate two channel sources and merge partial data. That is a shallow interface. It exposes backend timing complexity to the page.

Rejected.

### Alternative 2: Race `/chatroom` with a short timeout

`getPublicChannel` could keep fetching fresh settings, but give up after 250 to 500 ms and fall back to inline settings. This improves median latency but keeps a timer policy on the critical path. It also creates a tuning problem. A slow but healthy settings response would sometimes win and sometimes lose depending on local network timing.

Rejected.

### Alternative 3: Priority or split semaphores for route metadata

Giving route lookups their own Kick request slot or hidden-window priority may help under burst load. It does not remove the unnecessary `/chatroom` wait after the route already has the required IDs. It can also increase GPU or network pressure if implemented as more concurrency.

Rejected for this fix. Keep as a later investigation only if logs still show queue wait after the critical-path removal.

### Alternative 4: Remove chatroom settings from `UnifiedChannel` entirely

This is architecturally clean because settings freshness belongs to `useChatSettingsSync`, not channel identity. It is larger than needed. Existing call sites and tests already consume `chatroomSettings`, and the fresh hook uses the channel IPC as its fetch seam.

Rejected for now. It may be a later cleanup after this latency fix lands.

## Tradeoffs Accepted

- We accept that normal route channel data may carry inline settings that can be stale in exchange for returning authoritative IDs promptly. The mounted hook refreshes settings and owns last-write-wins room state.
- We accept one new backend option in exchange for no renderer API expansion.
- We accept that a Cloudflare challenge on the first channel payload can still require a serialized hidden `BrowserWindow`. That is the unavoidable source for IDs in the legacy path. The fix removes only the second settings wait.
- We accept that direct `getPublicChannel` callers may need an explicit mode audit during implementation. That audit is small and keeps compatibility choices local.

## Rejected Red Flags

- Shallow module avoided. Callers still ask for a channel. They do not coordinate channel identity plus settings themselves.
- Information leakage avoided. Raw Kick payloads and `/chatroom` transport details stay inside `channel-endpoints.ts`.
- Temporal decomposition avoided. The route does not learn about load stages. It receives one `UnifiedChannel`.
- Pass-through avoided. `freshChatroomSettings` remains meaningful policy at the IPC and client method boundary.

## Score

| Axis | Grade | Reason |
| --- | --- | --- |
| Direct removal from critical path | A | The second `/chatroom` request is not awaited for normal `getChannel` route lookup. |
| Correctness | A- | ID fields still come from the same parsed v2 channel payload and existing slug validation. Settings may be stale until the hook refreshes them. |
| No GPU or network burst | A | It removes one request. It does not add hidden windows or raise concurrency. |
| Small interface surface | A- | One backend-local option is added. No renderer contract changes. |
| Deterministic test | A | A never-resolving second request proves the route mode returns without awaiting it. |
| Runtime measurability | B+ | Existing slow logs become stage-specific. A full page-level mount metric would be useful but is not required for the root fix. |

## Open Questions And Risks

- Should direct `kickClient.getPublicChannel(slug)` keep historical fresh settings by default, or should every caller choose `inline` or `fresh` explicitly? I recommend preserving the default and making `getChannel` explicit.
- Are there any non-chat consumers that rely on account-age mode being present in `UnifiedChannel.chatroomSettings` before chat mounts? I did not find one in the traced route path.
- If a live route still shows a large gap after this fix, is the first `/api/v2/channels/:slug` call falling into the hidden-window timeout? The proposed logging will answer that without guessing.

## Next Implementation Step

Add `PublicChannelChatroomSettingsMode` to `channel-endpoints.ts`, wire `getChannel` to request `inline` for normal lookups and `fresh` for `freshChatroomSettings`, then add the never-resolving `/chatroom` regression test.

## Notes From Grounding

The task referenced `.agents/skills/architect/prompts/runner.md` and `.agents/skills/architect/references/design-flags.md`. Those exact paths were not present. I used the matching local architect files `.agents/skills/architect/references/runner-prompt.md` and `.agents/skills/architect/references/design-red-flags.md`.
