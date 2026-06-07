/**
 * logger.test.ts (renderer)
 *
 * Guards the renderer-side Valo logger. Unlike the main-process logger the
 * renderer cannot touch the file system directly; every call ships the
 * structured payload across IPC via `window.electronAPI.logs.write`.
 *
 * Invariants pinned here:
 *   - Each level method forwards `{ level, tag, message, meta? }` to the
 *     bridge with the right shape (no extra keys, no reordering).
 *   - When the bridge is unavailable (early renderer boot, test/SSR contexts
 *     where Electron's preload never ran) the call falls back to
 *     `console[level]` so no line is silently dropped.
 *   - If the bridge throws (preload installed but main is wedged) the call
 *     does NOT propagate the throw — same fallback to `console[level]`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type LoggerModule = typeof import("@/renderer/logging/logger");

interface ElectronWindow {
  electronAPI?: {
    logs?: {
      write?: (payload: {
        level: "debug" | "info" | "warn" | "error";
        tag: string;
        message: string;
        meta?: Record<string, unknown>;
      }) => void;
    };
  };
}

const writeMock = vi.fn();

async function freshLogger(): Promise<LoggerModule> {
  vi.resetModules();
  return await import("@/renderer/logging/logger");
}

beforeEach(() => {
  (globalThis as unknown as { window: ElectronWindow }).window = {
    electronAPI: { logs: { write: writeMock } },
  };
  writeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  // Don't leave a partial `window` shape behind for the next file.
  delete (globalThis as unknown as { window?: ElectronWindow }).window;
});

// ---------------------------------------------------------------------------
// Forwarding — each method emits the right payload
// ---------------------------------------------------------------------------

describe("renderer logger — forwarding", () => {
  it("debug() forwards { level:'debug', tag, message } to logs.write", async () => {
    const { logger } = await freshLogger();
    logger.debug("Renderer", "hello");
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith({
      level: "debug",
      tag: "Renderer",
      message: "hello",
    });
  });

  it("info() forwards { level:'info', tag, message }", async () => {
    const { logger } = await freshLogger();
    logger.info("App", "ready");
    expect(writeMock).toHaveBeenCalledWith({
      level: "info",
      tag: "App",
      message: "ready",
    });
  });

  it("warn() forwards { level:'warn', tag, message }", async () => {
    const { logger } = await freshLogger();
    logger.warn("Chat", "retry");
    expect(writeMock).toHaveBeenCalledWith({
      level: "warn",
      tag: "Chat",
      message: "retry",
    });
  });

  it("error() forwards { level:'error', tag, message }", async () => {
    const { logger } = await freshLogger();
    logger.error("Player", "decoder stalled");
    expect(writeMock).toHaveBeenCalledWith({
      level: "error",
      tag: "Player",
      message: "decoder stalled",
    });
  });

  it("passes meta through verbatim when provided", async () => {
    const { logger } = await freshLogger();
    const meta = { userId: "u1", attempts: 2 };
    logger.info("Auth", "token refreshed", meta);
    expect(writeMock).toHaveBeenCalledWith({
      level: "info",
      tag: "Auth",
      message: "token refreshed",
      meta,
    });
  });

  it("omits the meta key entirely when not provided", async () => {
    const { logger } = await freshLogger();
    logger.info("App", "boot");
    const payload = writeMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("meta" in payload).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bridge absent — fall back to console so messages aren't lost
// ---------------------------------------------------------------------------

describe("renderer logger — bridge absent fallback", () => {
  it("uses console.info when window.electronAPI is missing", async () => {
    (globalThis as unknown as { window: ElectronWindow }).window = {};
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { logger } = await freshLogger();
    logger.info("App", "early-boot");
    expect(spy).toHaveBeenCalled();
  });

  it("uses console.debug when logs namespace is missing", async () => {
    (globalThis as unknown as { window: ElectronWindow }).window = { electronAPI: {} };
    const spy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const { logger } = await freshLogger();
    logger.debug("App", "no-bridge");
    expect(spy).toHaveBeenCalled();
  });

  it("uses console.warn when logs.write is missing", async () => {
    (globalThis as unknown as { window: ElectronWindow }).window = {
      electronAPI: { logs: {} },
    };
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { logger } = await freshLogger();
    logger.warn("App", "partial-bridge");
    expect(spy).toHaveBeenCalled();
  });

  it("uses console.error when window itself is undefined (test/SSR)", async () => {
    delete (globalThis as unknown as { window?: ElectronWindow }).window;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { logger } = await freshLogger();
    logger.error("App", "no-window");
    expect(spy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Bridge throws — never propagate, fall back to console
// ---------------------------------------------------------------------------

describe("renderer logger — bridge-throws fallback", () => {
  it("does not throw when logs.write throws", async () => {
    writeMock.mockImplementation(() => {
      throw new Error("ipc down");
    });
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { logger } = await freshLogger();
    expect(() => logger.info("App", "boom")).not.toThrow();
  });

  it("falls back to console.<level> when logs.write throws", async () => {
    writeMock.mockImplementation(() => {
      throw new Error("ipc down");
    });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { logger } = await freshLogger();
    logger.warn("App", "still-logged");
    expect(spy).toHaveBeenCalled();
  });

  it("does not throw even when console.<level> ALSO throws", async () => {
    writeMock.mockImplementation(() => {
      throw new Error("ipc down");
    });
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console down too");
    });
    const { logger } = await freshLogger();
    expect(() => logger.error("App", "catastrophe")).not.toThrow();
  });
});
