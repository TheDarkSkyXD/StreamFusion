# Candidate A

## Caller usage

The chat service keeps one required send operation. It does not coordinate readiness, OAuth scopes, browser windows, or repair UI.

```ts
const result = await window.electronAPI.kickChat.sendMessage(
  channelInfo.chatroomId,
  content,
);

if (!result.ok) showSendError(result.message);
```

The IPC handler delegates once to the deep sender.

```ts
ipcMain.handle(KICK_CHAT_SEND, (_event, chatroomId, content) =>
  sendKickChatMessage(chatroomId, content),
);
```

```ts
export async function sendKickChatMessage(
  chatroomId: number,
  content: string,
): Promise<KickSendResult>;
```

No caller opens a repair popup or invokes a prepare-then-send sequence. Existing channel-join warmup may remain as a latency optimization, but send correctness cannot depend on it.

## Decision

Use the Kick page-context v2 sender as the only chat transport. Make its hidden `kick.com` navigation self-healing when the default Electron session has not exposed the Kick cookie yet.

Remove the missing-cookie early return from `ensureSendWindowReady`. Create or reuse the hidden window and allow one bounded `https://kick.com/` load before deciding that the session is expired. That load can rehydrate Kick SSO. Cookie and bearer checks become post-navigation evidence.

Do not use `/public/v1/chat` first or as a fallback. It historically returned success without broadcasting for this app. A successful response therefore cannot prove delivery, and a fallback after it risks duplicate messages. The current application OAuth scopes also omit `chat:write`.

Delete the new send-time repair popup path. If hidden rehydration fails, return `auth-expired` through the existing send result. The current error surface can direct the user to reconnect Kick in Settings.

## Type sketch

Keep the public result discriminated and readiness private.

```ts
export type KickSendResult =
  | { ok: true; messageId?: string }
  | {
      ok: false;
      kind:
        | "auth-expired"
        | "forbidden"
        | "rate-limited"
        | "network"
        | "unknown";
      message: string;
      retryAfterSeconds?: number;
    };

type ReadyKickSession = {
  window: BrowserWindow;
  bearer: KickWebBearer;
};

type KickSessionReadiness =
  | { kind: "ready"; session: ReadyKickSession }
  | { kind: "auth-expired" }
  | { kind: "network"; message: string };

async function ensureSendWindowReady(): Promise<KickSessionReadiness>;

async function sendViaPageContext(
  session: ReadyKickSession,
  chatroomId: number,
  content: string,
): Promise<KickSendResult>;
```

`ensureSendWindowReady` shares one in-flight warmup promise. It clears that promise and disposes unusable window state after failure so a later send can try again.

## Module map

### `apps/desktop/src/backend/api/platforms/kick/kick-send-window.ts`

- Remove the missing-cookie terminal preflight.
- Create or reuse the hidden window before classifying authentication.
- Perform one bounded Kick navigation and readiness poll.
- Read cookies and capture the bearer after navigation.
- Send only through the page-context v2 request.
- Remove the official-first branch and its `chat:write` gate.
- Share concurrent warmup work and reset failed state.

### `apps/desktop/src/backend/ipc/handlers/kick-chat-handlers.ts`

Call `sendKickChatMessage(chatroomId, content)` directly. Do not invoke repair UI or pass a broadcaster user ID that only served the official endpoint.

### `apps/desktop/src/backend/services/chat/kick-chat.ts`

Keep draft validation and visible error presentation. Pass only chatroom ID and content. Eager warmup remains optional.

### `apps/desktop/src/backend/services/kick-chat-send-coordinator.ts`

Delete this module if its remaining purpose is popup repair. Do not retain a pass-through coordinator. Session repair belongs beside the hidden page and authentication evidence in `kick-send-window.ts`.

### IPC contract surfaces

Update `apps/desktop/src/preload/index.ts` and `apps/desktop/src/shared/electron.d.ts` only if they thread `broadcasterUserId` or expose popup repair. Keep one renderer send call.

## Invariants

1. An absent cookie before hidden navigation never produces `auth-expired`.
2. Concurrent cold sends share one warmup promise and navigation.
3. No message request runs until readiness succeeds.
4. Only the page-context v2 response can produce `ok: true`.
5. The sender never falls back after any transport reports success.
6. One explicit v2 authentication failure may cause one reload and retry. A second failure stops.
7. Failed or destroyed window state resets so a future send can recover.
8. No send failure opens a popup or changes the active view.
9. Post-navigation missing session evidence returns a stable `auth-expired` result.

## Test seam

Use the existing Electron and request mocks at the send-window boundary. Add an internal dependency object only if tests cannot control navigation, cookie reads, bearer capture, and time. Do not export it.

Required regression cases follow.

1. The first cookie read is empty. The hidden window still loads Kick. The cookie and bearer appear during load. The v2 send succeeds.
2. Session evidence remains absent after the bounded load. The result is `auth-expired`. No popup is invoked.
3. Two concurrent cold sends cause one hidden navigation. Each message is sent once after readiness.
4. No official API request is made and no `chat:write` scope is required.
5. One v2 authentication failure reloads and retries once. A second returns `auth-expired`.
6. A warmup timeout clears stale state. A later send creates a fresh window and succeeds.
7. IPC and service tests prove that broadcaster ID and popup callbacks are absent from the send flow.

Place these cases in:

- `apps/desktop/tests/backend/api/platforms/kick/kick-send-window.test.ts`
- `apps/desktop/tests/backend/ipc/handlers/kick-chat-handlers.test.ts`
- `apps/desktop/tests/backend/services/chat/kick-chat.test.ts`

Delete `apps/desktop/tests/backend/services/kick-chat-send-coordinator.test.ts` with the rejected coordinator.

## Alternatives rejected

### Keep the preflight and open a repair popup

Rejected. The preflight blocks the hidden load that may restore SSO. The popup is outside the desired send experience.

### Use the official endpoint first and fall back to v2

Rejected. An official `2xx` historically did not mean broadcast. Falling back can duplicate messages. Stopping can silently lose them.

### Add a separate repair coordinator

Rejected. It exposes temporal stages and duplicates knowledge held by the send-window module. The caller should request a send, not orchestrate browser-session recovery.

## Tradeoffs and risks

- Cold sends may wait for one hidden page load. Existing best-effort join warmup can reduce this latency.
- The web request is brittle, but it has observed broadcast evidence that the official endpoint lacks.
- Removing official-first gives up a simpler path for legacy scoped tokens. This is intentional because its success response is not trustworthy.
- A genuinely expired session requires a manual reconnect in Settings. This matches the requested interaction.
- A short warmup timeout can misclassify a slow network. Distinguish network failure from missing post-navigation session evidence.
- Failed promise cleanup can strand later sends. Tests must prove reset after every terminal branch.
- An ambiguous network retry can duplicate a message. Retry only after an explicit authentication rejection.
- Dormant official-send or popup code can regress the design. Remove both authorities in the same change.

## Exact scope

This candidate changes Kick chat sending only. It does not change OAuth consent, add `chat:write`, alter Twitch chat, redesign general account repair, or introduce renderer UI. Production code remains untouched until the arena owner selects a synthesis.
