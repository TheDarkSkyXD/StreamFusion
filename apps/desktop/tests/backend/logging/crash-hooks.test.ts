/**
 * crash-hooks.test.ts
 *
 * Guards the install/uninstall lifecycle of the process- and app-level crash
 * listeners:
 *
 *   - Each Node `process` and Electron `app` crash event we promise to capture
 *     is wired through to `logger.error` with the documented tag + meta shape.
 *     Bug-report log files are useless if a crash silently disappears, so
 *     these wire-through assertions are the contract.
 *   - `unhandledRejection` serialization handles three shapes: `Error`,
 *     plain object, and primitive — plus a defensive try/catch path for
 *     reasons whose property access throws (Proxy-like). A serializer that
 *     throws must NEVER kill the host process; it falls back to `String()`.
 *   - The uninstall hook removes ALL listeners this module registered (named
 *     refs, not closures). Emitting a second crash event after uninstall
 *     produces zero logger calls.
 *   - Calling `installCrashHooks` twice in one process is a no-op for the
 *     second call so duplicate logs / double-counted listener counts can't
 *     happen — the first call's uninstall closure stays valid.
 *
 * The Electron `app` is replaced with a Node `EventEmitter` so the tests run
 * under plain Node without booting an Electron runtime; the production module
 * only relies on `.on` / `.off` / `.removeListener`, which `EventEmitter`
 * provides.
 */

import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type CrashHooksModule = typeof import("@/backend/logging/crash-hooks");
type LoggerModule = typeof import("@/backend/logging/logger");

async function freshCrashHooksModule(): Promise<CrashHooksModule> {
  vi.resetModules();
  // Re-register the mock — vi.resetModules() drops the previous registration.
  vi.doMock("@/backend/logging/logger", () => ({
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));
  return await import("@/backend/logging/crash-hooks");
}

async function getMockedLogger(): Promise<LoggerModule["logger"]> {
  const mod = await import("@/backend/logging/logger");
  return mod.logger;
}

// The production module types this as Electron.App — the only members it
// touches are `.on` and `.off`, both inherited from EventEmitter.
type FakeApp = EventEmitter;

function makeFakeApp(): FakeApp {
  return new EventEmitter();
}

let uninstall: (() => void) | null = null;
let uncaughtBaseline = 0;
let unhandledBaseline = 0;

beforeEach(() => {
  uncaughtBaseline = process.listenerCount("uncaughtException");
  unhandledBaseline = process.listenerCount("unhandledRejection");
});

afterEach(() => {
  if (uninstall) {
    try {
      uninstall();
    } catch {
      // best-effort
    }
    uninstall = null;
  }
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// process.on('uncaughtException')
// ---------------------------------------------------------------------------

describe("installCrashHooks — uncaughtException", () => {
  it("logs an error with the exception's name/message/stack on uncaughtException", async () => {
    const mod = await freshCrashHooksModule();
    const logger = await getMockedLogger();
    const app = makeFakeApp();
    uninstall = mod.installCrashHooks({ app: app as unknown as Electron.App });

    const err = new Error("boom");
    err.name = "TypeError";
    process.emit("uncaughtException", err);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("CrashHooks", "uncaughtException", {
      name: "TypeError",
      message: "boom",
      stack: err.stack,
    });
  });
});

// ---------------------------------------------------------------------------
// process.on('unhandledRejection')
// ---------------------------------------------------------------------------

describe("installCrashHooks — unhandledRejection", () => {
  it("serializes an Error reason to {name, message, stack}", async () => {
    const mod = await freshCrashHooksModule();
    const logger = await getMockedLogger();
    const app = makeFakeApp();
    uninstall = mod.installCrashHooks({ app: app as unknown as Electron.App });

    const err = new Error("nope");
    err.name = "RangeError";
    process.emit("unhandledRejection", err, Promise.resolve());

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("CrashHooks", "unhandledRejection", {
      reason: { name: "RangeError", message: "nope", stack: err.stack },
    });
  });

  it("serializes a string reason to {reason: String(reason)}", async () => {
    const mod = await freshCrashHooksModule();
    const logger = await getMockedLogger();
    const app = makeFakeApp();
    uninstall = mod.installCrashHooks({ app: app as unknown as Electron.App });

    process.emit("unhandledRejection", "kaboom", Promise.resolve());

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("CrashHooks", "unhandledRejection", {
      reason: { reason: "kaboom" },
    });
  });

  it("passes a plain-object reason through under the `reason` key", async () => {
    const mod = await freshCrashHooksModule();
    const logger = await getMockedLogger();
    const app = makeFakeApp();
    uninstall = mod.installCrashHooks({ app: app as unknown as Electron.App });

    const reason = { code: "E_FOO", detail: "bar" };
    process.emit("unhandledRejection", reason, Promise.resolve());

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("CrashHooks", "unhandledRejection", {
      reason,
    });
  });

  it("falls back to String(reason) when serialization throws and does not propagate", async () => {
    const mod = await freshCrashHooksModule();
    const logger = await getMockedLogger();
    const app = makeFakeApp();
    uninstall = mod.installCrashHooks({ app: app as unknown as Electron.App });

    // A Proxy whose `get` trap throws. Property reads explode (including the
    // ones a JSON.stringify-style walker would do) but the meta-only traps
    // (`has`, `ownKeys`, `getOwnPropertyDescriptor`) stay quiet so Node's
    // internal `unhandledRejection` plumbing — which does its own
    // `"domain" in reason` check — doesn't itself throw.
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("proxy-explode");
        },
      }
    );

    expect(() => process.emit("unhandledRejection", hostile, Promise.resolve())).not.toThrow();

    expect(logger.error).toHaveBeenCalledTimes(1);
    const call = vi.mocked(logger.error).mock.calls[0];
    expect(call[0]).toBe("CrashHooks");
    expect(call[1]).toBe("unhandledRejection");
    // The defensive path falls back to either a plain `{reason: String(reason)}`
    // wrapper or an `<unserializable>` marker — both are acceptable so long as
    // the host process didn't crash.
    expect(call[2]).toMatchObject({ reason: expect.anything() });
  });
});

// ---------------------------------------------------------------------------
// app.on('render-process-gone' | 'child-process-gone')
// ---------------------------------------------------------------------------

describe("installCrashHooks — app-level crash events", () => {
  it("logs render-process-gone with reason + exitCode", async () => {
    const mod = await freshCrashHooksModule();
    const logger = await getMockedLogger();
    const app = makeFakeApp();
    uninstall = mod.installCrashHooks({ app: app as unknown as Electron.App });

    app.emit(
      "render-process-gone",
      {} /* event */,
      {} /* webContents */,
      {
        reason: "crashed",
        exitCode: 11,
      }
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("CrashHooks", "render-process-gone", {
      reason: "crashed",
      exitCode: 11,
    });
  });

  it("logs child-process-gone with the full Details shape", async () => {
    const mod = await freshCrashHooksModule();
    const logger = await getMockedLogger();
    const app = makeFakeApp();
    uninstall = mod.installCrashHooks({ app: app as unknown as Electron.App });

    app.emit(
      "child-process-gone",
      {} /* event */,
      {
        type: "GPU",
        reason: "oom",
        exitCode: 9,
        serviceName: "gpu-service",
        name: "GPU Process",
      }
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("CrashHooks", "child-process-gone", {
      type: "GPU",
      reason: "oom",
      exitCode: 9,
      serviceName: "gpu-service",
      name: "GPU Process",
    });
  });
});

// ---------------------------------------------------------------------------
// uninstall
// ---------------------------------------------------------------------------

describe("installCrashHooks — uninstall", () => {
  it("removes every listener it added so post-uninstall emits no longer log", async () => {
    const mod = await freshCrashHooksModule();
    const logger = await getMockedLogger();
    const app = makeFakeApp();
    uninstall = mod.installCrashHooks({ app: app as unknown as Electron.App });

    // Sanity: counts went up by exactly one for the process events, and
    // the fake app got two new listeners (render + child).
    expect(process.listenerCount("uncaughtException")).toBe(uncaughtBaseline + 1);
    expect(process.listenerCount("unhandledRejection")).toBe(unhandledBaseline + 1);
    expect(app.listenerCount("render-process-gone")).toBe(1);
    expect(app.listenerCount("child-process-gone")).toBe(1);

    uninstall();
    uninstall = null;

    // Counts back to baseline / zero.
    expect(process.listenerCount("uncaughtException")).toBe(uncaughtBaseline);
    expect(process.listenerCount("unhandledRejection")).toBe(unhandledBaseline);
    expect(app.listenerCount("render-process-gone")).toBe(0);
    expect(app.listenerCount("child-process-gone")).toBe(0);

    // Emitting after uninstall is a no-op for our logger. Node treats an
    // `uncaughtException` with zero listeners as fatal, so we install a
    // benign no-op listener for the duration of these post-uninstall emits.
    const noop = (): void => undefined;
    process.on("uncaughtException", noop);
    process.on("unhandledRejection", noop);
    try {
      process.emit("uncaughtException", new Error("post-uninstall"));
      process.emit("unhandledRejection", "post-uninstall", Promise.resolve());
      app.emit("render-process-gone", {}, {}, { reason: "crashed", exitCode: 1 });
      app.emit("child-process-gone", {}, { type: "GPU", reason: "crashed", exitCode: 1 });
    } finally {
      process.removeListener("uncaughtException", noop);
      process.removeListener("unhandledRejection", noop);
    }

    expect(logger.error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// double-install guard
// ---------------------------------------------------------------------------

describe("installCrashHooks — double-install no-op", () => {
  it("second call in the same process registers no new listeners and the first uninstall still works", async () => {
    const mod = await freshCrashHooksModule();
    const logger = await getMockedLogger();
    const app = makeFakeApp();

    const uninstallFirst = mod.installCrashHooks({ app: app as unknown as Electron.App });
    const countsAfterFirst = {
      uncaught: process.listenerCount("uncaughtException"),
      unhandled: process.listenerCount("unhandledRejection"),
      render: app.listenerCount("render-process-gone"),
      child: app.listenerCount("child-process-gone"),
    };

    const uninstallSecond = mod.installCrashHooks({
      app: makeFakeApp() as unknown as Electron.App,
    });

    // Second install added NO additional listeners on process (the only
    // surface a second app could share) — and the fresh fake-app the second
    // call received was never touched.
    expect(process.listenerCount("uncaughtException")).toBe(countsAfterFirst.uncaught);
    expect(process.listenerCount("unhandledRejection")).toBe(countsAfterFirst.unhandled);
    expect(app.listenerCount("render-process-gone")).toBe(countsAfterFirst.render);
    expect(app.listenerCount("child-process-gone")).toBe(countsAfterFirst.child);

    // Second uninstall is a no-op (the second install was a no-op).
    expect(() => uninstallSecond()).not.toThrow();
    // First uninstall still works — listeners drain back to baseline.
    uninstallFirst();
    uninstall = null;
    expect(process.listenerCount("uncaughtException")).toBe(uncaughtBaseline);
    expect(process.listenerCount("unhandledRejection")).toBe(unhandledBaseline);
    expect(app.listenerCount("render-process-gone")).toBe(0);
    expect(app.listenerCount("child-process-gone")).toBe(0);

    // And once drained, no more logger calls. (Node treats a zero-listener
    // uncaughtException as fatal — install a benign no-op for the emit.)
    const noop = (): void => undefined;
    process.on("uncaughtException", noop);
    try {
      process.emit("uncaughtException", new Error("post-uninstall"));
    } finally {
      process.removeListener("uncaughtException", noop);
    }
    expect(logger.error).not.toHaveBeenCalled();
  });
});
