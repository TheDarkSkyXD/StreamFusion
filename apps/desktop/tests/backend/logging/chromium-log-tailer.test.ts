/**
 * chromium-log-tailer.test.ts
 *
 * Guards the file-tailer that mirrors Chromium's native `--enable-logging=file`
 * output into our main session log via the project logger.
 *
 * Invariants pinned here:
 *   1. New ERROR / WARNING / INFO / VERBOSE lines route to the matching logger
 *      level under the "Chromium" tag.
 *   2. Lines that don't carry the Chromium structured prefix are dropped.
 *   3. File truncation (curr.size < lastSize) is detected — the tailer
 *      re-reads from the top.
 *   4. Partial lines (no trailing newline) are buffered, not emitted, until
 *      the rest arrives.
 *   5. Stop is idempotent — calling the returned fn twice is safe and
 *      a subsequent append does NOT produce more logger calls.
 *
 * Timing strategy: vitest fake timers do NOT drive `fs.watchFile`'s native
 * polling. We use real timers with a small pollIntervalMs and short `await`
 * pauses to let the OS fire the watcher between writes.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@backend/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type TailerModule = typeof import("@backend/logging/chromium-log-tailer");
type LoggerMock = {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
};

const POLL_MS = 50;
const WAIT_MS = 250;

async function freshTailer(): Promise<{ mod: TailerModule; logger: LoggerMock }> {
  vi.resetModules();
  const mod = await import("@backend/logging/chromium-log-tailer");
  const { logger } = (await import("@backend/logging/logger")) as unknown as {
    logger: LoggerMock;
  };
  logger.debug.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
  return { mod, logger };
}

async function pause(ms: number = WAIT_MS): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

let tmpDir = "";
let stopFns: Array<() => void> = [];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "streamfusion-chromium-tailer-test-"));
  stopFns = [];
});

afterEach(async () => {
  for (const stop of stopFns) {
    try {
      stop();
    } catch {
      // best-effort
    }
  }
  // Let watchFile finish unregistering before nuking the dir, otherwise
  // Windows occasionally hangs on EBUSY.
  await pause(80);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// Chromium prefix routing
// ---------------------------------------------------------------------------

describe("startChromiumLogTailer — Chromium prefix routing", () => {
  it("routes an ERROR-level Chromium line appended to the file to logger.error", async () => {
    const { mod, logger } = await freshTailer();
    const filePath = path.join(tmpDir, "chromium.log");
    await fsp.writeFile(filePath, "", "utf8");

    stopFns.push(mod.startChromiumLogTailer({ filePath, pollIntervalMs: POLL_MS }));

    await fsp.appendFile(
      filePath,
      "[26712:0607/155145.309:ERROR:CONSOLE(1)] handshake failed\n",
      "utf8"
    );
    await pause();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Chromium",
      "[26712:0607/155145.309:ERROR:CONSOLE(1)] handshake failed"
    );
  });

  it("routes WARNING/INFO/VERBOSE lines to warn/info/debug", async () => {
    const { mod, logger } = await freshTailer();
    const filePath = path.join(tmpDir, "chromium.log");
    await fsp.writeFile(filePath, "", "utf8");

    stopFns.push(mod.startChromiumLogTailer({ filePath, pollIntervalMs: POLL_MS }));

    await fsp.appendFile(
      filePath,
      [
        "[1:0607/155145.309:WARNING:foo.cc(123)] noisy",
        "[1:0607/155145.310:INFO:foo.cc(123)] startup",
        "[1:0607/155145.311:VERBOSE:foo.cc(123)] chatter",
        "",
      ].join("\n"),
      "utf8"
    );

    await vi.waitFor(
      () => {
        expect(logger.warn).toHaveBeenCalledWith(
          "Chromium",
          "[1:0607/155145.309:WARNING:foo.cc(123)] noisy"
        );
        expect(logger.info).toHaveBeenCalledWith(
          "Chromium",
          "[1:0607/155145.310:INFO:foo.cc(123)] startup"
        );
        expect(logger.debug).toHaveBeenCalledWith(
          "Chromium",
          "[1:0607/155145.311:VERBOSE:foo.cc(123)] chatter"
        );
      },
      { interval: POLL_MS, timeout: 2_000 }
    );
  });
});

// ---------------------------------------------------------------------------
// Non-prefixed lines are dropped
// ---------------------------------------------------------------------------

describe("startChromiumLogTailer — non-Chromium lines are dropped", () => {
  it("does not emit logger calls for lines without the Chromium prefix", async () => {
    const { mod, logger } = await freshTailer();
    const filePath = path.join(tmpDir, "chromium.log");
    await fsp.writeFile(filePath, "", "utf8");

    stopFns.push(mod.startChromiumLogTailer({ filePath, pollIntervalMs: POLL_MS }));

    await fsp.appendFile(filePath, "Chromium starting up...\nrandom metadata\n", "utf8");
    await pause();

    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Truncation handling
// ---------------------------------------------------------------------------

describe("startChromiumLogTailer — truncation handling", () => {
  it("handles file truncation (replace contents, smaller size) by re-reading from the top", async () => {
    const { mod, logger } = await freshTailer();
    const filePath = path.join(tmpDir, "chromium.log");
    // Pre-seed with a long line so the initial size is large.
    const initial = `${"x".repeat(500)}\n[1:0607/155145.309:INFO:foo.cc(123)] first\n`;
    await fsp.writeFile(filePath, initial, "utf8");

    stopFns.push(mod.startChromiumLogTailer({ filePath, pollIntervalMs: POLL_MS }));
    // Let the tailer record the initial size without emitting anything for
    // pre-existing content. Behavior contract: on first observation, the
    // tailer treats the existing size as its baseline so the historical
    // tail isn't replayed.
    await pause();
    logger.info.mockReset();

    // Now truncate and rewrite a SHORTER file with a fresh ERROR line. The
    // new size is smaller, which signals truncation to the tailer.
    const replacement = "[1:0607/155146.000:ERROR:bar.cc(1)] after truncate\n";
    expect(replacement.length).toBeLessThan(initial.length);
    await fsp.writeFile(filePath, replacement, "utf8");
    await pause();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Chromium",
      "[1:0607/155146.000:ERROR:bar.cc(1)] after truncate"
    );
  });
});

// ---------------------------------------------------------------------------
// Partial lines (no trailing newline)
// ---------------------------------------------------------------------------

describe("startChromiumLogTailer — partial line buffering", () => {
  it("buffers an incomplete line and emits only after the newline arrives", async () => {
    const { mod, logger } = await freshTailer();
    const filePath = path.join(tmpDir, "chromium.log");
    await fsp.writeFile(filePath, "", "utf8");

    stopFns.push(mod.startChromiumLogTailer({ filePath, pollIntervalMs: POLL_MS }));

    // Append the first half of a Chromium ERROR line WITHOUT a trailing
    // newline. The tailer must not emit yet.
    await fsp.appendFile(filePath, "[1:0607/155145.309:ERROR:foo.cc(123)] split ", "utf8");
    await pause();
    expect(logger.error).not.toHaveBeenCalled();

    // Append the rest including the newline. Now the buffered partial + the
    // remainder combine into a single completed line.
    await fsp.appendFile(filePath, "across writes\n", "utf8");
    await pause();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Chromium",
      "[1:0607/155145.309:ERROR:foo.cc(123)] split across writes"
    );
  });
});

// ---------------------------------------------------------------------------
// Stop is idempotent
// ---------------------------------------------------------------------------

describe("startChromiumLogTailer — lifecycle", () => {
  it("stop is idempotent — calling it twice does not throw and prevents further emissions", async () => {
    const { mod, logger } = await freshTailer();
    const filePath = path.join(tmpDir, "chromium.log");
    await fsp.writeFile(filePath, "", "utf8");

    const stop = mod.startChromiumLogTailer({ filePath, pollIntervalMs: POLL_MS });

    // First stop releases the watcher.
    expect(() => stop()).not.toThrow();
    // Second stop must be a no-op.
    expect(() => stop()).not.toThrow();

    // Reset counters and confirm a subsequent append produces nothing — the
    // watcher is no longer listening.
    logger.error.mockReset();
    await fsp.appendFile(filePath, "[1:0607/155145.309:ERROR:foo.cc(123)] after-stop\n", "utf8");
    await pause();

    expect(logger.error).not.toHaveBeenCalled();
  });
});
