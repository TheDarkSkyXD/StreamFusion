/**
 * noise-logger.test.ts
 *
 * Guards the noise side-channel logger: a second electron-log instance that
 * writes high-volume events (HLS segments, chat throughput, player ticks)
 * to its own file so they don't drown out the main session log.
 *
 * Surface mirrors the main logger (`initNoiseLogger`, `noiseLogger`,
 * `getCurrentNoisePath`, `shutdownNoiseLogger`) and reuses the same
 * `formatLine` formatter — so we only retest behaviors that differ:
 *
 *   - the noise file name (`streamfusion-noise-<stamp>.log`),
 *   - the noise header / footer markers,
 *   - the `STREAMFUSION_NOISE_LOG_LEVEL` env override,
 *   - and — most importantly — that the noise instance is genuinely isolated
 *     from the main electron-log instance (cross-contamination test).
 *
 * Electron is mocked so electron-log's path/appName lookups don't need a real
 * Electron runtime.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("@/backend/logging/logger");
vi.unmock("@/backend/logging/noise-logger");

vi.mock("electron", () => ({
  app: {
    getPath: () => os.tmpdir(),
    getName: () => "streamfusion",
    getVersion: () => "0.0.0-test",
    isReady: () => true,
    isPackaged: false,
    once: () => undefined,
    on: () => undefined,
    off: () => undefined,
  },
  ipcMain: { on: () => undefined, handle: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
  webContents: { getAllWebContents: () => [] },
  session: { defaultSession: null },
  shell: { openExternal: async () => undefined },
  dialog: { showErrorBox: () => undefined },
}));

type NoiseLoggerModule = typeof import("@/backend/logging/noise-logger");
type LoggerModule = typeof import("@/backend/logging/logger");

async function freshNoiseModule(): Promise<NoiseLoggerModule> {
  vi.resetModules();
  return await import("@/backend/logging/noise-logger");
}

async function freshLoggerAndNoiseModules(): Promise<{
  loggerMod: LoggerModule;
  noiseMod: NoiseLoggerModule;
}> {
  vi.resetModules();
  const loggerMod = await import("@/backend/logging/logger");
  const noiseMod = await import("@/backend/logging/noise-logger");
  return { loggerMod, noiseMod };
}

let currentTmpDir = "";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "streamfusion-noisetest-"));
}

function readAllLines(file: string): string[] {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

beforeEach(() => {
  currentTmpDir = makeTmpDir();
});

afterEach(async () => {
  try {
    const mod = await import("@/backend/logging/noise-logger");
    await mod.shutdownNoiseLogger();
  } catch {
    // not initialized — nothing to shut down
  }
  try {
    const mod = await import("@/backend/logging/logger");
    await mod.shutdownLogger();
  } catch {
    // not initialized — nothing to shut down
  }
  try {
    fs.rmSync(currentTmpDir, { recursive: true, force: true });
  } catch {
    // Windows may briefly hold a handle — best-effort
  }
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// initNoiseLogger + getCurrentNoisePath
// ---------------------------------------------------------------------------

describe("initNoiseLogger + getCurrentNoisePath", () => {
  it("computes the noise file path from sessionStamp with `:` and `.` replaced by `-`", async () => {
    const mod = await freshNoiseModule();
    const stamp = "2026-06-07T15:51:25.011Z";
    mod.initNoiseLogger({ logsDir: currentTmpDir, sessionStamp: stamp });
    const got = mod.getCurrentNoisePath();
    expect(got).toBe(path.join(currentTmpDir, "streamfusion-noise-2026-06-07T15-51-25-011Z.log"));
  });

  it("creates the logsDir if it does not exist", async () => {
    const mod = await freshNoiseModule();
    const nested = path.join(currentTmpDir, "deep", "logs");
    expect(fs.existsSync(nested)).toBe(false);
    mod.initNoiseLogger({
      logsDir: nested,
      sessionStamp: "2026-06-07T15:51:25.011Z",
    });
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("writes a noise session header as the FIRST line of the file", async () => {
    const mod = await freshNoiseModule();
    const stamp = "2026-06-07T15:51:25.012Z";
    mod.initNoiseLogger({ logsDir: currentTmpDir, sessionStamp: stamp, level: "info" });
    const file = mod.getCurrentNoisePath();
    const lines = readAllLines(file);
    expect(lines[0]).toBe(`=== Noise debug started ${stamp} (level=info) ===`);
  });

  it("is idempotent — a second call with identical opts does not throw and does not duplicate the header", async () => {
    const mod = await freshNoiseModule();
    const stamp = "2026-06-07T15:51:25.013Z";
    const opts = { logsDir: currentTmpDir, sessionStamp: stamp };
    expect(() => mod.initNoiseLogger(opts)).not.toThrow();
    expect(() => mod.initNoiseLogger(opts)).not.toThrow();
    const lines = readAllLines(mod.getCurrentNoisePath());
    const headers = lines.filter((l) => l.startsWith("=== Noise debug started "));
    expect(headers).toHaveLength(1);
  });

  it("getCurrentNoisePath throws a clear error when the noise logger has not been initialized", async () => {
    const mod = await freshNoiseModule();
    expect(() => mod.getCurrentNoisePath()).toThrow(/not initialized/i);
  });

  it("writes streamfusion-noise-current.log.path containing the active noise log path", async () => {
    const mod = await freshNoiseModule();
    const stamp = "2026-06-07T15:51:25.022Z";
    mod.initNoiseLogger({ logsDir: currentTmpDir, sessionStamp: stamp });
    const pointer = path.join(currentTmpDir, "streamfusion-noise-current.log.path");
    expect(fs.existsSync(pointer)).toBe(true);
    const contents = fs.readFileSync(pointer, "utf8");
    expect(contents).toBe(mod.getCurrentNoisePath());
    expect(contents.endsWith("\n")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// noiseLogger.<level> — end-to-end file writes
// ---------------------------------------------------------------------------

describe("noiseLogger.<level>", () => {
  it("writes a formatted info line to the noise session file using the shared formatLine shape", async () => {
    const mod = await freshNoiseModule();
    mod.initNoiseLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.014Z",
    });
    mod.noiseLogger.info("Chat", "msg from x");
    const lines = readAllLines(mod.getCurrentNoisePath());
    const infoLine = lines.find((l) => l.includes("[info] [Chat] msg from x"));
    expect(infoLine).toBeDefined();
    expect(infoLine).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[info\] \[Chat\] msg from x$/
    );
  });

  it("appends meta JSON when provided", async () => {
    const mod = await freshNoiseModule();
    mod.initNoiseLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.015Z",
    });
    mod.noiseLogger.warn("HLS", "segment-stall", { seq: 42 });
    const lines = readAllLines(mod.getCurrentNoisePath());
    const warnLine = lines.find((l) => l.includes("[warn] [HLS] segment-stall"));
    expect(warnLine).toBeDefined();
    expect(warnLine).toMatch(/\[warn\] \[HLS\] segment-stall \{"seq":42\}$/);
  });

  it("drops debug calls when the configured level is `info`", async () => {
    const mod = await freshNoiseModule();
    mod.initNoiseLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.016Z",
      level: "info",
    });
    mod.noiseLogger.debug("HLS", "should-not-appear");
    mod.noiseLogger.info("HLS", "should-appear");
    const lines = readAllLines(mod.getCurrentNoisePath());
    expect(lines.some((l) => l.includes("should-not-appear"))).toBe(false);
    expect(lines.some((l) => l.includes("should-appear"))).toBe(true);
  });

  it("respects STREAMFUSION_NOISE_LOG_LEVEL=debug as an override of opts.level=info", async () => {
    vi.stubEnv("STREAMFUSION_NOISE_LOG_LEVEL", "debug");
    const mod = await freshNoiseModule();
    mod.initNoiseLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.017Z",
      level: "info",
    });
    mod.noiseLogger.debug("HLS", "debug-via-env");
    const lines = readAllLines(mod.getCurrentNoisePath());
    expect(lines.some((l) => l.includes("[debug] [HLS] debug-via-env"))).toBe(true);
  });

  it("ignores an invalid STREAMFUSION_NOISE_LOG_LEVEL value", async () => {
    vi.stubEnv("STREAMFUSION_NOISE_LOG_LEVEL", "wat");
    const mod = await freshNoiseModule();
    mod.initNoiseLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.018Z",
      level: "info",
    });
    mod.noiseLogger.debug("HLS", "should-not-appear");
    mod.noiseLogger.info("HLS", "should-appear");
    const lines = readAllLines(mod.getCurrentNoisePath());
    expect(lines.some((l) => l.includes("should-not-appear"))).toBe(false);
    expect(lines.some((l) => l.includes("should-appear"))).toBe(true);
  });

  it("throws a clear error when used before initNoiseLogger()", async () => {
    const mod = await freshNoiseModule();
    expect(() => mod.noiseLogger.info("HLS", "boom")).toThrow(/not initialized/i);
  });
});

// ---------------------------------------------------------------------------
// shutdownNoiseLogger
// ---------------------------------------------------------------------------

describe("shutdownNoiseLogger", () => {
  it("writes a noise footer line at the end of the session file", async () => {
    const mod = await freshNoiseModule();
    mod.initNoiseLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.019Z",
    });
    mod.noiseLogger.info("HLS", "before shutdown");
    await mod.shutdownNoiseLogger();
    const lines = readAllLines(mod.getCurrentNoisePath());
    const last = lines[lines.length - 1];
    expect(last).toMatch(/^=== Noise debug closed \S+ ===$/);
  });

  it("is idempotent — calling twice does not throw and does not write a duplicate footer", async () => {
    const mod = await freshNoiseModule();
    mod.initNoiseLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.020Z",
    });
    await mod.shutdownNoiseLogger();
    await mod.shutdownNoiseLogger();
    const lines = readAllLines(mod.getCurrentNoisePath());
    const footers = lines.filter((l) => l.startsWith("=== Noise debug closed "));
    expect(footers).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Isolation from the main logger — cross-contamination guard
// ---------------------------------------------------------------------------

describe("isolation from main logger", () => {
  it("writes to a different file than the main logger and they do not cross-contaminate", async () => {
    const { loggerMod, noiseMod } = await freshLoggerAndNoiseModules();
    const stamp = "2026-06-07T15:51:25.021Z";

    loggerMod.initLogger({ logsDir: currentTmpDir, sessionStamp: stamp });
    noiseMod.initNoiseLogger({ logsDir: currentTmpDir, sessionStamp: stamp });

    const mainPath = loggerMod.getCurrentLogPath();
    const noisePath = noiseMod.getCurrentNoisePath();

    expect(mainPath).not.toBe(noisePath);

    loggerMod.logger.info("Main", "main-only-line");
    noiseMod.noiseLogger.info("HLS", "noise-only-line");

    const mainLines = readAllLines(mainPath);
    const noiseLines = readAllLines(noisePath);

    // Main file has the main line but not the noise line.
    expect(mainLines.some((l) => l.includes("main-only-line"))).toBe(true);
    expect(mainLines.some((l) => l.includes("noise-only-line"))).toBe(false);

    // Noise file has the noise line but not the main line.
    expect(noiseLines.some((l) => l.includes("noise-only-line"))).toBe(true);
    expect(noiseLines.some((l) => l.includes("main-only-line"))).toBe(false);

    // Headers don't bleed across either.
    expect(mainLines.some((l) => l.startsWith("=== Noise debug started "))).toBe(false);
    expect(noiseLines.some((l) => l.startsWith("=== Debug started "))).toBe(false);
  });
});
