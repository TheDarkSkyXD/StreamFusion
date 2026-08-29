/**
 * renderer-crash-recovery.test.ts
 *
 * Guards the host renderer auto-recovery seam (PRD #51 slice 01, issue #52).
 *
 * The host BrowserWindow's webContents fires `render-process-gone` when the
 * renderer dies. Prior behavior: log only. New behavior: when the reason is
 * `oom` or `killed`, the main process must call `webContents.reload()` so the
 * user lands back on the same URL (route lives in the SPA URL, so the route
 * is preserved by construction through the reload).
 *
 * The seam is the public `installRendererCrashRecovery({ webContents })`
 * call. We inject a fake webContents (EventEmitter + reload spy) so the test
 * runs under plain Node without booting Electron — same DI pattern as
 * `tests/backend/logging/crash-hooks.test.ts`.
 */

import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

// Guards: a first unexpected renderer loss reloads once instead of leaving a blank window
// Guards: repeated or integrity-related renderer failures enter static safe mode instead of a reload loop

vi.mock("@backend/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

interface FakeWebContents extends EventEmitter {
  reload: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  getURL: () => string;
  isDestroyed: () => boolean;
}

function makeFakeWebContents(opts?: { destroyed?: boolean }): FakeWebContents {
  const ee = new EventEmitter() as FakeWebContents;
  ee.reload = vi.fn();
  ee.loadURL = vi.fn().mockResolvedValue(undefined);
  ee.getURL = () => "http://localhost:5173/#/settings";
  const destroyed = opts?.destroyed ?? false;
  ee.isDestroyed = (): boolean => destroyed;
  return ee;
}

type Details = { reason: string; exitCode: number };

function emitGone(wc: FakeWebContents, details: Details): void {
  wc.emit("render-process-gone", {}, details);
}

let uninstall: (() => void) | null = null;

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

describe("installRendererCrashRecovery — reload triggers", () => {
  it("calls webContents.reload() when render-process-gone reason is 'oom'", async () => {
    const mod = await import("@backend/recovery/renderer-crash-recovery");
    const wc = makeFakeWebContents();
    uninstall = mod.installRendererCrashRecovery({
      webContents: wc as unknown as Electron.WebContents,
    });

    emitGone(wc, { reason: "oom", exitCode: 9 });

    expect(wc.reload).toHaveBeenCalledTimes(1);
  });

  it("calls webContents.reload() when render-process-gone reason is 'killed'", async () => {
    const mod = await import("@backend/recovery/renderer-crash-recovery");
    const wc = makeFakeWebContents();
    uninstall = mod.installRendererCrashRecovery({
      webContents: wc as unknown as Electron.WebContents,
    });

    emitGone(wc, { reason: "killed", exitCode: 137 });

    expect(wc.reload).toHaveBeenCalledTimes(1);
  });
});

describe("installRendererCrashRecovery — non-recoverable reasons", () => {
  it("does NOT reload on 'clean-exit' (user-initiated, not a crash)", async () => {
    const mod = await import("@backend/recovery/renderer-crash-recovery");
    const wc = makeFakeWebContents();
    uninstall = mod.installRendererCrashRecovery({
      webContents: wc as unknown as Electron.WebContents,
    });

    emitGone(wc, { reason: "clean-exit", exitCode: 0 });

    expect(wc.reload).not.toHaveBeenCalled();
  });

  it("reloads once on an unexpected renderer crash", async () => {
    const mod = await import("@backend/recovery/renderer-crash-recovery");
    const wc = makeFakeWebContents();
    uninstall = mod.installRendererCrashRecovery({
      webContents: wc as unknown as Electron.WebContents,
    });

    emitGone(wc, { reason: "crashed", exitCode: 11 });

    expect(wc.reload).toHaveBeenCalledOnce();
  });

  it("opens static safe mode instead of looping after a second crash", async () => {
    const mod = await import("@backend/recovery/renderer-crash-recovery");
    const wc = makeFakeWebContents();
    uninstall = mod.installRendererCrashRecovery({
      webContents: wc as unknown as Electron.WebContents,
    });

    emitGone(wc, { reason: "crashed", exitCode: 11 });
    emitGone(wc, { reason: "crashed", exitCode: 11 });

    expect(wc.reload).toHaveBeenCalledOnce();
    expect(wc.loadURL).toHaveBeenCalledWith(expect.stringMatching(/^data:text\/html/));
  });

  it("opens safe mode immediately for an integrity failure", async () => {
    const mod = await import("@backend/recovery/renderer-crash-recovery");
    const wc = makeFakeWebContents();
    uninstall = mod.installRendererCrashRecovery({
      webContents: wc as unknown as Electron.WebContents,
    });

    emitGone(wc, { reason: "integrity-failure", exitCode: 12 });

    expect(wc.reload).not.toHaveBeenCalled();
    expect(wc.loadURL).toHaveBeenCalledOnce();
  });
});

describe("installRendererCrashRecovery — destroyed webContents", () => {
  it("does NOT call reload() if the webContents has already been destroyed", async () => {
    const mod = await import("@backend/recovery/renderer-crash-recovery");
    const wc = makeFakeWebContents({ destroyed: true });
    uninstall = mod.installRendererCrashRecovery({
      webContents: wc as unknown as Electron.WebContents,
    });

    emitGone(wc, { reason: "oom", exitCode: 9 });

    expect(wc.reload).not.toHaveBeenCalled();
  });
});

describe("installRendererCrashRecovery — uninstall", () => {
  it("removes the listener so a post-uninstall render-process-gone does not trigger reload", async () => {
    const mod = await import("@backend/recovery/renderer-crash-recovery");
    const wc = makeFakeWebContents();
    uninstall = mod.installRendererCrashRecovery({
      webContents: wc as unknown as Electron.WebContents,
    });

    expect(wc.listenerCount("render-process-gone")).toBe(1);

    uninstall();
    uninstall = null;

    expect(wc.listenerCount("render-process-gone")).toBe(0);

    emitGone(wc, { reason: "oom", exitCode: 9 });
    expect(wc.reload).not.toHaveBeenCalled();
  });
});

describe("installRendererCrashRecovery — logging", () => {
  it("logs a structured recovery line under tag 'CrashRecovery' when reload is triggered", async () => {
    const mod = await import("@backend/recovery/renderer-crash-recovery");
    const loggerMod = await import("@backend/logging/logger");
    const wc = makeFakeWebContents();
    uninstall = mod.installRendererCrashRecovery({
      webContents: wc as unknown as Electron.WebContents,
    });

    emitGone(wc, { reason: "oom", exitCode: 9 });

    expect(loggerMod.logger.warn).toHaveBeenCalledWith(
      "CrashRecovery",
      "host-renderer-auto-reload",
      { reason: "oom", exitCode: 9 }
    );
  });
});
