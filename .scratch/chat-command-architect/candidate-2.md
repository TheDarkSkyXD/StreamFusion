# Candidate 2: command-aware composer

## Usage

`ChatInput` keeps ownership of the controlled contentEditable draft. Twitch and Kick keep ownership of platform facts and side effects.

```tsx
// TwitchChat.tsx
const commandContext = useMemo<ChatCommandContext>(
  () => ({
    platform: "twitch",
    channel: { slug: channel, id: channelId ?? null },
    viewer: twitchUser
      ? {
          kind: "authenticated",
          id: twitchUser.id,
          username: twitchUser.login,
          role: twitchUser.id === channelId ? "broadcaster" : isMod ? "moderator" : "viewer",
        }
      : { kind: "guest", role: "guest" },
    chat: { canSend: isAuthenticated && isTwitchConnected },
  }),
  [channel, channelId, isAuthenticated, isMod, isTwitchConnected, twitchUser]
);

const executeCommandAction = useTwitchComposerCommandExecutor({
  channel,
  channelId: channelId ?? null,
  twitchUser,
  promptReconnect,
  updateRoomState,
  clearMessages,
  channelKey,
});

<ChatInput
  platform="twitch"
  channel={channel}
  channelId={channelId ?? null}
  commandContext={commandContext}
  onCommandAction={executeCommandAction}
  canSend={isAuthenticated && isTwitchConnected}
  isAuthenticated={isAuthenticated}
  viewerUserId={isAuthenticated ? twitchUser?.id : undefined}
  viewerCanBypassRoomModes={isMod}
/>;
```

```tsx
// KickChat.tsx
const commandContext = useMemo<ChatCommandContext>(
  () => ({
    platform: "kick",
    channel: {
      slug: channel,
      id: kickRoomKey || null,
      chatroomId: chatroomId ?? null,
      broadcasterUserId: kickUserId ?? null,
    },
    viewer: kickUser
      ? {
          kind: "authenticated",
          id: String(kickUser.id),
          username: kickUser.slug || kickUser.username,
          role: signedInUserIsBroadcaster ? "broadcaster" : isMod ? "moderator" : "viewer",
        }
      : { kind: "guest", role: "guest" },
    chat: { canSend: isAuthenticated && isKickConnected },
  }),
  [channel, chatroomId, isAuthenticated, isKickConnected, isMod, kickRoomKey, kickUser, kickUserId, signedInUserIsBroadcaster]
);

const executeCommandAction = useKickComposerCommandExecutor({
  channel,
  channelId: kickRoomKey || null,
  chatroomId: chatroomId ?? null,
  kickUser,
  updateRoomState,
  clearMessages,
  channelKey,
});

<ChatInput
  platform="kick"
  channel={channel}
  channelId={kickRoomKey || null}
  chatroomId={chatroomId}
  kickUserId={kickUserId}
  commandContext={commandContext}
  onCommandAction={executeCommandAction}
  canSend={isAuthenticated && isKickConnected}
  isAuthenticated={isAuthenticated}
  viewerUserId={kickUser ? String(kickUser.id) : undefined}
  viewerCanBypassRoomModes={isMod}
/>;
```

Inside `ChatInput`, the caller sees one hook and one submit planner.

```tsx
const mentionIndex = useChatMentionIndex({ platform, channel });
const completion = useChatComposerCompletion({
  draft: { text: message, emoteSlots, cursorPosition },
  context: commandContext,
  mentionIndex,
  emoteCandidates: getContextualEmoteCandidates({
    platform,
    channelId,
    viewerIsSubscribed,
  }),
});

const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
  if (completion.onKeyDown(event)) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void handleSend();
  }
};

const plan = planChatSubmission({
  draft: { text: message, emoteSlots },
  serializedText: serializeMessage(message, emoteSlots, platform),
  context: commandContext,
  mentionResolver: mentionIndex.resolve,
});

switch (plan.kind) {
  case "chat-message":
    await sendChatPayload(plan.message, plan.fragments);
    break;
  case "action-message":
    await sendChatAction(plan.message, plan.fragments);
    break;
  case "command-action":
    await onCommandAction(plan.action);
    break;
  case "rejected":
    setError(plan.message);
    restoreSubmittedDraft();
    break;
}
```

This usage is the contract. The composer asks "what is this draft?" once, and only then decides whether to run chat-send checks or command-action checks.

## Type sketch

```ts
export type ChatViewerRole = "guest" | "viewer" | "moderator" | "broadcaster";
export type ChatCommandAuth = "guest-ok" | "account-required";
export type ChatCommandEffect = "chat-message" | "local-ui" | "moderation-mutation" | "channel-mutation";

export interface ChatCommandContext {
  platform: ChatPlatform;
  channel: {
    slug: string;
    id: string | null;
    chatroomId?: number | null;
    broadcasterUserId?: string | null;
  };
  viewer:
    | { kind: "guest"; role: "guest" }
    | {
        kind: "authenticated";
        id: string;
        username: string;
        role: Exclude<ChatViewerRole, "guest">;
      };
  chat: {
    canSend: boolean;
  };
}

export type CommandArgumentSpec =
  | { kind: "user"; name: "target"; required: true }
  | { kind: "duration"; name: "duration"; required: boolean; defaultSeconds?: number }
  | { kind: "text"; name: "message" | "reason"; required: boolean; consumeRest: boolean }
  | { kind: "toggle"; name: "state"; values: readonly ["on", "off"] };

export interface PlatformCommandVariant {
  names: readonly SlashCommandName[];
  syntax: string;
  minRole: Exclude<ChatViewerRole, "guest">;
  auth: ChatCommandAuth;
  args: readonly CommandArgumentSpec[];
}

export interface ChatCommandDefinition<I extends ChatCommandIntent = ChatCommandIntent> {
  id: ChatCommandId;
  title: string;
  description: string;
  effect: ChatCommandEffect;
  platforms: Partial<Record<ChatPlatform, PlatformCommandVariant>>;
  buildIntent(input: {
    platform: ChatPlatform;
    name: SlashCommandName;
    args: ParsedCommandArgs;
    context: ChatCommandContext;
    resolveMention: MentionResolver;
  }): CommandBuildResult<I>;
}

export type MentionPurpose =
  | { kind: "plain-chat" }
  | { kind: "command-argument"; commandId: ChatCommandId; argument: "target" };

export interface MentionCandidate {
  userId: string;
  username: string;
  displayName: string;
  color?: string;
  avatarUrl?: string;
  role: ChatKnownUserRole;
  lastSeen: Date;
}

export type CompletionState =
  | { kind: "none" }
  | {
      kind: "commands";
      query: string;
      range: TextRange;
      items: readonly CommandSuggestion[];
      selectedIndex: number;
      acceptsEnter: true;
    }
  | {
      kind: "mentions";
      query: string;
      range: TextRange;
      purpose: MentionPurpose;
      items: readonly MentionCandidate[];
      selectedIndex: number;
      acceptsEnter: true;
    }
  | {
      kind: "emotes";
      query: string;
      range: TextRange;
      items: readonly EmoteSuggestion[];
      selectedIndex: number;
      acceptsEnter: boolean;
    };

export type ChatSubmitPlan =
  | { kind: "chat-message"; message: string; fragments: ContentFragment[] }
  | { kind: "action-message"; message: string; fragments: ContentFragment[] }
  | { kind: "command-action"; action: ChatCommandAction }
  | { kind: "rejected"; code: ChatCommandRejectCode; message: string };

export type ChatCommandAction =
  | {
      kind: "timeout-user";
      platform: ChatPlatform;
      target: MentionCandidate;
      durationSeconds: number;
      reason?: string;
    }
  | { kind: "ban-user"; platform: ChatPlatform; target: MentionCandidate; reason?: string }
  | { kind: "unban-user"; platform: ChatPlatform; target: MentionCandidate }
  | { kind: "warn-user"; platform: "twitch"; target: MentionCandidate; reason: string }
  | { kind: "clear-chat"; platform: ChatPlatform }
  | {
      kind: "set-chat-mode";
      platform: ChatPlatform;
      mode: "slow" | "followers" | "subscribers" | "emote-only";
      enabled: boolean;
      durationSeconds?: number;
    };
```

The registry uses one entry per domain command, with platform-specific forms attached to the entry. That keeps policy in one place.

```ts
export const CHAT_COMMAND_REGISTRY = [
  defineCommand({
    id: "action-message",
    title: "/me",
    description: "Send an action message.",
    effect: "chat-message",
    platforms: {
      twitch: {
        names: ["me"],
        syntax: "/me <message>",
        minRole: "viewer",
        auth: "account-required",
        args: [{ kind: "text", name: "message", required: true, consumeRest: true }],
      },
      kick: {
        names: ["me"],
        syntax: "/me <message>",
        minRole: "viewer",
        auth: "account-required",
        args: [{ kind: "text", name: "message", required: true, consumeRest: true }],
      },
    },
    buildIntent: notImplemented,
  }),
  defineCommand({
    id: "timeout-user",
    title: "/timeout",
    description: "Temporarily stop a user from chatting.",
    effect: "moderation-mutation",
    platforms: {
      twitch: {
        names: ["timeout"],
        syntax: "/timeout @user [seconds] [reason]",
        minRole: "moderator",
        auth: "account-required",
        args: [
          { kind: "user", name: "target", required: true },
          { kind: "duration", name: "duration", required: false, defaultSeconds: 600 },
          { kind: "text", name: "reason", required: false, consumeRest: true },
        ],
      },
      kick: {
        names: ["timeout"],
        syntax: "/timeout @user <seconds> [reason]",
        minRole: "moderator",
        auth: "account-required",
        args: [
          { kind: "user", name: "target", required: true },
          { kind: "duration", name: "duration", required: true },
          { kind: "text", name: "reason", required: false, consumeRest: true },
        ],
      },
    },
    buildIntent: notImplemented,
  }),
  defineCommand({
    id: "set-chat-mode",
    title: "/slow",
    description: "Change chat room modes.",
    effect: "channel-mutation",
    platforms: {
      twitch: {
        names: ["slow", "slowoff", "followers", "followersoff", "subscribers", "subscribersoff", "emoteonly", "emoteonlyoff"],
        syntax: "/slow <seconds>, /slowoff, /followers <minutes>, /followersoff, /subscribers, /subscribersoff, /emoteonly, /emoteonlyoff",
        minRole: "moderator",
        auth: "account-required",
        args: [],
      },
      kick: {
        names: ["slow", "followonly", "subonly", "emoteonly"],
        syntax: "/slow on <seconds>, /slow off, /followonly on, /followonly off, /subonly on, /subonly off, /emoteonly on, /emoteonly off",
        minRole: "moderator",
        auth: "account-required",
        args: [],
      },
    },
    buildIntent: notImplemented,
  }),
] satisfies readonly ChatCommandDefinition[];
```

The first slice should add entries for these StreamFusion-backed commands:

| Command id | Twitch forms | Kick forms | Visible to | Execution |
| --- | --- | --- | --- | --- |
| `action-message` | `/me <message>` | `/me <message>` | signed-in viewer and above | existing chat service action path |
| `timeout-user` | `/timeout @user [seconds] [reason]` | `/timeout @user <seconds> [reason]` | signed-in moderator and broadcaster | `moderation.createTimeoutSnapshot` then `moderation.submitTimeout` |
| `ban-user` | `/ban @user [reason]` | `/ban @user [reason]` | signed-in moderator and broadcaster | Twitch `twitch.execute`; Kick `kickChat.banUser` |
| `unban-user` | `/unban @user` | `/unban @user` | signed-in moderator and broadcaster | Twitch `twitch.execute`; Kick `kickChat.unbanUser` |
| `warn-user` | `/warn @user <reason>` | none | signed-in Twitch moderator and broadcaster | Twitch `twitch.execute` |
| `clear-chat` | `/clear` | `/clear` | signed-in moderator and broadcaster | Twitch `twitch.execute`; Kick needs explicit `kickChat.clearChat` IPC before it is enabled |
| `set-chat-mode` | `/slow`, `/slowoff`, `/followers`, `/followersoff`, `/subscribers`, `/subscribersoff`, `/emoteonly`, `/emoteonlyoff` | `/slow on/off`, `/followonly on/off`, `/subonly on/off`, `/emoteonly on/off` | signed-in moderator and broadcaster, except Kick `/subonly` can require broadcaster if we mirror Kick owner-only docs | Twitch `twitch.execute`; Kick needs explicit `kickChat.setChatMode` IPC before it is enabled |

Do not register commands that StreamFusion cannot execute or render yet. Twitch `/mods`, `/vips`, `/color`, `/w`, and Kick `/title`, `/category`, `/poll`, `/prediction`, `/raid`, `/vip`, `/unvip`, `/mod`, and `/unmod` should wait until each has a visible StreamFusion result and a typed executor. The registry can represent them later without changing the composer.

## Signatures

```ts
export function getAvailableChatCommands(
  registry: readonly ChatCommandDefinition[],
  context: ChatCommandContext
): readonly AvailableChatCommand[];

export function deriveComposerCompletion(input: {
  draft: RichChatDraft;
  context: ChatCommandContext;
  commands: readonly AvailableChatCommand[];
  mentionIndex: ChatMentionIndex;
  emoteCandidates: readonly EmoteSuggestion[];
}): CompletionState;

export function applyCompletionSelection(input: {
  draft: RichChatDraft;
  selection: CompletionSelection;
}): RichChatDraft;

export function planChatSubmission(input: {
  draft: RichChatDraft;
  serializedText: string;
  context: ChatCommandContext;
  mentionResolver: MentionResolver;
}): ChatSubmitPlan;

export function useChatComposerCompletion(input: {
  draft: RichChatDraft;
  context: ChatCommandContext;
  mentionIndex: ChatMentionIndex;
  emoteCandidates: readonly EmoteSuggestion[];
  onApplyDraft: (draft: RichChatDraft) => void;
  onClose: () => void;
}): {
  state: CompletionState;
  onKeyDown(event: React.KeyboardEvent<HTMLElement>): boolean;
  onHover(index: number): void;
  onSelect(index: number): void;
};

export function useChatMentionIndex(input: {
  platform: ChatPlatform;
  channel: string;
}): ChatMentionIndex;

export interface ChatMentionIndex {
  snapshot(): readonly MentionCandidate[];
  search(query: string, purpose: MentionPurpose): readonly MentionCandidate[];
  enrich(candidates: readonly MentionCandidate[]): Promise<void>;
  resolve(username: string): MentionCandidate | null;
}

export function useTwitchComposerCommandExecutor(input: TwitchCommandExecutorDeps): (
  action: ChatCommandAction
) => Promise<ChatCommandExecutionResult>;

export function useKickComposerCommandExecutor(input: KickCommandExecutorDeps): (
  action: ChatCommandAction
) => Promise<ChatCommandExecutionResult>;
```

`deriveComposerCompletion` gives mention matches precedence over command matches. For `/timeout @ali 600 spam`, it returns this:

```ts
{
  kind: "mentions",
  range: { start: 9, end: 13 },
  query: "ali",
  purpose: { kind: "command-argument", commandId: "timeout-user", argument: "target" },
  items,
  selectedIndex: 0,
  acceptsEnter: true,
}
```

Accepting a mention replaces only `@ali`, keeps `/timeout ` and ` 600 spam`, and leaves the cursor after `@alice `. This preserves mention completion inside command arguments without adding metadata nodes to the contentEditable value.

## Module map

Renderer chat feature:

| File | Responsibility |
| --- | --- |
| `apps/desktop/src/frontend/features/chat/utils/chat-command-registry.ts` | Single source for command names, platform variants, auth, role, syntax, argument specs, and intent builders |
| `apps/desktop/src/frontend/features/chat/utils/chat-command-parser.ts` | Pure lexer and planner for slash drafts. No React and no IPC |
| `apps/desktop/src/frontend/features/chat/utils/chat-composer-completion.ts` | Pure completion derivation and selection application |
| `apps/desktop/src/frontend/features/chat/data/useChatMentionIndex.ts` | Reads `chat-store` users by `buildChannelKey`, snapshots candidates, enriches through `electronAPI.chat.enrichMentionUsers`, and resolves command target usernames |
| `apps/desktop/src/frontend/features/chat/components/chat/ComposerCompletionMenu.tsx` | Vertical popover renderer for command and mention results. No keyboard listener |
| `apps/desktop/src/frontend/features/chat/components/chat/ContextualEmoteRow.tsx` | Keep the row, but make selected index and selection callbacks controlled by `useChatComposerCompletion` |
| `apps/desktop/src/frontend/features/chat/components/chat/MentionAutocomplete.tsx` | Either delete into `ComposerCompletionMenu` or leave as a pure controlled list renderer |
| `apps/desktop/src/frontend/features/chat/components/chat/ChatInput.tsx` | Owns contentEditable state, runs the completion hook, calls `planChatSubmission`, and dispatches the returned plan |
| `apps/desktop/src/frontend/features/chat/components/chat/twitch/useTwitchComposerCommandExecutor.ts` | Translates `ChatCommandAction` to Twitch IPC and timeout IPC |
| `apps/desktop/src/frontend/features/chat/components/chat/kick/useKickComposerCommandExecutor.ts` | Translates `ChatCommandAction` to Kick IPC and timeout IPC |

Shared and main process:

| File | Responsibility |
| --- | --- |
| `apps/desktop/src/shared/ipc-channels.ts` | Add only missing Kick command-action channels, such as `KICK_CHAT_SET_MODE` and `KICK_CHAT_CLEAR`, after the main handler exists |
| `apps/desktop/src/backend/preload/index.ts` | Add thin wrappers under `electronAPI.kickChat` for any new Kick IPC methods |
| `apps/desktop/src/backend/ipc/handlers/kick-chat-handlers.ts` | Validate new Kick command-action payloads with zod and call main-owned Kick mutation helpers |
| `apps/desktop/src/backend/api/platforms/kick/kick-mod-mutations.ts` | Own official or legacy Kick chat mode and clear mutation details |
| `apps/desktop/src/backend/ipc/handlers/twitch-api-handlers.ts` | Already validates Twitch command payloads through the `TwitchApiCommand` discriminated union |
| `apps/desktop/src/backend/ipc/handlers/timeout-moderation-handlers.ts` | Already owns state-aware timeout validation and submit semantics for both platforms |

Tests:

| File | Coverage to add |
| --- | --- |
| `apps/desktop/tests/components/chat/chat-command-registry.test.ts` | Platform, auth, and role filtering, including viewer commands shown to signed-in non-mods and hidden from guests |
| `apps/desktop/tests/components/chat/chat-command-parser.test.ts` | Command aliases, Kick versus Twitch syntax, duration units, invalid arguments, and no raw fallback for mutating commands |
| `apps/desktop/tests/components/chat/chat-composer-completion.test.ts` | Mention precedence inside command arguments, command suggestions only at the leading slash token, and emote Enter behavior preservation |
| `apps/desktop/tests/components/chat/ChatInput.test.tsx` | One keyboard owner, Enter dispatches a command action once, rejected command keeps the draft, and unknown slash input is not sent as chat |
| `apps/desktop/tests/components/chat/TwitchChat.test.tsx` | Command actions hit `twitch.execute` or timeout IPC with no chat-send call |
| `apps/desktop/tests/components/chat/KickChat.test.tsx` | Command actions hit `kickChat` or timeout IPC with no chat-send call |
| `apps/desktop/tests/backend/ipc/handlers/kick-chat-handlers.test.ts` | Origin checks and payload validation for any new Kick command-action channels |

Each new test should carry `// Guards:` lines per `apps/desktop/tests/AGENTS.md`.

## Rationale

The existing composer has two real problems. First, the command allowlist in `ChatInput` validates names but still lets every command except `/me` fall through to raw chat send. That makes `/ban`, `/timeout`, and room-mode changes look like StreamFusion actions while relying on platform chat text. Second, keyboard selection is split across `ChatInput`, `MentionAutocomplete`, and `ContextualEmoteRow`, which makes Enter, Tab, arrows, and Escape depend on whichever document listener wins.

The design models commands as typed domain data in one registry, per `principle-model-the-domain` and `principle-foundational-thinking`. Filtering and submission use the same `ChatCommandDefinition`, so a command cannot be suggested under one policy and rejected under a different one. Platform variants live inside the entry, so Twitch `/followersoff` and Kick `/followonly off` are two syntaxes for one `set-chat-mode` intent.

`ChatInput` parses the draft before send blockers. That is intentional. A normal chat message and `/me` still need chat-send eligibility. A moderation action needs authenticated moderator authority and a platform capability. It should not be blocked by emote-only, follower-only, or slow mode before the command is even classified.

The execution boundary is explicit, per `principle-boundary-discipline`. `planChatSubmission` can only return `chat-message`, `action-message`, `command-action`, or `rejected`. Mutating command actions never call `sendChatPayload`. Twitch commands go through existing typed `twitch.execute` or the timeout snapshot/submit service. Kick commands go through `kickChat` IPC. Missing Kick command-action channels should be added before the corresponding registry variant is enabled.

The public interface stays small, per `principle-laziness-protocol` and `principle-minimize-reader-load`. `ChatInput` gets one context prop and one command action callback. Popup components render controlled state and no longer install document-level keyboard listeners. The command executor hooks hide the platform-specific IPC details from the composer.

The user-facing behavior follows `principle-experience-first`. Signed-in viewers get viewer commands such as `/me`. Signed-in moderators get those plus moderator commands for the current platform. Guests do not see account-required commands, and if they type one manually the draft remains in place while the composer shows the auth error.

## Synthesis decision

This is a runner candidate, so final arena synthesis is not filled here. I would choose this shape as the base if the other candidates either keep raw slash command pass-through or split keyboard handling across separate popup components. Graft from another candidate only if it has a cleaner argument lexer or a smaller executor hook.

## Tradeoffs accepted

- We accept a typed registry with small intent builders in exchange for deleting duplicated policy from autocomplete and submit.
- We accept that some official platform commands are not suggested in the first slice in exchange for never advertising commands StreamFusion cannot execute or display.
- We accept one new Kick IPC method per missing real mutation in exchange for keeping raw Kick tokens and mutation details out of the renderer command path.
- We accept resolving manually typed usernames at submit time in exchange for keeping the contentEditable value as text plus emote slots, not a richer editor document model.
- We accept that `/timeout` from the composer may execute after validation without a modal in exchange for matching native slash-command expectations. The state-aware timeout snapshot still verifies actor, target, and policy first.

## Alternatives considered

1. Keep command parsing in `ChatInput` and add a `CommandAutocomplete` component beside `MentionAutocomplete`.

   This loses on interface depth. It exposes policy to `ChatInput`, the new command popup, and submit handling. It also leaves three keyboard owners unless both existing autocomplete components are rewritten anyway.

2. Let platform chat handle every slash command as raw text.

   This has the smallest diff, but it fails the most important invariant. A raw `/ban` send is a platform mutation with no typed validation, no origin-checked IPC boundary, no consistent toast or local state update, and no reliable test hook.

3. Build separate Twitch and Kick command registries.

   This looks simple at first, but it duplicates auth and role policy. The first divergence would likely hide a viewer command from moderators on one platform or leak an account-required command to guests. A single registry with platform variants keeps the platform differences local to command syntax and capability.

4. Store selected mentions as hidden rich editor nodes with user IDs.

   This would make target execution easy, but it expands the editor model for a narrow need. A mention index keyed by username gives command execution the same user IDs without teaching every contentEditable helper about mention nodes.

## Open questions and risks

- Should Kick `/me` stay as StreamFusion compatibility? Kick's public chat command help dated July 9, 2026 does not list it, but the current app already supports it by wrapping the message in asterisks.
- Should Kick `/subonly` be visible to moderators or only broadcasters? Kick's help marks it owner-only. The registry can encode that, but product behavior should match whatever Kick actually enforces in the current web session.
- Should `/clear` on Kick be remote clear or local clear? The current strip performs local clear. If product wants platform clear, the registry variant should remain disabled until main owns a real Kick clear action.
- Should slash `/timeout` require a confirmation dialog? Native chat commands execute on Enter. The safer compromise is immediate execution through the state-aware snapshot boundary, with rejected snapshots leaving the draft intact.
- How should non-mutating Twitch viewer commands such as `/mods` and `/vips` display results? They should not be suggested until StreamFusion can render their results in chat or a compact composer panel.

## Red-flag screen

- Shallow module: avoided. The public composer API is one context, one action callback, and one completion hook. The registry hides platform syntax, auth, role, and argument policy.
- Information leakage: avoided. Registry and composer use domain intents. Twitch IPC and Kick IPC payload shapes stay inside platform executor hooks and main handlers.
- Temporal decomposition: avoided. The command module owns command knowledge. It is not split into load, validate, transform, and execute stages that repeat the same policy.
- Pass-through method: avoided. New preload methods are thin only at the Electron boundary. They add origin checks and typed validation in main, so they earn the boundary.

## Next implementation step

Build `chat-command-registry.ts` and `chat-command-parser.ts` as pure renderer-feature utilities, then pin filtering and planning behavior with tests before touching `ChatInput`.

## Sources checked

- `apps/desktop/src/frontend/features/chat/components/chat/ChatInput.tsx`
- `apps/desktop/src/frontend/features/chat/components/chat/MentionAutocomplete.tsx`
- `apps/desktop/src/frontend/features/chat/components/chat/ContextualEmoteRow.tsx`
- `apps/desktop/src/frontend/features/chat/components/chat/twitch/TwitchChat.tsx`
- `apps/desktop/src/frontend/features/chat/components/chat/kick/KickChat.tsx`
- `apps/desktop/src/frontend/store/chat-store.ts`
- `apps/desktop/src/shared/chat-types.ts`
- `apps/desktop/src/shared/twitch-api-types.ts`
- `apps/desktop/src/shared/timeout-moderation-types.ts`
- `apps/desktop/src/backend/ipc/handlers/twitch-api-handlers.ts`
- `apps/desktop/src/backend/ipc/handlers/kick-chat-handlers.ts`
- `apps/desktop/src/backend/ipc/handlers/timeout-moderation-handlers.ts`
- `apps/desktop/src/backend/api/platforms/kick/kick-mod-mutations.ts`
- Kick help, "KICK chat commands", July 9, 2026: https://help.kick.com/en/articles/7112979-kick-chat-commands
- Twitch Help chat command search result, current fetch blocked by CSS shell: https://link.twitch.tv/ChatCommands
