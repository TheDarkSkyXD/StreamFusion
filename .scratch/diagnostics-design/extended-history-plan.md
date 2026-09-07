# Extended diagnostic history

- [x] Read SuperDev principles. Model the Domain chooses one shared range catalog; Prove It Works requires a real clean close and reopen; Build the Lever adds repeatable retention/restart checks.
- [x] Ground the existing feature: Resources owns range/selection; its hook queries a lease through preload and trusted diagnostics IPC; main owns the SQLite recorder; no Platform branch. The recorder already writes raw and minute data and marks runtime sessions clean on app shutdown.
- [x] Compare designs. Parallel minute/hour summaries preserve the existing seven-day history and keep queries independent of recurring compaction. In-place compaction would mix storage resolution and complicate migration and peak provenance. Choose parallel hourly summaries with one-time backfill.
- [x] Blocking first steps: inspect current persistence, shared range contracts, UI, and shutdown path before implementation.
- [x] Independent workstreams: feature owner changes production contracts/recorder/UI; parent owns independent evidence tests, docs, and live proof.
- [x] Shared mutable state: exclusive file ownership; no concurrent Electron runs or commits.
- [x] Smallest safe decomposition: one production owner integrates the shared catalog and storage selection; parent reviews the resulting behavior.
- [x] Implement real time, 5m, 30m, 1h, 24h, 7d, 30d, 90d and 90-day hourly evidence.
- [x] Verify clean close, retained data on reopen, new samples after reopen, visible closed gaps, and old peak/contributor/renderer evidence.
- [x] Verify IPC types, focused tests, lint, React Doctor, and live UI.
- [x] Commit and push main; preserve existing telemetry and local proof artifacts. No PR per repository instruction.

Real time follows the latest five minutes and publishes once per second while selected. Other ranges retain pause/back/date controls. Ninety-day views use coarser display buckets while retaining true sampled maxima and source timestamps. Calendar retention does not invent activity while the app is closed.

Verified 46 tests across 10 files, simulated 92-day retention, clean and interrupted sessions, legacy upgrade and partial pruning. Checked Electron launch passed typecheck and lint. React Doctor 91/100. Feature boundary proof passed. Comment review found no actionable additions or suppressions.

Real UI proof exercised all eight ranges at 1400x900 without horizontal overflow. Real time sampled every 1004-1017ms. Native Close persisted a clean shutdown and 97 samples. Reopening the saved SQLite retained all 97 samples, appended 33, and displayed the closed interval without fabricated observations. Selecting an older peak showed exited process identities and renderer evidence. Both isolated runs were cleaned and evidence retained. No real 90-day soak was claimed.

Committed and pushed 26d29bf to main. Required compiled Electron smoke passed. Existing user telemetry was restored with its original SHA256. Local proof artifacts were restored and the temporary preservation stash was dropped.

