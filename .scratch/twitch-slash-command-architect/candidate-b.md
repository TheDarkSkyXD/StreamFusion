# Candidate B: compile commands into effect programs

## Problem

StreamFusion has one catalog for preview and validation, then a separate command-name switch for execution. The two lists can drift. Worse, the executor still sends retired commands through `tmi.js`. Twitch stopped accepting third-party IRC commands except `/me` in 2023. The new design must cover all 47 commands in the research inventory, keep `/help` and `/me`, preserve Kick, run public mutations through authenticated main-process Helix calls, and give commands without a public API an honest first-party or local destination.

## Usage (caller's view)

`TwitchChat` builds one command session. It does not inspect command names.

```ts
const commandSession = useTwitchCommandSession({
  actor: twitchCommandActor,
  channel: { id: channelId, login: channel },
  grantedScopes,
  ports: {
    sendAction: (message) => twitchChatService.sendAction(channel, message),
    disconnect: () => twitchChatService.disconnect(),
    executeHelix: (request) => window.electronAPI.twitch.execute(request),
    openTwitchSurface,
    openEngagement,
    requestReconnect: promptReconnect,
    publishNotice: publishCommandNotice,
  },
});

<ChatInput
  commandAccess={commandSession.access}
  onProviderCommand={commandSession.execute}
  {...existingProps}
/>
```

The existing generic composer still discovers and parses commands from the registry facade. Its draft lifecycle does not change.

```ts
const commands = getCommandsForAccess(commandSession.access);
const parsed = parseAvailableCommand(draft, commands);
const error = compileTwitchCommand({
  name: parsed.definition.name,
  args: parsed.args,
  text: parsed.text,
  context: commandSession.context,
});

if (error.ok) await commandSession.run(error.program);
```

Tests and command help inspect the same source that execution compiles.

```ts
expect(getTwitchCatalogNames()).toEqual(TWITCH_GUIDE_COMMANDS);

const result = compileTwitchCommand({
  name: "ban",
  args: "@trouble repeated spam",
  context: moderatorContext,
});

expect(result).toEqual({
  ok: true,
  program: {
    kind: "helix",
    action: { kind: "ban", targetLogin: "trouble", reason: "repeated spam" },
  },
});
```

## Shape

### Core types

The Twitch catalog is a command compiler. Metadata, role rules, scope rules, argument validation, and handler identity live on one entry. The compiler returns a closed effect program. No registry entry can exist without a compiler.

```ts
type TwitchCommandRole = "viewer" | "moderator" | "broadcaster";

type TwitchCommandActor =
  | { kind: "viewer"; userId: string; grantedScopes: ReadonlySet<TwitchAppScope> }
  | { kind: "moderator"; userId: string; grantedScopes: ReadonlySet<TwitchAppScope> }
  | { kind: "broadcaster"; userId: string; grantedScopes: ReadonlySet<TwitchAppScope> };

interface TwitchCommandContext {
  readonly actor: TwitchCommandActor;
  readonly channel: { readonly id: string; readonly login: string };
}

interface TwitchCommandInput {
  readonly args: string;
  readonly text: string;
  readonly context: TwitchCommandContext;
}

type TwitchCommandCompileResult =
  | { readonly ok: true; readonly program: TwitchCommandProgram }
  | { readonly ok: false; readonly message: string };

type TwitchCommandProgram =
  | { readonly kind: "irc-action"; readonly message: string }
  | { readonly kind: "disconnect" }
  | { readonly kind: "helix"; readonly action: TwitchSlashHelixAction }
  | {
      readonly kind: "open-twitch";
      readonly destination: TwitchFirstPartyDestination;
      readonly notice: string;
    }
  | { readonly kind: "open-engagement"; readonly section: "polls" | "predictions" }
  | {
      readonly kind: "needs-reconnect";
      readonly scopes: readonly TwitchAppScope[];
      readonly originalCommand: string;
    };

interface TwitchCommandSpec {
  readonly id: `twitch-${string}`;
  readonly name: string;
  readonly usage: string;
  readonly description: string;
  readonly roles: readonly TwitchCommandRole[];
  readonly compile: (input: TwitchCommandInput) => TwitchCommandCompileResult;
}

type TwitchFirstPartyDestination =
  | { readonly kind: "channel-chat"; readonly channelLogin: string }
  | { readonly kind: "subscription-gift"; readonly channelLogin: string }
  | { readonly kind: "creator-dashboard"; readonly channelLogin: string }
  | { readonly kind: "stream-manager"; readonly channelLogin: string }
  | { readonly kind: "user-profile"; readonly userLogin: string };
```

`TwitchSlashHelixAction` uses channel logins and target logins where a command is naturally expressed that way. The main process owns user resolution and the API sequence. The renderer never coordinates `resolve-channel` followed by a mutation.

```ts
type TwitchSlashHelixAction =
  | { kind: "list-moderators" | "list-vips" }
  | { kind: "color"; color: string }
  | { kind: "whisper"; targetLogin: string; message: string }
  | { kind: "block" | "unblock"; targetLogin: string }
  | { kind: "ban"; targetLogin: string; reason?: string }
  | { kind: "timeout"; targetLogin: string; seconds: number; reason?: string }
  | { kind: "unban"; targetLogin: string }
  | { kind: "clear" }
  | { kind: "update-chat-settings"; settings: TwitchChatSettingsPatch }
  | { kind: "send-and-pin"; message: string }
  | { kind: "announce"; message: string }
  | { kind: "shoutout"; targetLogin: string }
  | { kind: "set-suspicious-status"; targetLogin: string; status: "monitor" | "restrict" }
  | { kind: "remove-suspicious-status"; targetLogin: string }
  | { kind: "add-moderator" | "remove-moderator" | "add-vip" | "remove-vip"; targetLogin: string }
  | { kind: "commercial"; seconds: 30 | 60 | 90 | 120 | 150 | 180 }
  | { kind: "start-raid"; targetLogin: string }
  | { kind: "cancel-raid" }
  | { kind: "create-marker"; description?: string };

type TwitchSlashCommandRequest = {
  readonly operation: "execute-slash-command";
  readonly broadcasterId: string;
  readonly actorId: string;
  readonly action: TwitchSlashHelixAction;
};

type TwitchSlashCommandReceipt =
  | { readonly kind: "completed"; readonly message: string }
  | { readonly kind: "users"; readonly label: "Moderators" | "VIPs"; readonly logins: string[] }
  | { readonly kind: "raid-pending"; readonly targetLogin: string; readonly createdAt: string };
```

The nested `action` union makes invalid payload combinations unrepresentable. The IPC handler validates it with a nested Zod discriminated union. The main process uses the stored user token. Renderer role checks control discovery only. Twitch remains the authorization authority.

### Signatures

```ts
export function getTwitchCommandSuggestions(
  context: TwitchCommandContext
): readonly CommandSuggestion[];

export function compileTwitchCommand(input: {
  readonly name: string;
  readonly args: string;
  readonly text: string;
  readonly context: TwitchCommandContext;
}): TwitchCommandCompileResult;

export function createTwitchCommandRunner(ports: TwitchCommandPorts): (
  program: TwitchCommandProgram
) => Promise<void>;

interface TwitchCommandPorts {
  readonly sendAction: (message: string) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly executeHelix: (request: TwitchSlashCommandRequest) => Promise<TwitchApiResult<TwitchSlashCommandReceipt>>;
  readonly openTwitchSurface: (destination: TwitchFirstPartyDestination) => Promise<void>;
  readonly openEngagement: (section: "polls" | "predictions") => void;
  readonly requestReconnect: (scopes: readonly TwitchAppScope[]) => Promise<void>;
  readonly publishNotice: (message: string) => void;
}

export interface TwitchSlashCommandService {
  execute(request: TwitchSlashCommandRequest): Promise<TwitchApiResult<TwitchSlashCommandReceipt>>;
}
```

`createTwitchCommandRunner` has one exhaustive switch over six effect families. It does not know any slash command names. `TwitchSlashCommandService` owns username resolution, endpoint selection, token-owned ID rules, and response receipts behind one IPC call.

### Catalog routing

The catalog contains all 47 guide commands plus StreamFusion's `/help` and Twitch's supported `/me`.

| Role | Commands | Compiled program |
| --- | --- | --- |
| Viewer | `mods`, `vips` | Helix only when the actor is the current broadcaster. Otherwise open first-party channel chat with an explanation. |
| Viewer | `color`, `w`, `block`, `unblock` | Helix. Missing scopes compile to `needs-reconnect`. |
| Viewer | `disconnect` | Local disconnect. |
| Viewer | `gift`, `vote` | Open Twitch gifting or channel-chat UI with an explanation. |
| Viewer | `me` | IRC action. This is the only IRC command. |
| Viewer | `help` | Existing local help. |
| Moderator | `timeout`, `ban`, `unban`, `clear` | Helix moderation actions. |
| Moderator | `followers`, `followersoff`, `slow`, `slowoff`, `subscribers`, `subscribersoff`, `emoteonly`, `emoteonlyoff`, `uniquechat`, `uniquechatoff` | Helix chat-settings patch. Duration parsers accept Twitch units and emit normalized integers. |
| Moderator | `pin`, `announce`, `shoutout`, `monitor`, `unmonitor`, `restrict`, `unrestrict` | Helix chat, announcement, shoutout, and suspicious-user actions. |
| Moderator | `user`, `requests` | Open the closest first-party Twitch user or dashboard surface. The notice says that Twitch does not expose the complete viewer card or request queue to apps. |
| Moderator | `poll`, `endpoll`, `deletepoll` | Broadcaster opens StreamFusion Engagement. A moderator opens Twitch's first-party management UI because Helix requires the broadcaster's token. |
| Broadcaster | `commercial` | Helix with the existing confirmation flow. Defaults to 30 seconds. |
| Broadcaster | `goal`, `sharedchat`, `rules` | Open creator dashboard, stream manager, or channel chat with an explanation. |
| Broadcaster | `prediction` | Open StreamFusion Engagement. |
| Broadcaster | `raid`, `unraid`, `marker` | Helix. Raid reuses existing confirmation and countdown behavior. |
| Broadcaster | `mod`, `unmod`, `vip`, `unvip` | Helix role actions. |

The current app cannot reliably discover editor status on another broadcaster's token. It therefore does not claim editor execution. Commands in Twitch's broadcaster-or-editor group appear for a broadcaster. Twitch can expand this later when StreamFusion gains a trustworthy editor-authority source.

The catalog compiler normalizes these argument forms:

- Leading `@` on Twitch logins.
- `/timeout user` to 600 seconds. A numeric second token becomes the duration. Remaining text becomes the reason.
- `/followers 30m`, `2h`, `2d`, `1w`, and `3mo` to Helix minutes.
- `/slow` to Twitch's default and validates 3 through 120 seconds when supplied.
- `/commercial` to 30 seconds and rejects lengths outside Twitch's six values.
- `/pin` and `/announce` to non-empty messages within API limits.
- `/marker` to an optional description of at most 140 characters.

Scope requirements stay beside each compiler through a helper such as `withScopes(required, compile)`. This keeps availability and execution from disagreeing. Commands remain visible to the correct role when an old token lacks a newly added scope. Their suggestion explains that Twitch must reconnect, and execution starts that flow while retaining the draft.

### Module map

| Module | Ownership |
| --- | --- |
| `frontend/features/chat/utils/twitch-command-language.ts` | The sole Twitch catalog. Owns metadata, roles, scope gates, parsers, and compilation to effect programs. |
| `frontend/features/chat/utils/chat-command-registry.ts` | Platform-neutral discovery facade and unchanged Kick catalog. Adapts compiled Twitch metadata to `CommandSuggestion`. |
| `frontend/features/chat/components/chat/twitch/useTwitchCommandSession.ts` | Binds current actor, channel, scopes, and six renderer ports. Runs programs. Contains no command-name branches. |
| `frontend/features/chat/components/chat/twitch/TwitchChat.tsx` | Creates the session and passes its access and executor to `ChatInput`. Controls the existing engagement and confirmation UI. |
| `shared/twitch-slash-command-types.ts` | Closed Helix action union, request, and receipt. No endpoint response types. |
| `shared/twitch-api-types.ts` | Adds `execute-slash-command` to the existing IPC command union. |
| `backend/ipc/handlers/twitch-api-handlers.ts` | Strict Zod validation for the nested action union and sender-origin check. |
| `backend/api/platforms/twitch/twitch-slash-command-service.ts` | Resolves logins and executes semantic actions through `TwitchRequestor`. Returns user-facing receipts. |
| `backend/api/platforms/twitch/twitch-api-service.ts` | Delegates the one slash-command operation to the deep service. |
| `backend/services/chat/twitch-chat.ts` | Keeps `sendAction`. Deletes `executeNativeCommand` after its only caller migrates. |
| `shared/auth-types.ts` | Adds the missing canonical scopes for chat color, announcements, shoutouts, suspicious users, broadcast markers, and Helix chat sends. |

### Migration sequence

1. Add the command language, action union, nested IPC schema, main service, and catalog contract tests.
2. Bind the runner in `TwitchChat` and reuse existing confirmation and Engagement UI ports.
3. Migrate every Twitch command away from `executeNativeCommand` in the same change.
4. Delete `executeNativeCommand` and its obsolete tmi-command tests. Keep `sendAction` and its `/me` test.
5. Leave Kick definitions and execution untouched. Run the cross-platform registry tests after each step.

This follows migrate-callers-then-delete-legacy-apis. There is no compatibility branch that still sends retired IRC commands.

## Rationale

The program union models the real execution domain. It replaces command-name conditionals with six effects and prevents a Helix-only command from accidentally reaching IRC, per model-the-domain and type-system-discipline. The catalog entry owns its compiler, so preview, role filtering, validation, scope state, and handler identity cannot drift.

The public renderer interface is one session with suggestions and `execute`. It hides parsing rules, scope recovery, first-party routing, user resolution, API sequencing, and receipts. That is a deep module with a two-file trace from `TwitchChat` to the command language. The main service is another deep module. It turns one semantic action into as many Helix calls as needed.

The IPC boundary accepts a closed semantic action rather than exposing raw paths or generic request options. Zod validates untrusted renderer data once. The main process owns credentials and network work, per boundary-discipline. Twitch validates actual role and token ownership. Local role checks never pretend to be security.

The design adds two focused modules, then deletes the obsolete IRC executor. It does not introduce a command class hierarchy, parser framework, or provider-neutral abstraction that Kick does not need. This is the smallest design that removes drift and transport misuse, per the Laziness Protocol.

## Synthesis decision

Arena synthesis has not run yet. This candidate should be compared as the command-compiler option. Its distinguishing choice is a catalog that compiles text into effects, plus one semantic main-process IPC action. It rejects direct per-command handlers in `TwitchChat`.

## Tradeoffs accepted

- We accept a sizable declarative catalog in one file in exchange for one auditable source for all 49 visible Twitch entries.
- We accept one exhaustive main-service action match in exchange for removing command-name branching from React and hiding multi-call Helix workflows.
- We accept first-party navigation for Twitch-private behavior in exchange for never claiming that an unsupported public API succeeded.
- We accept broadcaster-only discovery for editor-group commands until StreamFusion can prove editor authority.
- We accept a one-time reconnect for existing installs in exchange for requesting the exact scopes the executable catalog needs.

## Alternatives considered

- Put an `execution` enum and optional payload fields directly on `ChatCommandDefinition`. This keeps fewer files but creates an optional-field bag. Callers must understand command-specific combinations, and compile-time checks cannot prove that every entry builds a valid action.
- Create one renderer handler function per command in a record. This removes the React switch but leaves username resolution, scope checks, and endpoint choreography in the renderer. The record is broad and shallow.
- Send slash text to a main-process parser. This centralizes execution but makes preview and renderer validation a second grammar. The two can drift, and raw chat text crosses the process boundary without adding value.

## Open questions and risks

- Does a global `/disconnect` match the intended behavior in a multistream workspace, or should it leave only the current Channel Chat Tab? The current singleton Twitch connection makes this a user-visible product choice.
- Which first-party dashboard URLs are stable enough to encode? The URL builder needs tests and should fall back to the channel page if Twitch changes a route.
- Should `/commercial` and `/raid` clear the draft when their confirmation dialog opens, or only after confirmation? Reusing the current dialog behavior should settle this before wiring the command runner.
- Can `ChatPanelTabs` become controlled without disturbing retained chat mounts? `/poll` and `/prediction` need a programmatic switch to Engagement.

## Test matrix

| Layer | Required proof |
| --- | --- |
| Catalog contract | Exact set equality against the 47 guide commands. `/help` and `/me` are asserted separately. No duplicate name or id. Every eligible entry compiles to a non-dead program. |
| Role discovery | Guest sees none. Viewer, moderator, and broadcaster snapshots match the catalog table. Kick snapshots remain unchanged. |
| Parser | Usernames, `@` stripping, missing args, timeout defaults and reasons, followers units, limits for slow, commercial, pin, announce, whisper, and marker. Invalid text retains the draft. |
| Scope gates | Every Helix action names its required scope. Missing scope compiles to `needs-reconnect`. First-party and local programs never request scopes. |
| Program runner | Six effect variants call only their matching port. `/me` alone calls IRC. Helix failure propagates so `ChatInput` restores the draft. First-party navigation publishes its explanation. |
| IPC boundary | Reject wrong sender, extra keys, invalid nested variants, overlong strings, invalid commercial lengths, and malformed IDs. Accept one valid sample per action kind. |
| Main service | Assert endpoint, method, query, body, login resolution, and receipt for each action. Inject 401, 403, 404, 429, and 5xx failures. Assert token-ownership errors are returned without a success receipt. |
| Legacy removal | Static test or grep gate proves only `sendAction` remains in the Twitch chat service and no production code references `executeNativeCommand` or tmi command helpers. |
| UI integration | Slash preview renders the full role-appropriate list. Unknown commands never send. Failed commands restore drafts. `/poll` and `/prediction` open Engagement for broadcasters. First-party commands open the expected semantic destination. |
| Real Electron | Use controlled viewer, moderator, and broadcaster accounts. Verify preview visibility, one low-risk Helix action per role, reconnect behavior, first-party navigation, draft recovery, and that `/me` still renders as an action message. |

## Red-flag screen

- No shallow public module. The session exposes suggestions and execute while hiding the whole compiler and effect runner.
- No transport leakage. Renderer actions describe Twitch behavior, not URLs, HTTP methods, or Helix response bodies.
- No temporal decomposition. The command language owns discovery through compilation. The main slash service owns resolution through receipt.
- No pass-through layer. The registry facade adapts Twitch and Kick into the existing composer contract. The session binds UI-only ports and removes command logic from React.

## Next implementation step

Define `TwitchCommandProgram`, `TwitchSlashHelixAction`, and the catalog contract test before adding any endpoint body.
