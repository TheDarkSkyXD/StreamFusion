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
 *   4. Chromium disk-cache metadata repair, hostless net_error -101
 *      connection resets, and VizNullHypothesis "not a warning" lines match.
 *   5. Certificate-authority SSL failures do NOT match — they must keep
 *      flowing to logger.error.
 *   6. Empty input does not match.
 *   7. Plain non-Chromium freeform text does not match.
 *   8. tailer: matched harmless ERROR lines route to logger.debug, NOT
 *      logger.error. (Owned here — chromium-log-tailer.test.ts pins ERROR /
 *      WARNING / INFO / VERBOSE level routing but does NOT exercise the
 *      noise-demotion path; deleting this invariant would lose coverage.)
 *   9. tailer: certificate-authority SSL ERROR lines still route to logger.error.
 *   10. intercept: Autofill.enable -32601 written to process.stderr routes to
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

const POLL_MS = 20;
const WAIT_MS = 120;

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

describe("isHarmlessChromiumNoise — SharedImageManager mailbox miss", () => {
  it("matches the exact SharedImageManager ProduceSkia ERROR line from the bug report", () => {
    const line =
      "[54552:0608/192841.367:ERROR:shared_image_manager.cc(401)] SharedImageManager::ProduceSkia: Trying to Produce a Skia representation from a non-existent mailbox.";
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });
});

describe("isHarmlessChromiumNoise — Chromium cache metadata repair", () => {
  it("matches the exact invalid current cache-size ERROR line from the bug report", () => {
    const line = "[33224:0608/215341.464:ERROR:backend_impl.cc(1908)] Invalid cache (current) size";
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });

  it("matches Chromium's colon-formatted invalid cache-size line", () => {
    const line =
      "[62724:0823/172215.893:ERROR:net\\disk_cache\\blockfile\\backend_impl.cc:2015] Invalid cache (current) size";
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });

  it("matches routine partial cache revalidation misses", () => {
    const line =
      "[65144:0823/173616.164:WARNING:net\\http\\http_cache_transaction.cc:3556] Failed to revalidate partial entry";
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });

  it("matches late HTTP/2 headers for an already-closed stream", () => {
    const line =
      "[65144:0823/173619.361:WARNING:net\\spdy\\spdy_session.cc:3186] Received HEADERS for invalid stream 315";
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });
});

describe("isHarmlessChromiumNoise — transient SSL connection resets", () => {
  it("matches hostless net_error -101 ssl_client_socket_impl ERROR lines", () => {
    const line =
      "[33224:0608/215727.961:ERROR:ssl_client_socket_impl.cc(877)] handshake failed; returned -1, SSL error code 1, net_error -101";
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });

  it("matches hostless net_error -101 lines using Chromium's colon source format", () => {
    const line =
      "[24848:0810/115247.071:ERROR:net\\socket\\ssl_client_socket_impl.cc:963] handshake failed; returned -1, SSL error code 1, net_error -101";
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });
});

describe("isHarmlessChromiumNoise — must NOT swallow real errors", () => {
  it("does not match hostless net_error -202 SSL handshake lines", () => {
    const line =
      "[26712:0607/155145.309:ERROR:ssl_client_socket_impl.cc(877)] handshake failed; returned -1, SSL error code 1, net_error -202";
    expect(isHarmlessChromiumNoise(line)).toBe(false);
  });

  it("matches repetitive WebRTC TURN allocate diagnostics from normal Kick player startup", () => {
    const line =
      "[22460:0608/154909.231:WARNING:turn_port.cc(1455)] Port[64ee600:0:1:0:relay:Net[{F088CF09-876F-463C-9F47-DEC20DF8174D}:192.168.10.x/24:Ethernet:id=5]]: Received TURN allocate error response, id=705a494b4a4259324a344770, code=400, rtt=50";
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });

  it("matches repetitive WebRTC TURN bound-address diagnostics from normal Kick player startup", () => {
    const line =
      "[22460:0608/154907.023:WARNING:turn_port.cc(559)] Port[64ee600:0:1:0:relay:Net[{FC01FCD5-2B9D-2FD8-78D8-CB78B313E2B2}:10.5.0.x/16:Unknown:id=6]]: Socket is bound to the address:192.168.10.x:49770, rather than an address associated with network:Net[{FC01FCD5-2B9D-2FD8-78D8-CB78B313E2B2}:10.5.0.x/16:Unknown:id=6]. Discarding TURN port.";
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });

  it("matches repeated Kick player SDK and inactive collector banners", () => {
    expect(
      isHarmlessChromiumNoise(
        '[29128:0823/165430.829:INFO:CONSOLE:2] "Amazon IVS Player SDK 1.54.1", source: https://kick.com/ivs/1.54.1/amazon-ivs-wasmworker.min.js (2)'
      )
    ).toBe(true);
    expect(
      isHarmlessChromiumNoise(
        '[29128:0823/165430.830:INFO:CONSOLE:1] "[DZ] This collector is not active. Configure it to a data pipe to start sending events.", source: https://kick.com/datazoom/2.32.0/datazoom.js (1)'
      )
    ).toBe(true);
  });

  it("does not match Chromium H264 constrained-baseline startup diagnostics", () => {
    const line =
      "[28520:0608/155211.946:WARNING:codec.cc(386)] Explicitly added H264 constrained baseline to list of supported formats.";
    expect(isHarmlessChromiumNoise(line)).toBe(false);
  });

  it("does not match WebRTC aecdump shutdown diagnostics", () => {
    const line =
      "[24500:0608/155054.468:WARNING:webrtc_voice_engine.cc(809)] Attempting to stop aecdump when no audio processing module is present";
    expect(isHarmlessChromiumNoise(line)).toBe(false);
  });

  it("does not match other SSL handshake failures", () => {
    const line =
      "[26712:0607/155145.309:ERROR:ssl_client_socket_impl.cc(877)] handshake failed; returned -1, SSL error code 1, net_error -100";
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

  it("demotes a harmless SharedImageManager mailbox miss to logger.debug", async () => {
    const { mod, logger } = await freshTailer();
    const filePath = path.join(tmpDir, "chromium.log");
    await fsp.writeFile(filePath, "", "utf8");

    stopFns.push(mod.startChromiumLogTailer({ filePath, pollIntervalMs: POLL_MS }));

    const noiseLine =
      "[54552:0608/192841.367:ERROR:shared_image_manager.cc(401)] SharedImageManager::ProduceSkia: Trying to Produce a Skia representation from a non-existent mailbox.";
    await fsp.appendFile(filePath, `${noiseLine}\n`, "utf8");
    await pause();

    expect(logger.debug).toHaveBeenCalledWith("Chromium", noiseLine);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("demotes a harmless invalid current cache-size ERROR line to logger.debug", async () => {
    const { mod, logger } = await freshTailer();
    const filePath = path.join(tmpDir, "chromium.log");
    await fsp.writeFile(filePath, "", "utf8");

    stopFns.push(mod.startChromiumLogTailer({ filePath, pollIntervalMs: POLL_MS }));

    const noiseLine =
      "[33224:0608/215341.464:ERROR:backend_impl.cc(1908)] Invalid cache (current) size";
    await fsp.appendFile(filePath, `${noiseLine}\n`, "utf8");
    await pause();

    expect(logger.debug).toHaveBeenCalledWith("Chromium", noiseLine);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("demotes a hostless net_error -101 ssl_client_socket_impl ERROR line to logger.debug", async () => {
    const { mod, logger } = await freshTailer();
    const filePath = path.join(tmpDir, "chromium.log");
    await fsp.writeFile(filePath, "", "utf8");

    stopFns.push(mod.startChromiumLogTailer({ filePath, pollIntervalMs: POLL_MS }));

    const noiseLine =
      "[33224:0608/215727.961:ERROR:ssl_client_socket_impl.cc(877)] handshake failed; returned -1, SSL error code 1, net_error -101";
    await fsp.appendFile(filePath, `${noiseLine}\n`, "utf8");
    await pause();

    expect(logger.debug).toHaveBeenCalledWith("Chromium", noiseLine);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("keeps a hostless net_error -202 ssl_client_socket_impl ERROR line visible", async () => {
    const { mod, logger } = await freshTailer();
    const filePath = path.join(tmpDir, "chromium.log");
    await fsp.writeFile(filePath, "", "utf8");

    stopFns.push(mod.startChromiumLogTailer({ filePath, pollIntervalMs: POLL_MS }));

    const certAuthorityErr =
      "[26712:0607/155145.309:ERROR:ssl_client_socket_impl.cc(877)] handshake failed; returned -1, SSL error code 1, net_error -202";
    await fsp.appendFile(filePath, `${certAuthorityErr}\n`, "utf8");
    await pause();

    expect(logger.error).toHaveBeenCalledWith("Chromium", certAuthorityErr);
    expect(logger.debug).not.toHaveBeenCalledWith("Chromium", certAuthorityErr);
  });

  it("demotes repetitive WebRTC TURN startup warnings", async () => {
    const { mod, logger } = await freshTailer();
    const filePath = path.join(tmpDir, "chromium.log");
    await fsp.writeFile(filePath, "", "utf8");

    stopFns.push(mod.startChromiumLogTailer({ filePath, pollIntervalMs: POLL_MS }));

    const turnWarning =
      "[22460:0608/154909.231:WARNING:turn_port.cc(1455)] Port[64ee600:0:1:0:relay:Net[{F088CF09-876F-463C-9F47-DEC20DF8174D}:192.168.10.x/24:Ethernet:id=5]]: Received TURN allocate error response, id=705a494b4a4259324a344770, code=400, rtt=50";
    await fsp.appendFile(filePath, `${turnWarning}\n`, "utf8");
    await pause();

    expect(logger.debug).toHaveBeenCalledWith("Chromium", turnWarning);
    expect(logger.warn).not.toHaveBeenCalledWith("Chromium", turnWarning);
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

describe("isHarmlessChromiumNoise - VizNullHypothesis self-declared noise", () => {
  it("matches the Chromium VizNullHypothesis line that says it is not a warning", () => {
    const line =
      "[6740:0608/220547.902:WARNING:viz_main_impl.cc(85)] VizNullHypothesis is disabled (not a warning)";
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });
});

describe("isHarmlessChromiumNoise - Chromium cache cleanup", () => {
  it("matches invalid-entry cleanup warnings from Chromium's disk cache", () => {
    const line = "[1168:0608/220828.518:WARNING:backend_impl.cc(1758)] Destroying invalid entry.";
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });
});

describe("isHarmlessChromiumNoise - dev-only console banners", () => {
  it("matches Vite dev-client connection chatter", () => {
    const line =
      '[22640:0608/221014.690:INFO:CONSOLE(827)] "[vite] connected.", source: http://localhost:5173/@vite/client (827)';
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });

  it("matches React DevTools recommendation chatter", () => {
    const line =
      '[22640:0608/221015.722:INFO:CONSOLE(20103)] "%cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold", source: http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=174f3147 (20103)';
    expect(isHarmlessChromiumNoise(line)).toBe(true);
  });
});
