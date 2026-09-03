import { EventEmitter } from "node:events";

import type { BrowserWindow, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";

import { MainRendererPortController } from "@backend/ipc/main-renderer-port";
import { runFeatureRegistrationTransaction } from "@backend/ipc/feature-registration-transaction";
import { IPC_CHANNELS } from "@shared/ipc-channels";

interface FakeWindow extends EventEmitter {
  isDestroyed: ReturnType<typeof vi.fn>;
  webContents: EventEmitter & {
    id: number;
    isDestroyed: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
}

function createWindow(id: number): FakeWindow {
  const webContents = Object.assign(new EventEmitter(), {
    id,
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
  });
  return Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    webContents,
  });
}

// Guards: replacing the main renderer detaches old listeners and cannot be undone by late close events.
// Guards: process-owned publishers always target the live renderer, never a captured window generation.
describe("MainRendererPort", () => {
  it("replaces a window atomically and ignores late close events from the old window", () => {
    const port = new MainRendererPortController();
    const first = createWindow(1);
    const second = createWindow(2);
    const detach = vi.fn();
    const attach = vi.fn(() => detach);
    port.useWindow("test:listener", attach);

    port.bind(first as unknown as BrowserWindow);
    port.bind(second as unknown as BrowserWindow);
    first.emit("closed");

    expect(attach).toHaveBeenNthCalledWith(1, first);
    expect(attach).toHaveBeenNthCalledWith(2, second);
    expect(detach).toHaveBeenCalledOnce();
    expect(port.current()).toBe(second);
    expect(port.trustedSender()).toBe(second.webContents as unknown as WebContents);
  });

  it("sends only to the current live renderer and honors owner identity", () => {
    const port = new MainRendererPortController();
    const first = createWindow(1);
    const second = createWindow(2);

    port.bind(first as unknown as BrowserWindow);
    port.bind(second as unknown as BrowserWindow);

    expect(port.send(IPC_CHANNELS.WINDOW_ON_MAXIMIZE_CHANGE, true)).toBe(true);
    expect(port.sendToOwner(1, IPC_CHANNELS.WINDOW_ON_MAXIMIZE_CHANGE, false)).toBe(false);
    expect(port.sendToOwner(2, IPC_CHANNELS.WINDOW_ON_MAXIMIZE_CHANGE, false)).toBe(true);
    expect(first.webContents.send).not.toHaveBeenCalled();
    expect(second.webContents.send).toHaveBeenCalledTimes(2);
  });

  it("keeps a recovered renderer trusted when Electron retains a detached prior frame", () => {
    const port = new MainRendererPortController();
    const window = createWindow(1);
    Object.assign(window.webContents, {
      isCrashed: vi.fn(() => false),
      mainFrame: {
        isDestroyed: vi.fn(() => false),
        detached: true,
      },
    });

    port.bind(window as unknown as BrowserWindow);

    expect(port.trustedSender()).toBe(window.webContents as unknown as WebContents);
  });

  it("detaches once when either the window or its web contents closes", () => {
    const port = new MainRendererPortController();
    const window = createWindow(1);
    const cleanup = vi.fn();
    port.useWindow("test:listener", () => cleanup);
    port.bind(window as unknown as BrowserWindow);

    window.webContents.emit("destroyed");
    window.emit("closed");

    expect(cleanup).toHaveBeenCalledOnce();
    expect(port.current()).toBeNull();
    expect(port.trustedSender()).toBeNull();
  });

  it("does not retain a binding whose initial attachment throws", () => {
    const port = new MainRendererPortController();
    const window = createWindow(1);
    port.bind(window as unknown as BrowserWindow);

    expect(() =>
      port.useWindow("test:listener", () => {
        throw new Error("attach failed");
      })
    ).toThrow("attach failed");
    expect(() => port.useWindow("test:listener", () => undefined)).not.toThrow();
  });

  it("removes a window binding when its feature transaction fails", async () => {
    const port = new MainRendererPortController();
    const window = createWindow(1);
    const cleanup = vi.fn();
    port.bind(window as unknown as BrowserWindow);

    await expect(
      runFeatureRegistrationTransaction(async () => {
        port.useWindow("test:listener", () => cleanup);
        throw new Error("registration failed");
      })
    ).rejects.toThrow("registration failed");

    expect(cleanup).toHaveBeenCalledOnce();
    expect(() => port.useWindow("test:listener", () => undefined)).not.toThrow();
  });
});
