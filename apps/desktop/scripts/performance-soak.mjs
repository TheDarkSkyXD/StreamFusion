import { open, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MEBIBYTE = 1024 * 1024;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DISABLED_TRACE_CAPTURE = Object.freeze({ kind: "disabled" });
const TRACE_READ_CHUNK_BYTES = 64 * 1024;
const TRACE_COMPLETE_TIMEOUT_MS = 30_000;
const CDP_REQUEST_TIMEOUT_MS = 30_000;
const CDP_CLOSE_TIMEOUT_MS = 5_000;
const TRACE_BUFFER_ARTIFACT_RATIO = 0.25;
const TRACE_CATEGORIES = Object.freeze([
  "toplevel",
  "renderer.scheduler",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "v8",
  "v8.execute",
  "disabled-by-default-v8.cpu_profiler",
  "blink",
  "gpu",
]);
const DEFAULT_ROUTES = [
  "#/",
  "#/categories",
  "#/following",
  "#/multistream",
  "#/search?q=xqc",
  "#/settings?tab=diagnostics",
];

export const DEFAULT_SOAK_OPTIONS = Object.freeze({
  cdpEndpoint: "http://127.0.0.1:9236",
  durationMs: 5 * 60_000,
  sampleIntervalMs: 15_000,
  warmupMs: 60_000,
  routeCycleMs: 0,
  routes: DEFAULT_ROUTES,
  outputPath: null,
  traceCapture: DISABLED_TRACE_CAPTURE,
  maxResidentBytes: 1400 * MEBIBYTE,
  maxResidentGrowthBytes: 128 * MEBIBYTE,
  maxHeapGrowthBytes: 64 * MEBIBYTE,
  maxProcessCount: 7,
  maxCpuP95Percent: 15,
  maxFrameP95Ms: 20,
  maxRendererExceptions: 0,
  maxRateLimitedResponses: 0,
});

export const DEFAULT_TRACE_MAX_BYTES = 64 * MEBIBYTE;

function parseFiniteNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} requires a finite number`);
  return parsed;
}

function parsePositiveNumber(value, flag) {
  const parsed = parseFiniteNumber(value, flag);
  if (parsed <= 0) throw new Error(`${flag} must be greater than zero`);
  return parsed;
}

function parseNonNegativeNumber(value, flag) {
  const parsed = parseFiniteNumber(value, flag);
  if (parsed < 0) throw new Error(`${flag} must not be negative`);
  return parsed;
}

export function parseSoakArguments(args) {
  const options = { ...DEFAULT_SOAK_OPTIONS, routes: [...DEFAULT_SOAK_OPTIONS.routes] };
  let traceMaxBytes = DEFAULT_TRACE_MAX_BYTES;
  let traceMaxWasProvided = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    const requireValue = () => {
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
      }
      index += 1;
      return value;
    };

    switch (flag) {
      case "--":
        break;
      case "--cdp-endpoint":
        options.cdpEndpoint = requireValue();
        break;
      case "--duration-minutes":
        options.durationMs = parsePositiveNumber(requireValue(), flag) * 60_000;
        break;
      case "--duration-seconds":
        options.durationMs = parsePositiveNumber(requireValue(), flag) * 1000;
        break;
      case "--sample-seconds":
        options.sampleIntervalMs = parsePositiveNumber(requireValue(), flag) * 1000;
        break;
      case "--warmup-minutes":
        options.warmupMs = parseNonNegativeNumber(requireValue(), flag) * 60_000;
        break;
      case "--warmup-seconds":
        options.warmupMs = parseNonNegativeNumber(requireValue(), flag) * 1000;
        break;
      case "--route-cycle-seconds":
        options.routeCycleMs = parseNonNegativeNumber(requireValue(), flag) * 1000;
        break;
      case "--routes": {
        const routes = requireValue()
          .split(",")
          .map((route) => route.trim())
          .filter(Boolean);
        if (routes.length === 0 || routes.some((route) => !route.startsWith("#/"))) {
          throw new Error("--routes requires a comma-separated list of hash routes");
        }
        options.routes = routes;
        break;
      }
      case "--output":
        options.outputPath = resolveSoakOutputPath(requireValue());
        break;
      case "--trace":
      case "--trace-on-failure": {
        if (options.traceCapture.kind !== "disabled") {
          throw new Error("--trace and --trace-on-failure are mutually exclusive");
        }
        options.traceCapture = {
          kind: flag === "--trace" ? "always" : "on-failure",
          outputPath: resolveSoakOutputPath(requireValue()),
          maxBytes: traceMaxBytes,
        };
        break;
      }
      case "--trace-max-mb":
        traceMaxBytes = parsePositiveNumber(requireValue(), flag) * MEBIBYTE;
        traceMaxWasProvided = true;
        break;
      case "--max-memory-mb":
        options.maxResidentBytes = parsePositiveNumber(requireValue(), flag) * MEBIBYTE;
        break;
      case "--max-memory-growth-mb":
        options.maxResidentGrowthBytes = parseNonNegativeNumber(requireValue(), flag) * MEBIBYTE;
        break;
      case "--max-heap-growth-mb":
        options.maxHeapGrowthBytes = parseNonNegativeNumber(requireValue(), flag) * MEBIBYTE;
        break;
      case "--max-processes":
        options.maxProcessCount = parsePositiveNumber(requireValue(), flag);
        break;
      case "--max-cpu-p95":
        options.maxCpuP95Percent = parseNonNegativeNumber(requireValue(), flag);
        break;
      case "--max-frame-p95-ms":
        options.maxFrameP95Ms = parsePositiveNumber(requireValue(), flag);
        break;
      case "--max-renderer-exceptions":
        options.maxRendererExceptions = parseNonNegativeNumber(requireValue(), flag);
        break;
      case "--max-429":
        options.maxRateLimitedResponses = parseNonNegativeNumber(requireValue(), flag);
        break;
      default:
        throw new Error(`Unknown performance-soak option: ${flag}`);
    }
  }

  if (options.warmupMs >= options.durationMs) {
    throw new Error("Warmup must be shorter than the total soak duration");
  }
  if (options.sampleIntervalMs > options.durationMs - options.warmupMs) {
    throw new Error("Sample interval must fit inside the post-warmup duration");
  }
  if (traceMaxWasProvided && options.traceCapture.kind === "disabled") {
    throw new Error("--trace-max-mb requires --trace or --trace-on-failure");
  }
  if (options.traceCapture.kind !== "disabled") {
    options.traceCapture = { ...options.traceCapture, maxBytes: traceMaxBytes };
    if (
      options.outputPath &&
      normalizePathForComparison(options.outputPath) ===
        normalizePathForComparison(options.traceCapture.outputPath)
    ) {
      throw new Error("--output and trace output must use different paths");
    }
  }
  return options;
}

export function resolveSoakOutputPath(outputPath) {
  return isAbsolute(outputPath) ? outputPath : resolve(REPOSITORY_ROOT, outputPath);
}

function normalizePathForComparison(filePath) {
  return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint];
}

function stableWindowGrowth(samples, select) {
  if (samples.length < 2) return 0;
  const windowSize = Math.max(1, Math.ceil(samples.length * 0.2));
  const start = median(samples.slice(0, windowSize).map(select));
  const end = median(samples.slice(-windowSize).map(select));
  return start === null || end === null ? 0 : end - start;
}

export function analyzeSoakSamples({ samples, events, options, startedAt, endedAt }) {
  const stableSamples = samples.filter(
    (sample) => sample.observedAtMs - startedAt >= options.warmupMs
  );
  if (stableSamples.length < 2) {
    throw new Error("Soak did not collect at least two post-warmup samples");
  }

  const residentValues = stableSamples.map((sample) => sample.residentMemoryBytes);
  const heapValues = stableSamples.map((sample) => sample.rendererHeapBytes);
  const processValues = stableSamples.map((sample) => sample.processCount);
  const cpuValues = stableSamples.map((sample) => sample.cpuPercent);
  const frameP95Values = stableSamples.map((sample) => sample.frameP95Ms);
  const frameSampleTimeoutCount = stableSamples.filter(
    (sample) => sample.frameSampleTimedOut
  ).length;
  const rendererExceptions = events.filter((event) => event.kind === "renderer-exception");
  const rateLimitedResponses = events.filter((event) => event.kind === "http-429");
  const summary = {
    durationMs: endedAt - startedAt,
    sampleCount: samples.length,
    stableSampleCount: stableSamples.length,
    residentMemory: {
      minBytes: Math.min(...residentValues),
      maxBytes: Math.max(...residentValues),
      growthBytes: stableWindowGrowth(stableSamples, (sample) => sample.residentMemoryBytes),
    },
    rendererHeap: {
      minBytes: Math.min(...heapValues),
      maxBytes: Math.max(...heapValues),
      growthBytes: stableWindowGrowth(stableSamples, (sample) => sample.rendererHeapBytes),
    },
    processCount: {
      min: Math.min(...processValues),
      max: Math.max(...processValues),
    },
    cpuP95Percent: percentile(cpuValues, 0.95),
    frameP95Ms: percentile(frameP95Values, 0.95),
    frameSampleTimeoutCount,
    rendererExceptionCount: rendererExceptions.length,
    rateLimitedResponseCount: rateLimitedResponses.length,
  };

  const failures = [];
  if (summary.residentMemory.maxBytes > options.maxResidentBytes) {
    failures.push("resident-memory-peak");
  }
  if (summary.residentMemory.growthBytes > options.maxResidentGrowthBytes) {
    failures.push("resident-memory-growth");
  }
  if (summary.rendererHeap.growthBytes > options.maxHeapGrowthBytes) {
    failures.push("renderer-heap-growth");
  }
  if (summary.processCount.max > options.maxProcessCount) failures.push("process-count");
  if (summary.cpuP95Percent > options.maxCpuP95Percent) failures.push("cpu-p95");
  if (summary.frameP95Ms > options.maxFrameP95Ms) failures.push("frame-p95");
  if (summary.frameSampleTimeoutCount > 0) failures.push("frame-sample-timeout");
  if (summary.rendererExceptionCount > options.maxRendererExceptions) {
    failures.push("renderer-exceptions");
  }
  if (summary.rateLimitedResponseCount > options.maxRateLimitedResponses) {
    failures.push("http-429");
  }

  return {
    schemaVersion: 1,
    verdict: failures.length === 0 ? "pass" : "fail",
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    options,
    summary,
    failures,
    events,
    samples,
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findStreamFusionTarget(endpoint, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`${endpoint}/json/list`, {
        signal: AbortSignal.timeout(Math.min(2_000, deadline - Date.now())),
      }).then((response) => response.json());
      const target = targets.find((candidate) => candidate.title === "StreamFusion");
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await delay(500);
  }
  throw new Error(`StreamFusion CDP target was not available at ${endpoint}`);
}

function createCdpClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  const listeners = new Set();
  let nextId = 1;

  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  socket.addEventListener("error", () => rejectPending(new Error("CDP connection failed")));
  socket.addEventListener("close", () => rejectPending(new Error("CDP connection closed")));

  return {
    async open() {
      if (socket.readyState === WebSocket.OPEN) return;
      if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        throw new Error("CDP connection closed before it opened");
      }
      await new Promise((resolve, reject) => {
        let timer;
        const cleanup = () => {
          clearTimeout(timer);
          socket.removeEventListener("open", onOpen);
          socket.removeEventListener("error", onError);
          socket.removeEventListener("close", onClose);
        };
        const onOpen = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error("CDP connection failed before it opened"));
        };
        const onClose = () => {
          cleanup();
          reject(new Error("CDP connection closed before it opened"));
        };
        socket.addEventListener("open", onOpen, { once: true });
        socket.addEventListener("error", onError, { once: true });
        socket.addEventListener("close", onClose, { once: true });
        timer = setTimeout(() => {
          cleanup();
          socket.close();
          reject(new Error("Timed out opening the CDP connection"));
        }, CDP_REQUEST_TIMEOUT_MS);
        timer.unref?.();
      });
    },
    send(method, params = {}) {
      if (socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error(`Cannot send ${method} on a closed CDP connection`));
      }
      const id = nextId++;
      const response = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for ${method}`));
        }, CDP_REQUEST_TIMEOUT_MS);
        timer.unref?.();
        pending.set(id, { resolve, reject, timer });
      });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        const request = pending.get(id);
        pending.delete(id);
        clearTimeout(request?.timer);
        request?.reject(error);
      }
      return response;
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      listeners.clear();
      rejectPending(new Error("CDP connection closed"));
      if (socket.readyState === WebSocket.CLOSED) return;
      await new Promise((resolveClose) => {
        const timer = setTimeout(resolveClose, CDP_CLOSE_TIMEOUT_MS);
        timer.unref?.();
        socket.addEventListener(
          "close",
          () => {
            clearTimeout(timer);
            resolveClose();
          },
          { once: true }
        );
        socket.close();
      });
    },
  };
}

class TraceCaptureError extends Error {
  constructor(stage, message) {
    super(message);
    this.stage = stage;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createSettledTraceCaptureSession(outcome) {
  const settled = Promise.resolve(outcome);
  return {
    finish() {
      return settled;
    },
  };
}

function createCdpEventWaiter(client, method) {
  let stopListening = () => {};
  let timer;
  const promise = new Promise((resolveEvent, rejectEvent) => {
    stopListening = client.onEvent((message) => {
      if (message.method !== method) return;
      clearTimeout(timer);
      stopListening();
      resolveEvent(message.params ?? {});
    });
    timer = setTimeout(() => {
      stopListening();
      rejectEvent(new Error(`Timed out waiting for ${method}`));
    }, TRACE_COMPLETE_TIMEOUT_MS);
    timer.unref?.();
  });
  return {
    promise,
    cancel() {
      clearTimeout(timer);
      stopListening();
    },
  };
}

function shouldRetainTrace(policy, completion) {
  if (policy.kind === "always") return true;
  return completion.kind === "aborted" || completion.verdict === "fail";
}

async function closeRemoteStream(resources, client) {
  if (resources.remoteStream.kind !== "open") return;
  const handle = resources.remoteStream.handle;
  resources.remoteStream = { kind: "closed" };
  await client.send("IO.close", { handle });
}

async function closeLocalArtifact(resources) {
  if (resources.artifact.kind !== "open") return;
  const { file, path } = resources.artifact;
  resources.artifact = { kind: "temporary", path };
  await file.close();
}

async function removeTemporaryArtifact(resources) {
  if (resources.artifact.kind !== "temporary") return;
  const path = resources.artifact.path;
  resources.artifact = { kind: "removed" };
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function cleanupTraceResources(resources, client) {
  let cleanupError = null;
  for (const cleanup of [
    () => closeRemoteStream(resources, client),
    () => closeLocalArtifact(resources),
    () => removeTemporaryArtifact(resources),
    () => client.close(),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      cleanupError ??= error;
    }
  }
  return cleanupError;
}

async function finishTraceCapture(session, completion) {
  const { policy, client, resources } = session;
  let outcome = null;
  let failure = null;
  let stage = "stop";

  try {
    const tracingComplete = createCdpEventWaiter(client, "Tracing.tracingComplete");
    const tracingCompleteResult = tracingComplete.promise.then(
      (value) => ({ kind: "completed", value }),
      (error) => ({ kind: "failed", error })
    );
    try {
      await client.send("Tracing.end");
    } catch (error) {
      tracingComplete.cancel();
      throw error;
    }

    const completedResult = await tracingCompleteResult;
    if (completedResult.kind === "failed") throw completedResult.error;
    const completed = completedResult.value;
    if (typeof completed.stream !== "string" || completed.stream.length === 0) {
      throw new Error("Tracing.tracingComplete did not include a stream handle");
    }
    resources.remoteStream = { kind: "open", handle: completed.stream };
    const dataLossOccurred = completed.dataLossOccurred === true;

    if (!shouldRetainTrace(policy, completion)) {
      stage = "cleanup";
      await closeRemoteStream(resources, client);
      outcome = { kind: "discarded", reason: "soak-passed", dataLossOccurred };
    } else {
      stage = "write";
      await mkdir(dirname(policy.outputPath), { recursive: true });
      const temporaryPath = resolve(
        dirname(policy.outputPath),
        `.${basename(policy.outputPath)}.${process.pid}.${randomUUID()}.tmp`
      );
      const file = await open(temporaryPath, "wx");
      resources.artifact = { kind: "open", path: temporaryPath, file };
      let bytes = 0;

      while (true) {
        stage = "read";
        const chunk = await client.send("IO.read", {
          handle: completed.stream,
          size: TRACE_READ_CHUNK_BYTES,
        });
        if (typeof chunk.data !== "string") {
          throw new Error("IO.read returned an invalid trace chunk");
        }
        const buffer = Buffer.from(chunk.data, chunk.base64Encoded === true ? "base64" : "utf8");
        if (bytes + buffer.length > policy.maxBytes) {
          throw new TraceCaptureError(
            "limit",
            `Trace exceeded the ${policy.maxBytes}-byte artifact limit`
          );
        }
        stage = "write";
        await file.writeFile(buffer);
        bytes += buffer.length;
        if (chunk.eof === true) break;
      }

      stage = "cleanup";
      await closeRemoteStream(resources, client);
      await closeLocalArtifact(resources);
      stage = "publish";
      await rename(temporaryPath, policy.outputPath);
      resources.artifact = { kind: "published", path: policy.outputPath };
      outcome = {
        kind: "saved",
        outputPath: policy.outputPath,
        bytes,
        dataLossOccurred,
      };
    }
  } catch (error) {
    failure = {
      stage: error instanceof TraceCaptureError ? error.stage : stage,
      error,
    };
  }

  const cleanupError = await cleanupTraceResources(resources, client);
  if (!failure && cleanupError) failure = { stage: "cleanup", error: cleanupError };
  if (failure) {
    return {
      kind: "failed",
      stage: failure.stage,
      message: errorMessage(failure.error),
    };
  }
  return outcome;
}

export async function createTraceCaptureSession({ policy, client }) {
  if (policy.kind === "disabled") {
    return createSettledTraceCaptureSession({ kind: "disabled" });
  }

  let stage = "connect";
  try {
    await client.open();
    stage = "start";
    await client.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      streamFormat: "json",
      streamCompression: "none",
      traceConfig: {
        recordMode: "recordContinuously",
        traceBufferSizeInKb: Math.max(
          1,
          Math.floor((policy.maxBytes * TRACE_BUFFER_ARTIFACT_RATIO) / 1024)
        ),
        includedCategories: TRACE_CATEGORIES,
        enableSampling: true,
      },
    });
  } catch (error) {
    try {
      await client.close();
    } catch {}
    return createSettledTraceCaptureSession({
      kind: "failed",
      stage,
      message: errorMessage(error),
    });
  }

  const session = {
    policy,
    client,
    resources: {
      remoteStream: { kind: "none" },
      artifact: { kind: "none" },
    },
    state: { kind: "recording" },
  };
  return {
    finish(completion) {
      if (session.state.kind === "recording") {
        session.state = {
          kind: "finishing",
          promise: finishTraceCapture(session, completion),
        };
      }
      return session.state.promise;
    },
  };
}

async function openRunnerTraceCapture(policy, endpoint) {
  if (policy.kind === "disabled") {
    return createSettledTraceCaptureSession({ kind: "disabled" });
  }

  let client = null;
  try {
    const response = await fetch(`${endpoint}/json/version`, {
      signal: AbortSignal.timeout(CDP_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Browser CDP discovery returned HTTP ${response.status}`);
    const version = await response.json();
    if (typeof version.webSocketDebuggerUrl !== "string") {
      throw new Error("Browser CDP discovery did not return a WebSocket URL");
    }
    client = createCdpClient(version.webSocketDebuggerUrl);
    return await createTraceCaptureSession({ policy, client });
  } catch (error) {
    if (client) {
      try {
        await client.close();
      } catch {}
    }
    return createSettledTraceCaptureSession({
      kind: "failed",
      stage: "connect",
      message: errorMessage(error),
    });
  }
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ?? response.exceptionDetails.text
    );
  }
  return response.result.value;
}

const OPEN_LEASE_EXPRESSION = `(async () => {
  const reply = await window.electronAPI.diagnostics.openLease({
    documentInstanceId: crypto.randomUUID(),
    view: { tab: "resources", windowMinutes: 60 }
  });
  if (reply.kind === "error") throw new Error(\`Diagnostics lease failed: \${reply.error.code}\`);
  window.__streamFusionPerformanceSoakLeaseId = reply.value.leaseId;
  return reply.value.leaseId;
})()`;

const SAMPLE_EXPRESSION = `(async () => {
  const leaseId = window.__streamFusionPerformanceSoakLeaseId;
  if (!leaseId) throw new Error("Performance soak lease is not open");
  const reply = await window.electronAPI.diagnostics.refresh(leaseId);
  if (reply.kind === "error") throw new Error(\`Diagnostics refresh failed: \${reply.error.code}\`);
  const snapshot = reply.value;
  const readValue = (diagnostic, fallback = 0) =>
    diagnostic.status.kind === "ready" || diagnostic.status.kind === "stale"
      ? diagnostic.value
      : fallback;
  let frameSampleTimedOut = false;
  const frameTimes = await new Promise((resolve) => {
    const values = [];
    let previous = performance.now();
    const timeout = setTimeout(() => {
      frameSampleTimedOut = true;
      resolve(values.slice(1));
    }, 3000);
    const sample = (now) => {
      values.push(now - previous);
      previous = now;
      if (values.length >= 30) {
        clearTimeout(timeout);
        resolve(values.slice(1));
      }
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const orderedFrames = [...frameTimes].sort((left, right) => left - right);
  const frameP95Ms = orderedFrames.length > 0
    ? orderedFrames[Math.min(orderedFrames.length - 1, Math.ceil(orderedFrames.length * 0.95) - 1)]
    : 3000;
  return {
    observedAtMs: snapshot.observedAtMs,
    route: location.hash || "#/",
    cpuPercent: readValue(snapshot.overview.footprint.cpuPercent),
    residentMemoryBytes: readValue(snapshot.overview.footprint.residentMemoryBytes),
    processCount: readValue(snapshot.overview.footprint.processCount),
    rendererHeapBytes: performance.memory?.usedJSHeapSize ?? 0,
    frameP95Ms,
    frameMaxMs: frameTimes.length > 0 ? Math.max(...frameTimes) : 3000,
    frameSampleTimedOut,
    visibilityState: document.visibilityState,
    videoCount: document.querySelectorAll("video").length,
    playingVideoCount: [...document.querySelectorAll("video")].filter((video) => !video.paused && video.readyState >= 2).length,
    domNodeCount: document.querySelectorAll("*").length
  };
})()`;

const CLOSE_LEASE_EXPRESSION = `(async () => {
  const leaseId = window.__streamFusionPerformanceSoakLeaseId;
  if (!leaseId) return;
  await window.electronAPI.diagnostics.closeLease(leaseId);
  delete window.__streamFusionPerformanceSoakLeaseId;
})()`;

async function collectPerformanceSoak(options) {
  const target = await findStreamFusionTarget(options.cdpEndpoint);
  const client = createCdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  await client.send("Page.bringToFront");

  const events = [];
  const stopListening = client.onEvent((message) => {
    if (message.method === "Runtime.exceptionThrown") {
      events.push({
        kind: "renderer-exception",
        observedAtMs: Date.now(),
        description:
          message.params?.exceptionDetails?.exception?.description ?? "Renderer exception",
      });
    }
    if (message.method === "Network.responseReceived" && message.params?.response?.status === 429) {
      events.push({
        kind: "http-429",
        observedAtMs: Date.now(),
        url: message.params.response.url,
      });
    }
  });

  const startedAt = Date.now();
  const deadline = startedAt + options.durationMs;
  const samples = [];
  let nextRouteAt = options.routeCycleMs > 0 ? startedAt : Number.POSITIVE_INFINITY;
  let routeIndex = 0;

  try {
    await evaluate(client, OPEN_LEASE_EXPRESSION);
    while (Date.now() < deadline) {
      if (Date.now() >= nextRouteAt) {
        const route = options.routes[routeIndex % options.routes.length];
        routeIndex += 1;
        await evaluate(client, `location.hash = ${JSON.stringify(route)}`);
        await client.send("Page.bringToFront");
        await delay(2_000);
        nextRouteAt += options.routeCycleMs;
      }

      const sample = await evaluate(client, SAMPLE_EXPRESSION);
      samples.push(sample);
      const memoryMb = (sample.residentMemoryBytes / MEBIBYTE).toFixed(1);
      const heapMb = (sample.rendererHeapBytes / MEBIBYTE).toFixed(1);
      process.stdout.write(
        `${new Date(sample.observedAtMs).toISOString()} ` +
          `cpu=${sample.cpuPercent.toFixed(1)}% rss=${memoryMb}MB heap=${heapMb}MB ` +
          `procs=${sample.processCount} frameP95=${sample.frameP95Ms.toFixed(2)}ms route=${sample.route}\n`
      );

      const remainingMs = deadline - Date.now();
      if (remainingMs > 0) await delay(Math.min(options.sampleIntervalMs, remainingMs));
    }
  } finally {
    try {
      await evaluate(client, CLOSE_LEASE_EXPRESSION);
    } catch {
      // The renderer may have exited while the soak was ending.
    }
    stopListening();
    await client.close();
  }

  const result = analyzeSoakSamples({
    samples,
    events,
    options,
    startedAt,
    endedAt: Date.now(),
  });
  return result;
}

export async function runPerformanceSoak(options) {
  const traceSession = await openRunnerTraceCapture(options.traceCapture, options.cdpEndpoint);
  let runState;
  try {
    runState = { kind: "completed", result: await collectPerformanceSoak(options) };
  } catch (error) {
    runState = { kind: "aborted", error };
  }

  const completion =
    runState.kind === "completed"
      ? { kind: "completed", verdict: runState.result.verdict }
      : { kind: "aborted" };
  let traceCapture;
  try {
    traceCapture = await traceSession.finish(completion);
  } catch (error) {
    traceCapture = { kind: "failed", stage: "cleanup", message: errorMessage(error) };
  }

  if (runState.kind === "aborted") throw runState.error;
  const result = { ...runState.result, traceCapture };
  if (options.outputPath) {
    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return result;
}

async function main() {
  const options = parseSoakArguments(process.argv.slice(2));
  const result = await runPerformanceSoak(options);
  process.stdout.write(
    `${JSON.stringify(
      { verdict: result.verdict, ...result.summary, traceCapture: result.traceCapture },
      null,
      2
    )}\n`
  );
  if (result.verdict === "fail") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
