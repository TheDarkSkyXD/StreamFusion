### Feature

**You own the design. Plan, review, verify.** Delegate implementation. Stay in the lead.

1. `how` over the affected subsystem.
2. `architect` for parallel design exploration. Skipping stays as `architect skipped: <reason>`. Do not fold the design decision silently into implementation.
3. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (the **separate-before-serializing-shared-state** principle skill). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
4. Delegate code-writing to a subagent using your configured feature model (default `grok-4.7-high`) with a specific scope. Include the file paths, the named data shape, its organizing structure per **principle-model-the-domain**, and the success criteria. Choose the organizing structure before the delegate writes logic. It can be a state machine over scattered booleans, a table or registry over branching, or a typed model over repeated shape assumptions. When the implementation admits multiple valid shapes (error handling, abstraction layer, test structure), delegate via the **arena** skill instead so the runners surface the alternatives and the cross-judge guards the pick. Mandatory: no skip-with-reason escape, and Laziness Protocol does not override it (the gain is review separation, not lines saved). You can spawn a subagent even though you are one. "The app is small" and "a subagent cannot spawn one" are both wrong. A subagent forbidden to spawn satisfies this by owning the diff directly with the same review separation. No "standing by" reply that waits on a nested agent. Comments per **Comments**. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally.
5. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it.
6. Rebase into small, ordered commits. Stack follow-ups.
   Use the **sequence-verifiable-units** principle skill, building, verifying, and committing each small unit before the next.
7. If the design is contested, `interrogate` before shipping.
8. Run **Opening a PR**.

Code-coupled work (one feature, one migration) goes to a single owner with the checkpoint inline. That owner fans out internally after the blocking phase. Parent-level fan-out is for slices that produce independent artifacts (audits, cross-subsystem investigations, competing experiments). Rewrite the checkpoint at phase boundaries. Spawn a fresh owner rather than chaining interrupts.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.


User follow-up. Add automatic retry for transient playback failures. Existing live-window recovery already automatic.
Blocking first steps. Inspect native owner and Media3 retry behavior, reproduce interrupted network on native client.
Independent workstreams. Two read-only design candidates investigate owner callback recovery and loader policy. Root owns ADB. One implementation owner after design.
Shared mutable state. Serialize native edits, tests, build, and ADB. Preserve unrelated dirty files.
Smallest safe decomposition. One native owner and owned tests. No JS retry owner or bridge/schema changes unless source proves required.
Architect phases. Ground native ownership and default loader, sketch two shapes, select one, implement, scrap if native proof contradicts.
Shipping override. Commit and push main. No PR.

Reproduction complete. Twitch and Kick both stop on native UnknownHostException after Wi-Fi/data interruption. Both remain stopped after connectivity returns. Fast Refresh disabled temporarily to keep unrelated workspace edits from restarting the verification client.

Cross-judge selected the stateless load policy. Skeletal stock policy, factory wiring, and regression tests compiled. Targeted run had 17 tests, five expected policy failures and 12 lifecycle passes. Red stage committed e1db60f. Implementation delegated to the same owner because it retains the uncommitted policy work and Gradle test setup.

Native implementation and verification. Six policy and 12 caption tests pass. Broader playback and PiP selection has 34 tests across seven suites, all passing. Independent code review approved the combined diff. Comment Sicko found zero added comments or suppressions, zero deletions, and no flags. Scoped deslop and whitespace checks pass.

Native APK built successfully in 1m34s and installed. SHA256 61ED02E750415C989F6452770BA1CFA6847C702878DBA5D95EB6E163D3982DC7. PowerShell reported the NODE_ENV warning as NativeCommandError, but Gradle completed BUILD SUCCESSFUL and the newly built APK installed successfully. Kick recovered automatically after Wi-Fi/data were disabled at14:57:25 and restored after14:58:14. Advancing frames observed after recovery. Twitch reconnection validation in progress.

Observation correction. Added a success assertion to the evidence driver for UIAutomator dump. A null root can return exit0 and leave an older remote XML file. The driver now refuses that stale snapshot. Startup snapshot was retried successfully. This change is evidence tooling only.

Shared-state isolation. Another session navigated the shared emulator to authentication during the Twitch outage. Moved final Twitch verification to a task-owned read-only API30 emulator on ports5584/5585. The original Metro8084 stopped responding. A fresh Metro revealed a missing ExpoWebBrowser module introduced by concurrent uncommitted account-login work after the native APK was built. Created a detached, clean checkout at F:/CodexWorktrees/StreamFusion-retry-proof, commit b37dfda, and a dedicated Metro. No shared source changes were reverted. The fix was pushed to main and remote b37dfdab9adffeaa08d109d2f983e1be43883079 verified.

Final native proof. Twitch played through native Media3 session7f832cf, appPID6142. Wi-Fi/data disabled15:36:10.622, both settings0. Restored15:37:06.950, both settings1. The player retained its session during the56-second outage, then recovered from BehindLiveWindowException at15:37:12.939 with the earlier fix. Directly inspected restored and later screenshots show advancing video. No Retry tap. Saved UI evidence verifier passed Twitch, Kick, policy, and lifecycle checks. Kick's49-second outage proof and34 passing native playback/PiP tests complete the verification.
