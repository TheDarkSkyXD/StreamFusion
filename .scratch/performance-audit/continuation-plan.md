# MultiView and remaining desktop audit

1. Read SuperDev Principles in full. Done.
2. Frame coverage. Use prior report to distinguish checked interactions from gaps; build a page/tab/control matrix.
3. Fan out read-only investigation of MultiView ownership and remaining component risks. Root alone drives Electron.
4. Reproduce MultiView frame-time issue with a visible fixed-size window, stable providers, and matching observation intervals.
5. Fix confirmed causes in small units. Verify the original action and nearest regression tests after each unit.
6. Drive remaining page controls, tabs, dialogs, images, and error states; record provider and authentication limits explicitly.
7. Aggregate independent review, run necessary quality checks, commit and push main with the compiled Electron gate.
8. Report evidence and unresolved prerequisites.

Throughput checkpoint: root owns runtime measurement and source edits only after attribution. Two read-only workers inventory page/control coverage and MultiView ownership in parallel. No concurrent app drivers or source edits during baseline measurement. Preserve user telemetry, scratch files, and real credentials. Persistent Twitch sign-in remains awaiting user authorization; it cannot substitute for a completed live restart check.
