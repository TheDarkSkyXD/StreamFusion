/**
 * logger.test.ts
 *
 * Guards the Valo-style main-process logger:
 *
 *   - `formatLine` is a pure formatter — every observable property (timestamp
 *     position, level rendering, tag rendering, optional meta JSON tail) is
 *     pinned here so downstream tag/meta migrations cannot silently drift.
 *   - The singleton lifecycle (`initLogger` / `logger` / `getCurrentLogPath` /
 *     `shutdownLogger`) is exercised through real filesystem writes so we know
 *     electron-log's transport actually flushes the formatted line, the session
 *     header lands as the first file line, and the shutdown footer lands as
 *     the last.
 *   - Behavioral invariants: idempotency of init+shutdown, "use before init"
 *     fail-fast, and the `STREAMFUSION_LOG_LEVEL` env override.
 *
 * Electron is mocked so electron-log's path/appName lookups don't need a real
 * Electron runtime. The resolvePathFn override the production code installs
 * means electron-log never actually consults those lookups for our session
 * file, but the mock keeps any incidental access cheap and predictable.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("@/backend/logging/logger");

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

// Imported lazily inside helpers so each test can call resetModules() and get
// a fresh singleton.
type LoggerModule = typeof import("@/backend/logging/logger");

async function freshLoggerModule(): Promise<LoggerModule> {
  vi.resetModules();
  return await import("@/backend/logging/logger");
}

let currentTmpDir = "";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "streamfusion-loggertest-"));
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
// formatLine — pure formatter
// ---------------------------------------------------------------------------

describe("formatLine", () => {
  it("produces `[ts] [info] [Tag] message` for an info call", async () => {
    const { formatLine } = await freshLoggerModule();
    const line = formatLine({
      timestamp: "2026-06-07T15:51:25.014Z",
      level: "info",
      tag: "Main",
      message: "App ready - paths and debug initialized",
    });
    expect(line).toBe(
      "[2026-06-07T15:51:25.014Z] [info] [Main] App ready - paths and debug initialized"
    );
  });

  it("produces the right line for debug / warn / error too", async () => {
    const { formatLine } = await freshLoggerModule();
    const ts = "2026-06-07T15:51:25.014Z";
    expect(formatLine({ timestamp: ts, level: "debug", tag: "T", message: "m" })).toBe(
      "[2026-06-07T15:51:25.014Z] [debug] [T] m"
    );
    expect(formatLine({ timestamp: ts, level: "warn", tag: "T", message: "m" })).toBe(
      "[2026-06-07T15:51:25.014Z] [warn] [T] m"
    );
    expect(formatLine({ timestamp: ts, level: "error", tag: "T", message: "m" })).toBe(
      "[2026-06-07T15:51:25.014Z] [error] [T] m"
    );
  });

  it("appends a single space and JSON.stringify(meta) when meta is provided", async () => {
    const { formatLine } = await freshLoggerModule();
    const line = formatLine({
      timestamp: "2026-06-07T15:51:25.014Z",
      level: "info",
      tag: "Auth",
      message: "token refreshed",
      meta: { userId: "u1", attempts: 2 },
    });
    expect(line).toBe(
      '[2026-06-07T15:51:25.014Z] [info] [Auth] token refreshed {"userId":"u1","attempts":2}'
    );
  });

  it("omits the meta tail entirely when meta is undefined", async () => {
    const { formatLine } = await freshLoggerModule();
    const line = formatLine({
      timestamp: "2026-06-07T15:51:25.014Z",
      level: "info",
      tag: "Main",
      message: "boot",
    });
    expect(line.endsWith("boot")).toBe(true);
    expect(line).not.toContain("{");
  });

  it("preserves a tag string verbatim, even when it contains brackets or punctuation", async () => {
    const { formatLine } = await freshLoggerModule();
    const line = formatLine({
      timestamp: "2026-06-07T15:51:25.014Z",
      level: "info",
      tag: "Twitch:EventSub[ws]",
      message: "connected",
    });
    expect(line).toBe("[2026-06-07T15:51:25.014Z] [info] [Twitch:EventSub[ws]] connected");
  });
});

// ---------------------------------------------------------------------------
// initLogger + getCurrentLogPath
// ---------------------------------------------------------------------------

describe("initLogger + getCurrentLogPath", () => {
  it("computes the file path from sessionStamp by replacing `:` with `-`", async () => {
    const mod = await freshLoggerModule();
    const stamp = "2026-06-07T15:51:25.011Z";
    mod.initLogger({ logsDir: currentTmpDir, sessionStamp: stamp });
    const got = mod.getCurrentLogPath();
    expect(got).toBe(path.join(currentTmpDir, "streamfusion-2026-06-07T15-51-25-011Z.log"));
  });

  it("creates the logsDir if it does not exist", async () => {
    const mod = await freshLoggerModule();
    const nested = path.join(currentTmpDir, "deep", "logs");
    expect(fs.existsSync(nested)).toBe(false);
    mod.initLogger({
      logsDir: nested,
      sessionStamp: "2026-06-07T15:51:25.011Z",
    });
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("writes a session header as the FIRST line of the file", async () => {
    const mod = await freshLoggerModule();
    const stamp = "2026-06-07T15:51:25.012Z";
    mod.initLogger({ logsDir: currentTmpDir, sessionStamp: stamp, level: "info" });
    const file = mod.getCurrentLogPath();
    const lines = readAllLines(file);
    expect(lines[0]).toBe(`=== Debug started ${stamp} (level=info) ===`);
  });

  it("is idempotent — a second call with identical opts does not throw and does not duplicate the header", async () => {
    const mod = await freshLoggerModule();
    const stamp = "2026-06-07T15:51:25.013Z";
    const opts = { logsDir: currentTmpDir, sessionStamp: stamp };
    expect(() => mod.initLogger(opts)).not.toThrow();
    expect(() => mod.initLogger(opts)).not.toThrow();
    const lines = readAllLines(mod.getCurrentLogPath());
    const headers = lines.filter((l) => l.startsWith("=== Debug started "));
    expect(headers).toHaveLength(1);
  });

  it("getCurrentLogPath throws a clear error when the logger has not been initialized", async () => {
    const mod = await freshLoggerModule();
    expect(() => mod.getCurrentLogPath()).toThrow(/not initialized/i);
  });

  it("writes streamfusion-current.log.path containing the active log path", async () => {
    const mod = await freshLoggerModule();
    const stamp = "2026-06-07T15:51:25.022Z";
    mod.initLogger({ logsDir: currentTmpDir, sessionStamp: stamp });
    const pointer = path.join(currentTmpDir, "streamfusion-current.log.path");
    expect(fs.existsSync(pointer)).toBe(true);
    const contents = fs.readFileSync(pointer, "utf8");
    expect(contents).toBe(mod.getCurrentLogPath());
    // No trailing newline — one line, exactly.
    expect(contents.endsWith("\n")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// logger.<level> — end-to-end file writes
// ---------------------------------------------------------------------------

// Guards: routine app info and warnings remain durable without obscuring terminal errors
// Guards: console interception cannot bypass the main logger's error-only terminal transport
// Guards: debug thresholds and structured metadata remain file-side concerns
describe("logger.<level>", () => {
  it("writes info and warn only to the file while error also reaches the terminal", async () => {
    const originalWrite = process.stderr.write;
    const terminalWrite = vi.fn().mockReturnValue(true);
    process.stderr.write = terminalWrite as unknown as typeof process.stderr.write;

    try {
      const mod = await freshLoggerModule();
      mod.initLogger({
        logsDir: currentTmpDir,
        sessionStamp: "2026-06-07T15:51:25.023Z",
      });
      mod.logger.info("Main", "routine context");
      mod.logger.warn("Main", "recoverable warning");
      mod.logger.error("Main", "actionable failure");

      const terminalOutput = terminalWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(terminalOutput).not.toContain("routine context");
      expect(terminalOutput).not.toContain("recoverable warning");
      expect(terminalOutput).toContain("[error] [Main] actionable failure");

      const fileOutput = fs.readFileSync(mod.getCurrentLogPath(), "utf8");
      expect(fileOutput).toContain("[info] [Main] routine context");
      expect(fileOutput).toContain("[warn] [Main] recoverable warning");
      expect(fileOutput).toContain("[error] [Main] actionable failure");
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("writes debug only when the file level allows it and never to the terminal", async () => {
    const originalWrite = process.stderr.write;
    const terminalWrite = vi.fn().mockReturnValue(true);
    process.stderr.write = terminalWrite as unknown as typeof process.stderr.write;

    try {
      const mod = await freshLoggerModule();
      mod.initLogger({
        logsDir: currentTmpDir,
        sessionStamp: "2026-06-07T15:51:25.024Z",
        level: "debug",
      });
      mod.logger.debug("Main", "diagnostic detail");

      expect(terminalWrite).not.toHaveBeenCalled();
      expect(fs.readFileSync(mod.getCurrentLogPath(), "utf8")).toContain(
        "[debug] [Main] diagnostic detail"
      );
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("preserves pre-redacted structured metadata in the file and registered sinks", async () => {
    const mod = await freshLoggerModule();
    mod.initLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.025Z",
    });
    const meta = {
      authorization: "[REDACTED]",
      request: { status: 429, retryable: true },
    };
    const sink = vi.fn();
    const removeSink = mod.addLogSink(sink);

    mod.logger.warn("Network:Request", "retry scheduled", meta);
    removeSink();

    expect(fs.readFileSync(mod.getCurrentLogPath(), "utf8")).toContain(
      '[warn] [Network:Request] retry scheduled {"authorization":"[REDACTED]","request":{"status":429,"retryable":true}}'
    );
    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0]?.[0]).toMatchObject({
      level: "warn",
      tag: "Network:Request",
      message: "retry scheduled",
      meta,
    });
  });

  it("keeps an intercepted console.warn in the file and out of the terminal", async () => {
    const originalWrite = process.stderr.write;
    const terminalWrite = vi.fn().mockReturnValue(true);
    process.stderr.write = terminalWrite as unknown as typeof process.stderr.write;
    let uninstall = (): void => undefined;

    try {
      const mod = await freshLoggerModule();
      mod.initLogger({
        logsDir: currentTmpDir,
        sessionStamp: "2026-06-07T15:51:25.026Z",
      });
      const { installConsoleIntercept } = await import("@/backend/logging/console-intercept");
      uninstall = installConsoleIntercept();
      console.warn("intercepted warning");

      expect(terminalWrite).not.toHaveBeenCalled();
      expect(fs.readFileSync(mod.getCurrentLogPath(), "utf8")).toContain(
        "[warn] [console] intercepted warning"
      );
    } finally {
      uninstall();
      process.stderr.write = originalWrite;
    }
  });

  it("writes a formatted info line to the session file", async () => {
    const mod = await freshLoggerModule();
    mod.initLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.014Z",
    });
    mod.logger.info("Main", "hello");
    const lines = readAllLines(mod.getCurrentLogPath());
    const infoLine = lines.find((l) => l.includes("[info] [Main] hello"));
    expect(infoLine).toBeDefined();
    expect(infoLine).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[info\] \[Main\] hello$/
    );
  });

  it("appends meta JSON when provided", async () => {
    const mod = await freshLoggerModule();
    mod.initLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.015Z",
    });
    mod.logger.warn("Auth", "retry", { attempt: 3 });
    const lines = readAllLines(mod.getCurrentLogPath());
    const warnLine = lines.find((l) => l.includes("[warn] [Auth] retry"));
    expect(warnLine).toBeDefined();
    expect(warnLine).toMatch(/\[warn\] \[Auth\] retry \{"attempt":3\}$/);
  });

  it("drops debug calls when the configured level is `info`", async () => {
    const mod = await freshLoggerModule();
    mod.initLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.016Z",
      level: "info",
    });
    mod.logger.debug("Main", "should-not-appear");
    mod.logger.info("Main", "should-appear");
    const lines = readAllLines(mod.getCurrentLogPath());
    expect(lines.some((l) => l.includes("should-not-appear"))).toBe(false);
    expect(lines.some((l) => l.includes("should-appear"))).toBe(true);
  });

  it("respects STREAMFUSION_LOG_LEVEL=debug as an override of opts.level=info", async () => {
    vi.stubEnv("STREAMFUSION_LOG_LEVEL", "debug");
    const mod = await freshLoggerModule();
    mod.initLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.017Z",
      level: "info",
    });
    mod.logger.debug("Main", "debug-via-env");
    const lines = readAllLines(mod.getCurrentLogPath());
    expect(lines.some((l) => l.includes("[debug] [Main] debug-via-env"))).toBe(true);
  });

  it("ignores an invalid STREAMFUSION_LOG_LEVEL value", async () => {
    vi.stubEnv("STREAMFUSION_LOG_LEVEL", "wat");
    const mod = await freshLoggerModule();
    mod.initLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.018Z",
      level: "info",
    });
    mod.logger.debug("Main", "should-not-appear");
    mod.logger.info("Main", "should-appear");
    const lines = readAllLines(mod.getCurrentLogPath());
    expect(lines.some((l) => l.includes("should-not-appear"))).toBe(false);
    expect(lines.some((l) => l.includes("should-appear"))).toBe(true);
  });

  it("throws a clear error when used before initLogger()", async () => {
    const mod = await freshLoggerModule();
    expect(() => mod.logger.info("Main", "boom")).toThrow(/not initialized/i);
  });
});

// ---------------------------------------------------------------------------
// shutdownLogger
// ---------------------------------------------------------------------------

describe("shutdownLogger", () => {
  it("writes a footer line at the end of the session file", async () => {
    const mod = await freshLoggerModule();
    mod.initLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.019Z",
    });
    mod.logger.info("Main", "before shutdown");
    await mod.shutdownLogger();
    const lines = readAllLines(mod.getCurrentLogPath());
    const last = lines[lines.length - 1];
    expect(last).toMatch(/^=== Debug closed \S+ ===$/);
  });

  it("is idempotent — calling twice does not throw and does not write a duplicate footer", async () => {
    const mod = await freshLoggerModule();
    mod.initLogger({
      logsDir: currentTmpDir,
      sessionStamp: "2026-06-07T15:51:25.020Z",
    });
    await mod.shutdownLogger();
    await mod.shutdownLogger();
    const lines = readAllLines(mod.getCurrentLogPath());
    const footers = lines.filter((l) => l.startsWith("=== Debug closed "));
    expect(footers).toHaveLength(1);
  });
});
