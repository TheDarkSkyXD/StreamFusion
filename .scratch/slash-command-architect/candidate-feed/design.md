# Candidate: ephemeral command-result projection

## Usage first

`ChatInput` keeps the existing submit flow. It parses a leading slash against
the access-filtered registry. A recognized command is submitted to the active
platform executor; ordinary text alone reaches `sendChatPayload`.

```ts
const result = await commandRunner.run({
  platform, channel, command: parsed.definition, args: parsed.args,
});
resultFeed.publish(result); // renderer-local only
```

The chat presentation consumes one visual sequence, but not one persistence
model:

```tsx
<ChatMessageList
  rows={buildChatRows({
    messages: chatStore.messagesByChannel[channelKey],
    commandResults: resultFeed.forChannel(channelKey),
  })}
/>
```

Command rows appear inline near the relevant chat timestamp, with a subdued
system treatment. They disappear on channel/session teardown or bounded FIFO
eviction, and can never be rehydrated as chat history.

## Type sketch

Keep command definitions and official effects in `chat-command-registry.ts` and
`twitch-command-session.ts`. Add a renderer-only result domain rather than
manufacturing a `ChatMessage` (the current `createPrivateCommandMessage` shape
is too easy to send through `addMessage` and persistence).

```ts
type CommandResultKind = "info" | "success" | "error";

interface CommandResultContext {
  readonly channelKey: string; // produced by buildChannelKey
  readonly platform: ChatPlatform;
  readonly channel: string;
  readonly commandName: string;
}

interface CommandResult {
  readonly id: string;
  readonly context: CommandResultContext;
  readonly kind: CommandResultKind;
  readonly text: string;
  readonly timestamp: number;
  readonly expiresAt?: number;
}

interface EphemeralCommandResultFeed {
  readonly publish: (result: Omit<CommandResult, "id" | "timestamp">) => void;
  readonly forChannel: (channelKey: string) => readonly CommandResult[];
  readonly clearChannel: (channelKey: string) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

type ChatRow =
  | { readonly kind: "message"; readonly message: ChatMessage }
  | { readonly kind: "command-result"; readonly result: CommandResult };

function buildChatRows(input: {
  readonly messages: readonly ChatMessage[];
  readonly commandResults: readonly CommandResult[];
}): readonly ChatRow[];
```

`createEphemeralCommandResultFeed({ maxPerChannel, clock })` is a small
renderer-owned external store (or context-backed instance), not a persisted
Zustand store. It owns only bounded, current-renderer-lifetime data. `useSync-
ExternalStore` makes updates reliable without putting results in
`useChatStore`.

## Execution signatures and invariants

```ts
interface CommandRunner {
  run(input: {
    readonly platform: ChatPlatform;
    readonly channel: { readonly id: string; readonly login: string };
    readonly command: ChatCommandDefinition;
    readonly args: string;
  }): Promise<void>;
}

interface TwitchCommandRunnerDeps {
  readonly executeApi: (
    command: Extract<TwitchApiCommand, { operation: "execute-slash-command" }>
  ) => Promise<TwitchApiResult>;
  readonly readChannelMembers: (
    list: "moderators" | "vips"
  ) => Promise<TwitchApiResult<unknown>>;
  readonly publish: (kind: CommandResultKind, text: string) => void;
}
```

1. `ChatInput` validates/parses first. For `parsedCommand`, it never invokes
   `sendChatPayload`, `twitchChatService.sendMessage`, or Kick send; the raw
   slash text therefore cannot be posted or become a persisted chat message.
2. `CommandRunner` delegates official actions to the existing platform seams.
   Twitch mutations continue through `window.electronAPI.twitch.execute` and
   the existing `execute-slash-command` discriminated API. `/mods` and `/vips`
   continue through exactly the typed `get-moderators` and `get-vips` commands,
   via `readChannelMembers`; no URL construction or generic fetch is introduced.
3. Informational output, validation failures, scope/reconnect notices, and API
   failures call `publish`, never `addMessage`. Success may publish a concise
   confirmation after the official action resolves.
4. The effect union has no `openExternal`, `navigate`, URL, or shell capability.
   A command can be an API mutation, IRC/action message, disconnect,
   engagement-panel request, channel-members read, or local notice only.
   Registry review and a type-level exhaustiveness check reject external-page
   behavior.
5. `buildChatRows` merges by timestamp and stable tie-breaker. Command rows
   are presentation-only and excluded from `savePersistedChatHistory`, replay,
   merged-feed source buckets, and any backend IPC payload.

## Module map

```text
frontend/features/chat/utils/
  chat-command-registry.ts       parse, access, compile; no UI/state
  twitch-command-session.ts      existing Twitch effect execution
  command-runner.ts              catches/normalizes result and scope errors
  ephemeral-command-result-feed.ts  bounded external store, no persistence

frontend/features/chat/components/chat/
  ChatInput.tsx                  parse gate; command branch never sends raw text
  ChatMessageList.tsx             renders ChatRow union
  chat-row-feed.ts                timestamp merge, keying, no store writes
  twitch/TwitchChat.tsx           wires typed API and publishes notices
  kick/KickChat.tsx               wires Kick executor and publishes notices
```

Prefer a feed instance scoped to the ChatWorkspace or ChatPanel provider so a
channel switch cannot leak results. `clearChannel` runs with the same lifecycle
that drops a chat session. The feed's state is intentionally not serializable
and has no Zustand `persist` middleware.

## Tests

- `command-runner.test.ts`: recognized slash commands invoke the official
  executor; raw command text is never passed to either platform send method;
  executor rejection becomes an `error` result.
- `ephemeral-command-result-feed.test.ts`: publish/subscribe, channel
  isolation, FIFO bound, expiry/clear, and no `localStorage` or persistence
  adapter calls.
- `chat-row-feed.test.ts`: chronological merge, deterministic ties, stable
  keys, and command rows absent from the messages input remain visible.
- Existing Twitch command-session tests: `/mods` maps to
  `{ operation: "get-moderators", broadcasterId }`, `/vips` maps to
  `{ operation: "get-vips", broadcasterId }`, malformed member data becomes a
  local error, and neither path opens a page.
- `ChatInput` integration test: `/unknown` and invalid args stay local; a
  valid API command executes once; no `addMessage`/persisted-history call
  receives a synthetic command message.
- Registry invariant test: every compiled effect is in the allowlisted union,
  and no definition contains navigation/external-shell metadata.

## Tradeoffs

This adds a visual row union and a tiny external store, but makes the critical
boundary explicit: canonical chat remains canonical and persistence cannot
accidentally absorb command feedback. A context-scoped feed is slightly more
plumbing than appending a synthetic `ChatMessage`, and command results vanish
on reload by design. The bounded feed avoids unbounded memory during long
sessions; timestamp merging can make a late API response appear above newer
chat unless its timestamp is assigned at publication time, which is intentional
and should be covered by the ordering test.
