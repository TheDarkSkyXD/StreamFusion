# MultiChat Architect Arena Judge

## Scores

| Criterion | Candidate A | Candidate B |
| --- | ---: | ---: |
| Correct per-channel routing | 5 | 4 |
| No duplicate session/event work | 5 | 3 |
| Small deep interface | 5 | 4 |
| Preservation of existing ChatPanel features | 3 | 5 |
| No user-visible content cap | 5 | 4 |
| Measurable performance | 5 | 5 |
| Staged migration with low regression risk | 3 | 4 |
| Overall | 4.4 | 4.1 |

## Verdict

Use Candidate A as the base.

Candidate A has the correct target architecture for merged chat and channel tabs. It makes `ChannelKey` mandatory, scopes every channel-local event, moves event routing to one platform router, replaces global emote context with per-channel leases, and models merged chat as a compact reference index rather than hidden panels or repeated virtualized lists. That directly addresses the current risks in singleton service fan-out, unscoped pin and poll events, and `activeChannelId`.

Candidate B is a better migration bridge, but it is not the right final base. Its rail mounts one visible pane and its registry retains the existing platform components in `mode="view"`, which protects current behavior. The problem is that it does not fully design merged chat in the caller surface. It also says each `ChatChannelSession` registers service listeners once and filters by channel. That removes visual duplication, but still creates one listener set per channel instead of one provider-level event router. For a multichannel workspace, that keeps the current fan-out shape in a quieter form.

## Grafts

Graft these from Candidate B into Candidate A.

1. Add `ChatRenderMode = "standalone" | "view"` as a migration bridge for `TwitchChat` and `KickChat`. Candidate A's final `ChatSurface` is cleaner, but extracting both large platform components in one step risks losing moderation, reply, pins, predictions, emotes, badge hydration, and composer behavior. Use B's view mode to move lifecycle and listener ownership first while preserving the existing visual surface.

2. Add B's `retainVisible(key)` idea, or an equivalent short-lived visible lease, for React tab switches. This prevents a selected channel from being released during commit churn without giving React ownership of provider joins.

3. Use B's DOM invariant for tabs. The rail should mount exactly one `ChatMessageList` or `Virtuoso` in tabs mode while inactive channels keep session leases and unread counts. Candidate A states "never mounts hidden `ChatPanel` trees"; B makes that testable.

4. Use B's provider-by-provider extraction sequence. Start with Twitch, then Kick. Candidate A's migration is architecturally correct but broad. B's sequence gives a lower-risk route for proving `mode="view"` and registry ownership before touching the second provider.

5. Use B's measurement names for implementation telemetry. `multiview.chat.sessions` and `multiview.chat.visible_lists` are concrete counters that prove the core invariant. Add Candidate A's event-normalization and merged-feed frame-cost checks on top.

6. Use B's explicit merged-ordering open question. Candidate A specifies a merged reference index, but it does not choose receipt order versus provider timestamp ordering. That policy must be explicit before building `MergedMessageIndex`.

## Rejections

Do not take B's one-visible-pane design as the final product model. It silently narrows the request if "merged chat" is expected as a first-class mode. A tabs-only rail with live inactive sessions is not merged chat.

Do not take B's per-session service listener ownership as the final event model. It is safer to extract, but it does not satisfy the "no duplicate event work" criterion when several channels on the same provider are open.

Do not take A's category and playback work as part of the same implementation turn unless the parent task explicitly includes them. Both candidates discuss Categories and MultiView playback, but merged chat and channel tabs can be designed without shipping category cache migration or playback coordinator changes in the same turn.

Do not implement A's full `ChatSurface` extraction in one pass. It preserves features by assertion, not by a concrete bridge. B's `mode="view"` bridge is the safer way to keep current platform behavior while moving ownership.

## Behavior And Scope Flags

Candidate A overstates what can be safely implemented in one turn. Its migration touches chat event contracts, emote ownership, session registry, MultiView playback, category cache keys, persisted store migration, and component deletion. That is a multi-phase program, not one safe implementation unit.

Candidate B silently changes product behavior if accepted as-is. Its primary usage shows tabs with one visible `ChatChannelPane`, but not a real merged chat surface. Later tests mention a merged feed, but the design does not define its UI contract, send target behavior, or source-scoped widgets.

Both candidates include category and playback redesigns outside the immediate merged-chat problem. Those may be valid adjacent work, but they should not be bundled into the first chat migration unless the implementation goal has already expanded.

## Recommended Base Design

Base on Candidate A's final shape.

Keep:

- Branded `ChannelKey`.
- Complete `ChatEndpoint` union.
- Mandatory `ScopedChatEvent` for messages, notices, clears, deletions, pins, polls, predictions, room state, restrictions, and moderator state.
- One `PlatformRouter` per provider.
- Registry-owned channel leases and workspace leases.
- Per-channel emote leases.
- Compact `MergedMessageIndex`.
- `MultiChatView` as a presentation union with tabs and merged modes.

Modify with grafts:

- Use B's `mode="view"` bridge before extracting a new shared `ChatSurface`.
- Add a visible-retention lease for tab commit transitions.
- Define merged ordering policy before implementing `MergedMessageIndex`.
- Add tests that prove one visible virtualized list in tabs mode, one platform listener set per provider, and no event write outside the target `ChannelKey`.

## Verification Notes

This judge read both candidate files end to end and compared them directly against the requested rubric. No production files were edited.
