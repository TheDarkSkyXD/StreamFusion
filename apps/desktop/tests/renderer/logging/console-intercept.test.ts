/**
 * console-intercept.test.ts (renderer)
 *
 * Mirrors the main-process console intercept guardrails for the renderer
 * patch. Two invariants matter most:
 *   1. Routing — each console method lands on the matching renderer logger
 *      level with the requested tag (default `console:renderer`, configurable
 *      via opts).
 *   2. Safety — installing twice does NOT stack patches, the uninstall
 *      restores the exact pre-install function refs, and a thrown logger
 *      call falls back to the captured original method so we never silently
 *      drop a line.
 *
 * The renderer logger is mocked so we don't shell out to the IPC bridge
 * during the test (and so the tests can run without a real Electron context).
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type InterceptModule = typeof import("@/renderer/logging/console-intercept");
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
  const mod = await import("@/renderer/logging/console-intercept");
  const { logger } = (await import("@/renderer/logging/logger")) as unknown as {
    logger: LoggerMock;
  };
  logger.debug.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
  return { mod, logger };
}

// Snapshot the real console methods once at module load so any test that
// scribbles on them can put the system back the way it found it.
const realConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

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
  console.log = realConsole.log;
  console.info = realConsole.info;
  console.warn = realConsole.warn;
  console.error = realConsole.error;
  console.debug = realConsole.debug;
});

// ---------------------------------------------------------------------------
// Routing — each console method lands on the matching logger level
// ---------------------------------------------------------------------------

describe("installConsoleIntercept (renderer) — routing", () => {
  it("routes console.log to logger.info with default tag 'console:renderer'", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.log("hello");
    expect(logger.info).toHaveBeenCalledWith("console:renderer", "hello");
  });

  it("routes console.info to logger.info and joins multiple args with spaces", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.info("a", "b");
    expect(logger.info).toHaveBeenCalledWith("console:renderer", "a b");
  });

  it("routes console.warn to logger.warn", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.warn("warning");
    expect(logger.warn).toHaveBeenCalledWith("console:renderer", "warning");
  });

  it("routes console.error to logger.error", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.error("oh no");
    expect(logger.error).toHaveBeenCalledWith("console:renderer", "oh no");
  });

  it("routes console.debug to logger.debug", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.debug("trace");
    expect(logger.debug).toHaveBeenCalledWith("console:renderer", "trace");
  });

  it("emits an empty string when console is called with no args", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.log();
    expect(logger.info).toHaveBeenCalledWith("console:renderer", "");
  });

  it("preserves a single string arg verbatim", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.log("plain string");
    expect(logger.info).toHaveBeenCalledWith("console:renderer", "plain string");
  });
});

// ---------------------------------------------------------------------------
// Multi-arg + object formatting (renderer flavor: JSON.stringify, no util.inspect)
// ---------------------------------------------------------------------------

describe("installConsoleIntercept (renderer) — argument formatting", () => {
  it("JSON-stringifies plain objects when mixed with other args", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.log("user", { id: 1, name: "x" });
    const [tag, message] = logger.info.mock.calls[0] as [string, string];
    expect(tag).toBe("console:renderer");
    expect(message).toContain("user");
    expect(message).toContain('{"id":1,"name":"x"}');
  });

  it("falls back to String(arg) when the object is circular", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => console.log(circular)).not.toThrow();
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [, message] = logger.info.mock.calls[0] as [string, string];
    // String([object Object]) is the documented JS fallback for plain objects.
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });

  it("joins multiple non-string args with single spaces", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.log(1, 2, 3);
    const [, message] = logger.info.mock.calls[0] as [string, string];
    expect(message).toBe("1 2 3");
  });
});

// ---------------------------------------------------------------------------
// Error stringification — stacks must survive
// ---------------------------------------------------------------------------

describe("installConsoleIntercept (renderer) — error formatting", () => {
  it("includes the Error's stack text when logging an Error instance", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    const err = new Error("boom");
    console.error(err);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [tag, message] = logger.error.mock.calls[0] as [string, string];
    expect(tag).toBe("console:renderer");
    expect(message).toContain("boom");
    if (err.stack) {
      expect(message).toContain(err.stack);
    }
  });

  it("falls back to message-only when an Error has no stack", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    const err = new Error("stackless");
    Object.defineProperty(err, "stack", { value: undefined });
    console.error(err);
    const [, message] = logger.error.mock.calls[0] as [string, string];
    expect(message).toContain("stackless");
  });
});

// ---------------------------------------------------------------------------
// Custom tag
// ---------------------------------------------------------------------------

describe("installConsoleIntercept (renderer) — custom tag", () => {
  it("uses the provided tag for every routed call", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept({ tag: "renderer:console" }));
    console.log("x");
    console.warn("y");
    expect(logger.info).toHaveBeenCalledWith("renderer:console", "x");
    expect(logger.warn).toHaveBeenCalledWith("renderer:console", "y");
  });
});

// ---------------------------------------------------------------------------
// Uninstall + idempotent install
// ---------------------------------------------------------------------------

describe("installConsoleIntercept (renderer) — lifecycle", () => {
  it("uninstall restores the exact pre-install function references", async () => {
    const { mod } = await freshIntercept();
    const before = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };
    const uninstall = mod.installConsoleIntercept();
    expect(console.log).not.toBe(before.log);
    uninstall();
    expect(console.log).toBe(before.log);
    expect(console.info).toBe(before.info);
    expect(console.warn).toBe(before.warn);
    expect(console.error).toBe(before.error);
    expect(console.debug).toBe(before.debug);
  });

  it("install is idempotent — a second install does NOT re-patch on top of the first", async () => {
    const { mod, logger } = await freshIntercept();
    const before = console.log;
    const firstUninstall = mod.installConsoleIntercept();
    const afterFirst = console.log;
    const secondUninstall = mod.installConsoleIntercept();
    expect(console.log).toBe(afterFirst);

    firstUninstall();
    expect(console.log).toBe(before);

    expect(() => secondUninstall()).not.toThrow();
    expect(console.log).toBe(before);

    logger.info.mockReset();
    console.log("not-intercepted");
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("can re-install after a clean uninstall (install/uninstall/install cycle)", async () => {
    const { mod, logger } = await freshIntercept();
    const u1 = mod.installConsoleIntercept();
    u1();
    const u2 = mod.installConsoleIntercept();
    uninstallers.push(u2);
    console.log("cycle");
    expect(logger.info).toHaveBeenCalledWith("console:renderer", "cycle");
  });
});

// ---------------------------------------------------------------------------
// Fallback when the logger throws — we must never silently swallow a line
// ---------------------------------------------------------------------------

describe("installConsoleIntercept (renderer) — logger failure fallback", () => {
  it("falls back to the original console method when the logger throws", async () => {
    const { mod, logger } = await freshIntercept();

    const origError = console.error;
    const errSpy = vi.fn();
    console.error = errSpy;

    const uninstall = mod.installConsoleIntercept();
    uninstallers.push(uninstall);

    logger.error.mockImplementation(() => {
      throw new Error("logger down");
    });

    console.error("actual message", { detail: 1 });

    expect(logger.error).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith("actual message", { detail: 1 });

    uninstall();
    console.error = origError;
  });

  it("does not throw out of the console call when the logger throws", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    logger.info.mockImplementation(() => {
      throw new Error("nope");
    });
    expect(() => console.log("noise")).not.toThrow();
  });
});
