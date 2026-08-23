# T3 Code diagnostics and StreamFusion gap inventory

Research for [Inventory T3 Code diagnostics and StreamFusion gaps](https://github.com/TheDarkSkyXD/StreamFusion/issues/64). Upstream was inspected on `main` at commit [`ea8c9e5`](https://github.com/pingdotgg/t3code/commit/ea8c9e5ca3ace89cbf6cf0a2aa03047aab1d3ef9) on 2026-08-23.

Scope update on 2026-08-23: the user chose to make StreamFusion Diagnostics available in packaged production builds. Production now needs a safety boundary for sensitive data and recovery actions, not a development-only availability gate.

Architecture update on 2026-08-23: StreamFusion will match the applicable T3 Code diagnostic capabilities while remaining TypeScript-only. Electron, Node, and TypeScript platform adapters replace T3 Code's Rust sidecar; no Rust or other native sidecar is in scope.

## Upstream capability inventory

T3 Code renders a dedicated `/settings/diagnostics` route. The Settings About panel links to it through "View diagnostics." The route is available in production, which matches StreamFusion's revised availability target.

Primary sources:

- [Diagnostics route](https://github.com/pingdotgg/t3code/blob/ea8c9e5ca3ace89cbf6cf0a2aa03047aab1d3ef9/apps/web/src/routes/settings.diagnostics.tsx#L1-L7)
- [Settings entry](https://github.com/pingdotgg/t3code/blob/ea8c9e5ca3ace89cbf6cf0a2aa03047aab1d3ef9/apps/web/src/components/settings/SettingsPanels.tsx#L2440-L2462)
- [Settings route gate](https://github.com/pingdotgg/t3code/blob/ea8c9e5ca3ace89cbf6cf0a2aa03047aab1d3ef9/apps/web/src/routes/settings.tsx#L98-L111)

The page has these sections:

1. Resource monitor
2. Host and collection
3. Resource timeline
4. Live process tree
5. Instrumented application I/O
6. Live Processes
7. Resource History
8. Trace Diagnostics
9. Latest Failures
10. Most Common Failures
11. Slowest Spans
12. Span Logs
13. Top Span Names

The first five are implemented by [ResourceTelemetryDiagnostics.tsx](https://github.com/pingdotgg/t3code/blob/ea8c9e5ca3ace89cbf6cf0a2aa03047aab1d3ef9/apps/web/src/components/settings/ResourceTelemetryDiagnostics.tsx#L834-L1290). The remaining sections are composed by [DiagnosticsSettings.tsx](https://github.com/pingdotgg/t3code/blob/ea8c9e5ca3ace89cbf6cf0a2aa03047aab1d3ef9/apps/web/src/components/settings/DiagnosticsSettings.tsx#L811-L1391).

Live telemetry merges a Rust OS-counter sidecar, Electron process and power metrics, and explicit application I/O attribution. History is bounded in memory. The [resource telemetry architecture](https://github.com/pingdotgg/t3code/blob/ea8c9e5ca3ace89cbf6cf0a2aa03047aab1d3ef9/docs/internals/resource-telemetry.md#L220-L335) documents its sources, sampling, and aggregation.

Trace diagnostics read current and rotated NDJSON trace files. They aggregate failures, slow spans, parse errors, warning and error logs, and span-name statistics. [TraceDiagnostics.ts](https://github.com/pingdotgg/t3code/blob/ea8c9e5ca3ace89cbf6cf0a2aa03047aab1d3ef9/apps/server/src/diagnostics/TraceDiagnostics.ts#L189-L383) owns those queries.

The UI supports manual refresh, 5m, 15m, 30m, and 1h windows, collector retry, process-tree expansion, trace-ID copying, message expansion, opening the logs folder, and SIGINT or SIGKILL actions. T3 Code validates both PID and start time, restricts signaling to backend descendants, and confirms SIGKILL. See [ProcessDiagnostics.ts](https://github.com/pingdotgg/t3code/blob/ea8c9e5ca3ace89cbf6cf0a2aa03047aab1d3ef9/apps/server/src/diagnostics/ProcessDiagnostics.ts#L44-L165).

Upstream has unit coverage for resource-telemetry logic, trace aggregation, and process-signal safety. It does not include a committed diagnostics screenshot, component-render test, or end-to-end diagnostics-page test.

- [Resource telemetry logic tests](https://github.com/pingdotgg/t3code/blob/ea8c9e5ca3ace89cbf6cf0a2aa03047aab1d3ef9/apps/web/src/components/settings/ResourceTelemetryDiagnostics.logic.test.ts)
- [Trace diagnostics tests](https://github.com/pingdotgg/t3code/blob/ea8c9e5ca3ace89cbf6cf0a2aa03047aab1d3ef9/apps/server/src/diagnostics/TraceDiagnostics.test.ts)
- [Process diagnostics tests](https://github.com/pingdotgg/t3code/blob/ea8c9e5ca3ace89cbf6cf0a2aa03047aab1d3ef9/apps/server/src/diagnostics/ProcessDiagnostics.test.ts)

## StreamFusion capability map

StreamFusion already has useful pieces, but they are split between log files, development overlays, and main-process services.

| Capability | Current state | Evidence and consequence |
| --- | --- | --- |
| Settings production availability | Requires a change | `apps/desktop/src/pages/Settings/index.tsx` currently hides Logs and Report Bug behind `electronAPI.env.get()`. Diagnostics must replace those tabs and remain visible in packaged builds. |
| Main CPU, RSS, heap, load | Sampled every 30 seconds and written to logs | `apps/desktop/src/backend/logging/process-monitor.ts` can retain and expose its typed snapshot instead of reparsing its text line. |
| Electron process metrics | Partial | `app.getAppMetrics()` supplies PID, type, memory, and richer CPU data. The current formatter keeps only PID, type, RSS, and name. There is no renderer-facing snapshot or process hierarchy. |
| Renderer performance | Exists | `apps/desktop/src/components/dev/PerfTool.tsx` and `apps/desktop/src/renderer/performance/` already collect heap, frame timing, long tasks, route presentation, media milestones, and dropped frames. The diagnostics page should reuse this collector. |
| Resource history | Derivable | A bounded in-memory history can retain typed process-monitor samples for the same four upstream windows. Parsing rotated logs would be slower and less reliable. |
| Logs and bug reports | Exists | `LogsSection.tsx`, `BugReportSection.tsx`, the corresponding main handlers, and preload APIs can move into the Diagnostics tab. |
| Network diagnostics | Partial | `network-request-logger.ts` records redacted URLs, method, type, initiator, duration, status, cache state, and optional content length for recognized stream requests. It does not measure general process I/O. |
| Platform and HTTP health | Exists internally | `platform-health.ts`, `platform-health-telemetry.ts`, and `httpClient.getStats()` provide platform failures, circuit state, queue depth, and active requests. They need typed diagnostics snapshots. |
| General failure aggregation | Partial | Warning and error log lines can supply a first pass. Durable normalized grouping across sessions requires a new aggregator. |
| Traces and spans | Missing | StreamFusion has no span model, parent context, trace store, or parser. Slow spans, span logs, and top span names require new infrastructure. |
| Host and collector health | Mostly missing | Power, thermal, idle, collector overhead, restart counts, and source-health reporting need new collection work. |
| Application I/O attribution | Missing | StreamFusion has no general process read/write counters or logical-I/O registry. |
| Process signaling | Must be adapted | StreamFusion owns StreamSlots, caption utility processes, downloads, and recordings through service handles and state machines. Diagnostics keeps owner commands for stateful recovery and adds T3-style signal controls. A renderer request may identify a PID and expected start time, but main must freshly validate the exact start time and current StreamFusion ancestry before acting. |

## Production safety boundary

StreamFusion's current Logs and Bug Report handlers already register in packaged builds. The new page may reuse them, but process controls and sensitive diagnostic data need explicit production rules.

The implementation specification should require all of the following:

- Validate sender origin on every diagnostics request.
- Treat process observations as display-only. A signal request may include PID and expected start time, but main must freshly validate exact start time and current StreamFusion ancestry before acting.
- Route recovery actions through the owning service, such as slot destruction, caption-session stop, download cancellation, or recording stop.
- Implement collection and process-control adapters in TypeScript through Electron and Node; do not add a Rust or other native sidecar.
- Redact credentials, tokens, local paths, and user data before diagnostic values cross IPC or reach export and clipboard actions.
- Decide which recovery actions remain available in production, which need confirmation, and which should stay development-only.

## Planning conclusion

The first implementation slice can reuse existing data for current resources, bounded resource history, renderer performance, logs, bug reports, platform health, HTTP queue and circuit state, and stream-network requests. Full adapted parity also needs explicit decisions for tracing, normalized failure aggregation, host telemetry, application I/O attribution, process identity, and owner-safe recovery actions.

Those gaps should remain separate Wayfinder decisions. Hiding them inside one page ticket would make capability parity impossible to review.
