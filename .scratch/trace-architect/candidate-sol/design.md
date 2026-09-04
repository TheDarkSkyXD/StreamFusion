# Bounded trace capture for `perf:soak`

## Usage from the caller

No trace flags preserve the current command, report, and exit behavior. The root script remains the main entry point from `package.json:67`.

```powershell
npm run perf:soak -- --duration-minutes 30 --output .audit/soak.json
```

To retain a trace for every run, add one path and an optional size limit. `--trace` means "publish the bounded trace even when the soak passes."

```powershell
npm run perf:soak -- `
  --duration-minutes 30 `
  --output .audit/soak.json `
  --trace .audit/soak.trace.json `
  --trace-max-mb 256
```

For an unattended two-day run, retain the trace only when the soak fails. Tracing still starts with the soak because the verdict is not known until the run ends. A passing run closes and discards the CDP stream.

```powershell
npm run --workspace streamfusion perf:soak -- `
  --duration-minutes 2880 `
  --warmup-minutes 5 `
  --output .audit/soak.json `
  --trace-on-failure .audit/soak-failure.trace.json `
  --trace-max-mb 256
```

This workspace-level call site already resolves to `node scripts/performance-soak.mjs` in `apps/desktop/package.json:74`. The root call forwards to it.

The module entry point stays small. It still bases the process exit code only on `result.verdict`, as it does now in `apps/desktop/scripts/performance-soak.mjs:467-474`.

```js
const options = parseSoakArguments(process.argv.slice(2));
const result = await runPerformanceSoak(options);

process.stdout.write(
  `${JSON.stringify({ verdict: result.verdict, ...result.summary }, null, 2)}\n`
);
if (result.verdict === "fail") process.exitCode = 1;
```

The parser remains directly testable at the existing call site in `apps/desktop/tests/scripts/performance-soak.test.ts:23-42`.

```ts
const options = parseSoakArguments([
  "--trace-on-failure",
  ".audit/soak-failure.trace.json",
  "--trace-max-mb",
  "64",
]);

expect(options.traceCapture).toEqual({
  kind: "on-failure",
  outputPath: expect.stringContaining("soak-failure.trace.json"),
  maxBytes: 64 * 1024 * 1024,
});
```

The public CLI adds three flags. `--trace <path>` and `--trace-on-failure <path>` are mutually exclusive. `--trace-max-mb <positive integer>` is valid only with one trace path. When no trace path is present, `traceCapture` is disabled and no tracing connection opens. The default enabled limit is 256 MiB.

## Problem

The current runner finds the StreamFusion page through `/json/list`, opens one page WebSocket, samples the renderer, analyzes the samples, writes the JSON report, and closes the lease and socket in one `finally` block. See `apps/desktop/scripts/performance-soak.mjs:246-315` and `apps/desktop/scripts/performance-soak.mjs:384-463`. Trace capture must include Electron's browser, renderer, GPU, and utility processes without adding an app profiling mode, a preload method, or a UI. Long soak runs also rule out `Tracing.dataCollected` arrays or any design that assembles the trace in Node memory.

## Shape

### Data model

Use a discriminated union for the policy. An all-object union gives every branch the same exhaustive `kind` check and does not permit a path or byte limit while capture is disabled.

```js
/** @typedef {{ kind: "disabled" }} DisabledTraceCapture */

/**
 * @typedef {{
 *   kind: "always",
 *   outputPath: string,
 *   maxBytes: number,
 * }} AlwaysTraceCapture
 */

/**
 * @typedef {{
 *   kind: "on-failure",
 *   outputPath: string,
 *   maxBytes: number,
 * }} FailureTraceCapture
 */

/**
 * @typedef {
 *   DisabledTraceCapture |
 *   AlwaysTraceCapture |
 *   FailureTraceCapture
 * } TraceCapturePolicy
 */

/**
 * @typedef {
 *   { kind: "completed", verdict: "pass" | "fail" } |
 *   { kind: "aborted" }
 * } SoakCompletion
 */

/**
 * @typedef {
 *   { kind: "disabled" } |
 *   { kind: "discarded", dataLossOccurred: boolean } |
 *   { kind: "saved", outputPath: string, bytes: number, dataLossOccurred: boolean } |
 *   { kind: "failed", stage: "connect" | "start" | "stop" | "stream" | "limit" | "publish" | "cleanup", message: string }
 * } TraceCaptureOutcome
 */
```

`always` and `on-failure` describe retention, not buffer duration. Both modes use a bounded continuous ring buffer. `always` publishes its final window on both verdicts. `on-failure` publishes its final window for a failed verdict or an aborted run. It discards the stream after a passing verdict. This distinction matters on multi-day runs because a fixed byte budget cannot contain an unbounded full-duration trace.

The parser converts MiB to a positive safe integer and resolves the trace path at the CLI boundary. It rejects a trace path that resolves to the report path. Internal code receives one legal policy and does not repeat flag checks, per `principle-boundary-discipline` and `principle-type-system-discipline`.

### Signatures and caller flow

`performance-trace.mjs` exposes one lifecycle operation to the soak runner. It owns the protocol session, the stream handle, the temporary file, the retention decision, and all cleanup.

```js
/**
 * A total handle. openTraceCapture and finish never reject because trace capture
 * is diagnostic and must not alter the soak result or replace a soak exception.
 * finish is idempotent and returns the first outcome on repeated calls.
 *
 * @typedef {{
 *   finish(completion: SoakCompletion): Promise<TraceCaptureOutcome>
 * }} TraceCaptureHandle
 */

/**
 * @param {{ cdpEndpoint: string, policy: TraceCapturePolicy }} input
 * @returns {Promise<TraceCaptureHandle>}
 */
export async function openTraceCapture(input) {
  throw new Error("not implemented");
}

/**
 * @param {string[]} args
 * @returns {typeof DEFAULT_SOAK_OPTIONS}
 */
export function parseSoakArguments(args) {
  throw new Error("not implemented");
}

/**
 * @param {typeof DEFAULT_SOAK_OPTIONS} options
 * @returns {Promise<SoakResult & { traceCapture: TraceCaptureOutcome }>}
 */
export async function runPerformanceSoak(options) {
  throw new Error("not implemented");
}
```

The orchestration has one capture handle and one completion value.

```js
const trace = await openTraceCapture({
  cdpEndpoint: options.cdpEndpoint,
  policy: options.traceCapture,
});

let result;
let runError;

try {
  // Existing lease, sample, route, event, and analysis flow.
  result = analyzeSoakSamples({ samples, events, options, startedAt, endedAt: Date.now() });
} catch (error) {
  runError = error;
} finally {
  // Existing page client and diagnostics lease cleanup also stays total.
}

const traceCapture = await trace.finish(
  result ? { kind: "completed", verdict: result.verdict } : { kind: "aborted" }
);

if (traceCapture.kind === "failed") {
  process.stderr.write(`Trace capture failed at ${traceCapture.stage}: ${traceCapture.message}\n`);
}
if (runError) throw runError;
return { ...result, traceCapture };
```

`analyzeSoakSamples` remains the only function that creates `verdict` and `failures`. Trace outcomes never enter its inputs. A failure in `Tracing.end`, `IO.close`, a file close, or a WebSocket close therefore cannot change a passing soak to a failure or hide an existing soak error. This keeps the existing gate semantics in `apps/desktop/scripts/performance-soak.mjs:166-239`.

### CDP trace lifecycle

The trace module follows this sequence.

1. For a disabled policy, return a finished no-op handle without fetching a CDP endpoint.
2. Fetch `/json/version` and connect to its browser `webSocketDebuggerUrl`. The CDP endpoint documentation identifies this as the browser target. The current page connection remains dedicated to `Runtime`, `Network`, and `Page` commands.
3. Send `Tracing.start` on the browser connection with `transferMode: "ReturnAsStream"`, `streamFormat: "json"`, and `streamCompression: "none"`. Mark the handle as recording only after this command succeeds. If another tool already owns Chromium's single global trace, report a `start` failure and do not send `Tracing.end` for a session this CLI did not start.
4. Set `traceConfig.recordMode` to `recordContinuously`. Set `traceConfig.traceBufferSizeInKb` from `maxBytes`. Use a fixed performance category set that includes top-level tasks, renderer scheduling, DevTools timeline events, V8, compositor, GPU, and Electron events. Exclude screenshots, heap dumps, and systrace.
5. Before sending `Tracing.end`, register the one-shot `Tracing.tracingComplete` waiter. This prevents an event race. Apply an internal stop deadline so an unresponsive child process cannot hang the unattended soak.
6. For a passing `on-failure` run, close the returned `IO.StreamHandle` without reading it.
7. For a retained trace, create a unique sibling temporary file. Repeatedly call `IO.read` with a 1 MiB maximum chunk. Decode `data` according to `base64Encoded`, write the chunk with backpressure, and increment an exact byte count. No trace event array or full-file string exists in Node.
8. If the next chunk would exceed `maxBytes`, do not write it. Close the stream, close the file, delete the temporary file, and return a `limit` failure. Never publish truncated JSON.
9. At EOF, close the file and the CDP stream before publishing the temporary file at `outputPath`. The published bytes are exactly the JSON that CDP returned, so Chrome and Perfetto can open the artifact. Record `dataLossOccurred` from `Tracing.tracingComplete` because continuous mode may have wrapped.
10. In an outer `finally`, close the browser WebSocket and reject any pending protocol requests. In an inner `finally`, close any acquired `IO.StreamHandle`. In another inner `finally`, close and remove any unpublished temporary file. Each cleanup branch catches and records its own error.

The protocol supports `ReturnAsStream`, JSON output, a continuous record mode, a trace buffer size, `Tracing.tracingComplete`, and an `IO.StreamHandle`. `IO.read` provides bounded chunks, and `IO.close` discards temporary backing storage. See the official [CDP Tracing domain](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/), [CDP IO domain](https://chromedevtools.github.io/devtools-protocol/tot/IO/), and [browser target endpoint](https://chromedevtools.github.io/devtools-protocol/#how-do-i-access-the-browser-target). Perfetto opens Chrome JSON files directly according to its [external trace format documentation](https://perfetto.dev/docs/getting-started/other-formats).

The bounded ring is the primary browser-memory limit. The exact writer limit is the artifact guarantee. Chromium's in-memory representation and JSON serialization do not have a provable one-to-one byte ratio, so an artifact can exceed the writer budget even when the configured trace buffer does not. That run reports `kind: "failed", stage: "limit"` and publishes no malformed artifact.

### Module map

`apps/desktop/scripts/performance-soak.mjs` keeps CLI parsing, soak policy, sampling, analysis, report output, and exit status. It adds the `traceCapture` option and brackets the existing run with one trace handle.

`apps/desktop/scripts/performance-cdp.mjs` owns the small WebSocket request and event transport extracted from `performance-soak.mjs:262-314`. It adds request timeouts, one-shot event waits, pending-request rejection, and an awaitable idempotent close. Both the page target and the browser trace target use it.

`apps/desktop/scripts/performance-trace.mjs` owns `TraceCapturePolicy`, trace retention, CDP Tracing and IO commands, byte accounting, atomic publication, and cleanup. CDP wire shapes do not escape this module.

`apps/desktop/tests/scripts/performance-soak.test.ts` keeps parser and verdict contracts. New cases guard mutual exclusion, default-disabled behavior, byte conversion, path collision, and the invariant that capture outcomes do not enter `failures`. Its existing `// Guards:` comments must be updated because the test file changes, per `apps/desktop/tests/AGENTS.md:59-117`.

`apps/desktop/tests/scripts/performance-trace.test.ts` uses a scripted fake CDP transport and temporary files. It guards chunked writes, base64 chunks, pass discard, failure retention, overflow deletion, event-before-response ordering, idempotent finish, and cleanup after each injected protocol or filesystem error. It stays under the two-second file budget in `apps/desktop/tests/AGENTS.md:121-138`.

The call chain is `performance-soak.mjs` to `performance-trace.mjs` and `performance-cdp.mjs`. No product source, IPC contract, preload bridge, or renderer code changes. This keeps protocol details behind one deep module and avoids pass-through wrappers, per `principle-minimize-reader-load`.

## Rationale

The browser CDP target is the right owner because tracing is a browser-wide Chromium service and the CLI already requires a remote-debugging endpoint. A dedicated browser connection separates trace lifecycle errors from the existing page target used for renderer sampling. It also lets the trace module close its own connection without disrupting the last diagnostics sample.

The policy union is the central data shape, per `principle-foundational-thinking` and `principle-model-the-domain`. It replaces loose flags after parsing and makes the retention decision exhaustive. The capture handle owns all mutable lifecycle state. Callers cannot obtain or forget a raw stream handle.

`finish` is total and idempotent, per `principle-make-operations-idempotent`. Repeated cleanup returns the first outcome. A crash during publication leaves at most a uniquely named unpublished temporary file, never a truncated artifact at the requested path. A later implementation can remove stale temporary files for the same output during `openTraceCapture` without changing the public contract.

The interface is deliberately deep. The soak runner supplies a policy once and a completion once. The trace module hides browser discovery, CDP ordering, ring-buffer settings, stream decoding, byte enforcement, file publication, retention, and cleanup. The public CLI exposes retention and budget, which are operator decisions. It does not expose categories, transfer mode, chunk size, stream compression, buffer record mode, or cleanup deadlines.

## Synthesis decision

Pending arena synthesis. This candidate recommends a dedicated browser-level CDP trace connection, a bounded continuous buffer, and streamed JSON publication. The synthesizer should record any grafted decisions and rejected candidate shapes here.

## Tradeoffs accepted

- We accept a final-window trace instead of a full multi-day timeline in exchange for a hard memory and artifact budget.
- We accept trace overhead on passing `on-failure` runs in exchange for retaining the events that led to a verdict known only at the end.
- We accept an additive `traceCapture` field on the returned and saved soak result in exchange for machine-readable capture status. The top-level stdout summary and exit code remain unchanged.
- We accept a second CDP WebSocket during enabled runs in exchange for isolated ownership and cleanup.
- We accept JSON even though CDP marks it for eventual deprecation in exchange for an artifact that both `chrome://tracing` and Perfetto open without conversion.

## Alternatives considered

### Electron `contentTracing` through IPC

Electron's `contentTracing.startRecording` and `stopRecording` capture all processes and write a Chrome trace. The official [Electron documentation](https://www.electronjs.org/docs/latest/api/content-tracing/) confirms both properties. This shape loses because the external soak CLI would need new main-process, shared IPC, preload, and renderer contracts only to reach a capability already available through the required debug endpoint. `stopRecording` writes a finished file but does not expose an incremental stream or an exact output byte limit. The interface leaks artifact paths and diagnostic authority into the app.

### Page-target CDP tracing on the existing socket

This shape sends `Tracing.start` through the page WebSocket already opened at `performance-soak.mjs:384-389`. It saves one connection but shares pending requests, event listeners, and failure cleanup with sampling. A trace stop timeout or socket error can then interfere with lease cleanup and result analysis. The small connection saving does not justify the coupled lifecycle.

### Hybrid CDP control with Electron file capture

This shape uses CDP for soak sampling and IPC-backed `contentTracing` for the trace. It has both transport stacks, two error models, and app changes. It hides less behind a larger interface than either single-mechanism design, so it is the weakest option.

### `Tracing.dataCollected` with incremental JSON assembly

This shape avoids `IO.read` but delivers buckets through WebSocket events after tracing stops. The Node process must queue or serialize protocol objects and manufacture the outer JSON document. Cleanup after a partial bucket can leave invalid JSON. `ReturnAsStream` already provides the supported bounded read contract, so custom assembly does not earn its complexity.

## Open questions and risks

- Does the chosen category set preserve enough network detail for 429 investigations without recording request bodies, cookies, or authentication data?
- Should the implementation refuse an existing trace destination, or replace it only after a complete new artifact is ready? Atomic replacement behavior differs on Windows and POSIX.
- Is a 256 MiB default artifact budget acceptable for CI and local audit storage, or should the first implementation use 128 MiB?
- Does Electron 43.4.1 expose the expected browser-target Tracing and IO domains at the registered port on Windows, macOS, and Linux? A one-run system test must prove this against the actual bundled Chromium protocol rather than a mock.
- What message gives an operator enough context when DevTools or another profiler already owns Chromium's global trace? The CLI must not take over or stop that session.
- Should an aborted run retain an `on-failure` trace even when no soak verdict exists? This design says yes because the artifact has the highest diagnostic value in that case.
- How should operators treat `dataLossOccurred: true`? The artifact remains valid and useful, but the report must state that the ring wrapped.
- Trace files can include URLs, titles, and hardware details. Should the CLI print a privacy warning whenever capture is enabled?

## Red-flag screen

No shallow module remains. One handle hides the full capture lifecycle. CDP wire types stay private, so no protocol representation leaks into soak policy. The trace module owns behavior that runs at start and finish because both steps protect one trace invariant, so the split is not temporal decomposition. The extracted CDP transport earns its boundary by serving both page and browser targets and by owning pending-request shutdown. No method forwards the trace policy unchanged through another wrapper.

## Next implementation step

Build `performance-cdp.mjs` and the scripted transport tests first, then implement `performance-trace.mjs` against that contract before changing the CLI parser.
