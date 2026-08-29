/**
 * native-stderr-intercept.test.ts
 *
 * Guards the main-process patch of `process.stderr.write` and
 * `process.stdout.write` that captures lines emitted directly by Chromium /
 * Electron native code (which bypass the JS-level `console.*` intercept).
 *
 * Invariants pinned here:
 *   1. Chromium's structured prefix `[pid:date/time:LEVEL:...]` routes to the
 *      matching logger level with the "Chromium" tag.
 *   2. Plain text lines fall through to `logger.info(tag, line)` so output
 *      is never silently dropped.
 *   3. Multi-line chunks emit one logger call per non-empty line.
 *   4. Structured Chromium output is owned by the logger so warnings stay
 *      file-only and errors are not duplicated; unstructured process output
 *      still passes through to the original writer.
 *   5. Uninstall restores the original `process.stderr.write` /
 *      `process.stdout.write` references.
 *   6. Recursion guard: when the logger itself writes to stderr (via
 *      electron-log's console transport), the patched writer skips the
 *      logger call to prevent an infinite loop.
 *   7. Install is idempotent — calling twice returns a single uninstall.
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@backend/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type InterceptModule = typeof import("@backend/logging/native-stderr-intercept");
type LoggerMock = {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
};

async function freshIntercept(): Promise<{
  mod: InterceptModule;
  logger: LoggerMock;
}> {
  vi.resetModules();
  const mod = await import("@backend/logging/native-stderr-intercept");
  const { logger } = (await import("@backend/logging/logger")) as unknown as {
    logger: LoggerMock;
  };
  logger.debug.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
  return { mod, logger };
}

// Snapshot the real writers once so any test that scribbles on them can put
// the system back the way it found it.
const realStderrWrite = process.stderr.write.bind(process.stderr);
const realStdoutWrite = process.stdout.write.bind(process.stdout);

let uninstallers: Array<() => void> = [];

beforeEach(() => {
  uninstallers = [];
});

afterEach(() => {
  for (const u of uninstallers) {
    try {
      u();
    } catch {
      // best-effort
    }
  }
  // Defensive reset
  process.stderr.write = realStderrWrite as typeof process.stderr.write;
  process.stdout.write = realStdoutWrite as typeof process.stdout.write;
});

// ---------------------------------------------------------------------------
// Chromium prefix routing
// ---------------------------------------------------------------------------

// Guards: structured Chromium levels route through the logger without bypassing its terminal filter
describe("installNativeStderrIntercept — Chromium prefix routing", () => {
  it("routes ERROR-level Chromium lines to logger.error with the 'Chromium' tag", async () => {
    const { mod, logger } = await freshIntercept();
    const stderrSpy = vi.fn().mockReturnValue(true);
    process.stderr.write = stderrSpy as unknown as typeof process.stderr.write;

    uninstallers.push(mod.installNativeStderrIntercept());
    process.stderr.write(
      '[26712:0607/155145.309:ERROR:CONSOLE(1)] "Request Autofill.enable failed"\n'
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Chromium",
      '[26712:0607/155145.309:ERROR:CONSOLE(1)] "Request Autofill.enable failed"'
    );
  });

  it("prints a structured Chromium error once through the logger", async () => {
    const { mod, logger } = await freshIntercept();
    const stderrSpy = vi.fn().mockReturnValue(true);
    process.stderr.write = stderrSpy as unknown as typeof process.stderr.write;
    logger.error.mockImplementation(() => {
      process.stderr.write("[formatted logger error]\n");
    });

    uninstallers.push(mod.installNativeStderrIntercept());
    process.stderr.write("[1:0607/155145.309:ERROR:foo.cc(123)] native failure\n");

    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stderrSpy).toHaveBeenCalledWith("[formatted logger error]\n");
  });

  it("routes WARNING-level Chromium lines to logger.warn", async () => {
    const { mod, logger } = await freshIntercept();
    const stderrSpy = vi.fn().mockReturnValue(true);
    process.stderr.write = stderrSpy as unknown as typeof process.stderr.write;

    uninstallers.push(mod.installNativeStderrIntercept());
    process.stderr.write("[1:0607/155145.309:WARNING:foo.cc(123)] something noisy\n");

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Chromium",
      "[1:0607/155145.309:WARNING:foo.cc(123)] something noisy"
    );
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("routes INFO-level Chromium lines to logger.info", async () => {
    const { mod, logger } = await freshIntercept();
    process.stderr.write = vi.fn().mockReturnValue(true) as unknown as typeof process.stderr.write;

    uninstallers.push(mod.installNativeStderrIntercept());
    process.stderr.write("[1:0607/155145.309:INFO:foo.cc(123)] startup\n");

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "Chromium",
      "[1:0607/155145.309:INFO:foo.cc(123)] startup"
    );
  });

  it("routes VERBOSE-level Chromium lines to logger.debug", async () => {
    const { mod, logger } = await freshIntercept();
    process.stderr.write = vi.fn().mockReturnValue(true) as unknown as typeof process.stderr.write;

    uninstallers.push(mod.installNativeStderrIntercept());
    process.stderr.write("[1:0607/155145.309:VERBOSE:foo.cc(123)] chatter\n");

    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith(
      "Chromium",
      "[1:0607/155145.309:VERBOSE:foo.cc(123)] chatter"
    );
  });
});

// ---------------------------------------------------------------------------
// Plain text fallthrough
// ---------------------------------------------------------------------------

describe("installNativeStderrIntercept — plain text fallthrough", () => {
  it("routes a plain non-prefixed line to logger.info with the default tag", async () => {
    const { mod, logger } = await freshIntercept();
    process.stderr.write = vi.fn().mockReturnValue(true) as unknown as typeof process.stderr.write;

    uninstallers.push(mod.installNativeStderrIntercept());
    process.stderr.write("hello\n");

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("Chromium", "hello");
  });

  it("uses a custom tag from opts.tag when provided", async () => {
    const { mod, logger } = await freshIntercept();
    process.stderr.write = vi.fn().mockReturnValue(true) as unknown as typeof process.stderr.write;

    uninstallers.push(mod.installNativeStderrIntercept({ tag: "native" }));
    process.stderr.write("hello\n");

    expect(logger.info).toHaveBeenCalledWith("native", "hello");
  });

  it("decodes Buffer chunks as utf8 before routing", async () => {
    const { mod, logger } = await freshIntercept();
    process.stderr.write = vi.fn().mockReturnValue(true) as unknown as typeof process.stderr.write;

    uninstallers.push(mod.installNativeStderrIntercept());
    process.stderr.write(Buffer.from("buffered hello\n", "utf8"));

    expect(logger.info).toHaveBeenCalledWith("Chromium", "buffered hello");
  });

  it("does not re-route StreamFusion formatted log lines", async () => {
    const { mod, logger } = await freshIntercept();
    process.stderr.write = vi.fn().mockReturnValue(true) as unknown as typeof process.stderr.write;

    uninstallers.push(mod.installNativeStderrIntercept());
    process.stderr.write("[2026-06-08T16:52:04.684Z] [info] [Main] Logging initialized\n");

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("skips empty chunks", async () => {
    const { mod, logger } = await freshIntercept();
    process.stderr.write = vi.fn().mockReturnValue(true) as unknown as typeof process.stderr.write;

    uninstallers.push(mod.installNativeStderrIntercept());
    process.stderr.write("");
    process.stderr.write("\n");
    process.stderr.write("   \n");

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Multi-line chunks
// ---------------------------------------------------------------------------

// Guards: mixed native chunks preserve ordinary process output while filtering structured Chromium noise
describe("installNativeStderrIntercept — multi-line chunks", () => {
  it("emits one logger call per non-empty line in a multi-line chunk", async () => {
    const { mod, logger } = await freshIntercept();
    process.stderr.write = vi.fn().mockReturnValue(true) as unknown as typeof process.stderr.write;

    uninstallers.push(mod.installNativeStderrIntercept());
    process.stderr.write(
      "[1:0607/155145.309:ERROR:foo.cc(123)] first\nsecond plain line\n[1:0607/155146.000:WARNING:foo.cc(123)] third\n"
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    expect(logger.error).toHaveBeenCalledWith(
      "Chromium",
      "[1:0607/155145.309:ERROR:foo.cc(123)] first"
    );
    expect(logger.info).toHaveBeenCalledWith("Chromium", "second plain line");
    expect(logger.warn).toHaveBeenCalledWith(
      "Chromium",
      "[1:0607/155146.000:WARNING:foo.cc(123)] third"
    );
  });

  it("passes through unstructured output from a mixed chunk without leaking Chromium warnings", async () => {
    const { mod } = await freshIntercept();
    const stderrSpy = vi.fn().mockReturnValue(true);
    process.stderr.write = stderrSpy as unknown as typeof process.stderr.write;

    uninstallers.push(mod.installNativeStderrIntercept());
    process.stderr.write(
      "[1:0607/155146.000:WARNING:foo.cc(123)] Chromium warning\nvite startup ready\n"
    );

    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stderrSpy).toHaveBeenCalledWith("vite startup ready\n");
  });
});

// ---------------------------------------------------------------------------
// Unstructured output passes through to the original writer
// ---------------------------------------------------------------------------

// Guards: npm, Vite, Electron, and other unstructured output remains visible outside the app logger
describe("installNativeStderrIntercept — pass-through to original writer", () => {
  it("calls the original stderr.write with the original chunk so terminal output is preserved", async () => {
    const { mod } = await freshIntercept();
    const stderrSpy = vi.fn().mockReturnValue(true);
    process.stderr.write = stderrSpy as unknown as typeof process.stderr.write;

    uninstallers.push(mod.installNativeStderrIntercept());
    process.stderr.write("hello\n");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith("hello\n");
  });

  it("calls the original stdout.write with the original chunk", async () => {
    const { mod } = await freshIntercept();
    const stdoutSpy = vi.fn().mockReturnValue(true);
    process.stdout.write = stdoutSpy as unknown as typeof process.stdout.write;

    uninstallers.push(mod.installNativeStderrIntercept());
    process.stdout.write("stdout hello\n");

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).toHaveBeenCalledWith("stdout hello\n");
  });
});

// ---------------------------------------------------------------------------
// Uninstall + idempotent install
// ---------------------------------------------------------------------------

describe("installNativeStderrIntercept — lifecycle", () => {
  it("uninstall restores the exact pre-install writer references", async () => {
    const { mod } = await freshIntercept();
    const stderrBefore = process.stderr.write;
    const stdoutBefore = process.stdout.write;

    const uninstall = mod.installNativeStderrIntercept();
    expect(process.stderr.write).not.toBe(stderrBefore);
    expect(process.stdout.write).not.toBe(stdoutBefore);

    uninstall();
    expect(process.stderr.write).toBe(stderrBefore);
    expect(process.stdout.write).toBe(stdoutBefore);
  });

  it("install is idempotent — a second install does NOT re-patch", async () => {
    const { mod, logger } = await freshIntercept();
    process.stderr.write = vi.fn().mockReturnValue(true) as unknown as typeof process.stderr.write;

    const firstUninstall = mod.installNativeStderrIntercept();
    const afterFirst = process.stderr.write;
    const secondUninstall = mod.installNativeStderrIntercept();
    expect(process.stderr.write).toBe(afterFirst);

    firstUninstall();
    expect(() => secondUninstall()).not.toThrow();

    // After restore, no logger calls for subsequent writes.
    logger.info.mockReset();
    process.stderr.write("not-intercepted\n");
    expect(logger.info).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Recursion guard — logger itself writes to stderr (via electron-log)
// ---------------------------------------------------------------------------

describe("installNativeStderrIntercept — recursion guard", () => {
  it("does not recurse when the logger triggers a nested stderr write", async () => {
    const { mod, logger } = await freshIntercept();
    const stderrSpy = vi.fn().mockReturnValue(true);
    process.stderr.write = stderrSpy as unknown as typeof process.stderr.write;

    uninstallers.push(mod.installNativeStderrIntercept());

    // Simulate electron-log's console transport: every logger call writes
    // back to process.stderr. Without the guard, this would loop forever.
    logger.info.mockImplementation(() => {
      process.stderr.write("[logger-emitted line]\n");
    });

    process.stderr.write("triggering\n");

    // Only ONE logger.info call — the nested write must NOT re-enter the
    // logger path.
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("Chromium", "triggering");
  });
});
