# Bounded Chrome trace capture for `perf:soak`

## Usage

The ordinary soak command remains profile-free.

```sh
npm run perf:soak -- --duration-minutes 30 --output .audit/soak.json
```

Capture every run when a maintainer needs a timeline regardless of the gate result.

```sh
npm run perf:soak -- \
  --duration-minutes 30 \
  --trace .audit/soak-2026-09-01.json \
  --trace-max-mb 64 \
  --output .audit/soak-2026-09-01-summary.json
```

Keep the artifact only when the existing soak gate fails.

```sh
npm run perf:soak -- \
  --duration-minutes 120 \
  --route-cycle-seconds 900 \
  --trace-on-failure .audit/soak-failure.json \
  --trace-max-mb 96
```

`--trace` and `--trace-on-failure` are mutually exclusive. `--trace-max-mb` requires one of them, defaults to 64 MiB, and must resolve to at least 1 KiB. Both paths use the existing repository-relative path resolution. The result JSON gains a diagnostic-only `traceCapture` field. Its value never changes `verdict`, `failures`, or the CLI exit code.

## Problem

[`apps/desktop/scripts/performance-soak.mjs`](../../../apps/desktop/scripts/performance-soak.mjs) already drives one renderer through its remote-debugging target and computes the soak verdict locally. It has no application profiling state. A useful trace must instead include Chromium's renderer, browser, GPU, and utility work, be opt-in, stay bounded during long runs, and leave the current gate authoritative if trace teardown or artifact writing breaks. [`apps/desktop/src/backend/runtime-mode.ts`](../../../apps/desktop/src/backend/runtime-mode.ts) deliberately exposes CDP only for an unpackaged explicit port, so the design must use that development-only boundary rather than add a production feature.

## Shape

```ts
/** One policy selected at the command boundary. */
export type TraceCapturePolicy =
  | { readonly kind: "disabled" }
  | {
      readonly kind: "always";
      readonly outputPath: string;
      readonly maxBytes: number;
    }
  | {
      readonly kind: "on-failure";
      readonly outputPath: string;
      readonly maxBytes: number;
    };

export type TraceCaptureReport =
  | { readonly kind: "disabled" }
  | {
      readonly kind: "discarded";
      readonly maxBytes: number;
      readonly bytesObserved: number;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "written";
      readonly outputPath: string;
      readonly maxBytes: number;
      readonly bytesWritten: number;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "unavailable" | "cleanup-failed" | "write-failed";
      readonly phase: "start" | "stop" | "stream" | "write" | "close";
      readonly message: string;
    };

export type SoakOptions = ExistingSoakOptions & {
  readonly traceCapture: TraceCapturePolicy;
};

export type CdpEndpointDiscovery = {
  readonly pageWebSocketDebuggerUrl: string;
  readonly browserWebSocketDebuggerUrl: string;
};

export type TraceRecorder = {
  finish(input: {
    readonly persist: boolean;
  }): Promise<TraceCaptureReport>;
};

export function parseSoakArguments(args: readonly string[]): SoakOptions;

export function discoverCdpEndpoints(endpoint: string): Promise<CdpEndpointDiscovery>;

export function startChromeTrace(input: {
  readonly browserWebSocketDebuggerUrl: string;
  readonly policy: Exclude<TraceCapturePolicy, { readonly kind: "disabled" }>;
}): Promise<TraceRecorder>;
```

The discriminant owns both the user intent and whether a path and budget exist. A disabled run cannot accidentally create a trace writer. A trace path cannot exist without a positive byte ceiling. Argument parsing validates the path-bearing flags and emits this domain value once. The runner and trace recorder trust it afterward, per boundary discipline and type-system discipline.

The chosen protocol call is sent to the browser CDP endpoint returned by `GET /json/version`, not the page endpoint returned by `GET /json/list`. The existing page endpoint remains responsible for `Runtime.evaluate`, `Network.enable`, and route cycling. Sending `Tracing.start` from the browser session lets Chromium coordinate a browser-wide trace rather than limiting the design to the inspected renderer target.

`startChromeTrace` sends one supported command before the soak loop.

```js
Tracing.start({
  transferMode: "ReturnAsStream",
  streamFormat: "json",
  streamCompression: "none",
  traceConfig: {
    recordMode: "recordUntilFull",
    traceBufferSizeInKb: Math.floor(policy.maxBytes / 1024),
    includedCategories: [
      "toplevel",
      "blink.user_timing",
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "renderer.scheduler",
      "input",
      "cc",
      "gpu",
      "viz",
    ],
  },
});
```

The fixed trace categories serve renderer scheduling, input, compositor, GPU, and timeline diagnosis. They deliberately omit screenshot and heap-profiling categories. `recordUntilFull` gives a finite capture instead of an unbounded event stream or a wrapping history. The protocol documents a default 200 MB trace buffer when no size is supplied, so an explicit KiB value is mandatory here. `ReturnAsStream` provides a stream handle only after `Tracing.tracingComplete`, which is the supported way to avoid `Tracing.dataCollected` accumulation. The JSON artifact opens in Chrome tracing and Perfetto. See the [CDP Tracing domain](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/) and [CDP IO domain](https://chromedevtools.github.io/devtools-protocol/tot/IO/).

`finish` follows this exact lifecycle.

1. Send `Tracing.end` once if start succeeded.
2. Await the corresponding `Tracing.tracingComplete` event.
3. If persistence is not requested, call `IO.close` on the returned stream and report `discarded`.
4. If persistence is requested, read at most 64 KiB per `IO.read`, decode only that chunk, count decoded bytes, and write it to a unique sibling temporary file while respecting Node stream backpressure.
5. Abort the write before the next chunk when the decoded total would exceed `maxBytes`. Close the IO handle and remove the temporary file. Report `write-failed` instead of leaving a deceptive partial trace.
6. Close the IO handle in an inner `finally`, close the browser CDP socket and remove its event listener in an outer `finally`, then atomically rename the complete temporary file to `outputPath`.

The parser converts MiB to integer bytes once, rejects values below 1 KiB, and derives `traceBufferSizeInKb` by flooring that byte budget. The browser trace buffer is capped by `traceBufferSizeInKb`. The stream reader is capped by a fixed chunk. The writer is capped independently by `maxBytes`. Those three bounds hold Chromium memory, Node memory, and disk output separately. `tracingComplete.dataLossOccurred` and a full-buffer observation are recorded as `truncated` metadata, yet the valid bounded artifact remains useful.

`runPerformanceSoak` starts the recorder immediately after both CDP sockets connect and before `OPEN_LEASE_EXPRESSION`. It retains the existing page session, event listener, sampling loop, analysis, report writer, and page-session cleanup. Once `analyzeSoakSamples` has produced a result, it chooses persistence with this pure rule.

```ts
function shouldPersistTrace(
  policy: TraceCapturePolicy,
  result: SoakResult | undefined,
  soakError: unknown,
): boolean {
  return policy.kind === "always" ||
    (policy.kind === "on-failure" && (result?.verdict === "fail" || soakError !== undefined));
}
```

An unexpected soak exception remains the original exception after `finish` runs best-effort. A computed pass or fail remains exactly that pass or fail. Trace start, stop, stream, close, and file errors are caught at the trace boundary, recorded in `traceCapture`, and printed as a warning. A start failure closes the browser socket before returning `unavailable`. They never replace a soak result or set a different exit code. This preserves the current verdict when capture cleanup fails.

## Module map

[`apps/desktop/scripts/performance-soak.mjs`](../../../apps/desktop/scripts/performance-soak.mjs) remains the public CLI. It parses the three trace flags, discovers both CDP endpoints, runs the soak, chooses persistence after analysis, and writes the current summary plus `traceCapture`.

`apps/desktop/scripts/performance-soak-cdp.mjs` owns a small private CDP connection. It exports endpoint discovery, request correlation, event subscription, and a close that rejects outstanding requests. Both page automation and browser tracing use it. It knows no trace category, file, or verdict policy.

`apps/desktop/scripts/performance-soak-trace.mjs` owns the entire tracing protocol and artifact lifecycle. It exposes only `startChromeTrace` and the returned `finish` capability. It knows `Tracing.start`, `Tracing.end`, `Tracing.tracingComplete`, `IO.read`, `IO.close`, temporary output, and bounded streaming. It does not know routes, leases, thresholds, or exit codes.

[`apps/desktop/tests/scripts/performance-soak.test.ts`](../../../apps/desktop/tests/scripts/performance-soak.test.ts) extends its command-boundary coverage for the three flags and illegal combinations. A new sibling `performance-soak-trace.test.ts` supplies fake CDP and filesystem boundaries to prove the exact start payload, failure-only discard, byte-limit cleanup, stream closure, and verdict preservation. The test guidance in [`apps/desktop/tests/AGENTS.md`](../../../apps/desktop/tests/AGENTS.md) keeps these deterministic and fast.

This is one public CLI layer, one reusable CDP transport, and one deep trace module. The transport earns its boundary because both independently owned sessions need request and event handling. No wrapper forwards trace policy through the application. This minimizes reader load.

## Rationale

The current runner is already an external CDP consumer and the desktop app is intentionally CDP-enabled only for explicit unpackaged development launches. A second browser-level CDP connection is the narrowest path to a multi-process Chromium trace. It preserves the no-UI, no-always-on-profiling posture in [`apps/desktop/src/backend/main.ts`](../../../apps/desktop/src/backend/main.ts) and avoids making application IPC responsible for a CLI-only artifact.

The policy is a small state model rather than three flags leaking through the run loop. That choice is driven by model-the-domain. The write decision is made only after the verdict exists, so on-failure retains the full run in Chromium's bounded buffer without writing passing artifacts. Each boundary parses external input once and encloses all protocol and filesystem failure handling, per boundary discipline. One recorder owns its stream and socket, which makes repeated `finish` calls converge to the same stored report rather than issuing a second `Tracing.end`, per make-operations-idempotent.

## Alternatives considered

`Electron.contentTracing` through a new main-process IPC API lost. Electron can start recording across all processes and write a file, but it requires an application-side IPC surface, app lifecycle ownership, and a single global trace operation. The Electron API documents that a recording already in progress resolves immediately. That exposes global tracing state to a soak caller and makes independent runs harder to reason about. It is deeper inside Electron but makes the public app boundary wider. See [Electron `contentTracing`](https://www.electronjs.org/docs/latest/api/content-tracing).

Tracing from the existing renderer page CDP socket lost. It is the smallest implementation, but its ownership is ambiguous for a multi-process request and makes the trace transport compete with renderer inspection. It hides less of the browser-wide requirement behind the interface.

A hybrid main-process `contentTracing` controller with the CLI's renderer CDP socket lost. It offers Electron-specific categories but creates two tracing authorities, a new IPC contract, and ordering rules between them. The added surface does not buy a stronger artifact for this CLI use case.

Unbounded `Tracing.dataCollected` accumulation lost. It would put the entire trace in the Node process and makes long soak duration directly inflate memory. `ReturnAsStream` plus fixed-size IO reads hides that transport detail behind the recorder.

## Tradeoffs accepted

- We accept a bounded and potentially truncated timeline in exchange for a hard ceiling on trace memory and output size.
- We accept one additional local CDP WebSocket in exchange for browser-wide rather than renderer-only capture.
- We accept JSON despite its legacy status in the protocol in exchange for a directly inspectable Chrome and Perfetto artifact without a local conversion step.
- We accept trace-capture warnings that do not fail the gate in exchange for preserving the soak verdict as the stable CI signal.
- We accept no Electron-specific `electron` category in exchange for no app-side tracing feature or IPC surface.

## Open questions and risks

- Does the Electron 43 development build expose `Tracing` on the `/json/version` browser WebSocket with the proposed category set? Verify one short real run before implementation is considered complete.
- Should CI retain a failed trace as a build artifact automatically, or is the local path contract sufficient for the first release?
- Is 64 MiB a useful default on the target development machines, or should the initial default be 32 MiB after a short route-cycle measurement?
- Does the repository's artifact retention policy require a fixed `.pftrace` extension later? If so, switch to CDP `proto` only after opening it in the intended Chrome and Perfetto versions.

## Next implementation step

Extract the current generic CDP client into `performance-soak-cdp.mjs`, then add deterministic trace-recorder tests against a fake browser CDP session before wiring the three CLI flags.

## Synthesis decision

Awaiting arena synthesis.
