# T3 Code diagnostics and StreamFusion gap inventory

Research for [Inventory T3 Code diagnostics and StreamFusion gaps](https://github.com/TheDarkSkyXD/StreamFusion/issues/64). Upstream was inspected on `main` at commit [`ea8c9e5`](https://github.com/pingdotgg/t3code/commit/ea8c9e5ca3ace89cbf6cf0a2aa03047aab1d3ef9) on 2026-08-23.

## Upstream capability inventory

T3 Code renders a dedicated `/settings/diagnostics` route. The Settings About panel links to it through “View diagnostics.” The route is available in production; T3 Code does not apply the development-only boundary required by StreamFusion.

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
| Settings development gate | Exists at the renderer level | `apps/desktop/src/pages/Settings/index.tsx` fails closed while `electronAPI.env.get()` resolves, hides development-only tabs, and redirects blocked deep links. Diagnostic IPC remains a separate concern. |
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
| Process signaling | Must be adapted | StreamFusion owns StreamSlots, caption utility processes, downloads, and recordings through service handles and state machines. Diagnostics must call those owners by opaque IDs. It must never accept an arbitrary PID from the renderer. |

## Safety and production boundary

StreamFusion's current Logs and Bug Report handlers register in packaged builds. Hiding a Settings tab does not make a future process-control API development-only.

The implementation specification should require all of the following:

- Do not register diagnostics handlers when `app.isPackaged`.
- Make every diagnostics handler fail closed in packaged mode as a second check.
- Validate sender origin on every diagnostics request.
- Expose opaque owner identifiers, not caller-supplied PIDs.
- Route recovery actions through the owning service, such as slot destruction, caption-session stop, download cancellation, or recording stop.
- Decide separately whether diagnostics code may remain in the production renderer bundle while inaccessible, or must be excluded from packaged artifacts.

## Planning conclusion

The first implementation slice can reuse existing data for current resources, bounded resource history, renderer performance, logs, bug reports, platform health, HTTP queue and circuit state, and stream-network requests. Full adapted parity also needs explicit decisions for tracing, normalized failure aggregation, host telemetry, application I/O attribution, process identity, and owner-safe recovery actions.

Those gaps should remain separate Wayfinder decisions. Hiding them inside one page ticket would make capability parity impossible to review.
