import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import {
  DEFAULT_SOAK_OPTIONS,
  DEFAULT_TRACE_MAX_BYTES,
  analyzeSoakSamples,
  createTraceCaptureSession,
  parseSoakArguments,
  resolveSoakOutputPath,
} from "../../scripts/performance-soak.mjs";

type TraceChunk = {
  data: string;
  base64Encoded?: boolean;
  eof?: boolean;
};

class ScriptedCdpClient {
  readonly operations: string[] = [];
  readonly startParameters: unknown[] = [];
  readonly readParameters: unknown[] = [];
  readonly listeners = new Set<(message: unknown) => void>();
  readonly chunks: TraceChunk[];
  readonly failingMethod: string | null;

  constructor({
    chunks = [],
    failingMethod = null,
  }: { chunks?: TraceChunk[]; failingMethod?: string | null } = {}) {
    this.chunks = [...chunks];
    this.failingMethod = failingMethod;
  }

  async open() {
    this.operations.push("open");
    if (this.failingMethod === "open") throw new Error("open failed");
  }

  async send(method: string, parameters: unknown = {}) {
    this.operations.push(method);
    if (method === this.failingMethod) throw new Error(`${method} failed`);
    if (method === "Tracing.start") this.startParameters.push(parameters);
    if (method === "Tracing.end") {
      this.emit({
        method: "Tracing.tracingComplete",
        params: { stream: "trace-stream", dataLossOccurred: false },
      });
    }
    if (method === "IO.read") {
      this.readParameters.push(parameters);
      const chunk = this.chunks.shift();
      if (!chunk) throw new Error("No scripted trace chunk remains");
      return chunk;
    }
    return {};
  }

  onEvent(listener: (message: unknown) => void) {
    this.operations.push("listen");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close() {
    this.operations.push("socket.close");
  }

  private emit(message: unknown) {
    for (const listener of this.listeners) listener(message);
  }
}

const temporaryDirectories: string[] = [];

async function createTemporaryTracePath() {
  const directory = await mkdtemp(join(tmpdir(), "streamfusion-trace-"));
  temporaryDirectories.push(directory);
  return { directory, outputPath: join(directory, "soak.trace.json") };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

// Guards: the unattended soak command rejects invalid timing and threshold inputs before opening Electron.
// Guards: trace flags form one valid retention policy.
// Guards: report and trace paths resolve without collisions.
// Guards: trace finalization registers its completion waiter before stopping.
// Guards: trace chunks preserve their exact bytes.
// Guards: trace artifacts cannot exceed their configured byte limit.
// Guards: trace finalization closes each CDP resource once.
// Guards: failure-only tracing keeps failed runs.
// Guards: failure-only tracing keeps aborted runs.
// Guards: failure-only tracing discards passing runs.
// Guards: failed trace capture never publishes a partial artifact.
// Guards: trace diagnostics cannot change the soak verdict or failure codes.
// Guards: stable native memory, renderer heap, CPU, frames, process count, exceptions, and 429s produce a passing report.
// Guards: sustained memory growth and quota violations fail with machine-readable reason codes.
// Guards: a throttled renderer cannot hang the unattended runner and fails with an explicit frame-sample timeout.
describe("performance soak gate", () => {
  it("cycles the discovery and MultiView performance surfaces by default", () => {
    expect(DEFAULT_SOAK_OPTIONS.routes).toEqual(
      expect.arrayContaining(["#/categories", "#/multistream", "#/search?q=xqc"])
    );
  });

  it("parses an explicit multi-day run without weakening default thresholds", () => {
    const options = parseSoakArguments([
      "--",
      "--duration-minutes",
      "2880",
      "--sample-seconds",
      "30",
      "--warmup-minutes",
      "5",
      "--route-cycle-seconds",
      "1800",
      "--output",
      ".audit/soak.json",
    ]);

    expect(options).toMatchObject({
      durationMs: 2 * 24 * 60 * 60_000,
      sampleIntervalMs: 30_000,
      warmupMs: 5 * 60_000,
      routeCycleMs: 30 * 60_000,
      outputPath: resolveSoakOutputPath(".audit/soak.json"),
      traceCapture: { kind: "disabled" },
      maxResidentGrowthBytes: DEFAULT_SOAK_OPTIONS.maxResidentGrowthBytes,
      maxRateLimitedResponses: 0,
    });
  });

  it("keeps trace capture disabled without trace flags", () => {
    expect(parseSoakArguments([]).traceCapture).toEqual({ kind: "disabled" });
  });

  it("parses always and failure-only trace policies with resolved paths", () => {
    const always = parseSoakArguments(["--trace", ".audit/always.trace.json"]);
    const onFailure = parseSoakArguments([
      "--trace-on-failure",
      ".audit/failure.trace.json",
      "--trace-max-mb",
      "8",
    ]);

    expect(always.traceCapture).toEqual({
      kind: "always",
      outputPath: resolveSoakOutputPath(".audit/always.trace.json"),
      maxBytes: DEFAULT_TRACE_MAX_BYTES,
    });
    expect(onFailure.traceCapture).toEqual({
      kind: "on-failure",
      outputPath: resolveSoakOutputPath(".audit/failure.trace.json"),
      maxBytes: 8 * 1024 * 1024,
    });
  });

  it("rejects mutually exclusive trace modes", () => {
    expect(() =>
      parseSoakArguments([
        "--trace",
        ".audit/always.trace.json",
        "--trace-on-failure",
        ".audit/failure.trace.json",
      ])
    ).toThrow("mutually exclusive");
  });

  it("rejects a trace budget without enabled tracing", () => {
    expect(() => parseSoakArguments(["--trace-max-mb", "8"])).toThrow(
      "requires --trace or --trace-on-failure"
    );
  });

  it("rejects report and trace path collisions after resolution", () => {
    expect(() =>
      parseSoakArguments([
        "--output",
        ".audit/soak.json",
        "--trace",
        resolveSoakOutputPath(".audit/soak.json"),
      ])
    ).toThrow("must use different paths");
  });

  it("rejects a warmup that consumes the run", () => {
    expect(() =>
      parseSoakArguments(["--duration-seconds", "30", "--warmup-seconds", "30"])
    ).toThrow("Warmup must be shorter");
  });

  it("resolves relative reports into the repository audit directory", () => {
    const outputPath = resolveSoakOutputPath(".audit/soak.json");

    expect(isAbsolute(outputPath)).toBe(true);
    expect(outputPath.endsWith(join(".audit", "soak.json"))).toBe(true);
  });

  it("passes a stable post-warmup run", () => {
    const startedAt = Date.parse("2026-08-25T18:00:00.000Z");
    const result = analyzeSoakSamples({
      startedAt,
      endedAt: startedAt + 40_000,
      options: {
        ...DEFAULT_SOAK_OPTIONS,
        durationMs: 40_000,
        warmupMs: 10_000,
      },
      events: [],
      samples: [0, 10, 20, 30, 40].map((seconds, index) => ({
        observedAtMs: startedAt + seconds * 1000,
        route: "#/",
        cpuPercent: 0.4 + index * 0.1,
        residentMemoryBytes: (800 + index * 2) * 1024 * 1024,
        processCount: 5,
        rendererHeapBytes: (60 + index) * 1024 * 1024,
        frameP95Ms: 16.8,
        frameMaxMs: 17,
        frameSampleTimedOut: false,
        videoCount: 1,
        playingVideoCount: 1,
        domNodeCount: 1200,
      })),
    });

    expect(result.verdict).toBe("pass");
    expect(result.failures).toEqual([]);
    expect(result.summary.stableSampleCount).toBe(4);
  });

  it("uses the center of even sample windows for memory growth", () => {
    const startedAt = Date.parse("2026-08-25T18:00:00.000Z");
    const memoryMb = [800, 900, 1_000, 1_100, 1_200, 1_300, 1_000, 1_100];
    const result = analyzeSoakSamples({
      startedAt,
      endedAt: startedAt + 80_000,
      options: {
        ...DEFAULT_SOAK_OPTIONS,
        durationMs: 80_000,
        warmupMs: 0,
        maxResidentGrowthBytes: 200 * 1024 * 1024,
      },
      events: [],
      samples: memoryMb.map((residentMemoryMb, index) => ({
        observedAtMs: startedAt + index * 10_000,
        route: "#/",
        cpuPercent: 1,
        residentMemoryBytes: residentMemoryMb * 1024 * 1024,
        processCount: 5,
        rendererHeapBytes: 60 * 1024 * 1024,
        frameP95Ms: 16.8,
        frameMaxMs: 17,
        frameSampleTimedOut: false,
        videoCount: 1,
        playingVideoCount: 1,
        domNodeCount: 1200,
      })),
    });

    expect(result.summary.residentMemory.growthBytes).toBe(200 * 1024 * 1024);
    expect(result.failures).toEqual([]);
  });

  it("fails sustained memory growth, exceptions, and rate limiting", () => {
    const startedAt = Date.parse("2026-08-25T18:00:00.000Z");
    const result = analyzeSoakSamples({
      startedAt,
      endedAt: startedAt + 40_000,
      options: {
        ...DEFAULT_SOAK_OPTIONS,
        durationMs: 40_000,
        warmupMs: 0,
        maxResidentGrowthBytes: 20 * 1024 * 1024,
      },
      events: [
        { kind: "renderer-exception", observedAtMs: startedAt + 1, description: "boom" },
        { kind: "http-429", observedAtMs: startedAt + 2, url: "https://example.test" },
      ],
      samples: [0, 10, 20, 30, 40].map((seconds, index) => ({
        observedAtMs: startedAt + seconds * 1000,
        route: "#/",
        cpuPercent: 1,
        residentMemoryBytes: (700 + index * 25) * 1024 * 1024,
        processCount: 5,
        rendererHeapBytes: 60 * 1024 * 1024,
        frameP95Ms: 16.8,
        frameMaxMs: 17,
        frameSampleTimedOut: index === 4,
        videoCount: 1,
        playingVideoCount: 1,
        domNodeCount: 1200,
      })),
    });

    expect(result.verdict).toBe("fail");
    expect(result.failures).toEqual([
      "resident-memory-growth",
      "frame-sample-timeout",
      "renderer-exceptions",
      "http-429",
    ]);
  });

  it("discards a passing failure-only trace", async () => {
    const { outputPath } = await createTemporaryTracePath();
    const client = new ScriptedCdpClient();
    const session = await createTraceCaptureSession({
      policy: { kind: "on-failure", outputPath, maxBytes: 1024 },
      client,
    });

    const outcome = await session.finish({ kind: "completed", verdict: "pass" });

    expect(outcome).toEqual({
      kind: "discarded",
      reason: "soak-passed",
      dataLossOccurred: false,
    });
    expect(client.operations).toContain("IO.close");
    await expect(readFile(outputPath)).rejects.toThrow();
  });

  it("retains failed and aborted failure-only traces", async () => {
    const failedPath = await createTemporaryTracePath();
    const abortedPath = await createTemporaryTracePath();
    const content = '{"traceEvents":[]}';
    const failedSession = await createTraceCaptureSession({
      policy: { kind: "on-failure", outputPath: failedPath.outputPath, maxBytes: 1024 },
      client: new ScriptedCdpClient({ chunks: [{ data: content, eof: true }] }),
    });
    const abortedSession = await createTraceCaptureSession({
      policy: { kind: "on-failure", outputPath: abortedPath.outputPath, maxBytes: 1024 },
      client: new ScriptedCdpClient({ chunks: [{ data: content, eof: true }] }),
    });

    const failed = await failedSession.finish({ kind: "completed", verdict: "fail" });
    const aborted = await abortedSession.finish({ kind: "aborted" });

    expect(failed).toMatchObject({ kind: "saved", bytes: Buffer.byteLength(content) });
    expect(aborted).toMatchObject({ kind: "saved", bytes: Buffer.byteLength(content) });
    await expect(readFile(failedPath.outputPath, "utf8")).resolves.toBe(content);
    await expect(readFile(abortedPath.outputPath, "utf8")).resolves.toBe(content);
  });

  it("registers the completion waiter before ending tracing", async () => {
    const { outputPath } = await createTemporaryTracePath();
    const client = new ScriptedCdpClient();
    const session = await createTraceCaptureSession({
      policy: { kind: "on-failure", outputPath, maxBytes: 8 * 1024 * 1024 },
      client,
    });

    await session.finish({ kind: "completed", verdict: "pass" });

    expect(client.operations.indexOf("listen")).toBeLessThan(
      client.operations.indexOf("Tracing.end")
    );
    expect(client.startParameters[0]).toMatchObject({
      transferMode: "ReturnAsStream",
      streamFormat: "json",
      traceConfig: {
        recordMode: "recordContinuously",
        traceBufferSizeInKb: 2 * 1024,
        enableSampling: true,
        includedCategories: expect.arrayContaining(["toplevel", "renderer.scheduler", "v8", "gpu"]),
      },
    });
  });

  it("appends streamed chunks, decodes base64, and publishes exact artifact bytes", async () => {
    const { outputPath } = await createTemporaryTracePath();
    const content = '{"traceEvents":[{"name":"render"}]}';
    const splitAt = 18;
    const client = new ScriptedCdpClient({
      chunks: [
        { data: content.slice(0, splitAt), eof: false },
        {
          data: Buffer.from(content.slice(splitAt)).toString("base64"),
          base64Encoded: true,
          eof: true,
        },
      ],
    });
    const session = await createTraceCaptureSession({
      policy: { kind: "always", outputPath, maxBytes: Buffer.byteLength(content) },
      client,
    });

    const outcome = await session.finish({ kind: "completed", verdict: "pass" });

    expect(outcome).toMatchObject({ kind: "saved", bytes: Buffer.byteLength(content) });
    expect(client.readParameters).toEqual([
      { handle: "trace-stream", size: 64 * 1024 },
      { handle: "trace-stream", size: 64 * 1024 },
    ]);
    await expect(readFile(outputPath, "utf8")).resolves.toBe(content);
  });

  it("removes partial output when the exact byte limit is exceeded", async () => {
    const { directory, outputPath } = await createTemporaryTracePath();
    const client = new ScriptedCdpClient({
      chunks: [{ data: '{"traceEvents":[]}', eof: true }],
    });
    const session = await createTraceCaptureSession({
      policy: { kind: "always", outputPath, maxBytes: 4 },
      client,
    });

    const outcome = await session.finish({ kind: "completed", verdict: "pass" });

    expect(outcome).toMatchObject({ kind: "failed", stage: "limit" });
    expect(await readdir(directory)).toEqual([]);
    expect(client.operations).toContain("IO.close");
  });

  it("closes the remote stream after a read failure", async () => {
    const { directory, outputPath } = await createTemporaryTracePath();
    const client = new ScriptedCdpClient({ failingMethod: "IO.read" });
    const session = await createTraceCaptureSession({
      policy: { kind: "always", outputPath, maxBytes: 1024 },
      client,
    });

    const outcome = await session.finish({ kind: "completed", verdict: "fail" });

    expect(outcome).toMatchObject({ kind: "failed", stage: "read" });
    expect(client.operations).toContain("IO.close");
    expect(client.operations.at(-1)).toBe("socket.close");
    expect(await readdir(directory)).toEqual([]);
  });

  it("finishes a trace session only once", async () => {
    const { outputPath } = await createTemporaryTracePath();
    const client = new ScriptedCdpClient();
    const session = await createTraceCaptureSession({
      policy: { kind: "on-failure", outputPath, maxBytes: 1024 },
      client,
    });

    const first = session.finish({ kind: "completed", verdict: "pass" });
    const second = session.finish({ kind: "aborted" });

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ kind: "discarded" });
    expect(client.operations.filter((operation) => operation === "Tracing.end")).toHaveLength(1);
    expect(client.operations.filter((operation) => operation === "IO.close")).toHaveLength(1);
    expect(client.operations.filter((operation) => operation === "socket.close")).toHaveLength(1);
  });

  it("reports trace startup failures without opening an artifact", async () => {
    const client = new ScriptedCdpClient({ failingMethod: "Tracing.start" });
    const session = await createTraceCaptureSession({
      policy: { kind: "always", outputPath: "unused.json", maxBytes: 1024 },
      client,
    });
    const traceCapture = await session.finish({ kind: "completed", verdict: "fail" });

    expect(traceCapture).toMatchObject({ kind: "failed", stage: "start" });
    expect(client.operations.filter((operation) => operation === "socket.close")).toHaveLength(1);
  });

  it("reports trace connection failures separately from startup failures", async () => {
    const client = new ScriptedCdpClient({ failingMethod: "open" });
    const session = await createTraceCaptureSession({
      policy: { kind: "always", outputPath: "unused.json", maxBytes: 1024 },
      client,
    });

    await expect(session.finish({ kind: "completed", verdict: "fail" })).resolves.toMatchObject({
      kind: "failed",
      stage: "connect",
    });
    expect(client.operations.filter((operation) => operation === "socket.close")).toHaveLength(1);
  });
});
