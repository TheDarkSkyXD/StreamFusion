import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowBinding } from "@backend/ipc/main-renderer-port";

const handlers = new Map<string, (event: { sender: { id: number } }, value: unknown) => unknown>();

vi.mock("@backend/ipc/trusted-ipc-main", () => ({
  trustedIpcMain: {
    handle: (
      channel: string,
      handler: (event: { sender: { id: number } }, value: unknown) => unknown
    ) => {
      handlers.set(channel, handler);
    },
  },
}));

import { IPC_CHANNELS } from "@shared/ipc-channels";
import { registerProtectedPlaybackRoutes } from "@backend/features/playback/routes/protected-playback-routes";

describe("protected playback IPC", () => {
  const host = {
    open: vi.fn().mockResolvedValue({ kind: "opened" }),
    focus: vi.fn(),
    close: vi.fn(),
    mute: vi.fn(),
    present: vi.fn().mockResolvedValue(undefined),
    closeOwner: vi.fn(),
    closeAll: vi.fn(),
  };
  const renderer = {
    current: vi.fn().mockReturnValue({ webContents: { id: 7 } }),
    useWindow: vi.fn((_key: string, _attach: WindowBinding) => vi.fn()),
    sendToOwner: vi.fn(),
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerProtectedPlaybackRoutes(renderer, host, vi.fn().mockResolvedValue(true));
  });

  it("rejects arbitrary URLs and invalid slugs before creating a native window", async () => {
    const open = handlers.get(IPC_CHANNELS.PROTECTED_PLAYBACK_OPEN)!;
    await expect(
      open(
        { sender: { id: 7 } },
        {
          ownerId: "player-1",
          channelSlug: "primevideo",
          muted: false,
          url: "https://attacker.example/",
        }
      )
    ).resolves.toEqual({ kind: "unavailable", reason: "host-start-failed" });
    await expect(
      open(
        { sender: { id: 7 } },
        {
          ownerId: "player-1",
          channelSlug: "prime/video",
          muted: false,
        }
      )
    ).resolves.toEqual({ kind: "unavailable", reason: "host-start-failed" });
    expect(host.open).not.toHaveBeenCalled();
  });

  it("rejects a failed metadata lookup while invalid check requests remain false", async () => {
    const detect = vi.fn().mockRejectedValue(new Error("Twitch metadata unavailable"));
    registerProtectedPlaybackRoutes(renderer, host, detect);
    const check = handlers.get(IPC_CHANNELS.PROTECTED_PLAYBACK_CHECK)!;

    await expect(check({ sender: { id: 7 } }, { channelSlug: "prime/video" })).resolves.toBe(false);
    expect(detect).not.toHaveBeenCalled();
    await expect(check({ sender: { id: 7 } }, { channelSlug: "primevideo" })).rejects.toThrow(
      "Twitch metadata unavailable"
    );
  });

  it("scopes controls to the calling renderer and validated owner", async () => {
    const open = handlers.get(IPC_CHANNELS.PROTECTED_PLAYBACK_OPEN)!;
    const close = handlers.get(IPC_CHANNELS.PROTECTED_PLAYBACK_CLOSE)!;
    await open(
      { sender: { id: 7 } },
      { ownerId: "player-1", channelSlug: "primevideo", muted: false }
    );
    expect(host.open).toHaveBeenCalledWith(expect.objectContaining({ ownerKey: "7:player-1" }));
    await close({ sender: { id: 8 } }, { ownerId: "player-1" });
    expect(host.close).toHaveBeenCalledWith("8:player-1");
    await close({ sender: { id: 7 } }, { ownerId: "../../another" });
    expect(host.close).toHaveBeenCalledTimes(1);
  });

  it("accepts only bounded presentation from the current renderer", async () => {
    const present = handlers.get(IPC_CHANNELS.PROTECTED_PLAYBACK_PRESENT)!;
    const layout = {
      ownerId: "player-1",
      revision: 2,
      presentation: "docked",
      blockerEnabled: true,
      layout: {
        kind: "visible",
        boundsCss: { x: 10, y: 20, width: 640, height: 360 },
        clipCss: { x: 10, y: 40, width: 640, height: 340 },
        radiusCss: 0,
      },
    };
    await present({ sender: { id: 7 } }, layout);
    expect(host.present).toHaveBeenCalledWith(
      "7:player-1",
      expect.objectContaining({ revision: 2 })
    );
    await present({ sender: { id: 7 } }, { ...layout, revision: 3, presentation: "theater" });
    expect(host.present).toHaveBeenCalledWith(
      "7:player-1",
      expect.objectContaining({ revision: 3, presentation: "theater" })
    );
    await present({ sender: { id: 8 } }, layout);
    await present({ sender: { id: 7 } }, { ...layout, revision: -1 });
    await present(
      { sender: { id: 7 } },
      {
        ...layout,
        layout: { ...layout.layout, clipCss: { x: 10, y: 40, width: 700, height: 340 } },
      }
    );
    expect(host.present).toHaveBeenCalledTimes(2);
  });

  it("keeps the player on same-document navigation and closes it on reload", () => {
    const binding = renderer.useWindow.mock.calls[0][1];
    const contents = Object.assign(new EventEmitter(), { id: 7 });
    const cleanup = binding({ webContents: contents } as unknown as BrowserWindow);

    contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    expect(host.closeOwner).not.toHaveBeenCalled();
    contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    expect(host.closeOwner).toHaveBeenCalledExactlyOnceWith(7);
    cleanup?.();
  });
});
