import { EventEmitter } from "node:events";

import type { BrowserWindow, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";

import { runFeatureRegistrationTransaction } from "@backend/ipc/feature-registration-transaction";
import { createMainRendererPortMock } from "./main-renderer-port-mock";

function createWindow(): BrowserWindow {
  const webContents = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: () => false,
    isCrashed: () => false,
    mainFrame: { isDestroyed: () => false, detached: false },
    send: vi.fn(),
  }) as unknown as WebContents;

  return Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents,
  }) as unknown as BrowserWindow;
}

// Guards: the shared renderer-port mock detaches bindings on both Electron window death signals.
// Guards: failed feature registration removes renderer bindings before a retry can rebind them.
// Guards: disposing the mock removes its Electron lifecycle listeners.
describe("main renderer port mock lifecycle", () => {
  it.each(["closed", "destroyed"] as const)("detaches on %s", (eventName) => {
    const window = createWindow();
    const cleanup = vi.fn();
    const renderer = createMainRendererPortMock(window);
    renderer.useWindow("test", () => cleanup);

    if (eventName === "closed") window.emit("closed");
    else window.webContents.emit("destroyed");

    expect(renderer.current()).toBeNull();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("rolls back a binding registered by a failed feature", async () => {
    const firstWindow = createWindow();
    const secondWindow = createWindow();
    const attach = vi.fn(() => vi.fn());
    const renderer = createMainRendererPortMock(firstWindow);

    await expect(
      runFeatureRegistrationTransaction(async () => {
        renderer.useWindow("test", attach);
        throw new Error("registration failed");
      })
    ).rejects.toThrow("registration failed");

    renderer.bind(secondWindow);
    expect(attach).toHaveBeenCalledOnce();
  });

  it("removes lifecycle listeners when disposed", () => {
    const window = createWindow();
    const renderer = createMainRendererPortMock(window);

    expect(window.listenerCount("closed")).toBe(1);
    expect(window.webContents.listenerCount("destroyed")).toBe(1);
    renderer.dispose();
    expect(window.listenerCount("closed")).toBe(0);
    expect(window.webContents.listenerCount("destroyed")).toBe(0);
  });
});
