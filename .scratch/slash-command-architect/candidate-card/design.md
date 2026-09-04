# Slash-command result card: candidate design

## Usage (caller first)

`ChatInput` owns one ephemeral `commandResult` state and renders
`<CommandResultCard result={commandResult} onDismiss={clearCommandResult} />`
immediately above the composer/footer. Submitting `/vips` or `/mods` calls the
platform orchestrator, awaits its official typed API call, and receives a
`CommandResult`; the raw slash text is consumed and never reaches
`sendChatPayload`. A successful action command may return no card. A command
error is converted to an error result in the same card (and the draft is
restored according to the existing send flow).

The card is renderer-local React state: it is not passed to `addMessage`, the
chat message store, persistence, history hydration, or a websocket. Dismissal
clears the single result; a later command replaces it. No command dependency
receives an URL opener or browser/navigation callback. Existing non-command
restriction UI may retain its separately documented channel-page callback.

## Type sketch

```ts
export type CommandResultTone = "info" | "success" | "error";

export interface CommandResult {
  readonly id: string;
  readonly tone: CommandResultTone;
  readonly title: string;
  readonly body: string;
  readonly command: string; // normalized name, e.g. "/vips"
}

export type CommandExecutionResult =
  | { readonly kind: "none" }
  | {
      readonly kind: "result";
      readonly tone?: Exclude<CommandResultTone, "success">;
      readonly title?: string;
      readonly body: string;
    };

export interface ProviderCommandRequest {
  readonly command: ChatCommandDefinition;
  readonly args: string;
  readonly text: string;
}

export type ProviderCommandHandler = (
  request: ProviderCommandRequest
) => Promise<CommandExecutionResult>;
```

`CommandResult` is view data, not a `ChatMessage`; in particular it has no
`platform`, `channel`, timestamp, or persistence/wire serialization fields.
The handler contract is intentionally result-oriented: it prevents an
orchestrator from smuggling informational output through the message store.

## Signatures and flow

```ts
// ChatInput props
onProviderCommand?: ProviderCommandHandler;

// Shared command execution boundary (one per platform)
runTwitchCommandEffect(
  definition: TwitchCommandDefinition,
  args: string,
  dependencies: TwitchCommandSessionDependencies
): Promise<CommandExecutionResult>;

runKickCommandEffect(
  definition: KickCommandDefinition,
  args: string,
  dependencies: KickCommandSessionDependencies
): Promise<CommandExecutionResult>;

// Twitch dependency: existing typed IPC/API contracts remain the source of truth
readChannelMembers: (
  list: "moderators" | "vips"
) => Promise<TwitchApiResult<unknown>>;
```

Submission order remains: serialize editor → parse/validate command → if a
command, clear the draft and invoke `onProviderCommand` → show returned result
or map thrown failure to the card → never call `sendChatPayload` for that
submission. Local `/help` can use the same card (or existing inline help), but
must not be sent. Unknown/unavailable slash commands are card/validation
feedback and are never sent.

The Twitch orchestrator supplies `readChannelMembers` as the current typed
operations: `/mods` maps to
`window.electronAPI.twitch.execute({ operation: "get-moderators", broadcasterId: channelId })`
and `/vips` maps to
`window.electronAPI.twitch.execute({ operation: "get-vips", broadcasterId: channelId })`.
The session validates the typed response, formats a bounded informational body,
and returns it. It must not call `addMessage` or open a page. Official action
effects (`api`, IRC action, moderation, disconnect, engagement) keep their
existing calls and return `{ kind: "none" }` unless a concise local result is
useful. The command registry/effect unions contain no `open-url` or navigation
variant.

## Module map

- `frontend/features/chat/components/chat/ChatInput.tsx`: owns result state,
  command-submit interception, error mapping, and card placement above the
  composer; never writes command feedback to chat history.
- `frontend/features/chat/components/chat/CommandResultCard.tsx`: presentational,
  dismissible, keyboard-accessible `role="status"`/alert presentation; no API,
  store, or navigation imports.
- `frontend/features/chat/utils/chat-command-registry.ts`: command metadata,
  parsing, role/access and effect unions. Keep official effects; explicitly
  exclude external navigation.
- `frontend/features/chat/utils/twitch-command-session.ts`: scope checks,
  official action dispatch, typed `/mods` and `/vips` reads, response
  validation/formatting, and conversion to `CommandExecutionResult`.
- `frontend/features/chat/utils/kick-command-session.ts`: same result contract
  for Kick official actions and local notices.
- `frontend/features/chat/components/chat/twitch/TwitchChat.tsx` and
  `kick/KickChat.tsx`: adapt platform dependencies and return session results;
  do not call `addMessage` for command notices.
- `frontend/features/chat/components/chat/ChatPanel.tsx`: unchanged routing;
  card remains inside the composer surface.

## Tests

- Registry/parser tests: known commands parse; unknown slash text is rejected;
  `/vips` and `/mods` produce `channel-members`; no command produces a URL/open
  effect; role/scope failures remain typed errors.
- Session tests: Twitch `/mods` and `/vips` call exactly the existing typed
  operations and format valid/empty/malformed/error responses as results;
  official action effects still invoke their dependency exactly once.
- `ChatInput` tests: command submission invokes the provider handler and never
  `sendChatPayload`; returned result renders one card; a second result replaces
  the first; dismiss removes it; thrown errors render a card and restore the
  draft; raw `/...` text never enters the message-store mock.
- Card tests: accessible dismiss control, tone/title/body rendering, and no
  navigation or persistence side effects.

## Tradeoffs

Returning a result instead of adding a synthetic system message makes the
non-persistence invariant structural and keeps chat history truthful, at the
cost of threading one result through both platform orchestrators. A single
card avoids a second scrollable message stream and gives predictable replacement
semantics, but concurrent commands should be serialized by the existing
`isSendingRef` (the latest completed result wins). Keeping formatting in the
Twitch session gives API-specific validation and bounded output, while the card
stays platform-neutral. Errors are shown in the card rather than silently
discarded; this slightly changes existing inline-error presentation but gives
all slash outcomes one consistent, dismissible surface.

## Synthesis decision

Choose the result-returning adapter boundary. It preserves official command
execution and existing typed Twitch APIs, while making “raw slash is never
posted” and “informational feedback is renderer-local/non-persisted” properties
of the call graph rather than conventions. Keep navigation out of the command
effect algebra entirely, and use one card owned by `ChatInput` above the
composer.
