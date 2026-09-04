# Candidate 1: typed composer completions and command execution

## Recommendation

Keep `ChatInput` as the controlled editor and make it the sole keyboard-selection owner. Add one feature-local command registry used by both autocomplete and submission parsing. Platform callers provide an audience and a typed executor. A resolved platform mutation can only cross an existing typed IPC boundary; it can never fall through to `sendMessage`.

## Caller usage first

```tsx
// TwitchChat.tsx
<ChatInput
  {...existingProps}
  platform="twitch"
  commandAudience={toCommandAudience(isAuthenticated, isMod)}
  executeCommand={executeTwitchChatCommand}
/>

// KickChat.tsx
<ChatInput
  {...existingProps}
  platform="kick"
  commandAudience={toCommandAudience(isAuthenticated, isMod)}
  executeCommand={executeKickChatCommand}
/>
```

Inside `ChatInput`, submission resolves before ordinary chat-send eligibility checks. Normal messages and `/me` still use the existing chat path and its room-mode checks. Real moderation actions use the supplied executor.

```ts
const submission = resolveComposerSubmission({
  platform,
  audience: commandAudience,
  draft: message,
  knownUsers,
})

switch (submission.kind) {
  case "message":
  case "action-message":
    return sendEligibleChat(submission)
  case "platform-command":
    return runCommand(submission.action)
  case "rejected-command":
    return showComposerError(submission.message)
}
```

## Type sketch

```ts
type ChatPlatform = "twitch" | "kick"

type CommandAudience =
  | { kind: "guest" }
  | { kind: "signed-in"; role: "viewer" | "moderator" }

type RequiredAudience = "signed-in" | "moderator"

type TwitchCommandAction =
  | { kind: "ban-user"; userId: string; reason?: string }
  | { kind: "timeout-user"; userId: string; durationSeconds: number; reason?: string }
  | { kind: "unban-user"; userId: string }
  | { kind: "clear-chat" }
  | { kind: "set-room-mode"; mode: TwitchRoomMode; enabled: boolean; seconds?: number }

type KickCommandAction =
  | { kind: "ban-user"; userId: string; reason?: string }
  | { kind: "timeout-user"; userId: string; durationSeconds: number; reason?: string }
  | { kind: "unban-user"; userId: string }

type CommandActionByPlatform = {
  twitch: TwitchCommandAction
  kick: KickCommandAction
}

type ComposerSubmission<P extends ChatPlatform> =
  | { kind: "message"; body: string }
  | { kind: "action-message"; body: string }
  | { kind: "platform-command"; action: CommandActionByPlatform[P] }
  | { kind: "rejected-command"; code: CommandErrorCode; message: string }

type CommandDefinition<P extends ChatPlatform = ChatPlatform> = {
  name: `/${string}`
  platforms: readonly P[]
  requiredAudience: RequiredAudience
  syntax: string
  description: string
  parse: (context: ParseCommandContext<P>) => ParseCommandResult<P>
}

type CompletionSession =
  | { kind: "mention"; range: TextRange; query: string; selectedKey?: string }
  | { kind: "command"; range: TextRange; query: string; selectedKey?: string }
  | { kind: "emote"; range: TextRange; query: string; selectedKey?: string }
```

The registry is the single source for platform, audience, help text, and parser. Audience is a discriminated union, so a guest moderator state is unrepresentable. Moderator ranking includes both `signed-in` and `moderator` definitions. Guests receive no initial commands because every initial command requires an account.

## Core signatures

```ts
function listAvailableCommands<P extends ChatPlatform>(input: {
  platform: P
  audience: CommandAudience
  query: string
}): readonly CommandSuggestion[]

function resolveComposerSubmission<P extends ChatPlatform>(input: {
  platform: P
  audience: CommandAudience
  draft: string
  knownUsers: readonly ChatKnownUser[]
}): ComposerSubmission<P>

function matchCompletion(draft: string, cursor: number): CompletionMatch | null

function useComposerCompletionController(input: {
  draft: string
  cursor: number
  platform: ChatPlatform
  audience: CommandAudience
  knownUsers: readonly ChatKnownUser[]
  emotes: readonly Emote[]
  replaceRange: (range: TextRange, replacement: string) => void
}): {
  session: CompletionSession | null
  items: readonly CompletionItem[]
  activeDescendantId?: string
  handleKeyDown: (event: React.KeyboardEvent) => boolean
  select: (key: string) => void
  dismiss: () => void
}

type ChatCommandExecutor<P extends ChatPlatform> = (
  action: CommandActionByPlatform[P],
) => Promise<{ ok: true; message?: string } | { ok: false; code: string; message: string }>
```

## Completion behavior

`matchCompletion` is pure and returns ranges in original-draft offsets. Its precedence is mention, then command, then emote.

- Mention matches a current token whose `@` starts at the draft boundary or after an allowed separator. It does not match email-like text. It works anywhere, including `/timeout @al`.
- Command matches only the leading slash token while the cursor is before its first whitespace. After `/timeout `, the command menu closes and mention matching can take over.
- Emote matching stays suppressed inside mention, command, URL, and email tokens.

`ChatInput` calls the controller first from its existing `onKeyDown`. The dropdown components become passive views without document listeners or local selection state.

- Mention and command use Up/Down, Tab/Enter to commit, and Escape to dismiss.
- Contextual emotes use Left/Right, Tab to commit, and Escape to dismiss. Enter remains unhandled and sends the draft, preserving current behavior.
- An empty result set never traps Enter. Escape still dismisses it.
- Dismissal stores the current match fingerprint until draft or cursor changes, preventing immediate reopen.
- Selection uses stable item keys rather than array indices, so asynchronous enrichment cannot move the selected user.

Mention candidates come from `chat-store`'s channel-scoped `usersByChannel` index. Remove the redundant message scan. Snapshot candidate identity when a mention session opens, enrich only presentation data, and key enrichment by `platform:userId` rather than username. Replacement uses the latest editor range and refs. The editor exposes `aria-controls`, `aria-expanded`, and `aria-activedescendant`; views expose stable option IDs.

## Initial command inventory

| Platform | Signed-in viewer | Moderator additions |
|---|---|---|
| Twitch | `/me` | `/ban`, `/timeout`, `/unban`, `/clear`, `/slow`, `/slowoff`, `/followers`, `/followersoff`, `/subscribers`, `/subscribersoff`, `/emoteonly`, `/emoteonlyoff` |
| Kick | `/me` | `/ban`, `/timeout`, `/unban` |

Do not advertise Kick `/clear`: the current clear operation is local, not a provider mutation. Do not advertise Kick room modes until they have a main-owned typed IPC boundary. Unsupported, unknown, disallowed, or malformed leading slash commands resolve to `rejected-command`; none become raw chat messages.

## Validated execution boundary

Autocomplete filtering is discovery policy, not authorization. Executors translate already parsed intents into existing typed boundaries:

- Twitch ban, unban, clear, and room modes call `window.electronAPI.twitch.execute(...)` with the existing typed command union.
- Timeouts on both platforms use `moderation.createTimeoutSnapshot(...)` followed by `moderation.submitTimeout(...)`, preserving authority revalidation, snapshot expiry, and idempotency.
- Kick ban and unban call the existing `kickChat` IPC methods.
- Main-process IPC keeps sender-origin and payload validation. The platform service remains responsible for authenticated provider calls.

User mutations require a stable current-channel `userId`. A manually typed or stale username that cannot resolve through the known-user index returns a validation error and retains the draft. Clear the draft only after successful execution.

## Module map

```text
apps/desktop/src/frontend/features/chat/components/chat/
  ChatInput.tsx                           modify: orchestration and sole key owner
  MentionAutocomplete.tsx                modify: passive view
  CommandAutocomplete.tsx                add: passive view
  ContextualEmoteRow.tsx                  modify: passive view
  use-composer-completion-controller.ts  add: match, rank, select state
  chat-command-registry.ts               add: definitions, filtering, parsing
  composer-submission.ts                 add: pure submission resolver
  twitch/TwitchChat.tsx                  modify: audience and Twitch executor
  kick/KickChat.tsx                      modify: audience and Kick executor
```

Keep platform executor adapters adjacent to their chat orchestrators unless their size justifies one sibling file each. No new generic cross-platform IPC is needed for the initial inventory.

## Verification seams

- Registry matrix tests cover guest, signed-in viewer, moderator, and both platforms.
- Matcher table tests cover start/middle tokens, email and URL exclusions, and mentions in every command argument position.
- Controller tests assert one key owner, empty-list behavior, dismissal fingerprints, stable selection, and existing emote Enter behavior.
- Submission tests prove every slash-prefixed input resolves to action or rejection, never `message`.
- `ChatInput` integration tests prove completion commits update the controlled contentEditable range and that command execution bypasses ordinary room-mode send checks.
- Executor tests assert exact typed IPC payloads and draft retention on failure. Existing IPC tests remain the authority checks.

## Rationale

**Forces.** The composer already owns text and cursor synchronization, while provider containers own identity and authority context. Suggestions and submission must agree on platform and role. Remote moderation must stay visibly separate from chat transport.

**Decision.** Put command knowledge in one small typed registry, interaction policy in one completion controller, and provider effects behind caller-supplied typed executors. `ChatInput` coordinates them without learning Twitch or Kick IPC shapes.

**Accepted tradeoffs.** The passive-view refactor touches all three completion surfaces, but removes competing keyboard listeners. Destructive user commands only accept known current-channel users, favoring stable identity over permissive username guessing. Kick initially has a smaller truthful inventory.

**Alternatives rejected.** A generic cross-platform command IPC would duplicate existing typed boundaries and centralize unrelated provider policy. Independent autocomplete listeners retain keyboard races. Sending slash strings through chat makes mutations masquerade as messages. A shared IPC command catalog would couple renderer help text to transport contracts without improving authorization.

## Design red-flag screen

- The controller has one deep interface: session, items, one key handler, select, and dismiss.
- `ChatInput` sees command intents, not provider wire payloads.
- Registry rows colocate definition, visibility, and parsing, avoiding temporal decomposition and duplicated policy.
- Executors change abstraction from validated intent to typed provider call; they are not pass-through wrappers.
- The initial design adds no speculative server catalog, generic command bus, or duplicate user cache.

Candidate 1 recommendation. Parent arena synthesis remains the final decision point.
