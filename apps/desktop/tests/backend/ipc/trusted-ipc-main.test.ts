import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({ handle: vi.fn(), on: vi.fn() }));
const loggerMocks = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));

vi.mock("electron", () => ({ ipcMain: electronMocks }));
vi.mock("@/backend/logging/logger", () => ({ logger: loggerMocks }));

type RegisteredHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

async function loadConfiguredGate() {
  vi.resetModules();
  const mod = await import("@/backend/ipc/trusted-ipc-main");
  const frame = { url: "http://localhost:5173/index.html#/home" };
  const sender = { mainFrame: frame };
  mod.configureTrustedIpcMain(sender as Electron.WebContents, "http://localhost:5173/index.html");
  return { mod, frame, sender };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Guards: every legacy IPC route rejects non-main renderers and oversized payloads before executing
// Guards: thrown handler details stay in main-process logs and never cross the renderer boundary
describe("trusted legacy IPC gate", () => {
  it("executes a bounded request from the exact main renderer", async () => {
    const { mod, frame, sender } = await loadConfiguredGate();
    const listener = vi.fn(async () => "ok");
    mod.trustedIpcMain.handle("test", listener);
    const registered = electronMocks.handle.mock.calls[0]?.[1] as RegisteredHandler;

    await expect(registered({ sender, senderFrame: frame }, { id: "1" })).resolves.toBe("ok");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("accepts a bounded 5,000-item browse snapshot used by persistence", async () => {
    const { mod, frame, sender } = await loadConfiguredGate();
    const listener = vi.fn(() => undefined);
    mod.trustedIpcMain.handle("store:set", listener);
    const registered = electronMocks.handle.mock.calls[0]?.[1] as RegisteredHandler;
    const entries = Array.from({ length: 5_000 }, (_, index) => ({
      id: String(index),
      title: `Category ${index}`,
      tags: ["one", "two", "three"],
      provider: { twitch: true, kick: true },
    }));

    expect(() =>
      registered({ sender, senderFrame: frame }, { key: "snapshot", entries })
    ).not.toThrow();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("rejects another renderer and a payload over the string budget", async () => {
    const { mod, frame, sender } = await loadConfiguredGate();
    const listener = vi.fn(async () => "ok");
    mod.trustedIpcMain.handle("test", listener);
    const registered = electronMocks.handle.mock.calls[0]?.[1] as RegisteredHandler;

    const otherFrame = { url: frame.url };
    expect(() =>
      registered({ sender: { mainFrame: otherFrame }, senderFrame: otherFrame }, {})
    ).toThrow("IPC request rejected");
    expect(() =>
      registered({ sender, senderFrame: frame }, "x".repeat(8 * 1024 * 1024 + 1))
    ).toThrow("IPC request rejected");
    expect(listener).not.toHaveBeenCalled();
  });

  it("counts cumulative strings and cloneable Map/Set contents", async () => {
    const { mod, frame, sender } = await loadConfiguredGate();
    const listener = vi.fn(() => undefined);
    mod.trustedIpcMain.handle("test", listener);
    const registered = electronMocks.handle.mock.calls[0]?.[1] as RegisteredHandler;
    const largePart = "x".repeat(5 * 1024 * 1024);

    expect(() => registered({ sender, senderFrame: frame }, [largePart, largePart])).toThrow(
      "IPC request rejected"
    );
    expect(() =>
      registered({ sender, senderFrame: frame }, new Map([["payload", largePart + largePart]]))
    ).toThrow("IPC request rejected");
    expect(() =>
      registered({ sender, senderFrame: frame }, new Set([largePart + largePart]))
    ).toThrow("IPC request rejected");
    expect(listener).not.toHaveBeenCalled();
  });

  it("returns only a diagnostic ID when a handler throws", async () => {
    const { mod, frame, sender } = await loadConfiguredGate();
    mod.trustedIpcMain.handle("test", async () => {
      throw new Error("secret token detail");
    });
    const registered = electronMocks.handle.mock.calls[0]?.[1] as RegisteredHandler;

    const rejection = await registered({ sender, senderFrame: frame }).catch(
      (error: unknown) => error
    );
    expect(String(rejection)).toContain("IPC request failed");
    expect(String(rejection)).not.toContain("secret token detail");
    expect(JSON.stringify(loggerMocks.error.mock.calls)).not.toContain("secret token detail");
  });
});
