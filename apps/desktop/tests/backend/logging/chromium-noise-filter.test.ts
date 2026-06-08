/**
 * chromium-noise-filter.test.ts
 *
 * Guards the predicate that classifies known-harmless Chromium ERROR lines so
 * the logger pipeline can demote them from ERROR to DEBUG instead of letting
 * them pollute the session log. Also pins the integration touch points where
 * the tailer and native-stderr-intercept consume the predicate, since the
 * whole point of this filter is end-to-end demotion — not pure-function
 * matching in isolation. The dedicated chromium-log-tailer.test.ts and
 * native-stderr-intercept.test.ts pin the level-routing contract (ERROR /
 * WARNING / INFO / VERBOSE) but explicitly do NOT exercise the noise-filter
 * demotion path — that's owned here.
 *
 * Invariants pinned here:
 *   1. The exact IDCompositionDevice4 GPU-probe line from the bug report
 *      matches.
 *   2. The exact Autofill.enable -32601 DevTools CDP line matches.
 *   3. The Autofill.setAddresses variant matches.
 *   4. Real SSL handshake errors do NOT match — they must keep flowing to
 *      logger.error.
 *   5. Empty input does not match.
 *   6. Plain non-Chromium freeform text does not match.
 *   7. tailer: matched harmless ERROR lines route to logger.debug, NOT
 *      logger.error. (Owned here — chromium-log-tailer.test.ts pins ERROR /
 *      WARNING / INFO / VERBOSE level routing but does NOT exercise the
 *      noise-demotion path; deleting this invariant would lose coverage.)
 *   8. tailer: real SSL ERROR lines still route to logger.error.
 *   9. intercept: Autofill.enable -32601 written to process.stderr routes to
 *      logger.debug, NOT logger.error. (Owned here — native-stderr-intercept.test.ts
 *      similarly pins level routing only, not noise-demotion.)
 *
 * Verified 2026-06-08 (U20.c): grep of chromium-log-tailer.test.ts and
 * native-stderr-intercept.test.ts for noise/demote/harmless found no matches
 * in either file, so the dual-ownership concern called out in the U20.c brief
 * doesn't apply — invariants 7-9 are SOLELY owned here.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { isHarmlessChromiumNoise } from "@/backend/logging/chromium-noise-filter";

vi.mock("@/backend/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type LoggerMock = {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
};

type TailerModule = typeof import("@/backend/logging/chromium-log-tailer");
type InterceptModule = typeof import("@/backend/logging/native-stderr-intercept");

const POLL_MS = 50;
const WAIT_MS = 250;

async function pause(ms: number = WAIT_MS): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function freshTailer(): Promise<{ mod: TailerModule; logger: LoggerMock }> {
  vi.resetModules();
  const mod = await import("@/backend/logging/chromium-log-tailer");
  const { logger } = (await import("@/backend/logging/logger")) as unknown as {
    logger: LoggerMock;
  };
  logger.debug.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
  return { mod, logger };
}

async function freshIntercept(): Promise<{ mod: InterceptModule; logger: LoggerMock }> {
  vi.resetModules();
  const mod = await import("@/backend/logging/native-stderr-intercept");
  const { logger } = (await import("@/backend/logging/logger")) as unknown as {
    logger: LoggerMock;
  };
  logger.debug.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
  return { mod, logger };
}

describe("isHarmlessChromiumNoise — IDCompositionDevice4 GPU probe", () => {
  it("matches the exact IDCompositionDevice4 ERROR line from the bug report", () => {
    const line =
      "[26712:0607/155145.309:ERROR:direct_composition_support.cc(1122)] QueryInterface to IDCompositionDevice4 failed: No such interface supported (0x80004002)";
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });
});

describe("isHarmlessChromiumNoise — DevTools Autofill domain", () => {
  it("matches the exact Autofill.enable -32601 line from the bug report", () => {
    const line =
      '[26712:0607/155145.309:ERROR:CONSOLE(1)] "Request Autofill.enable failed. {"code":-32601,"message":"\'Autofill.enable\' wasn\'t found"}", source: devtools://devtools/bundled/core/protocol_client/protocol_client.js (1)';
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });

  it("matches the Autofill.setAddresses -32601 variant", () => {
    const line =
      '[26712:0607/155145.309:ERROR:CONSOLE(1)] "Request Autofill.setAddresses failed. {"code":-32601,"message":"\'Autofill.setAddresses\' wasn\'t found"}", source: devtools://devtools/bundled/core/protocol_client/protocol_client.js (1)';
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });
});

describe("isHarmlessChromiumNoise — must NOT swallow real errors", () => {
  it("does not match a real SSL handshake error", () => {
    const line =
      "[26712:0607/155145.309:ERROR:ssl_client_socket_impl.cc(877)] handshake failed; returned -1, SSL error code 1";
    expect(isHarmlessChromiumNoise(line)).toBe(false);
  });

  it("does not match an empty string", () => {
    expect(isHarmlessChromiumNoise("")).toBe(false);
  });

  it("does not match plain non-Chromium freeform text", () => {
    expect(isHarmlessChromiumNoise("Hello world, just some text")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: chromium-log-tailer demotes harmless ERROR lines
// ---------------------------------------------------------------------------

describe("chromium-log-tailer — noise demotion", () => {
  let tmpDir = "";
  let stopFns: Array<() => void> = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "streamfusion-noise-filter-test-"));
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
    await pause(80);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("demotes a harmless IDCompositionDevice4 ERROR line to logger.debug", async () => {
    const { mod, logger } = await freshTailer();
    const filePath = path.join(tmpDir, "chromium.log");
    await fsp.writeFile(filePath, "", "utf8");

    stopFns.push(mod.startChromiumLogTailer({ filePath, pollIntervalMs: POLL_MS }));

    const noiseLine =
      "[26712:0607/155145.309:ERROR:direct_composition_support.cc(1122)] QueryInterface to IDCompositionDevice4 failed: No such interface supported (0x80004002)";
    await fsp.appendFile(filePath, `${noiseLine}\n`, "utf8");
    await pause();

    expect(logger.debug).toHaveBeenCalledWith("Chromium", noiseLine);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("still routes a real ssl_client_socket_impl ERROR line to logger.error", async () => {
    const { mod, logger } = await freshTailer();
    const filePath = path.join(tmpDir, "chromium.log");
    await fsp.writeFile(filePath, "", "utf8");

    stopFns.push(mod.startChromiumLogTailer({ filePath, pollIntervalMs: POLL_MS }));

    const realErr =
      "[26712:0607/155145.309:ERROR:ssl_client_socket_impl.cc(877)] handshake failed; returned -1";
    await fsp.appendFile(filePath, `${realErr}\n`, "utf8");
    await pause();

    expect(logger.error).toHaveBeenCalledWith("Chromium", realErr);
  });
});

// ---------------------------------------------------------------------------
// Integration: native-stderr-intercept demotes harmless ERROR lines
// ---------------------------------------------------------------------------

describe("native-stderr-intercept — noise demotion", () => {
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
    process.stderr.write = realStderrWrite as typeof process.stderr.write;
    process.stdout.write = realStdoutWrite as typeof process.stdout.write;
  });

  it("demotes an Autofill.enable -32601 ERROR line written to stderr to logger.debug", async () => {
    const { mod, logger } = await freshIntercept();
    process.stderr.write = vi.fn().mockReturnValue(true) as unknown as typeof process.stderr.write;

    uninstallers.push(mod.installNativeStderrIntercept());
    const noiseLine =
      '[26712:0607/155145.309:ERROR:CONSOLE(1)] "Request Autofill.enable failed. {"code":-32601,"message":"\'Autofill.enable\' wasn\'t found"}", source: devtools://devtools/bundled/core/protocol_client/protocol_client.js (1)';
    process.stderr.write(`${noiseLine}\n`);

    expect(logger.debug).toHaveBeenCalledWith("Chromium", noiseLine);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
