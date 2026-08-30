# Remove chatroom settings from the Kick channel cold path

## Problem

`StreamPage` starts playback and `useChannelByUsername` independently. Kick playback can become usable while `channels:get-by-username` is still pending. The page cannot render the channel card until that query returns, and it cannot mount Kick chat until the returned `UnifiedChannel` has `id`, `kickChannelId`, and `chatroomId`.

The legacy `GET /api/v2/channels/:slug` payload already contains those three identities. `getPublicChannel` parses and validates that payload, then waits for `GET /api/v2/channels/:slug/chatroom` before it returns. Each session request has a 10 second timeout. A hidden `BrowserWindow` fallback can add another 10 second wait and must stay serialized to protect Chromium and the GPU service.

The observed 25.4 second log gap proves that metadata and chat mounted late. It does not prove which backend stage consumed the time. The shared Kick queue can increase the delay, but the evidence does not identify it as the main cause. The separate chatroom-settings request is still proven unnecessary for the page gate because mounted chat requests a fresh settings snapshot through `useChatSettingsSync`.

## Usage from the caller's view

The renderer call stays unchanged.

```ts
const channel = await window.electronAPI.channels.getByUsername({
  platform: "kick",
  username: channelName,
});

// The resolved channel still carries all three independently sourced IDs.
channel.data?.id;
channel.data?.kickChannelId;
channel.data?.chatroomId;
```

`StreamPage` keeps its existing gate. No route, hook, preload, IPC, or shared DTO changes.

```ts
const canMountChatPanel = Boolean(
  channelDataMatchesRoute &&
    channelData?.id &&
    channelData?.kickChannelId &&
    channelData?.chatroomId
);
```

Mounted Kick chat keeps the existing refresh request.

```ts
await window.electronAPI.channels.getByUsername({
  platform: "kick",
  username: channel,
  freshChatroomSettings: true,
});
```

Backend callers of `getPublicChannel(slug, { priority })` continue to receive a `UnifiedChannel`. The default read maps the settings embedded in the channel payload and does not request the authoritative chatroom snapshot.

## Shape

### Data and signatures

Keep the cross-process data model unchanged. In particular, do not make any ID optionality broader and do not infer one Kick ID from another.

```ts
interface UnifiedChannel {
  id: string;
  kickChannelId?: string;
  kickUserId?: string;
  chatroomId?: number;
  chatroomSettings?: KickChatroomSettings;
  // Existing fields remain unchanged.
}
```

Add one private mode inside `channel-endpoints.ts`. The mode is not an IPC option and is not exported from the Kick client.

```ts
type ChatroomSettingsMode = "embedded" | "refresh";

interface PublicChannelReadOptions {
  priority: BrowserWindowPriority;
  chatroomSettingsMode: ChatroomSettingsMode;
}

type PublicChannelInFlight = {
  promise: Promise<UnifiedChannel | null>;
  priority: BrowserWindowPriority;
  chatroomSettingsMode: ChatroomSettingsMode;
};

export async function getPublicChannel(
  slug: string,
  options: { priority?: BrowserWindowPriority } = {}
): Promise<UnifiedChannel | null> {
  return loadPublicChannel(slug, {
    priority: options.priority ?? "normal",
    chatroomSettingsMode: "embedded",
  });
}

async function loadPublicChannel(
  slug: string,
  options: PublicChannelReadOptions
): Promise<UnifiedChannel | null> {
  throw new Error("not implemented");
}

async function doFetchPublicChannel(
  slug: string,
  key: string,
  options: PublicChannelReadOptions
): Promise<UnifiedChannel | null> {
  throw new Error("not implemented");
}
```

`getChannel` selects the private mode from its existing option.

```ts
const publicChannel = await loadPublicChannel(slug, {
  priority: "high",
  chatroomSettingsMode: options.freshChatroomSettings ? "refresh" : "embedded",
});
```

Apply that selection at both current `getPublicChannel` call sites inside `getChannel`, including the signed-out fallback. External callers still use the exported `getPublicChannel` wrapper and always take the fast default.

### Resolution flow

`doFetchPublicChannel` keeps the current direct-session-first behavior and the same hidden-window fallback. Once it validates `PublicChannelPayload`, it reads the IDs exactly as it does today.

```ts
const unifiedId = data.id || data.user_id;
if (!unifiedId) return null;

const chatroomId = typeof data.chatroom?.id === "number" ? data.chatroom.id : undefined;
const kickChannelId =
  data.id != null ? String(data.id) : chatroomId != null ? String(chatroomId) : undefined;
const kickUserId = data.user_id != null ? String(data.user_id) : undefined;

const embeddedSettings = mapKickChatroomToSettings(data.chatroom);
let chatroomSettings = embeddedSettings;

if (options.chatroomSettingsMode === "refresh") {
  const refreshedSettings = win
    ? await fetchKickChatroomSettings(win, slug)
    : await fetchKickChatroomSettingsDirect(slug);
  chatroomSettings = refreshedSettings ?? embeddedSettings;
}
```

The default path has no await after the payload supplies the IDs. If the direct session succeeded, the function returns without the second network request. If the hidden window was necessary, the function destroys that window and releases the existing semaphore immediately after mapping the channel.

The refresh path preserves current behavior. A direct channel read uses the persistent session for the settings request. A hidden-window channel read reuses the same window for the settings request, then destroys the window before it releases the semaphore. A failed refresh falls back to the embedded settings.

The in-flight compatibility rule must include both priority and settings mode.

```ts
function canJoinPublicChannelRead(
  existing: PublicChannelInFlight,
  requested: PublicChannelReadOptions
): boolean {
  const priorityIsSufficient =
    requested.priority === "normal" || existing.priority === "high";
  const settingsAreSufficient =
    requested.chatroomSettingsMode === "embedded" ||
    existing.chatroomSettingsMode === "refresh";
  return priorityIsSufficient && settingsAreSufficient;
}
```

A refresh request must not join an embedded-only promise because that would silently return stale settings. A normal embedded request may join a high-priority refresh promise. The Stream cold path does not hit that case because chat starts its refresh only after the embedded request has returned. The existing semaphore still prevents concurrent hidden windows.

This design keeps the ID parsing at the external-data boundary and preserves the three separate identity fields, per `type-system-discipline`. It removes the proven unnecessary await instead of adding renderer state or another IPC operation, per `fix-root-causes` and `laziness-protocol`.

### Module map

`apps/desktop/src/backend/api/platforms/kick/endpoints/channel-endpoints.ts`

- Owns the private settings mode.
- Returns the default public channel from the v2 payload without fetching `/chatroom`.
- Preserves the authoritative settings refresh behind `getChannel(..., { freshChatroomSettings: true })`.
- Includes the settings mode in in-flight compatibility.
- Keeps the current session, hidden-window, semaphore, negative-cache, and destruction policies.

`apps/desktop/tests/backend/api/platforms/kick/channel-endpoints.test.ts`

- Pins the one-request default path.
- Pins the two-request refresh path and authoritative-settings merge.
- Pins the in-flight rule so a refresh cannot reuse an embedded-only result.

No other production module needs a change. `StreamPage`, `useChannelByUsername`, `useChatSettingsSync`, `kick-client.ts`, channel IPC, preload, and `UnifiedChannel` keep their current signatures.

### Interface depth

The public interface remains `getPublicChannel(slug, { priority })` plus the existing `getChannel(slug, { freshChatroomSettings })`. Callers choose whether they need fresh chat settings at the existing channel boundary. They do not choose a transport, a timeout, a hidden-window policy, or a fetch order.

The private mode hides the source choice between embedded flags and the authoritative snapshot. The exported wrapper is not a pass-through. It fixes the public-read policy to the fast embedded mode so unrelated callers cannot put settings refreshes back on their critical paths.

## Deterministic regression seam

Change the existing test named `hydrates a channel directly without constructing a hidden window` into the cold-path contract. Give the mocked session one valid `/api/v2/channels/:slug` response with all three IDs and embedded flags. Leave every later `mockSessionFetch` call configured to reject immediately.

The assertions are deterministic and use no wall-clock delay.

```ts
const result = await getPublicChannel("direct-streamer");

expect(result).toMatchObject({
  id: "12345",
  kickChannelId: "12345",
  kickUserId: "67890",
  chatroomId: 999,
});
expect(mockSessionFetch).toHaveBeenCalledTimes(1);
expect(mockLoadURL).not.toHaveBeenCalled();
```

This test fails against the current code because the current code makes a second session request for `/chatroom`. It passes only when the default lookup removes that request.

Keep or adapt the existing `bypasses cached channel metadata when fresh chatroom settings are requested` test. Run it through `getChannel(client, slug, { freshChatroomSettings: true })`, return different embedded and authoritative settings, and assert that the authoritative value wins. Also assert the requested paths in order. This guards the deferred work instead of deleting it.

Add one in-flight test with deferred promises. Start an embedded read, then request a refresh for the same slug. Assert that the refresh does not receive the embedded-only promise. Resolve both requests manually. Do not use real timers, a real session, or a real `BrowserWindow`, per `prove-it-works`.

## Runtime measurement

Extend the existing `Public Kick channel lookup slow` fields in `doFetchPublicChannel`. Do not add a new telemetry service.

```ts
{
  slug,
  totalMs,
  channelPayloadMs,
  chatroomSettingsMs,
  chatroomSettingsMode,
  queueWaitMs,
  loadMs,
  extractMs,
  hasChatroom,
  hasCoreChatIds,
  isLive,
}
```

Set `channelPayloadMs` immediately after payload validation and ID extraction. Set `chatroomSettingsMs` only in refresh mode. `hasCoreChatIds` means that `id`, `kickChannelId`, and `chatroomId` are all present. Keep the existing slow threshold and emit the same fields at debug level for successful reads below the threshold if the logger configuration retains debug events.

This measurement separates the channel payload, queue, hidden-window load, extraction, and settings stages. It does not claim that the backend change explains the full 25.4 second gap. After implementation, compare a cold Kick route before and after the change. The default lookup must report `chatroomSettingsMode: "embedded"`, no `chatroomSettingsMs`, and one session request. The post-mount refresh may report a settings duration without delaying the first channel result.

## Synthesis decision

Use the deferred-settings design as the base. It directly removes a sequential 10 second timeout candidate from the card and chat gate while keeping the authoritative refresh after chat mounts. Keep the existing hidden-window policy and identity mapping unchanged.

Take one useful idea from the progressive-data alternative: name the distinction between channel identity and fresh settings. Keep that distinction private rather than adding a second renderer model. Reject request racing and semaphore tuning because neither removes the unnecessary settings wait.

## Tradeoffs accepted

- We accept embedded chat-mode flags during the brief interval before `useChatSettingsSync` finishes in exchange for returning the IDs immediately. Chat already treats the mounted refresh as authoritative.
- We accept a second channel payload read when mounted chat requests `freshChatroomSettings` in exchange for keeping the current cache and hidden-window ownership intact. The requests are sequential, and the cold path performs one fewer request than today.
- We accept that a rare normal embedded caller may join an already-running high-priority refresh and wait for its settings. The Stream cold path cannot produce that order because the refresh starts after chat mounts. Removing this last overlap would require a two-phase in-flight task and a larger change.
- We accept instrumentation in the existing structured log instead of a new end-to-end trace in exchange for a one-module fix. The added stage timings can disprove or confirm this backend hypothesis on the next runtime capture.

## Alternatives considered

### Return progressive channel data through a second renderer query

Introduce `KickChannelCore` for the card and chat IDs, then load `UnifiedChannel` details separately. This would make the renderer coordinate two queries, two cache keys, and a merge rule. It exposes backend loading stages to `StreamPage` and expands the preload and IPC contracts. The selected design gets the same first-render result without that interface cost.

### Race the direct request and hidden `BrowserWindow`

Start both transports and return the first valid response. This can lower a tail caused by one transport, but it doubles work during the worst network conditions and can create renderer and GPU pressure. It also leaves `/chatroom` on the critical path. The selected design removes one request and preserves the serialized fallback.

### Raise priority or replace the FIFO semaphore

Give route metadata a separate window slot or let more hidden windows run concurrently. The current queue can amplify latency, but the log gap does not prove that it caused this incident. More slots weaken the GPU-crash protection. Priority tuning also leaves both 10 second waits intact. Keep the high-priority lane and the single slot until stage timings prove a queue problem.

### Build chat IDs from `UnifiedStream`

Mount chat from playback or stream metadata before the channel lookup returns. `UnifiedStream.channelId` represents the broadcaster identity and does not supply the legacy channel ID or chatroom ID. Substituting one numeric domain for another would make the page faster by making chat incorrect. This alternative is not viable.

## Scorecard

| Design | Removes wait from critical path | ID correctness | GPU and network load | Interface size | Deterministic test | Runtime measurement |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Deferred settings, selected | 5 | 5 | 5 | 5 | 5 | 4 |
| Progressive renderer data | 5 | 5 | 4 | 2 | 4 | 4 |
| Direct and window race | 2 | 5 | 1 | 4 | 3 | 3 |
| Semaphore tuning | 1 | 5 | 2 | 4 | 3 | 4 |
| Stream-derived IDs | 5 | 1 | 5 | 3 | 4 | 3 |

The selected design scores 4 for measurement because it adds stage timings but not a cross-process trace ID. A trace ID is useful only if the focused fix leaves a large unexplained gap.

## Open questions and risks

- Does any non-chat caller depend on the authoritative nested `/chatroom` response rather than the embedded flags? Current source reads fresh settings only through `useChatSettingsSync`, but the implementation review must re-run the caller search before editing.
- Can a high-priority refresh begin before the initial embedded read finishes outside `StreamPage`? If runtime logs show that order, should the in-flight work become two-phase so embedded callers can return before refresh completion?
- After the second request leaves the cold path, does `channelPayloadMs` or `queueWaitMs` still account for most of the delay? If neither does, the next trace must inspect official user enrichment and the suspension-status search in `channel-handlers.ts` rather than tune the semaphore by guesswork.

## Next implementation step

First, change the direct-session test to require one request and verify that it fails on the current code. Then add the private mode and move the authoritative settings await behind the existing `freshChatroomSettings` request.
