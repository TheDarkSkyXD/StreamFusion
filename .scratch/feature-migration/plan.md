# Feature-root migration

1. Read SuperDev Principles in full. Done.
2. Phase A: Frame. Inventory implemented features, runtime boundaries, tests, and exact completion checks.
3. Phase B: Design the workflow. Compare responsibility maps, capture baseline counts, and build a collision-safe relocation/import updater before moving code.
4. Phase C: Run the loop. Migrate independently verifiable runtime/feature groups; check imports, layer direction, test discovery, types, and behavior after each group.
5. Phase D: Keep the audit trail. Record decisions and verification in decisions.tsv as each unit completes.
6. Phase E: Verify and hand back. Run complete checks and real Electron navigation, review independently, commit and push main.

Done predicate: each implemented app feature has an owned root using the nine responsibility directories; feature-private code and tests no longer live in generic legacy locations; transport stays thin and privileged code stays outside the renderer; normal lint enforces layer dependencies; test discovery retains the baseline tests; runtime entry points and verification helpers follow new paths; full checks and actual Electron pass.

Throughput checkpoint: three read-only inventory slices run in parallel while the root builds the migration manifest and relocation tool. No concurrent shared-source edits. Implementation workers receive isolated worktrees and disjoint feature scopes after the map is agreed. The root owns integration, cross-feature imports, build/lint/test configuration, UI verification, and main pushes. Existing user telemetry and scratch work stay untouched.

Design phases: Ground, Sketch, Agree (automatic for authorized reversible migration), Implement, Scrap only if verification disproves the shape.
Swarm phases: Frame, Fan out by ownership, Aggregate, Report.
