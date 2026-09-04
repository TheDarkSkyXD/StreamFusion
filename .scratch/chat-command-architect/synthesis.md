# Chat composer command design synthesis

## Decision

Candidate 2 is the base. It is the only candidate that models broadcaster access separately from moderator access. Candidate 1 supplies stable completion keys, empty-result keyboard behavior, and the rule that a leading slash can never fall through to an ordinary message. Candidate 3 supplies small provider-local executors and a ban on generic command IPC.

The public composer contract is one `ChatCommandAccess` value and one typed executor. `ChatInput` remains the sole owner of editor state and keyboard selection.

## Core shape

```ts
type ChatCommandAccess =
  | { kind: "guest"; platform: ChatPlatform }
  | {
      kind: "authenticated";
      platform: ChatPlatform;
      role: "viewer" | "moderator" | "broadcaster";
    };

type ChatCommandDefinition = {
  id: string;
  name: string;
  usage: string;
  description: string;
  platform: ChatPlatform;
  allowedRoles: readonly ("viewer" | "moderator" | "broadcaster")[];
  execution: "local" | "action-message" | "platform-command";
};

type CompletionState =
  | { kind: "none" }
  | { kind: "command"; range: TextRange; selectedKey: string; items: readonly CommandSuggestion[] }
  | { kind: "mention"; range: TextRange; selectedKey: string; items: readonly MentionSuggestion[] }
  | { kind: "emote"; range: TextRange; selectedKey: string; items: readonly EmoteSuggestion[] };
```

The readonly registry owns platform, role, syntax, description, and execution kind. The autocomplete and submit parser use the same rows.

## Inventory

Viewer commands appear for signed-in viewers, moderators, and broadcasters. Moderator commands are additions, not a replacement list.

- Twitch viewer commands include `/block`, `/unblock`, `/color`, `/help`, `/me`, `/mods`, and `/vips`.
- Twitch moderator commands include `/ban`, `/unban`, `/timeout`, `/clear`, `/slow`, `/slowoff`, `/followers`, `/followersoff`, `/subscribers`, `/subscribersoff`, `/uniquechat`, `/uniquechatoff`, `/emoteonly`, and `/emoteonlyoff`.
- Twitch broadcaster additions include `/mod`, `/unmod`, `/vip`, and `/unvip` when their executor is available.
- Kick viewer commands include `/help` and the existing StreamFusion `/me` compatibility command.
- Kick moderator commands follow Kick's current native inventory when StreamFusion can execute them through an explicit provider-command method. They include `/ban`, `/unban`, `/timeout`, `/clear`, `/user`, `/slow`, `/followonly`, `/emoteonly`, `/title`, `/category`, `/poll`, `/polldelete`, and `/prediction`.
- Kick broadcaster additions include `/mod`, `/unmod`, `/subonly`, `/raid`, `/og`, `/unog`, `/vip`, and `/unvip` when their executor is available. Partner-only `/multi` and `/kpp` stay hidden because StreamFusion has no reliable partner-status fact.

If a provider command cannot be made truthful through the current transport, omit that row instead of allowing an ordinary chat-message fallback.

## Interaction

The controlled editor owns one key handler. Popup components are passive views.

1. A leading slash token opens command completion.
2. A whitespace-delimited `@` token opens mention completion anywhere, including command arguments.
3. Emote completion runs only when neither command nor mention completion matches.
4. Arrow keys change the stable selected key. Tab or Enter commits. Escape dismisses. An empty result never traps Enter.
5. Command selection replaces only the leading slash token and appends a space. Mention selection replaces only its token and appends a space.

## Execution

Submission resolves before ordinary room-mode send blockers.

- Ordinary text keeps the existing send path.
- `/me` uses the existing action path.
- `/help` is local and displays the filtered command catalog.
- Platform commands call a typed provider-local executor. The executor may use the provider's native command transport, but it must be a distinct method with no optimistic ordinary-message echo.
- Unknown, unavailable, disallowed, and malformed slash input rejects locally and retains the draft.
- Renderer role filtering is presentation. Existing IPC validation, platform auth, and provider authority remain authoritative.

## Files

- `frontend/features/chat/utils/chat-command-registry.ts` owns definitions, filtering, and slash matching.
- `frontend/features/chat/components/chat/CommandAutocomplete.tsx` renders the passive command list.
- `ChatInput.tsx` owns trigger precedence, keyboard handling, selection, and submission classification.
- `MentionAutocomplete.tsx` remains the mention data and presentation owner, but keyboard ownership moves to `ChatInput` if required to prevent listener races.
- `TwitchChat.tsx` and `KickChat.tsx` derive access and provide provider-local execution.
- Platform chat services gain explicit command methods only where current methods cannot express a command honestly.

## Verification

- Pure registry tests cover platform and guest, viewer, moderator, and broadcaster filtering.
- Popup tests cover command text, descriptions, selection, scrolling, and accessibility roles.
- Composer tests cover `/`, prefix filtering, keyboard commit, empty results, Escape, viewer-plus-moderator visibility, mentions in command arguments, and no raw fallback.
- Provider tests prove command dispatch does not call the ordinary chat-send path.
- Real Electron verification types `@`, `/`, viewer prefixes, and moderator prefixes in Twitch and Kick composers.

## Rejections

- Separate Twitch and Kick registries duplicate access rules.
- Independent document keyboard listeners preserve the existing race.
- A generic cross-platform command IPC bus hides provider behavior behind a broad transport union.
- Treating unknown slash text as a normal message makes errors destructive and can leak command text into public chat.
