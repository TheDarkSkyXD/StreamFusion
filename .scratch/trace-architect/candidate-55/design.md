# Candidate 55 trace capture design

## Usage

The soak runner stays opt-in. A normal soak run does not start tracing.

```powershell
npm run perf:soak -- --duration-minutes 30 --output .audit/soak.json
```

Capture the trace only when the soak fails.

```powershell
npm run perf:soak -- --duration-minutes 30 --output .audit/soak.json --trace-on-failure .audit/soak.trace.json --trace-max-mb 256
```

Capture every opted-in run when reproducing a known performance issue.

```powershell
npm run perf:soak -- --duration-minutes 10 --route-cycle-seconds 30 --trace-always .audit/soak-repro.trace.json --trace-max-mb 512
```

The two trace mode flags are mutually exclusive. `--trace-max-mb` is legal only with one of them. No category flag ships in the first version. The default category set belongs to the runner because the public CLI should not expose Chrome tracing internals.

Real call site in `apps/desktop/scripts/performance-soak.mjs` argument parsing.

```js
case "--trace-on-failure":
  options.traceCapture = createTraceCapturePolicy("on-failure", requireValue(), options.traceCapture);
  break;
case "--trace-always":
  options.traceCapture = createTraceCapturePolicy("always", requireValue(), options.traceCapture);
  break;
case "--trace-max-mb":
  pendingTraceMaxBytes = parsePositiveNumber(requireValue(), flag) * MEBIBYTE;
  break;
```

Real call site in `runPerformanceSoak`.

```js
const cdpTarget = await findStreamFusionTarget(options.cdpEndpoint);
const pageClient = createCdpClient(cdpTarget.webSocketDebuggerUrl);
const traceClient =
  options.traceCapture.mode === "disabled"
    ? null
    : createCdpClient(cdpTarget.browserWebSocketDebuggerUrl ?? cdpTarget.webSocketDebuggerUrl);
const traceSession = await startTraceCapture(traceClient, options.traceCapture);

let result = null;
let primaryError = null;
try {
  result = await collectAndAnalyzeSoak(pageClient, options);
} catch (error) {
  primaryError = error;
} finally {
  const traceCapture = await finishTraceCaptureSafely(traceSession, {
    verdict: result?.verdict ?? "error",
    primaryError,
  });
  if (result) result.traceCapture = traceCapture;
  closeCdpClient(traceClient);
  closeCdpClient(pageClient);
}

if (primaryError) throw primaryError;
return result;
```

Real call site in the future focused test.

```js
const result = await finishTraceCaptureSafely(session, { verdict: "pass", primaryError: null });

expect(result).toMatchObject({ kind: "discarded", reason: "soak-passed" });
expect(client.sentMethods()).toEqual(["Tracing.end", "IO.close"]);
expect(client.maxBufferedBytes()).toBeLessThanOrEqual(1024 * 1024);
```

## Problem

`apps/desktop/scripts/performance-soak.mjs` already drives a StreamFusion renderer through CDP, samples diagnostics through `window.electronAPI.diagnostics`, listens for renderer exceptions and HTTP 429s, analyzes the samples, and optionally writes the JSON report. Trace capture needs to live inside that command without changing the desktop app, without turning profiling on by default, and without making tracing cleanup change the soak verdict. The non-obvious part is lifecycle. CDP delivers the trace stream only after `Tracing.end`, while on-failure capture must start at the beginning because the runner cannot reconstruct an earlier trace after the verdict is known.

Relevant existing files:

- `apps/desktop/scripts/performance-soak.mjs` owns the CLI, CDP client, sampling loop, verdict analysis, and report write.
- `apps/desktop/tests/scripts/performance-soak.test.ts` already tests exported parser and analysis helpers through Vitest.
- `apps/desktop/package.json` wires `npm run perf:soak` to `node scripts/performance-soak.mjs`.

Protocol facts checked against primary docs:

- CDP `Tracing.start` supports `transferMode: "ReturnAsStream"` and `streamFormat: "json"`. `Tracing.tracingComplete` returns an `IO.StreamHandle`. Source: https://chromedevtools.github.io/devtools-protocol/tot/Tracing/
- CDP `IO.read` reads chunks from that stream and `IO.close` closes it and discards temporary backing storage. Source: https://chromedevtools.github.io/devtools-protocol/tot/IO/
- Electron `contentTracing` can record all processes and write to a file, but it is a main-process API. Using it from this CLI would require an app IPC command. Source: https://www.electronjs.org/docs/latest/api/content-tracing

## Shape

The named data shape should be a discriminated union. Disabled tracing has no path or budget. Enabled tracing always has both.

```js
/**
 * @typedef {{ mode: "disabled" }} DisabledTraceCapturePolicy
 * @typedef {{
 *   mode: "always" | "on-failure";
 *   outputPath: string;
 *   maxBytes: number;
 * }} EnabledTraceCapturePolicy
 * @typedef {DisabledTraceCapturePolicy | EnabledTraceCapturePolicy} TraceCapturePolicy
 */
```

I would refine the implementation with derived internal states, not extra public modes.

```js
/**
 * @typedef {{
 *   mode: "disabled";
 * }} TraceCaptureSessionDisabled
 *
 * @typedef {{
 *   mode: "recording";
 *   policy: EnabledTraceCapturePolicy;
 *   client: CdpClient;
 *   startedAtMs: number;
 * }} TraceCaptureSessionRecording
 *
 * @typedef {TraceCaptureSessionDisabled | TraceCaptureSessionRecording} TraceCaptureSession
 *
 * @typedef {{
 *   kind: "disabled";
 * } | {
 *   kind: "written";
 *   outputPath: string;
 *   bytes: number;
 *   dataLossOccurred: boolean;
 * } | {
 *   kind: "discarded";
 *   reason: "soak-passed";
 *   dataLossOccurred: boolean;
 * } | {
 *   kind: "failed";
 *   stage: "start" | "end" | "read" | "close" | "write";
 *   message: string;
 * }} TraceCaptureOutcome
 */
```

Boundary parsing stays near `parseSoakArguments`, per `boundary-discipline`.

```js
export const DEFAULT_TRACE_MAX_BYTES = 256 * MEBIBYTE;

function createTraceCapturePolicy(mode, outputPath, existingPolicy) {
  throw new Error("not implemented");
}

function applyTraceCaptureBudget(policy, maxBytes) {
  throw new Error("not implemented");
}

function assertTraceCaptureOptionsComplete(policy, sawTraceMaxBytes) {
  throw new Error("not implemented");
}
```

Capture control is a private deep module inside the same script at first. A new file is not earned yet because there is one caller, one transport, and one test file. That follows `laziness-protocol` and `minimize-reader-load`.

```js
const TRACE_READ_CHUNK_BYTES = 1024 * 1024;
const TRACE_END_TIMEOUT_MS = 30_000;
const TRACE_CATEGORIES = Object.freeze([
  "toplevel",
  "blink",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "v8",
  "renderer.scheduler",
  "cc",
  "gpu",
  "viz",
]);

async function startTraceCapture(client, policy) {
  throw new Error("not implemented");
}

async function finishTraceCaptureSafely(session, runStatus) {
  throw new Error("not implemented");
}

async function finishTraceCapture(session, runStatus) {
  throw new Error("not implemented");
}

async function drainCdpTraceStreamToFile(client, streamHandle, outputPath, maxBytes) {
  throw new Error("not implemented");
}

function shouldWriteTrace(policy, runStatus) {
  throw new Error("not implemented");
}

function waitForCdpEvent(client, method, predicate, timeoutMs) {
  throw new Error("not implemented");
}
```

`startTraceCapture` sends one `Tracing.start` command.

```js
await client.send("Tracing.start", {
  transferMode: "ReturnAsStream",
  streamFormat: "json",
  streamCompression: "none",
  traceConfig: {
    recordMode: "recordContinuously",
    traceBufferSizeInKb: Math.ceil(policy.maxBytes / 1024),
    includedCategories: TRACE_CATEGORIES,
    enableArgumentFilter: true,
  },
});
```

`recordContinuously` makes the browser keep the most recent bounded window instead of filling once and silently losing the end of the run. `traceBufferSizeInKb` derives from `maxBytes`, per `foundational-thinking` and `model-the-domain`. The Node side still enforces `maxBytes` while draining because browser trace size and file bytes are related but not identical.

`finishTraceCapture` creates the `Tracing.tracingComplete` wait before calling `Tracing.end`, then always closes the returned stream.

```js
const complete = waitForCdpEvent(client, "Tracing.tracingComplete", Boolean, TRACE_END_TIMEOUT_MS);
await client.send("Tracing.end");
const { stream, dataLossOccurred = false } = await complete;

try {
  if (shouldWriteTrace(session.policy, runStatus)) {
    return await drainCdpTraceStreamToFile(client, stream, session.policy.outputPath, session.policy.maxBytes);
  }
  return { kind: "discarded", reason: "soak-passed", dataLossOccurred };
} finally {
  await client.send("IO.close", { handle: stream });
}
```

`drainCdpTraceStreamToFile` writes to a sibling temp file and renames it after the stream reaches EOF. It never concatenates chunks. It decodes base64 chunks when `IO.read` says the data is encoded. If the byte count would exceed `maxBytes`, it closes the local file, deletes the temp file, and returns a failed trace outcome instead of producing a truncated artifact. A produced artifact is always complete JSON from Chrome, so Chrome and Perfetto can open it.

The runner uses two CDP connections when `/json/version` exposes a browser WebSocket URL. The existing page connection keeps `Runtime.evaluate`, `Network.enable`, and route cycling. The trace connection owns only `Tracing.*` and `IO.*`. If Electron does not expose the browser WebSocket URL, the trace code falls back to the page target WebSocket so older remote-debugging setups still work.

`findStreamFusionTarget` can return one richer object without changing the public CLI.

```js
async function findStreamFusionTarget(endpoint, timeoutMs = 30_000) {
  throw new Error("not implemented");
  // returns { webSocketDebuggerUrl, browserWebSocketDebuggerUrl, title }
}
```

The result JSON gets a non-verdict field.

```js
{
  "verdict": "fail",
  "failures": ["frame-p95"],
  "traceCapture": {
    "kind": "written",
    "outputPath": "F:\\...\\.audit\\soak.trace.json",
    "bytes": 73412019,
    "dataLossOccurred": false
  }
}
```

`analyzeSoakSamples` should not know tracing exists. Trace capture is a command concern, not a sampling verdict concern. This keeps the current failure codes stable.

## Module map

- `apps/desktop/scripts/performance-soak.mjs`
  - Add `traceCapture` to `DEFAULT_SOAK_OPTIONS` as `{ mode: "disabled" }`.
  - Extend `parseSoakArguments` with `--trace-on-failure`, `--trace-always`, and `--trace-max-mb`.
  - Extend `findStreamFusionTarget` to also read `/json/version` for the browser WebSocket URL when present.
  - Keep the existing `createCdpClient` and add `waitForCdpEvent` on top of `onEvent`.
  - Add private trace helpers next to the CDP helpers.
  - Reorder `runPerformanceSoak` so it computes the soak result, finalizes trace capture safely, writes the report, and returns or rethrows the original error.
- `apps/desktop/tests/scripts/performance-soak.test.ts`
  - Future tests cover parser legal states, mutual exclusion, stream draining without accumulated buffers, `IO.close` after read errors, and verdict preservation when trace cleanup fails.

## Rationale

CDP `ReturnAsStream` is the best fit. It uses the remote-debugging connection the soak CLI already requires. It adds no preload API, no main-process IPC command, no UI, and no always-on profiling path inside the app. The public CLI has two mode flags plus one budget flag. The implementation hides tracing protocol order, stream handling, temporary-file safety, and cleanup under one `finishTraceCaptureSafely` call. That is the right interface depth for this script.

The legal-state model matters more than a category knob. `TraceCapturePolicy` prevents disabled tracing from carrying stale output paths and prevents enabled tracing from missing a byte budget. `TraceCaptureSession` prevents stop logic from running against a disabled policy. `TraceCaptureOutcome` records trace failure without adding soak failure reasons. These choices apply `model-the-domain` and `type-system-discipline` even though the file is JavaScript, because JSDoc still documents and checks the intended union under editor tooling.

Cleanup is deliberately best effort. Parser errors still fail before the app opens because those are user input errors. Runtime tracing failures write a warning and a `traceCapture.kind: "failed"` outcome when a result exists. They do not change `result.verdict` or `process.exitCode`, per the task constraint.

## Synthesis decision

Placeholder for the arena orchestrator. Candidate 55 recommends CDP `Tracing.start` with `transferMode: "ReturnAsStream"` from the existing soak CLI, using a browser-level CDP connection when available and the current page target as fallback.

## Tradeoffs accepted

- We accept that `on-failure` still records during the whole opted-in run in exchange for having the pre-failure timeline available.
- We accept one extra CDP connection when the browser WebSocket is available in exchange for clearer ownership between sampling and tracing.
- We accept a fixed internal category list in exchange for a smaller CLI and fewer unsupported trace files caused by user-selected categories.
- We accept discarding an oversized trace instead of truncating it in exchange for never producing an artifact Chrome or Perfetto rejects.

## Alternatives considered

- Electron `contentTracing` through IPC. This captures all Electron processes and writes a file directly, but it requires new main-process and preload contracts only for a diagnostics CLI. It also exposes a global one-recording-at-a-time profiler through app IPC. That is too much product code for an opt-in soak artifact.
- Hybrid CDP plus Electron `contentTracing`. This can combine renderer protocol control with Electron categories, but it creates two lifecycles, two failure paths, and either two artifacts or a merge step. It exposes more complexity to callers and maintainers than it hides.
- CDP `ReportEvents` with `Tracing.dataCollected`. This is easy to code but wrong for long soaks because the Node process must accumulate event buckets or continuously stitch JSON. It directly violates the no unbounded in-memory accumulation constraint.
- Always write a trace and delete it on pass for `on-failure`. This simplifies persistence decisions but creates unnecessary disk churn on successful long runs. Reading and closing the stream without writing on pass keeps the browser cleanup correct while leaving no artifact.

## Open questions and risks

- Should the default trace budget be 256 MiB or 512 MiB for two-day soaks?
- Do we want `netlog` in the internal category list even though traces may include URLs?
- Does the packaged Electron version expose `/json/version.webSocketDebuggerUrl` in every environment where the soak runner is used?
- Should a trace `dataLossOccurred` flag be echoed to stderr even when the soak verdict is already fail?

## Red-flag screen

- Shallow module. The public CLI does not expose tracing categories, stream format, chunk size, or CDP event ordering.
- Information leakage. Transport details stay in trace helpers. The result reports `TraceCaptureOutcome`, not raw CDP payloads.
- Temporal decomposition. The trace code is grouped around capture ownership, not separate start, stop, read, and save modules.
- Pass-through methods. The only proposed wrapper with one caller is `finishTraceCaptureSafely`, and it earns its place because it converts auxiliary trace errors into non-verdict outcomes.

## Next implementation step

Add `TraceCapturePolicy` parsing and parser tests first, then add the CDP stream helper behind fake-client tests before wiring it into `runPerformanceSoak`.
