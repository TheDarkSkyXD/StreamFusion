# Slash-command architecture judge

## Scores

| Criterion | candidate-card | candidate-feed |
|---|---:|---:|
| 1. Structural guarantee: raw slash text and feedback never enter provider send or persisted chat, while official mutations still run | 5 | 4 |
| 2. Smallest interface and shortest call chain | 5 | 2 |
| 3. Easy insertion into TwitchChat/KickChat/ChatInput without changing ChatMessageList | 5 | 1 |
| 4. Typed Twitch `/vips` and `/mods` plus local unsupported notices | 4 | 4 |
| 5. Testability and accessibility | 4 | 3 |

## Recommendation

Use `candidate-card` as the base.

Its core boundary is cleaner: `ChatInput` consumes slash submissions, calls a provider command handler, and renders any returned `CommandResult` in local React state above the composer. That makes the important invariant a property of the call graph: command text does not continue to `sendChatPayload`, and command feedback is not modeled as `ChatMessage`, not routed through `addMessage`, and not available to persistence or hydration.

It also has the smaller integration footprint. `TwitchChat` and `KickChat` only need to provide `onProviderCommand`; `ChatInput` owns the result surface; `ChatMessageList` stays unchanged. Official command mutations still run through the existing platform command session, and typed Twitch reads for `/mods` and `/vips` remain explicit.

## Graft from candidate-feed

Graft the channel-scoped lifecycle guard from `candidate-feed`, but keep the card UI.

Concretely: include the active `channelKey` or a submit sequence token in the pending command result path, and discard a result if it completes after the input has moved to another channel/session. This preserves `candidate-card`'s small interface while preventing stale `/mods` or `/vips` output from appearing under the wrong composer after a channel switch.

Do not graft the feed/store/row-union machinery.

## Red flags

- `candidate-feed` requires changing `ChatMessageList` to accept a `ChatRow` union. That expands the blast radius into the most sensitive rendering path and violates the easiest-insertion criterion.
- `candidate-feed` adds an external result store plus timestamp merging. That creates extra ordering and lifecycle behavior to test, and it gives command feedback more ways to look like chat history even if the model is technically separate.
- `candidate-feed`'s `CommandRunner.run(): Promise<void>` with injected `publish` is less audit-friendly than returning a `CommandExecutionResult`; side effects are easier to hide.
- `candidate-card` should not ship with only "latest completed result wins" semantics. Add a channel/session token so slow command responses cannot render in a stale context.
- `candidate-card` should make unsupported/unknown command feedback explicit in the same local result path, including Kick unsupported notices, so no platform falls back to sending unknown slash text.
