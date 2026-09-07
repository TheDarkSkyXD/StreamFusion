# Desktop performance and reliability audit

- [x] Read the SuperDev Principles section in full.
- [x] Phase A: Frame. Cover all primary routes, settings sections, discovery filters, playback tabs, and available dialogs. Successful paths require rendered content, image inspection, and no app exception. Record unavailable provider/account paths separately.
- [x] Phase B: Design the workflow. Use the existing isolated Electron controller. Capture timings, screenshots, image state, network failures, and renderer exceptions before changes. Read-only explorers trace separate code areas while one driver owns the app.
- [ ] Phase C: Run the loop.
- [ ] Inventory and measure primary routes and settings tabs.
- [ ] Reproduce and repair image failures at their owner.
- [ ] Measure and reduce the dominant repeated work.
- [ ] Exercise playback, related content, multistream, search, and local library controls.
- [ ] Repeat affected paths and run applicable quality checks.
- [ ] Phase D: Keep the audit trail. Append decisions and evidence as each unit finishes.
- [ ] Phase E: Verify and hand back. Review changes and evidence independently, commit only task changes, push main, and clean up the isolated instance.

Throughput checkpoint. One Electron driver avoids concurrent navigation. Existing controller and performance-soak utilities provide interaction and profiling. A reusable sweep captures comparable route artifacts. Code exploration runs concurrently without shared writes. Architectural design exploration is skipped for mechanical fixes with existing ownership; revisit if a fix changes a contract.
