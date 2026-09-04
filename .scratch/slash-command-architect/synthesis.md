# Slash-command local result synthesis

## Decision

Use the single-card candidate. `ChatInput` consumes recognized slash commands, awaits a typed provider outcome, and renders one dismissible renderer-local result above the composer. The result is not a `ChatMessage`, never enters `useChatStore`, and is never serialized or persisted.

## Graft

Adopt the feed candidate's channel lifecycle protection without its store or row union. A monotonically increasing command context token is invalidated when platform or channel changes, and stale async outcomes are discarded.

## Core shape

```ts
type ChatCommandOutcome =
  | { readonly kind: "handled" }
  | { readonly kind: "local-result"; readonly result: ChatCommandResult };

interface ChatCommandResult {
  readonly tone: "info" | "error";
  readonly title: string;
  readonly body: string;
}
```

Twitch effects gain a typed channel-member read for `/mods` and `/vips`. Twitch and Kick platform-only effects become local notices. Official API mutations, moderation actions, IRC actions, disconnect, and in-app engagement navigation remain executable and return `handled`. Neither command session accepts an external-navigation capability.

## Rejections

The ephemeral feed lost because it adds a second store, timestamp merging, and a `ChatMessageList` row union to solve a single-result interaction. Synthetic system messages lost because they could leak into chat persistence and history.

## Verification

Session tests must prove both catalogs have no external-open dependency, `/vips` and `/mods` call existing typed Twitch API operations, and unsupported workflows return local results. Component tests must prove results render locally and official moderation calls still execute.
