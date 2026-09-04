# Raid handoff arena cross-judge

## Verdict

Use **Candidate A** as the base. It is the closest fit to StreamFusion's existing renderer-side chat services, Hermes client, shared Pusher client, lazy chat loader, per-stream page, and per-slot multiview ownership. It reaches hidden-chat support without introducing a new main-process IPC subsystem or an app-wide coordinator.

Graft Candidate C's dated capability profiles, independent kill switches, explicit signal-loss behavior, and strict separation of progress from launch authority. Graft Candidate B's final source recheck, target preloading, reduced-motion behavior, and typed multiview merge result.

Scores use a 10-point scale. Higher is better, including implementation risk, where 10 means lower risk.

| Criterion | A | B | C |
| --- | ---: | ---: | ---: |
| Interface depth | 8 | 6 | 9 |
| Existing StreamFusion fit | 10 | 5 | 7 |
| Provider-contract honesty | 8 | 9 | 10 |
| Hidden-chat coverage | 9 | 10 | 9 |
| Concurrency and multiview correctness | 9 | 9 | 9 |
| Implementation risk | 9 | 5 | 7 |
| Verifiability | 9 | 10 | 9 |
| **Total** | **62** | **54** | **60** |

## Candidate A

### Why it is the base

- Its `useRaidHandoff({ source, onJoin })` caller contract is small and keeps route or slot replacement with the surface that owns it.
- It extends real StreamFusion seams: `twitch-hermes-client.ts`, `kick-chat.ts`, `chat-service-loader.ts`, `ChatServiceEvents`, `StreamPage`, `stream-slot.tsx`, `multistream-store.ts`, and `ChatSimTool.tsx`.
- Separate raid leases make detection independent of whether chat is mounted while retaining the existing shared realtime connections.
- One controller per surface isolates opt-out state and timers. A raid in one multiview slot cannot mutate another slot's decision.
- The atomic multiview replacement includes the useful existing-target merge rule instead of creating duplicates.
- Parser fixtures, socket lifecycle tests, fake-clock reducer tests, and single/multiview integration tests give a credible verification path.

### Corrections required in the base

- Replace optional or slug-only source matching with a resolved canonical channel ID when the provider supplies one. Recheck that the source is still playing immediately before navigation.
- Do not treat IRC `unraid` as a stable cancellation fallback without a current captured, source-scoped contract. Unknown or weakly correlated cancellation must fail closed.
- Do not allow optional raid IDs to correlate unrelated updates, cancels, or go signals. If the wire event lacks a usable ID, correlate within a provider/source-scoped session and reject ambiguity.
- Add contract provenance and runtime feature guards before enabling either undocumented adapter.
- Make transport loss an explicit reducer input that clears the pending timer and leaves playback unchanged.
- Derive displayed time from an absolute deadline and the clock. Never make interval ticks the source of truth.

### Red-flag screen

No fatal red flag. The main concern is a mildly shallow transport surface: `watchRaidHandoffs`, `RaidHandoffEventSource`, and explicit `on`/`off` APIs overlap. Keep one deep acquisition operation that installs the listener and returns an idempotent release function. Adding the outgoing event to general `ChatServiceEvents` is acceptable for existing fit only if raw provider fields never enter that shared type.

## Candidate B

### Strengths worth grafting

- Three-stage source validation, especially the final playback-context check just before execution.
- A result-bearing atomic multiview replacement that explicitly handles an already-open target.
- Absolute-deadline progress, reduced-motion behavior, target query warming, and a strong story matrix.
- Dev replay entering the real ingestion boundary is stronger than directly inserting renderer state.
- Keyed offers correctly acknowledge that multiple multiview sources can raid concurrently.

### Why it is not the base

- The app-shell coordinator must observe exported router state, multiview state, source leases, prompt stacking, target hydration, timers, and navigation. It hides work from callers but accumulates unrelated ownership and couples the feature to every playback mode.
- The proposed main-process service, IPC handlers, preload contract, snapshot store, and owner lifecycle are a large parallel architecture for realtime clients that already run and are consumed in the renderer.
- `watch(sources)` followed separately by `onChanged(listener)` does not by itself eliminate the registration race it claims to solve. A single subscribe-and-snapshot operation would be required.
- A global prompt stack introduces unresolved ordering and visibility policy that per-surface ownership avoids.
- Canonical resolution in main is useful in isolation, but moving the full feature there increases the blast radius without a demonstrated security or lifecycle need.

### Red-flag screen

Candidate B has information leakage and shallow-interface pressure. The zero-prop coordinator implicitly knows router, multiview, query, prompt, and IPC policy, while the two-method `watch`/`onChanged` API makes callers coordinate subscription timing. Several new layers change transport location more than abstraction. Reject this shape as the base.

## Candidate C

### Strengths worth grafting

- The dated `RaidContractProfile` is the clearest representation of unstable first-party observations. Per-provider guards and session circuit breakers make graceful degradation operational rather than rhetorical.
- `RaidProgress` and `RaidLaunchAuthority` are correctly distinct. Twitch may display progress but must wait for a validated go signal; Kick may execute from the dated observed-client deadline.
- Audience facts encode meaning, so Kick's `hosted.viewers_count` cannot become raid-party or chatter copy.
- `signal-lost`, compact opt-out with rejoin, same-platform generic types, avatar fallback, and captured-fixture metadata are strong additions.
- The boundary is the deepest React interface of the three.

### Why it is not the base

- The module map does not define the actual bridge between its backend service and frontend controller. StreamFusion's existing services are renderer-consumed, while the design labels a separate backend service without explaining whether it is imported directly or exposed through preload/IPC.
- Wrapping each player in a boundary is clean for DOM players but its claim that a renderer portal will appear above a `WebContentsView` is not safe. Native web contents can composite above renderer DOM. The design acknowledges this only later as an open question.
- A separate raid-handoff service beside chat services risks duplicating connection and lease policy unless synthesis explicitly embeds its adapters in the existing shared clients.
- A documented EventSub `channel.raid` event should not be used as preferred go authority until its timing and correlation with the active proprietary offer are proven.

### Red-flag screen

The public boundary is deep and raw wire types do not leak. The main red flag is temporal and ownership ambiguity between `raid-handoff-service`, adapter watches, and the frontend controller because the process boundary is missing. Retain the domain concepts, not the incomplete service placement. Also reject the unproven DOM-portal-over-`WebContentsView` assertion.

## Graft plan

Apply these changes coherently to Candidate A:

1. Add Candidate C's dated provider capability profiles with independent runtime guards, mismatch telemetry, and a session-only circuit breaker. Default enablement remains a release decision after controlled live capture.
2. Replace `RaidAdvance` with separate progress and launch-authority types. Twitch zero progress enters a waiting state; only a validated go moves. Kick's eight-second absolute deadline carries `observed-first-party-client` provenance.
3. Add `signal-lost` and source-change transitions. Both cancel timers and retain the current stream.
4. Add Candidate C's semantically typed audience labels and compact **Join raid** control after local opt-out. Never label an audience count as chatters.
5. Add Candidate B's final source-presence check, absolute-clock rendering, reduced-motion treatment, target preload, and typed existing-target merge result.
6. Keep Candidate A's existing chat transport reuse and per-surface controllers. Consolidate its listener API to one acquire-and-release operation.
7. Verify WCV presentation before choosing a popup host. If DOM cannot cover the native view, temporarily inset or hide only the affected WCV through its existing slot bridge; do not assume a portal fixes composition.
8. Keep two simulator levels: normalized scenario controls for fast UI work and raw captured fixture replay through the private parsers for contract verification.

## Explicit rejections

- Reject Candidate B's app-shell global coordinator, new IPC snapshot subsystem, and split `watch`/`onChanged` API.
- Reject a single global active raid. Surface-local decisions remain independent; shared transports only fan out immutable normalized events.
- Reject raw Pusher, Hermes, IRC, EventSub, or GraphQL objects in renderer state.
- Reject Twitch `joinRaid` or `leaveRaid` GraphQL mutations because they are unsupported third-party contracts.
- Reject incoming raid notices and generic stream-offline signals as outgoing navigation triggers.
- Reject fabricated Twitch deadlines and reject Kick target viewers as raid-party members or chatters.
- Reject `unraid` as a cancellation authority until a source-scoped current capture proves it.
- Reject EventSub as a go authority until timing and offer correlation are proven.
- Reject any automatic navigation after malformed data, source mismatch, transport loss, unknown contract version, or ambiguous correlation.
- Reject the assumption that a renderer portal can cover `WebContentsView`; verify composition and use the slot bridge if required.

## Final synthesis direction

Candidate A plus the listed grafts produces the smallest coherent design: existing transport ownership, one deep per-surface controller, accurate platform semantics, reversible local participation, atomic single/multiview movement, and explicit kill switches around every undocumented contract. The first implementation slice should be domain types, dated profile registry, pure reducer, and raw parser fixtures. No popup or navigation should ship before those boundaries pass tests and a controlled live capture validates the enabled profile.
