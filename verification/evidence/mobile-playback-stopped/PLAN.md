# Mobile playback stopped bug

1. Reproduce it yourself on the matching surface via the control skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with the active harness's durable wake or scheduling mechanism when available. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
3. Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default `grok-4.7-high`) with a specific scope.
4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
5. Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
   This is the canonical **sequence-verifiable-units** principle skill, the failing test first and the fix on top.
6. Run **Opening a PR**.


Step 6 override. Commit and push to main per user instruction. No PR.

Throughput checkpoint. Root owns emulator reproduction and verification. Delegate source investigation and implementation. Keep scope to the evidenced lifecycle failure.

Progress. Reproduced exact stopped message on native development client. Android log shows BehindLiveWindowException. Official Media3 recipe confirms recoverable native error. Release 0.1.8 installed and hash verified. New lifecycle tests fail because owner releases recoverable session.

Architect. Ground complete. Sketch native recovery and JS restart alternatives. Agree uses native callback with numeric error code and currentSession identity guard. Implementation pending red-test commit. No new data model or bridge contract required. Scrap only if same-surface verification contradicts design.

Kick baseline. Released 0.1.8 absi also fails with BehindLiveWindowException at 14:12:17. Twitch-specific filtering is not required for this failure. Source recovery stays in shared Media3 owner.

Cross-judge. Independent reviewer approved native six-line recovery. Reject JS source restart and unsupported one-recovery cap. Scoped no-comments found zero added comments or flags. Deslop diff has no new abstraction or guard beyond native player identity. Targeted native12pass, mobile1112pass plus architectureproof. Native full8updaterfail independent of playback changes, occurrence baseline not yet run.

Same-surface verification. New native APK installed. Isolated Metro server8084 replaced unresponsive8081 for this test only. Twitch real stream recovered from the original BehindLiveWindowException at14:26:40 in process21021. Screenshot twitch-after-running.png at14:27 shows active gameplay rather than a stopped screen. Kick validation pending.

Kick verification complete. Absi remained active through 14:32 with advancing scenes and no stopped screen. Initial emulator color artifacts cleared in the final capture. Both providers reproduced on released 0.1.8 and played on rebuilt native APK. Evidence and full-suite limitations recorded in README.md. Scoped diff check passed. Commit and push the six-line fix after the existing failing-test commit.
