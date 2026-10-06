# Mobile UI architecture cross-judgment

Grounding: `mobile-ui-grounding-synthesis.md`, root `AGENTS.md`, `apps/mobile/CONTEXT.md`, architect design red flags, and arena rubric. Both candidates were read end to end. Scores are 1–5, with 5 strongest.

| Criterion | A | B | Judgment |
| --- | ---: | ---: | --- |
| Preserve real state owners, player lifecycle, and auth revision fences | 5 | 4 | A keeps existing route/controller startup, disposal, mounted player, native journal, account generation, and channel revision in place. B says these remain authoritative, but its new `useFocusedWatchSession` route and `shell.lifecycle` argument would need proof that they do not reown lifecycle. |
| Small public API that hides complexity without redundant state | 5 | 3 | A presents existing snapshots through feature layouts and adds only missing ports. B's bound registry, screen models, presenters, and action wrappers add coordination around controllers already bound to `AppShell`; the route registry's value does not yet justify migration. |
| Enforce feature boundaries and share production views with stories | 5 | 4 | Both keep adapters behind ports and production free of preview imports. A puts layout and stories with each feature and leaves composition as wiring. B does likewise but introduces a cross-feature registry and repeated screen-model layer. |
| Exact 160 reachable stories and Android pixel/behavior proof | 5 | 4 | A requires a manifest-derived ledger with opening control, owner, command, observed result, paired 412 × 892 capture, and native smoke proof. B has the stronger automated exact-ID check, but its sample evidence contract omits the observed result and screenshot pair, and a recorded difference can be treated as an “approval entry.” |
| Incremental implementation without throwaway architecture | 5 | 3 | A can migrate one real feature at a time, with native contracts and proofs in separate slices. B makes registry and `AppShell` route migration the first slice, before a working screen improves. |
| **Total** | **25** | **18** | **Use A as the base.** |

Graft from B: make A's ledger executable. Check its IDs against the approved manifest for exactly 160 unique rows, fail missing production owners/routes/triggers, and require observed results plus screenshot pair references for screen and workflow stories. This strengthens A's proof without adding a route registry. Keep B's deterministic boundary adapters for Storybook where rare controller states need setup; the production component and action path must be shared.

Reject B's bound route registry and universal `ControlAvailability` as initial architecture. The current `AppShell` owns navigation/restoration and controllers own operation-specific states; inserting these layers now risks pass-through coordination and broad availability mapping. Revisit a registry only if concrete feature migrations show the `AppShell` branch itself blocks ownership or reachability.

First implementation move: generate and validate the 160-row ledger from the manifest, capture the current native-client baseline, then extract shared shell chrome and migrate one existing feature without moving navigation or player lifecycle ownership.
