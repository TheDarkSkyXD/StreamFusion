import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MEBIBYTE = 1024 * 1024;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
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
  maxResidentBytes: 1400 * MEBIBYTE,
  maxResidentGrowthBytes: 128 * MEBIBYTE,
  maxHeapGrowthBytes: 64 * MEBIBYTE,
  maxProcessCount: 7,
  maxCpuP95Percent: 15,
  maxFrameP95Ms: 20,
  maxRendererExceptions: 0,
  maxRateLimitedResponses: 0,
});

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
        options.outputPath = requireValue();
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
  return options;
}

export function resolveSoakOutputPath(outputPath) {
  return isAbsolute(outputPath) ? outputPath : resolve(REPOSITORY_ROOT, outputPath);
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
      const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
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

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });

  return {
    async open() {
      if (socket.readyState === WebSocket.OPEN) return;
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
    },
    send(method, params = {}) {
      const id = nextId++;
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      socket.close();
    },
  };
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

export async function runPerformanceSoak(options) {
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
    client.close();
  }

  const result = analyzeSoakSamples({
    samples,
    events,
    options,
    startedAt,
    endedAt: Date.now(),
  });
  if (options.outputPath) {
    const outputPath = resolveSoakOutputPath(options.outputPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return result;
}

async function main() {
  const options = parseSoakArguments(process.argv.slice(2));
  const result = await runPerformanceSoak(options);
  process.stdout.write(
    `${JSON.stringify({ verdict: result.verdict, ...result.summary }, null, 2)}\n`
  );
  if (result.verdict === "fail") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
