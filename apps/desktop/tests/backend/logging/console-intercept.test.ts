/**
 * console-intercept.test.ts
 *
 * Guards the main-process global `console.*` interceptor that pipes every
 * existing `console.log/info/warn/error/debug` call into our Valo-style logger
 * so we don't have to mechanically migrate ~700 call sites.
 *
 * Two invariants matter most:
 *   1. Routing — each console method lands on the matching logger level with
 *      the requested tag (default `console`, configurable via opts).
 *   2. Safety — installing twice does NOT stack patches, the uninstall
 *      restores the exact pre-install function refs, and a thrown logger call
 *      falls back to the original console so we never silently drop a line.
 *
 * The logger module is mocked so tests can run without a real electron-log
 * file transport and without booting the singleton.
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/backend/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type InterceptModule = typeof import("@/backend/logging/console-intercept");
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
  const mod = await import("@/backend/logging/console-intercept");
  const { logger } = (await import("@/backend/logging/logger")) as unknown as {
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
  // Roll back any patches a test forgot to uninstall, in install order so the
  // FIRST returned uninstall restores correctly even after re-installs.
  for (const u of uninstallers) {
    try {
      u();
    } catch {
      // best-effort
    }
  }
  // Defensive reset: even if uninstall logic regresses, the next test starts
  // with the real console.
  console.log = realConsole.log;
  console.info = realConsole.info;
  console.warn = realConsole.warn;
  console.error = realConsole.error;
  console.debug = realConsole.debug;
});

// ---------------------------------------------------------------------------
// Routing — each console method lands on the matching logger level
// ---------------------------------------------------------------------------

describe("installConsoleIntercept — routing", () => {
  it("routes console.log to logger.info with the default 'console' tag", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.log("hello");
    expect(logger.info).toHaveBeenCalledWith("console", "hello");
  });

  it("routes console.info to logger.info and joins multiple args with spaces", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.info("a", "b");
    expect(logger.info).toHaveBeenCalledWith("console", "a b");
  });

  it("routes console.warn to logger.warn", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.warn("warning");
    expect(logger.warn).toHaveBeenCalledWith("console", "warning");
  });

  it("routes console.debug to logger.debug and inspects mixed args", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.debug({ a: 1 }, 2);
    expect(logger.debug).toHaveBeenCalledTimes(1);
    const [tag, message] = logger.debug.mock.calls[0] as [string, string];
    expect(tag).toBe("console");
    expect(message).toContain("{ a: 1 }");
    expect(message).toContain("2");
    // No third arg — meta is folded into the message.
    expect(logger.debug.mock.calls[0]).toHaveLength(2);
  });

  it("emits an empty string when console is called with no args", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.log();
    expect(logger.info).toHaveBeenCalledWith("console", "");
  });

  it("preserves a single string arg verbatim (no inspect quoting)", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    console.log("plain string");
    expect(logger.info).toHaveBeenCalledWith("console", "plain string");
  });
});

// ---------------------------------------------------------------------------
// Error stringification — stacks must survive
// ---------------------------------------------------------------------------

describe("installConsoleIntercept — error formatting", () => {
  it("includes the Error's stack text when logging an Error instance", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    const err = new Error("boom");
    console.error(err);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [tag, message] = logger.error.mock.calls[0] as [string, string];
    expect(tag).toBe("console");
    // Either the full stack (preferred) or the message header — both contain
    // 'boom' and the 'Error:' marker that V8 stack-traces print.
    expect(message).toContain("boom");
    expect(message).toContain("Error");
    if (err.stack) {
      // The stack should land in the message verbatim so debuggers can grep
      // for frames.
      expect(message).toContain(err.stack);
    }
  });

  it("falls back to message-only when an Error has no stack", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept());
    const err = new Error("stackless");
    // Some sandboxes strip stacks; simulate that explicitly.
    Object.defineProperty(err, "stack", { value: undefined });
    console.error(err);
    const [, message] = logger.error.mock.calls[0] as [string, string];
    expect(message).toContain("stackless");
  });
});

// ---------------------------------------------------------------------------
// Custom tag
// ---------------------------------------------------------------------------

describe("installConsoleIntercept — custom tag", () => {
  it("uses the provided tag for every routed call", async () => {
    const { mod, logger } = await freshIntercept();
    uninstallers.push(mod.installConsoleIntercept({ tag: "main:console" }));
    console.log("x");
    console.warn("y");
    expect(logger.info).toHaveBeenCalledWith("main:console", "x");
    expect(logger.warn).toHaveBeenCalledWith("main:console", "y");
  });
});

// ---------------------------------------------------------------------------
// Uninstall + idempotent install
// ---------------------------------------------------------------------------

describe("installConsoleIntercept — lifecycle", () => {
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
    // Sanity: the patch swapped the methods.
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
    // Second install must be a no-op — same patched ref, not a new wrapper.
    const secondUninstall = mod.installConsoleIntercept();
    expect(console.log).toBe(afterFirst);

    // The FIRST returned uninstall still restores the originals.
    firstUninstall();
    expect(console.log).toBe(before);

    // A redundant second uninstall must not throw and must not re-patch.
    expect(() => secondUninstall()).not.toThrow();
    expect(console.log).toBe(before);

    // And after restore, console.log should NOT route to the logger anymore.
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
    expect(logger.info).toHaveBeenCalledWith("console", "cycle");
  });
});

// ---------------------------------------------------------------------------
// Fallback when the logger throws — we must never silently swallow a line
// ---------------------------------------------------------------------------

describe("installConsoleIntercept — logger failure fallback", () => {
  it("falls back to the original console method when the logger throws", async () => {
    const { mod, logger } = await freshIntercept();

    // Replace console.error with a spy BEFORE installing so the interceptor
    // stashes the spy as its 'original' fallback target.
    const origError = console.error;
    const errSpy = vi.fn();
    console.error = errSpy;

    const uninstall = mod.installConsoleIntercept();
    uninstallers.push(uninstall);

    logger.error.mockImplementation(() => {
      throw new Error("logger down");
    });

    console.error("actual message", { detail: 1 });

    // The logger was still attempted.
    expect(logger.error).toHaveBeenCalled();
    // And the original (spy) was called with the raw args so the message is
    // not lost.
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
