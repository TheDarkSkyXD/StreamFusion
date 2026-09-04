# Twitch slash command architecture cross-judge

## Verdict

Use Candidate B as the base. Its catalog entries are executable command compilers, its effect union is closed, and its single semantic main-process boundary hides login resolution and Helix sequencing. This gives future commands one place to define discovery, validation, scope behavior, and execution.

Graft Candidate A's explicit role routes, channel-scoped disconnect behavior, argument grammar coverage, and detailed OAuth and response checks into that base. Fix Candidate B's missing moderator prediction route before implementation.

## Scores

Scores are out of 5 for each rubric item.

| Criterion | Candidate A | Candidate B |
| --- | ---: | ---: |
| 1. All 47 commands, roles, and capability gaps | 4.8 | 4.2 |
| 2. Helix, IRC, main-credential boundary, and OAuth | 4.1 | 4.8 |
| 3. Typed registry prevents catalog and executor drift | 4.2 | 5.0 |
| 4. Honest first-party and token-ownership UX | 4.8 | 4.6 |
| 5. Small, maintainable, testable, preserves Kick/multiview/drafts | 4.0 | 4.5 |
| **Total** | **21.9 / 25** | **23.1 / 25** |

## Candidate A

### Strengths

- Enumerates all 47 linked commands plus `/help` and `/me`, with the most complete role-routing table of the two designs.
- Models editor authority as verified or unknown instead of inferring it from moderator status.
- Correctly routes moderators to Twitch first-party surfaces where native Twitch permissions are broader than public Helix token ownership, including polls and predictions.
- Defines channel-scoped `/disconnect`, which is safer for a multistream workspace than disconnecting a singleton Twitch client.
- Gives concrete argument rules, scope additions, API limits, response cases, and draft-restoration tests.
- Keeps all tokens and API requests behind the existing typed main-process boundary and removes retired IRC execution.

### Risks

- `ArgumentGrammar`, `ParsedCommandArguments`, and `TwitchHelixHandler` are independent unions. The type system cannot prove that a handler receives the argument shape it needs. The proposed separate plan compiler can recreate the command-name switch the design intends to remove.
- The design says the hook hides username resolution, but its proposed IPC variants accept resolved user IDs. That leaves renderer orchestration and multi-call Helix workflows exposed.
- `set-suspicious-status` includes `NO_TREATMENT`, while Twitch exposes removal as a distinct endpoint. Candidate B's separate remove action models this boundary more accurately.
- Replacing `ChatInput`'s current command interface with a catalog object expands the Kick and composer blast radius.
- Direct per-operation IPC additions are initially smaller, but they leave command workflow knowledge split between renderer planning and main endpoint adapters.

## Candidate B

### Strengths

- Every catalog entry must compile to a closed effect program. A command cannot appear in autocomplete without an execution result or an explicit first-party/local fallback.
- The semantic `TwitchSlashHelixAction` union carries command-specific payloads, making invalid handler-and-argument combinations harder to represent.
- Main owns username resolution, endpoint selection, token-owner rules, and receipts behind one validated IPC operation. The renderer never receives credentials or coordinates API sequences.
- Only `/me` can compile to `irc-action`; the legacy `executeNativeCommand` path is deleted after migration.
- It preserves the existing generic `ChatInput` and Kick registry facade, reducing cross-platform regression risk.
- First-party destinations are semantic values rather than URLs in command definitions, so URL stability and fallback policy stay in one adapter.
- Its contract, runner, IPC, main-service, and legacy-removal tests directly prove the architecture's invariants.

### Risks

- The routing table omits `/prediction` for known moderators even though Twitch's first-party UI supports moderators. It currently shows the command only for broadcasters.
- `/disconnect` is modeled as a global port and the design leaves its multiview semantics unresolved. It must leave only the current channel or tab.
- `actorId` is supplied by the renderer in `TwitchSlashCommandRequest`. Main must derive it from stored authentication or validate it against the authenticated token before using it. Sender-origin validation alone does not establish identity.
- The new semantic service overlaps existing Twitch API operations. It should delegate to existing endpoint helpers where possible instead of duplicating request code and schemas.
- `/commercial` and `/raid` need an explicit completion contract with their confirmation flows so the composer clears its draft only after the intended handoff succeeds.

## Grafted recommendation

Start from Candidate B with these changes:

1. Keep `TwitchCommandSpec.compile` as the sole executable catalog and `TwitchCommandProgram` as the renderer effect boundary.
2. Add Candidate A's context-dependent routes. In particular, expose `/prediction` to verified moderators and open Twitch's first-party management surface; use StreamFusion Engagement for broadcasters. Keep editor commands hidden until editor authority is positively verified.
3. Make `/disconnect` carry the current channel identity and leave only that Twitch chat. Do not disconnect other multiview chats.
4. Keep Candidate B's typed command-specific action payloads, but reuse Candidate A's normalization rules and limits through small parser helpers. Do not introduce one generic parsed-arguments union.
5. Retain the semantic `execute-slash-command` IPC boundary. Have its main service delegate to existing Twitch endpoint helpers, resolve target logins in main, and return typed receipts.
6. Remove renderer-controlled `actorId` where the stored token can supply it. Otherwise validate it against authenticated token identity before any mutation. Continue treating renderer role filtering as UX only and Twitch as the authorization authority.
7. Put required scopes beside each compiler and add Candidate A's explicit missing scopes. Missing scopes should produce `needs-reconnect` without hiding the command or losing the draft.
8. Model suspicious-status removal as a distinct action and endpoint. Explain that both monitored and restricted treatment are cleared.
9. Reuse existing Engagement, commercial confirmation, and raid confirmation/countdown UI. Define whether opening a dialog is completion; preserve the draft until the command has been accepted by that flow.
10. Add exact 47-name equality, per-role availability, every-entry-compiles, `/me`-only-IRC, Kick snapshot, channel-scoped disconnect, draft restoration, strict IPC, token-identity, and endpoint delegation tests.

## Rejections

- Reject Candidate A's loosely paired grammar and handler unions because they allow registry/compiler drift inside the type system.
- Reject renderer-side username resolution and Helix choreography because those details belong with the credential-owning main service.
- Reject global Twitch disconnect semantics because they can break unrelated multiview sessions.
- Reject exposing unverified editor commands. A declared `unknown` editor state is useful, but it must not imply capability.
- Reject hard-coded first-party URLs in the catalog. Resolve semantic destinations in one tested adapter with a safe channel-page fallback.

## Verification gate

The synthesized design is ready for implementation after the moderator `/prediction`, channel-scoped `/disconnect`, and authenticated actor-ID rules are written into the contract. Implementation must then prove exact catalog coverage, no production reference to `executeNativeCommand`, no IRC effect except `/me`, unchanged Kick behavior, and failed-command draft restoration.
