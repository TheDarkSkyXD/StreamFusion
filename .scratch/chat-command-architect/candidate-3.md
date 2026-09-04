# Candidate 3. One completion controller and typed command plans

## Problem

ChatInput owns a controlled contenteditable draft, emote slots, and the send
path. It currently owns a local CHAT_COMMANDS list, yet only /me has an
execution path. Other listed commands pass through sendMessage as raw chat
text. That is dangerous for moderation actions and makes the advertised
platform inventory untrustworthy.

The composer also has three keyboard handlers. ChatInput,
MentionAutocomplete, and ContextualEmoteRow all respond to keys. The last two
attach document listeners. The result depends on listener order and makes an
@username argument compete with a command or emote panel.

The design keeps normal chat sending in ChatInput. It moves command policy into
one typed registry, gives the contenteditable one completion controller, and
makes TwitchChat and KickChat execute validated command plans through their
existing platform-specific boundaries.

## Usage

TwitchChat supplies the current platform account state and a typed executor. It
does not pass individual command flags into ChatInput.

~~~tsx
const commandAccess = commandAccessFor({
  platform: "twitch",
  isAuthenticated,
  isModerator: isMod,
});

<ChatInput
  ref={chatInputRef}
  platform="twitch"
  channel={channel}
  channelId={channelId ?? null}
  canSend={isAuthenticated && isTwitchConnected}
  isAuthenticated={isAuthenticated}
  viewerUserId={isAuthenticated ? twitchUser?.id : undefined}
  commandAccess={commandAccess}
  onExecuteCommand={(command) =>
    executeTwitchComposerCommand(command, {
      channel,
      broadcasterId: channelId,
      moderatorId: twitchUser?.id,
    })
  }
/>
~~~

KickChat uses the same ChatInput contract. Its executor only receives plans the
registry says Kick supports.

~~~tsx
const commandAccess = commandAccessFor({
  platform: "kick",
  isAuthenticated,
  isModerator: isMod,
});

<ChatInput
  ref={chatInputRef}
  platform="kick"
  channel={channel}
  channelId={kickRoomKey || null}
  chatroomId={chatroomId}
  canSend={isAuthenticated && isKickConnected}
  isAuthenticated={isAuthenticated}
  viewerUserId={isAuthenticated && kickUser ? String(kickUser.id) : undefined}
  commandAccess={commandAccess}
  onExecuteCommand={(command) =>
    executeKickComposerCommand(command, { channel, channelId, chatroomId })
  }
/>
~~~

The user experience has one keyboard path.

~~~text
/timeout @al 600 spam
          ^

ArrowDown selects the next matching chatter.
Tab or Enter inserts "@alice ".
Enter again validates and executes the timeout plan.
~~~

The first Enter never sends /timeout through either chat service. A failed typed
mutation leaves the draft intact and shows its safe error.

The registry produces the autocomplete inventory. Signed-in viewers receive
viewer commands. Signed-in moderators receive viewer commands plus moderator
commands. Guests receive no account-required command. The initial inventory is
deliberately small.

| Command | Twitch | Kick | Access | Effect |
| --- | --- | --- | --- | --- |
| /me <text> | yes | yes | viewer | Twitch action. Kick keeps its established *text* fallback. |
| /timeout @user <duration> [reason] | yes | yes | moderator | Existing state-aware timeout IPC. |
| /ban @user [reason] | yes | yes | moderator | Typed Twitch mutation or Kick moderation IPC. |
| /unban @user | yes | yes | moderator | Typed Twitch mutation or Kick moderation IPC. |
| /clear | yes | no | moderator | Twitch typed clear-chat mutation. |
| /slow and /slowoff | yes | no | moderator | Twitch chat-settings mutation. |
| /followers and /followersoff | yes | no | moderator | Twitch chat-settings mutation. |
| /subscribers and /subscribersoff | yes | no | moderator | Twitch chat-settings mutation. |
| /emoteonly and /emoteonlyoff | yes | no | moderator | Twitch chat-settings mutation. |

Kick does not advertise /clear because the available Kick strip clears the
local feed only. A command named /clear must not imply a platform-wide mutation
that StreamFusion cannot perform. No command calls raw sendMessage to
impersonate a moderation action.

## Shape

### Command domain

ChatKnownUser already provides the stable user ID and canonical username needed
for a local command target. The parser accepts both alice and @alice, but
resolves them through the active channel's usersByChannel record. Selecting a
mention simply makes that resolution unambiguous. A typed manual name that is
not in the roster produces a local error. It never falls back to a raw command
send.

~~~ts
import type { ChatKnownUser, ChatPlatform } from "@shared/chat-types";

export type CommandRole = "guest" | "viewer" | "moderator";

export type CommandAccess =
  | { role: "guest"; platform: ChatPlatform }
  | { role: "viewer"; platform: ChatPlatform }
  | { role: "moderator"; platform: ChatPlatform };

export function commandAccessFor(input: {
  platform: ChatPlatform;
  isAuthenticated: boolean;
  isModerator: boolean;
}): CommandAccess;

export interface TextRange {
  start: number;
  end: number;
}

export interface CommandTarget {
  userId: string;
  username: string;
  displayName: string;
}

export type CommandGrammar =
  | { kind: "message" }
  | { kind: "none" }
  | { kind: "target"; reason: "optional" | "forbidden" }
  | { kind: "timeout" };

export type ComposerCommand =
  | { kind: "action"; text: string }
  | { kind: "clear-chat" }
  | { kind: "timeout"; target: CommandTarget; duration: number; reason?: string }
  | { kind: "ban"; target: CommandTarget; reason?: string }
  | { kind: "unban"; target: CommandTarget }
  | { kind: "set-slow-mode"; seconds: number | null }
  | { kind: "set-followers-only"; minutes: number | null }
  | { kind: "set-subscribers-only"; enabled: boolean }
  | { kind: "set-emote-only"; enabled: boolean };

export interface CommandDefinition {
  id: string;
  name: string;
  description: string;
  platforms: readonly ChatPlatform[];
  minimumRole: "viewer" | "moderator";
  grammar: CommandGrammar;
  toPlan(input: {
    args: string;
    lookupUser(username: string): ChatKnownUser | undefined;
  }): { ok: true; command: ComposerCommand } | { ok: false; message: string };
}

export type ComposerSubmission =
  | { kind: "message"; text: string }
  | { kind: "command"; command: ComposerCommand }
  | { kind: "invalid-command"; message: string };

export function listCommands(access: CommandAccess): readonly CommandDefinition[];
export function parseComposerSubmission(input: {
  draft: string;
  access: CommandAccess;
  knownUsers: Readonly<Record<string, ChatKnownUser>>;
}): ComposerSubmission;
~~~

COMMAND_DEFINITIONS is a readonly table. It is the only owner of a command's
name, description, grammar, platform availability, and minimum role.
Autocomplete calls listCommands. Submission calls parseComposerSubmission.
There is no second CHAT_COMMANDS object and no platform-specific command
filtering in a view.

CommandAccess is a union rather than isAuthenticated plus isMod. A guest cannot
accidentally acquire a moderator command list through a contradictory pair of
booleans. commandAccessFor collapses caller state into guest, viewer, or
moderator once at the boundary.

The parser verifies command syntax and locally known targets. The state-aware
timeout service verifies duration limits, target state, account scope, and role
again at the privileged boundary. A parser cannot make a moderation request
safe on its own.

### Completion domain

Completion derives from the controlled draft and caret. There is one active
variant and one selected index. Escape records a dismissed match signature so
the same unchanged token does not reopen the panel until the user edits or moves
the caret.

~~~ts
export type ComposerCompletion =
  | { kind: "none" }
  | {
      kind: "command";
      range: TextRange;
      selectedIndex: number;
      items: readonly CommandDefinition[];
    }
  | {
      kind: "mention";
      range: TextRange;
      selectedIndex: number;
      items: readonly ChatKnownUser[];
    }
  | {
      kind: "emote";
      range: TextRange;
      selectedIndex: number;
      items: readonly Emote[];
    };

export interface ComposerCompletionController {
  completion: ComposerCompletion;
  refresh(input: {
    draft: string;
    caret: number;
    access: CommandAccess;
    knownUsers: Readonly<Record<string, ChatKnownUser>>;
    emotes: readonly Emote[];
  }): void;
  handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): boolean;
  dismiss(): void;
}

export function useComposerCompletion(input: {
  draft: string;
  caret: number;
  access: CommandAccess;
  knownUsers: Readonly<Record<string, ChatKnownUser>>;
  emotes: readonly Emote[];
  replace(range: TextRange, text: string, emote?: Emote): void;
}): ComposerCompletionController;
~~~

The controller calculates the current token before choosing a panel.

1. A first-token slash range selects command completion.
2. A whitespace-delimited token that begins with @ selects mention completion.
   This includes /timeout @al and rejects an embedded @ in an email address.
3. An emote trigger selects emote completion.

Each completion view receives the controller's selected index and a click
callback. None registers a document key listener. The contenteditable's
existing onKeyDown calls handleKeyDown first. It consumes Arrow keys, Tab,
Enter, and Escape only while a completion has selectable items. A normal Enter
sends only when the controller reports no handled key. Shift+Enter keeps the
existing newline behavior when no completion consumed it.

Mention selection calls the existing replaceMessageRange path with a completed
username and trailing space. It therefore preserves emote-slot offsets and
works at any argument position. Mention roster loading stays in the existing
chat-store snapshot and keeps enrichMentionUsers as a presentation enrichment
request. It does not add remote lookup to every keystroke.

### Explicit execution boundary

ChatInput separates a normal message from a parsed command before it clears the
draft.

~~~ts
export type CommandExecutionResult =
  | { ok: true }
  | { ok: false; message: string };

export type ExecuteComposerCommand = (
  command: ComposerCommand
) => Promise<CommandExecutionResult>;

export interface ChatInputProps {
  // Existing composer fields omitted.
  commandAccess: CommandAccess;
  onExecuteCommand: ExecuteComposerCommand;
}
~~~

For a message submission, ChatInput keeps the present send flow and calls
sendChatPayload. For a command submission, it calls onExecuteCommand and does
not call sendChatPayload, twitchChatService.sendMessage, or
kickChatService.sendMessage from the moderation branch. It clears the draft
only after success. A false result retains the exact rich-editor draft, reply
state, and caret.

The two platform callers are intentionally small exhaustive switches. They do
not parse strings, repeat access policy, or filter inventories.

~~~ts
async function executeTwitchComposerCommand(
  command: ComposerCommand,
  context: {
    channel: string;
    broadcasterId: string | null | undefined;
    moderatorId: string | null | undefined;
  }
): Promise<CommandExecutionResult>;

async function executeKickComposerCommand(
  command: ComposerCommand,
  context: {
    channel: string;
    channelId: string | null | undefined;
    chatroomId: number | undefined;
  }
): Promise<CommandExecutionResult>;
~~~

Twitch dispatches clear-chat, ban-user, unban-user, and update-chat-settings
through window.electronAPI.twitch.execute. It only uses
twitchChatService.sendAction for the viewer action command. Kick dispatches
banUser and unbanUser through window.electronAPI.kickChat. Both providers
execute timeout through the existing state-aware moderation sequence.

~~~ts
const snapshot = await window.electronAPI.moderation.createTimeoutSnapshot({
  platform,
  channelId,
  channelSlug: channel,
  targetUserId: command.target.userId,
  targetUsername: command.target.username,
  action: "timeout",
});

if (snapshot.state !== "available") return unavailable(snapshot);

return mapTimeoutResult(
  await window.electronAPI.moderation.submitTimeout({
    snapshotId: snapshot.snapshotId,
    duration: command.duration,
    ...(command.reason ? { reason: command.reason } : {}),
  })
);
~~~

That service rechecks authority and target state immediately before the real
mutation. Its snapshot policy owns duration units and bounds. The composer only
requires a positive whole number, then surfaces the returned policy error when
the provider rejects it. This avoids a second, drifting timeout policy.

The executor rejects a stale or incomplete platform context before calling an
API. The backend remains authoritative. Twitch and Kick IPC handlers validate
their own input and sender origin, and the timeout IPC has its own Zod boundary
validation.

## Module map

apps/desktop/src/frontend/features/chat/utils/composer-commands.ts owns the
readonly command definitions, CommandAccess, syntax parsing, target lookup, and
command plan union. It has no React, Electron, or platform API imports.

apps/desktop/src/frontend/features/chat/components/chat/use-composer-completion.ts
owns active completion, selection, dismissal, and keyboard handling. It calls
the replacement callback supplied by ChatInput and installs no document
listeners.

apps/desktop/src/frontend/features/chat/components/chat/CommandAutocomplete.tsx
renders command rows only. It receives a selected index and selection callback.

apps/desktop/src/frontend/features/chat/components/chat/MentionAutocomplete.tsx
keeps the chat-store snapshot, filtering, avatar enrichment, and list rendering.
It becomes a controlled list. Its document keyboard effect and private selected
index disappear.

apps/desktop/src/frontend/features/chat/components/chat/ContextualEmoteRow.tsx
keeps emote list rendering and becomes a controlled list. Its document keyboard
effect disappears.

apps/desktop/src/frontend/features/chat/components/chat/ChatInput.tsx owns the
draft, cursor, rich-editor replacement, one completion controller, and
submission split. Remove CHAT_COMMANDS, parseCommand, the direct /me branch,
and completion-specific early returns from this file.

apps/desktop/src/frontend/features/chat/components/chat/twitch/TwitchChat.tsx
builds CommandAccess and owns the Twitch typed command switch beside existing
typed moderation actions.

apps/desktop/src/frontend/features/chat/components/chat/kick/KickChat.tsx builds
CommandAccess and owns the Kick typed command switch beside existing moderation
IPC calls.

No new IPC channel, shared contract, or global store is needed. The existing
state-aware timeout IPC, typed Twitch API command union, Kick moderation IPC,
and chat-store user index cover the required boundaries.

## Rationale

The typed registry models the actual command domain rather than extending an
if-chain in ChatInput. A definition describes availability and parsing once.
The public renderer contract is two props, commandAccess and onExecuteCommand.
Callers do not learn token parsing, command syntax, or completion precedence.
This is a deep interface with a short call chain.

ChatInput remains the owner of the controlled contenteditable. Its children
render a completion state but cannot mutate the editor or observe global keys.
This preserves the current emote-slot invariant and removes the listener-order
race without a cross-component event bus.

Provider differences stay next to provider effects. The shared registry says
what a command means and who may see it. TwitchChat and KickChat say how that
valid command reaches their platform. This keeps raw auth tokens and privileged
calls out of shared UI code.

The decisions follow these principles.

- principle-model-the-domain selects a registry and discriminated command plan
  instead of repeated command-name conditionals.
- principle-type-system-discipline uses a role union and command-plan union so
  guests cannot become moderators through a flag combination and executors
  handle every effect explicitly.
- principle-boundary-discipline keeps syntax parsing in pure renderer code,
  then relies on typed platform APIs and timeout snapshot validation for real
  authority.
- principle-minimize-reader-load keeps one keyboard owner in ChatInput and
  avoids an execution facade that only forwards the same plan to platform code.
- principle-experience-first prioritizes predictable keyboard selection and
  prevents moderators from seeing commands StreamFusion cannot honestly run.
- principle-foundational-thinking puts the registry and plan shape before UI
  changes so filtering, autocomplete, parsing, and execution agree by
  construction.

## Design red-flag check

This has no pass-through command service. onExecuteCommand changes the
abstraction from a platform-neutral parsed plan to a real platform effect. The
registry hides policy instead of leaking role and platform checks into three
callers. Completion is grouped by the state it owns, not by a sequence of
keyboard stages. Platform transport types do not cross into the shared
registry.

## Synthesis decision

This is an arena candidate. It recommends the registry plus plan boundary as
the base shape. The arena owner should compare it with candidates that move
more logic into a backend command service or retain autonomous completion
panels. I would reject those alternatives unless they show a smaller caller
contract and preserve the existing timeout validation boundary.

## Tradeoffs accepted

- We accept an initial command target must be present in the active channel's
  known-user index in exchange for a stable user ID and no new per-keystroke
  platform lookup.
- We accept two short provider execution switches in exchange for keeping
  platform API details out of ChatInput and avoiding a generic mutation IPC.
- We accept Twitch-only chat-mode commands in exchange for never advertising a
  Kick mutation that currently has no matching safe command boundary.
- We accept immediate timeout submission after snapshot creation in exchange
  for standard slash-command Enter behavior. The existing service validates
  authority and target state again before execution.

## Alternatives considered

| Alternative | Why it loses |
| --- | --- |
| Let each panel keep a document key listener and coordinate with stop propagation. | It exposes listener ordering and editor focus details to three panels. It cannot guarantee one selection owner. |
| Give ChatInput a second object of platform command flags and let it call platform services. | It duplicates policy, grows the composer API, and lets UI code impersonate moderation commands as chat sends. |
| Add one generic chat execute-command IPC endpoint. | It hides platform behavior behind a broad transport union and duplicates already typed Twitch and Kick boundaries. The small per-platform switch is clearer. |
| Keep Kick /clear as local-feed clearing. | The typed text promises a channel-wide moderation action but only changes local UI state. It is misleading. |

## Tests and implementation order

1. Add pure tests for listCommands and parseComposerSubmission. Cover guest,
   viewer, and moderator access on both platforms. Assert unsupported commands
   cannot parse into a plan and that an @username command target resolves from
   usersByChannel.
2. Extract controlled completion. Add a ChatInput integration test for
   /timeout @al, then ArrowDown, Tab, and Enter. It must select one mention,
   call the command executor once, and never call either normal chat send
   method. Cover Escape, normal Enter, Shift+Enter, and emote keyboard behavior
   in the same controller test rather than three listener tests.
3. Add one executor test per provider. Twitch must map /ban, /clear, and a
   chat-mode command to exact twitch.execute operations. Kick must map ban and
   unban to exact kickChat IPC methods. Both timeout executors must call
   snapshot then submit. Each failed result must retain the draft.
4. Update the existing mention and contextual-emote tests to assert no document
   keydown listener. Keep avatar enrichment, pagination, and rich-editor
   editing coverage.

The throughput checkpoint is simple. The pure registry and completion hook can
be built independently. ChatInput is the shared write point and should be
integrated after both are tested. TwitchChat, KickChat, and their executor tests
can proceed in parallel because they touch disjoint provider files. No new
shared mutable state is introduced.

## Open questions and risks

- Should Kick retain its current /me fallback that sends *text*, or should the
  registry omit /me until Kick offers a native action protocol? The current
  composer supports the fallback while a development fixture labels it
  Twitch-only. Product should settle that inconsistency before implementation.
- Is local-roster-only targeting acceptable for a moderator who needs to act on
  a user not represented in the retained 500-user chat index? If not, add a
  deliberate, debounced target resolver at the command submit boundary. Do not
  turn mention autocomplete into remote search.
- Should timeout commands prompt for confirmation? This candidate preserves
  normal slash-command Enter behavior and relies on the existing two-phase
  authority check. A confirmation would need an explicit pending-command state
  so cancellation can preserve the draft.

## Next implementation step

Create composer-commands.ts with the inventory above and write its access,
platform, syntax, and target-resolution tests before changing ChatInput.
