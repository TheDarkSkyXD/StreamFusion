import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_WORKERS = [8];
const DEFAULT_RUNS = 1;
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vitestBinary = resolve(desktopRoot, "node_modules/vitest/vitest.mjs");

const help = `Usage: node scripts/benchmark-test-suite.mjs [options]

Options:
  --workers=<list>  Comma-separated positive worker counts (default: 8)
  --runs=<count>    Positive number of runs per worker count (default: 1)
  -h, --help        Show this help
`;

function parsePositiveInteger(value, flag) {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${flag} requires a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} exceeds the safe integer range`);
  return parsed;
}

function parseArguments(args) {
  let workers = DEFAULT_WORKERS;
  let runs = DEFAULT_RUNS;
  let sawWorkers = false;
  let sawRuns = false;

  for (const argument of args) {
    if (argument === "-h" || argument === "--help") return { help: true, workers, runs };
    if (argument.startsWith("--workers=")) {
      if (sawWorkers) throw new Error("--workers may be provided only once");
      sawWorkers = true;
      const values = argument.slice("--workers=".length).split(",").map((value) => value.trim());
      if (values.some((value) => value.length === 0)) {
        throw new Error("--workers requires a comma-separated list of positive integers");
      }
      workers = values.map((value) => parsePositiveInteger(value, "--workers"));
      if (new Set(workers).size !== workers.length) {
        throw new Error("--workers must not contain duplicate counts");
      }
      continue;
    }
    if (argument.startsWith("--runs=")) {
      if (sawRuns) throw new Error("--runs may be provided only once");
      sawRuns = true;
      runs = parsePositiveInteger(argument.slice("--runs=".length), "--runs");
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return { help: false, workers, runs };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function runVitest(workers, run) {
  const argv = [
    vitestBinary,
    "run",
    "--project=node",
    "--project=dom",
    `--maxWorkers=${workers}`,
    "--reporter=agent",
    "--silent=passed-only",
  ];
  const startedAt = process.hrtime.bigint();
  const result = spawnSync(process.execPath, argv, {
    cwd: desktopRoot,
    shell: false,
    stdio: ["ignore", 2, 2],
    windowsHide: true,
  });
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  return {
    run,
    durationMs: round(durationMs),
    exitCode: result.status,
    signal: result.signal,
    error: result.error
      ? { code: result.error.code ?? null, message: result.error.message }
      : null,
  };
}

function benchmarkWorkerCount(workers, runs) {
  const samples = Array.from({ length: runs }, (_, index) => runVitest(workers, index + 1));
  const durations = samples.map((sample) => sample.durationMs);
  const medianMs = median(durations);
  const slowestMs = Math.max(...durations);

  return {
    workers,
    samples,
    medianMs: round(medianMs),
    slowestMs: round(slowestMs),
    slowestMedianSpreadMs: round(slowestMs - medianMs),
    slowestMedianSpreadRatio: medianMs === 0 ? 0 : round(slowestMs / medianMs - 1),
  };
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${help}`);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    process.stdout.write(help);
    return;
  }

  const results = options.workers.map((workers) => benchmarkWorkerCount(workers, options.runs));
  const passed = results.every((result) =>
    result.samples.every((sample) => sample.exitCode === 0 && sample.error === null)
  );
  const report = {
    command: {
      executable: process.execPath,
      vitestBinary,
      arguments: [
        "run",
        "--project=node",
        "--project=dom",
        "--maxWorkers=<workers>",
        "--reporter=agent",
        "--silent=passed-only",
      ],
    },
    runsPerWorkerCount: options.runs,
    passed,
    results,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
}

main();
