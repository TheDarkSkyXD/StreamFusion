# Player controls correction

1. Reproduce it yourself on the matching surface via the control skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with the active harness's durable wake or scheduling mechanism when available. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
3. Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default `grok-4.7-high`) with a specific scope.
4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
5. Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
   This is the canonical **sequence-verifiable-units** principle skill, the failing test first and the fix on top.
6. Run **Opening a PR**.


Step 5 skip: the existing parent commit and native screenshot already reproduce the layout; this correction does not need a standalone failing-test commit. Step 6 uses commit and push to main, per root AGENTS.md, without a PR.

Architect phases

1. Ground
2. Sketch
3. Agree
4. Implement
5. Scrap

Arena phases

1. Frame
2. Fan out
3. Cross-judge
4. Pick
5. Graft
6. Verify

Throughput checkpoint: two production components plus their route lifecycle and focused tests. Existing transport controls are already on the video. Preserve one player mount, existing quality and preference contracts, and safe-area bounds. Native portrait/fullscreen verification is required.
