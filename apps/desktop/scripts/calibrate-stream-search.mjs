import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const PLATFORMS = ["twitch", "kick"];
const REQUIRED_FIELDS = [
  "observedAt",
  "query",
  "platform",
  "latencyMs",
  "requests",
  "pages",
  "yield",
  "pageSize",
  "concurrency",
];

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function assertObservation(value, index) {
  if (!value || typeof value !== "object") throw new Error(`Observation ${index} must be an object`);
  for (const field of REQUIRED_FIELDS) {
    if (!(field in value)) throw new Error(`Observation ${index} is missing ${field}`);
  }
  if (!PLATFORMS.includes(value.platform)) {
    throw new Error(`Observation ${index} has unsupported platform ${String(value.platform)}`);
  }
  if (typeof value.query !== "string" || value.query.trim().length === 0) {
    throw new Error(`Observation ${index} query must be non-empty`);
  }
  for (const field of ["latencyMs", "requests", "pages", "yield", "pageSize", "concurrency"]) {
    if (!Number.isFinite(value[field]) || value[field] < 0) {
      throw new Error(`Observation ${index} ${field} must be a non-negative number`);
    }
  }
}

export function deriveStreamSearchCalibration(input, generatedAt = new Date().toISOString()) {
  if (input?.schemaVersion !== 1 || !Array.isArray(input.observations)) {
    throw new Error("Expected { schemaVersion: 1, observations: [...] }");
  }
  input.observations.forEach(assertObservation);

  const budgets = {};
  for (const platform of PLATFORMS) {
    const samples = input.observations.filter((sample) => sample.platform === platform);
    if (samples.length === 0) throw new Error(`No ${platform} observations were supplied`);
    const p95Latency = percentile(samples.map((sample) => sample.latencyMs), 0.95);
    const p95Requests = percentile(samples.map((sample) => sample.requests), 0.95);
    const p95Pages = percentile(samples.map((sample) => sample.pages), 0.95);
    const bestYield = [...samples].sort(
      (left, right) =>
        right.yield / Math.max(1, right.latencyMs) - left.yield / Math.max(1, left.latencyMs)
    )[0];

    budgets[platform] = {
      pageSize: bestYield.pageSize,
      maxPages: Math.max(1, Math.ceil(p95Pages * 1.25)),
      maxRequests: Math.max(1, Math.ceil(p95Requests * 1.25)),
      maxDurationMs: Math.max(1000, Math.ceil((p95Latency * 1.25) / 1000) * 1000),
      maxConcurrentRequests: Math.max(1, Math.floor(bestYield.concurrency)),
    };
  }

  return {
    schemaVersion: 1,
    calibrated: true,
    source: "electron-runtime-observations",
    observationCount: input.observations.length,
    generatedAt,
    budgets,
  };
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    throw new Error(
      "Usage: node scripts/calibrate-stream-search.mjs <observations.json> <profile.json>"
    );
  }
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const calibration = deriveStreamSearchCalibration(input);
  await writeFile(outputPath, `${JSON.stringify(calibration, null, 2)}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
