# Diagnostics investigation

The user wants to investigate a week of CPU and RAM activity visually on the Diagnostics page. Exporting files is not part of the required workflow.

## Acceptance

- The recorder starts with the app and continues with Diagnostics closed. It checkpoints during operation and restores persisted evidence after restart.
- Resources opens with CPU and RAM timelines visible without scrolling past large cards. No duplicate charts. Both charts have time labels, units, keyboard selection, and explicit gaps.
- Ranges include an hour, a day, and seven days. Users can freeze the range, move backward, and select an observed period or incident. Changing selection visibly updates contributing processes and activity.
- Preserve actual sampled maxima and peak timestamps through aggregation. Never compute a peak from previously averaged observations.
- Retain process identity after exit; historical records never grant recovery authority. Show CPU peak, RAM growth, process lifetime, and observed activity with timestamps.
- Collect renderer heap, route, chat activity and active workloads during ordinary use. Label associations as evidence, not proven causation. Never store chat message contents, tokens, full playback URLs or user query strings.
- Keep minute summaries for seven days and fine samples for a recent hour. Preserve a bounded set of before/after incident windows. Enforce byte/row limits and show when coverage is incomplete.
- Expose recorder status, actual oldest/newest data, sampling resolution and gaps. No fake historical data in the product.
- Handle storage failures without taking down playback. Display recording failures on the page.
- Existing tabs continue working. Keep main-only persistence behind the trusted diagnostics IPC boundary.

## Verification

1. Real database or filesystem tests span eight simulated days, including a single short peak, gradual memory growth, exited processes, gaps, eviction, close/reopen, and storage budget pressure.
2. Renderer tests verify range/incident selection updates the displayed evidence and pause remains fixed during live updates.
3. Run relevant diagnostics tests, desktop typecheck/lint, architecture checks and React Doctor.
4. Launch isolated Electron with verify-streamfusion. Navigate Home then Diagnostics, select historical periods and incidents, capture screenshots, and prove collector activity happened while the page was closed.
5. Explicitly distinguish accelerated retention tests from a real seven-day soak. No claim that a real seven-day soak happened.

## Ownership and delivery

- One feature owner integrates source/contracts and delegates disjoint modules after the contract is established. Parent reviews and verifies independently.
- Keep existing telemetry/platform-health.jsonl changes untouched and unstaged.
- Commit and push main after verification. Do not open a PR.
