# Cross-judgment

Use **SQLite** as the base. It is the only candidate with checkpointed, crash-atomic samples, startup repair, byte/row shedding, explicit gaps, bounded on-demand reads, and peak timestamps preserved across rollups.

| Criterion | SQLite | Segments |
| --- | ---: | ---: |
| Durable crash-safe evidence | 5 | 3 |
| Peak and time accuracy | 5 | 2 |
| Bounded observer overhead | 4 | 2 |
| In-page range and incident queries | 4 | 2 |
| Integration simplicity | 3 | 4 |

Segments loses an open minute on crash, omits CPU/RAM peak timestamps, leaves gap rendering unresolved, permits an unbounded write queue/detail growth, and has no byte-pressure policy. Its simpler append-only integration does not compensate for those acceptance failures.

Necessary SQLite grafts/simplifications:

1. Retain a non-authoritative process observation identity (PID/instance/start/session fingerprint) with label/category and explicit truncation status; it supports exited-process history but never recovery authority.
2. Make `endAtMs` part of the fixed range query, and let selection be a time interval/incident ID scoped to that query. This supplies freeze and backward navigation without an opaque bucket registry.
3. Add bounded, privacy-safe workload metrics for route, chat, renderer heap, and active stream workloads; existing trace/log activity alone cannot meet ordinary-use attribution.
4. Use lower, explainable configurable incident defaults and show ranked/visible peaks; an 80% machine-normalized CPU threshold is too coarse.
5. Replace the permanent 20-ms-write disable fuse with bounded batched writes, failure status, exponential retry, and detail shedding.
