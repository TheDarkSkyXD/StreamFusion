# Chosen design

SQLite is the base. The independent judge and parent agree that indexed selected-period reads, atomic checkpoints, and bounded retention fit the page workflow better than scanning segmented files. The parent read both candidates. Segments has a smaller initial writer, but leaves incident persistence, peak timestamps, crash loss and query cost unresolved.

Use the SQLite candidate with these changes:

- Select by bounded timestamps or incident ID, not an in-memory bucket ID registry. Fixed endAtMs supports paused and older ranges across restart.
- Preserve process observationId, PID, creation time and session identity. Historical rows have no recovery capability. Keep exited processes and surface any detail truncation.
- Preserve original maxima and timestamps and first/last memory. Never sum individual process maxima and call that an observed app peak.
- Record fresh lightweight renderer route, heap, DOM and chat/video/workload counters outside Diagnostics. Correlated activity must be visible on the page. Existing diagnostics-only trace operations do not meet this requirement.
- Keep a five-second inexpensive process cadence outside Diagnostics. Avoid background native I/O subprocess churn. Preserve sampling intervals and gaps honestly.
- Use ranked observed peaks accessible regardless of automatic thresholds. For preserved incidents, use documented CPU jump and sustained RAM-growth thresholds with cooldown/coalescing. Eighty percent of total machine CPU is too high as the only trigger.
- Keep current recording available after one slow transaction or a transient storage error. Bound writes and query payloads, report storage failure, and retry at a bounded cadence. No permanent 20ms fuse.
- Apply row/byte budgets to database, WAL, incident data and any quarantined corrupt file. Show early eviction/partial coverage instead of promising seven days that are no longer present.
- Keep the page compact, with CPU and RAM charts first and one inline detail panel. Follow DESIGN.md. No export work required.

Grafted from segmented design: keep historical queries separate from live snapshot publication, and bound selected-period contributor/activity results. These also converged with SQLite.

Implement against acceptance.md. The implementation owner may simplify private schema/table count while retaining all observable invariants. Root reviews and performs the live desktop verification.
