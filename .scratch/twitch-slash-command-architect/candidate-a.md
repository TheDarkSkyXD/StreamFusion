# Candidate A: executable catalog that compiles to command plans

## Problem

StreamFusion currently discovers Twitch commands in `chat-command-registry.ts`, validates them in a second argument-rule map, then executes most of them through `TwitchChatService.executeNativeCommand`. Twitch stopped accepting third-party IRC slash commands in 2023, except `/me`. Adding 24 names to the autocomplete would therefore create dead suggestions. The design must cover the 47 commands in the research inventory, preserve `/help` and `/me`, use main-process Helix calls where Twitch exposes them, and name the first-party gaps instead of pretending they are supported.

## Usage, caller's view

`ChatInput` asks one catalog for suggestions and parsing. It does not know Twitch handler names, OAuth scopes, or Helix payloads.

```ts
const catalog = getChatCommandCatalog(commandAccess);
const completion = catalog.complete(message, cursorPosition);
const submission = catalog.parse(message);

if (submission.kind === "invalid") {
  setError(submission.message);
  return;
}

if (submission.kind === "command") {
  await onProviderCommand(submission.command);
}
```

`TwitchChat` supplies current authority and a small set of ports, then calls one deep executor. The executor returns only after the command succeeded or the user-facing navigation completed. A thrown error keeps the existing draft-restoration path intact.

```ts
const twitchCommands = useTwitchSlashCommands({
  channel: { id: channelId, login: channel },
  viewer: { id: twitchUser.id, login: twitchUser.login },
  authority,
  grantedScopes,
  ports: {
    executeHelix: window.electronAPI.twitch.execute,
    sendAction: twitchChatService.sendAction.bind(twitchChatService),
    disconnect: () => twitchChatService.leaveChannel(channel),
    openExternal: window.electronAPI.openExternal,
    openPanel: setActiveChatPanel,
    notify: toast,
  },
});

<ChatInput
  commandCatalog={twitchCommands.catalog}
  onProviderCommand={twitchCommands.execute}
/>
```

The renderer executor compiles the selected catalog entry and parsed arguments into one of five plans. React does not switch on 47 command names.

```ts
const result = compileTwitchCommand({ command, context });

switch (result.kind) {
  case "irc-action":
    return ports.sendAction(result.message);
  case "helix":
    return runHelixPlan(result, ports);
  case "local":
    return runLocalPlan(result, ports);
  case "first-party":
    return ports.openExternal(result.url);
  case "needs-scopes":
    return ports.requestReconnect(result.scopes);
}
```

Main receives the same typed `TwitchApiCommand` union it already validates. New Helix operations extend that union and its Zod schema. The renderer never receives a token.

```ts
await window.electronAPI.twitch.execute({
  operation: "send-chat-announcement",
  broadcasterId,
  moderatorId,
  message,
  color: "primary",
});
```

## Shape

### Core types

The registry owns syntax, role visibility, validation grammar, scope policy, token-ownership policy, fallback behavior, and execution identity. There is no second argument-rule map and no command-name switch.

```ts
type TwitchNativeRole = "viewer" | "moderator" | "editor" | "broadcaster";

type TwitchChannelAuthority =
  | { kind: "guest" }
  | {
      kind: "authenticated";
      chatRole: "viewer" | "moderator" | "broadcaster";
      editorStatus: "editor" | "unknown";
    };

type ArgumentGrammar =
  | { kind: "none" }
  | { kind: "text"; label: string; maximumLength?: number }
  | { kind: "optional-text"; label: string; maximumLength?: number }
  | { kind: "username" }
  | { kind: "username-message" }
  | { kind: "username-reason" }
  | { kind: "timeout"; defaultSeconds: 600; maximumSeconds: 1_209_600 }
  | { kind: "seconds"; defaultValue: number; minimum: number; maximum: number }
  | { kind: "followers-duration"; defaultMinutes: number; maximumMinutes: 129_600 }
  | { kind: "commercial-length"; defaultValue: 30; allowed: readonly [30, 60, 90, 120, 150, 180] }
  | { kind: "quantity"; minimum: 1 };

type TwitchUiDestination =
  | "channel-chat"
  | "gift-subscriptions"
  | "viewer-profile"
  | "channel-point-requests"
  | "stream-manager"
  | "shared-chat";

type TwitchHelixHandler =
  | "list-own-moderators"
  | "list-own-vips"
  | "update-color"
  | "send-whisper"
  | "block-user"
  | "unblock-user"
  | "ban-user"
  | "unban-user"
  | "clear-chat"
  | "update-chat-settings"
  | "send-and-pin-message"
  | "send-announcement"
  | "send-shoutout"
  | "set-suspicious-status"
  | "add-moderator"
  | "remove-moderator"
  | "add-vip"
  | "remove-vip"
  | "start-raid"
  | "cancel-raid"
  | "run-commercial"
  | "create-stream-marker";

type CommandAction =
  | { kind: "irc-action" }
  | { kind: "local"; handler: "help" | "disconnect" | "open-engagement" }
  | { kind: "first-party"; destination: TwitchUiDestination; notice: string }
  | {
      kind: "helix";
      handler: TwitchHelixHandler;
      scopes: readonly TwitchAppScope[];
      tokenOwner: "viewer" | "moderator" | "broadcaster" | "editor-or-broadcaster";
    };

type CommandRoute = {
  when: "always" | "broadcaster" | "moderator-or-broadcaster" | "editor-or-broadcaster";
  action: CommandAction;
};

interface TwitchCommandSpec {
  readonly id: `twitch-${string}`;
  readonly name: string;
  readonly usage: `/${string}`;
  readonly description: string;
  readonly nativeRoles: readonly TwitchNativeRole[];
  readonly arguments: ArgumentGrammar;
  readonly routes: readonly [CommandRoute, ...CommandRoute[]];
}

type ParsedCommand =
  | { kind: "none" }
  | { kind: "invalid"; message: string }
  | {
      kind: "command";
      definition: TwitchCommandSpec;
      arguments: ParsedCommandArguments;
      originalText: string;
    };

type TwitchCommandPlan =
  | { kind: "irc-action"; message: string }
  | { kind: "helix"; command: TwitchApiCommand; successMessage: string }
  | { kind: "local"; action: "disconnect" | "show-help" | "open-engagement" }
  | { kind: "first-party"; url: string; notice: string }
  | { kind: "needs-scopes"; scopes: readonly TwitchAppScope[] };
```

`routes` is a non-empty tuple. Every visible command therefore has an execution route. Role-dependent commands can use Helix for a broadcaster and navigate moderators to Twitch's first-party tool when public token ownership is narrower than Twitch's own UI. This encodes the mismatch rather than burying it in error handling, per type-system-discipline.

`editorStatus` is explicit because Twitch has no public endpoint that lets an arbitrary viewer prove they edit the current channel. StreamFusion must not infer editor authority from moderator authority. When editor status is unknown, editor-only routes remain hidden. Broadcasters still receive every command in that group. A later trusted editor signal can populate the existing type without changing the catalog.

### Catalog

The production array uses `as const satisfies readonly TwitchCommandSpec[]`. A catalog test compares its 47 linked names with a literal expected set. StreamFusion's `/help` and Twitch's supported `/me` remain additional entries.

| Command group | Commands | Execution route |
| --- | --- | --- |
| Authenticated viewer | `mods`, `vips` | Broadcaster uses the existing Helix list calls. Other viewers open first-party channel chat with a notice that Twitch must run the command. |
| Authenticated viewer | `color` | Helix `PUT /chat/color`. |
| Authenticated viewer | `w` | Resolve target, then Helix `POST /whispers`. |
| Authenticated viewer | `block`, `unblock` | Resolve target, then existing Helix block operations. |
| Authenticated viewer | `disconnect` | Leave the current local Twitch chat connection. |
| Authenticated viewer | `gift` | Open `twitch.tv/subs/{channel}`. No purchase API exists. |
| Authenticated viewer | `vote` | Open first-party channel chat. No vote API exists. |
| Moderator or broadcaster | `timeout`, `ban`, `unban`, `clear` | Existing moderation Helix operations. Extend `ban-user` with optional `durationSeconds` for timeout. |
| Moderator or broadcaster | `followers`, `followersoff`, `slow`, `slowoff`, `subscribers`, `subscribersoff`, `emoteonly`, `emoteonlyoff`, `uniquechat`, `uniquechatoff` | Existing `update-chat-settings` operation. The argument grammar converts Twitch duration units before IPC. |
| Moderator or broadcaster | `pin` | Helix Send Chat Message with `pin: true`. Do not confuse it with pinning an existing message. |
| Moderator or broadcaster | `announce` | Helix Send Chat Announcement with `primary` as the default color. |
| Moderator or broadcaster | `shoutout` | Resolve target, then Helix Send a Shoutout. |
| Moderator or broadcaster | `monitor`, `restrict` | Resolve target, then Add Suspicious Status with `ACTIVE_MONITORING` or `RESTRICTED`. |
| Moderator or broadcaster | `unmonitor`, `unrestrict` | Resolve target, then Remove Suspicious Status. The success notice says Twitch clears both treatments because the public endpoint has one `NO_TREATMENT` result. |
| Moderator or broadcaster | `user` | Open the target's Twitch profile with a notice that the full native viewer card and mod history are first-party only. |
| Moderator or broadcaster | `requests` | Open the channel-point request queue in Twitch's first-party dashboard. Public redemption APIs cannot reproduce the general queue. |
| Moderator or broadcaster | `poll`, `endpoll`, `deletepoll` | Broadcaster opens StreamFusion's Engagement tab. Moderator opens Twitch's first-party poll UI because Helix mutations require the broadcaster's token. |
| Broadcaster | `mod`, `unmod`, `vip`, `unvip` | Resolve target, then existing role Helix operations. |
| Broadcaster | `rules` | Open first-party channel chat because Twitch has no rules endpoint. |
| Broadcaster | `sharedchat` | Open Twitch Stream Together or Shared Chat management. The API is read-only. |
| Editor or broadcaster | `commercial` | Broadcaster uses existing Start Commercial. A positively identified editor opens Twitch Stream Manager because Helix rejects editor-owned tokens. |
| Editor or broadcaster | `goal` | Open Twitch Stream Manager. Creator goals are read-only through Helix. |
| Moderator, editor, or broadcaster | `prediction` | Broadcaster opens StreamFusion's Engagement tab. Other supported native roles open Twitch's first-party prediction UI. |
| Editor or broadcaster | `raid` | Broadcaster resolves the target and uses existing Start Raid, which feeds the existing outgoing raid handoff UI. A positively identified editor uses Twitch Stream Manager because Helix requires a broadcaster-owned token. |
| Editor or broadcaster | `unraid` | Broadcaster uses new Cancel Raid. A positively identified editor uses Twitch Stream Manager. |
| Editor or broadcaster | `marker` | Helix Create Stream Marker. This public endpoint accepts editor tokens, once StreamFusion has a trustworthy editor signal. |

Additional entries are `/me`, which is the only IRC action, and local `/help`. Kick entries keep their current definitions and provider executor.

### Availability and OAuth

`getCommandsForAccess` becomes a catalog query that returns a status with each suggestion.

```ts
type CommandAvailability =
  | { kind: "ready" }
  | { kind: "needs-scopes"; scopes: readonly TwitchAppScope[] }
  | { kind: "first-party"; label: "Opens Twitch" };
```

Signed-in users see commands allowed by their native role. Missing scopes do not silently erase a known role command. The suggestion carries `needs-scopes`, selecting it opens the existing reconnect flow, and Enter cannot issue a dead request. Guests still see no slash catalog.

Add these scopes to `TWITCH_APP_SCOPES` and its documentation:

- `user:manage:chat_color`
- `user:write:chat`
- `moderator:manage:announcements`
- `moderator:manage:shoutouts`
- `moderator:manage:suspicious_users`
- `channel:manage:broadcast`

Existing installs reconnect once. Main owns the token and checks Twitch responses. Renderer role checks only shape discovery and UX. They are not authorization.

### Signatures

```ts
export function createChatCommandCatalog(input: {
  platform: ChatPlatform;
  access: ChatCommandAccess;
  grantedScopes?: readonly string[];
}): ChatCommandCatalog;

export function parseArguments(
  grammar: ArgumentGrammar,
  raw: string
): ParsedCommandArguments | CommandArgumentError;

export function compileTwitchCommand(input: {
  command: ParsedTwitchCommand;
  context: TwitchCommandContext;
}): TwitchCommandPlan;

export function useTwitchSlashCommands(input: TwitchSlashCommandHookInput): {
  catalog: ChatCommandCatalog;
  execute(command: ParsedProviderCommand): Promise<void>;
};

export interface TwitchApiService {
  execute(command: TwitchApiCommand): Promise<TwitchApiResult>;
}
```

The hook's public API is deep. It hides username resolution, scope prompts, Twitch URLs, Helix payload construction, success notices, and response errors behind `catalog` plus `execute`. `ChatInput` still owns draft submission and restoration. `TwitchChat` still owns provider side effects, as required by the chat UI instructions. The shared process contract contains only serialization-safe API commands.

### New Helix operations

Extend `TwitchApiCommand`, the IPC Zod union, and `twitch-api-service.ts` with these operations:

```ts
type NewTwitchApiCommand =
  | { operation: "update-chat-color"; userId: string; color: TwitchChatColor }
  | { operation: "send-whisper"; fromUserId: string; toUserId: string; message: string }
  | { operation: "send-and-pin-message"; broadcasterId: string; senderId: string; message: string }
  | { operation: "send-chat-announcement"; broadcasterId: string; moderatorId: string; message: string; color: TwitchAnnouncementColor }
  | { operation: "send-shoutout"; fromBroadcasterId: string; toBroadcasterId: string; moderatorId: string }
  | { operation: "set-suspicious-status"; broadcasterId: string; moderatorId: string; userId: string; status: "ACTIVE_MONITORING" | "RESTRICTED" | "NO_TREATMENT" }
  | { operation: "cancel-raid"; broadcasterId: string }
  | { operation: "create-stream-marker"; userId: string; description?: string };
```

Also add `durationSeconds?: number` to `ban-user`. Zod validates lengths, numeric limits, enum values, and IDs at the IPC boundary. `twitch-api-service.ts` parses external responses with Zod and returns the existing result union. Do not add a second IPC channel or expose a raw token.

### Module map

| Module | Ownership |
| --- | --- |
| `frontend/features/chat/utils/chat-command-registry.ts` | Platform-neutral catalog interface, completion, parsing, and shared Kick catalog. Remove `CHAT_COMMAND_ARGUMENT_RULES`. |
| `frontend/features/chat/utils/twitch-slash-command-catalog.ts` | The 47 Twitch definitions plus `/help` and `/me`, role routes, grammars, required scopes, and destination identities. Pure code. |
| `frontend/features/chat/utils/twitch-slash-command-plan.ts` | Pure compilation from one parsed Twitch command plus context into `TwitchCommandPlan`. |
| `frontend/features/chat/data/useTwitchSlashCommands.ts` | Executes the five plan variants through injected ports. Owns toasts, reconnect prompts, panel changes, and typed IPC calls. |
| `frontend/features/chat/components/chat/ChatInput.tsx` | Uses the supplied catalog. Keeps current draft clearing and restoration. |
| `frontend/features/chat/components/chat/twitch/TwitchChat.tsx` | Builds authority/context and supplies provider ports. Removes `executeTwitchCommand`. Controls `ChatPanelTabs` so engagement commands can select it. |
| `frontend/features/chat/components/chat/mod/ChatPanelTabs.tsx` | Supports controlled `activeTab` plus `onTabChange`, while retaining its uncontrolled default. |
| `shared/twitch-api-types.ts` | Adds serialization-safe Helix command variants and enums. |
| `shared/auth-types.ts` | Adds canonical OAuth scopes. |
| `backend/ipc/handlers/twitch-api-handlers.ts` | Adds strict Zod schemas. Keeps sender-origin enforcement. |
| `backend/api/platforms/twitch/twitch-api-service.ts` | Adds official Helix request mappings and response parsing. |
| `backend/services/chat/twitch-chat.ts` | Deletes `executeNativeCommand`. Keeps `sendAction` and ordinary message sending. |

The dominant trace is three files. `ChatInput` parses through the catalog, `useTwitchSlashCommands` executes a plan, and `twitch-api-service` performs a Helix call. First-party and local routes stop after the second file. This stays under the architect reader-load limit.

### Migration

1. Add the catalog types and full Twitch catalog. Change `ChatInput` to consume a catalog object. Keep Kick behavior unchanged through its current adapter.
2. Add the plan compiler and renderer executor. Move the existing block and unblock implementation into it. Add the typed Helix variants and scope changes.
3. Migrate every current Twitch command from `executeTwitchCommand` to a catalog action. Verify the 47-name coverage test and per-command plan tests.
4. Delete `TwitchChatService.executeNativeCommand` and its implementation-detail tests in the same change. Retain `sendAction` for `/me`. Do not ship a compatibility wrapper, per migrate-callers-then-delete-legacy-apis.

## Synthesis decision

Arena synthesis has not run yet. Candidate A is the executable-catalog option. It should be judged against the alternative whole-shape design before implementation.

## Tradeoffs accepted

- We accept a data-heavy catalog in exchange for one source of truth for discovery, validation, capability limits, and handler identity.
- We accept first-party navigation for commands with no public equivalent in exchange for never claiming a dead command succeeded.
- We accept a one-time Twitch reconnect after adding scopes in exchange for keeping all Helix credentials and permissions in the main process.
- We accept an explicit `editorStatus: "unknown"` state in exchange for not granting editor commands from an unverifiable moderator guess.
- We accept a small plan interpreter in exchange for removing a 47-command React switch and the obsolete IRC switch.

## Alternatives considered

### One renderer handler per command

Forty-seven exported functions would make each action easy to test alone, but callers would need a registry, validator table, handler imports, and role policy kept in sync. It exposes the coordination problem instead of hiding it.

### One new main-process `execute-slash-command` operation

This would move parsing and provider policy behind IPC, but autocomplete and role filtering still need a renderer catalog. The two processes would own duplicate command knowledge. Local panel navigation and first-party browser routes would also bounce through main for no security benefit.

### Keep tmi.js helpers and add only missing names

This is not viable. Twitch accepts only `/me` through third-party IRC, so the preview would advertise commands that cannot execute.

## Open questions and risks

- Which stable Twitch dashboard URLs should `requests`, `goal`, `sharedchat`, polls, and predictions use? Verify each in a packaged Electron build before freezing them in the catalog.
- Can StreamFusion obtain a trustworthy editor signal without private GQL? If not, editor-only discovery must remain limited to broadcasters and documented as a public-API gap.
- Does the current Device Code app registration allow every newly requested scope? Verify OAuth grant results, not only the authorization URL.
- Does Send Chat Message with `pin: true` return a sent message when moderator pin permission is disabled? The executor must surface Twitch's `drop_reason` as failure.
- Should `/unmonitor` and `/unrestrict` require confirmation because the public API clears both suspicious-user treatments? The catalog must at least state this effect in its success copy.

## Test matrix

| Layer | Required proof |
| --- | --- |
| Catalog | Exact linked set contains 47 unique Twitch names. `/help` and `/me` are the only extras. Guests receive none. Viewer, moderator, editor, and broadcaster snapshots contain the expected commands. Every entry has a non-empty route. |
| Parser | Each argument grammar has valid, missing, boundary, malformed, and `@username` cases. Followers units convert `m`, `h`, `d`, `w`, and `mo`. Timeout defaults to 600. Commercial accepts only six lengths. |
| Plan compiler | Table-driven test for all 47 commands asserts plan kind, handler identity, scope behavior, and role-dependent fallback. No plan other than `/me` yields `irc-action`. |
| ChatInput | `/` shows the role catalog. Selecting a command preserves existing mention completion in arguments. Unknown commands fail locally. Failed provider execution restores text, emote slots, caret, and reply. First-party navigation counts as completion only after `openExternal` resolves. |
| Twitch renderer | Block and user-target commands resolve IDs before mutation. Missing scope invokes reconnect. `/poll` selects Engagement for a broadcaster. Moderator `/poll` opens Twitch. `/disconnect` leaves only the current channel. Kick execution remains unchanged. |
| IPC schema | Reject unknown operations, extra fields, invalid lengths, invalid enums, empty IDs, out-of-range timeout seconds, and spoofed sender origins. Accept one valid payload for every new variant. |
| Helix service | Assert exact path, query, method, and JSON body for each new operation. Parse success, empty success, 401, 403, 409 or cooldown, dropped chat message, and malformed Twitch response. |
| OAuth | Canonical scope set has no duplicates and contains all catalog scopes. A stored token missing one new scope triggers reconnect instead of a request. |
| Chat service | `/me` still calls `client.action`. `executeNativeCommand` no longer exists. Ordinary send, rate limiting, and reconnect tests remain green. |
| Runtime | In the Electron app, authenticate as viewer, moderator, and broadcaster. Capture `/` autocomplete, one Helix success, one missing-scope reconnect, one first-party navigation, `/me`, a failed call with restored draft, and unchanged Kick commands. |

## Next implementation step

Write the catalog type and the exact 47-name coverage test first, then migrate one representative route of each action kind against that contract.
