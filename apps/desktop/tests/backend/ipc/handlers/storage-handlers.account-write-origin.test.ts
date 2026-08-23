import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  KickAccountFollowWriteChangedEvent,
  KickAccountFollowWriteRequest,
} from "@/shared/auth-types";
import { IPC_CHANNELS } from "@/shared/ipc-channels";

const enqueue = vi.hoisted(() => vi.fn());
const onAccountWriteChanged = vi.hoisted(() => vi.fn());
const writeTwitch = vi.hoisted(() => vi.fn());
const warn = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/services/storage-service", () => ({
  storageService: {
    hasToken: vi.fn(() => true),
    getActiveFollowsByPlatform: vi.fn(() => []),
    getPendingFollowWritesByPlatform: vi.fn(() => []),
  },
}));

vi.mock("@/backend/services/kick-follow-write-service", () => ({
  kickFollowWriteService: { enqueue, onAccountWriteChanged },
}));

vi.mock("@/backend/services/twitch-follow-write-service", () => ({
  twitchFollowWriteService: { write: writeTwitch },
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: { warn },
}));

import { ipcMain } from "electron";

import {
  attachKickFollowWriteService,
  registerStorageHandlers,
} from "@/backend/ipc/handlers/storage-handlers";
import { storageService } from "@/backend/services/storage-service";

type Handler = (event: unknown, args?: unknown) => unknown;

function getHandler(channelName: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([channel]) => channel === channelName);
  if (!call) throw new Error(`${channelName} handler was not registered`);
  return call[1];
}

const request: KickAccountFollowWriteRequest = {
  action: "unfollow",
  follow: {
    platform: "kick",
    channelId: "411439",
    channelName: "summit1g",
    displayName: "Summit1G",
    profileImage: "",
  },
};

// Guards: remote renderer content must not be able to trigger privileged Kick account follow mutations.
// Guards: malformed renderer payloads cannot reach authentication or Kick account follow services.
// Guards: restart hydration exposes sanitized pending writes only to the authenticated application renderer.
// Guards: account-write transitions are forwarded only while the application renderer still exists.
// Guards: renderer forwarding failures cannot unwind account-write transitions or leak their payloads.
describe("storage-handlers Kick account write origin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueue.mockResolvedValue({ status: "confirmed", action: "unfollow" });
    writeTwitch.mockResolvedValue({ status: "confirmed", activeFollows: [] });
    vi.mocked(storageService.hasToken).mockReturnValue(true);
    vi.mocked(storageService.getPendingFollowWritesByPlatform).mockReturnValue([]);
  });

  it("returns sanitized persisted writes only to the authenticated application renderer", () => {
    vi.mocked(storageService.getPendingFollowWritesByPlatform).mockReturnValue([
      {
        id: 73,
        platform: "kick",
        channelId: "legacy-kick-id",
        slug: "SUMMIT1G",
        action: "unfollow",
        status: "pending",
        createdAt: "2026-08-03T00:00:00.000Z",
        attemptedAt: "2026-08-03T00:00:00.000Z",
        nextAttemptAt: "2026-08-03T00:00:01.000Z",
        expiresAt: "2026-08-03T00:10:00.000Z",
        attemptCount: 1,
        lastError: "not-confirmed",
      },
    ]);
    registerStorageHandlers();
    const handler = getHandler(IPC_CHANNELS.FOLLOWS_GET_ACCOUNT_WRITES);

    expect(handler({ senderFrame: { url: "file:///streamfusion/index.html" } })).toEqual([
      {
        status: "pending",
        action: "unfollow",
        target: {
          platform: "kick",
          channelId: "legacy-kick-id",
          channelName: "SUMMIT1G",
        },
        createdAt: "2026-08-03T00:00:00.000Z",
        attemptedAt: "2026-08-03T00:00:00.000Z",
        nextAttemptAt: "2026-08-03T00:00:01.000Z",
        expiresAt: "2026-08-03T00:10:00.000Z",
        attemptCount: 1,
        lastError: "not-confirmed",
      },
    ]);

    expect(handler({ senderFrame: { url: "https://evil.example.com/embed" } })).toEqual([]);

    vi.mocked(storageService.hasToken).mockReturnValue(false);
    expect(handler({ senderFrame: { url: "file:///streamfusion/index.html" } })).toEqual([]);
    expect(storageService.getPendingFollowWritesByPlatform).toHaveBeenCalledTimes(1);
  });

  it("benignly rejects an unexpected sender without calling the Kick write service", async () => {
    registerStorageHandlers();

    const result = await getHandler(IPC_CHANNELS.FOLLOWS_WRITE_ACCOUNT)(
      { senderFrame: { url: "https://evil.example.com/embed" } },
      request
    );

    expect(result).toEqual({
      status: "rejected",
      activeFollows: [],
      error: "Rejected: caller is not the application renderer.",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("benignly rejects malformed account writes before authentication or service access", async () => {
    registerStorageHandlers();
    const handler = getHandler(IPC_CHANNELS.FOLLOWS_WRITE_ACCOUNT);
    const allowedSender = { senderFrame: { url: "file:///streamfusion/index.html" } };
    const malformedRequests: unknown[] = [
      {
        action: request.action,
        follow: { ...request.follow, platform: "youtube" },
      },
      {
        action: "delete",
        follow: request.follow,
      },
      {
        action: request.action,
        follow: { ...request.follow, channelName: "   " },
      },
    ];

    const results = await Promise.all(
      malformedRequests.map((payload) => handler(allowedSender, payload))
    );

    expect(results).toEqual(
      malformedRequests.map(() => ({
        status: "rejected",
        activeFollows: [],
        error: "Rejected: invalid Kick account follow request.",
      }))
    );
    expect(storageService.hasToken).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("routes an authenticated Twitch account write through confirmed reconciliation", async () => {
    const twitchRequest = {
      action: "follow",
      follow: {
        platform: "twitch",
        channelId: "141981764",
        channelName: "example_channel",
        displayName: "Example Channel",
        profileImage: "https://static.example/avatar.png",
      },
    };
    registerStorageHandlers();

    const result = await getHandler(IPC_CHANNELS.FOLLOWS_WRITE_ACCOUNT)(
      { senderFrame: { url: "file:///streamfusion/index.html" } },
      twitchRequest
    );

    expect(writeTwitch).toHaveBeenCalledWith(twitchRequest.follow, "follow");
    expect(result).toEqual({ status: "confirmed", activeFollows: [] });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("safely forwards sanitized account-write transitions to the renderer", () => {
    let publish!: (event: KickAccountFollowWriteChangedEvent) => void;
    onAccountWriteChanged.mockImplementation((listener) => {
      publish = listener;
      return vi.fn();
    });
    const send = vi.fn();
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send,
      },
    } as unknown as BrowserWindow;
    const event: KickAccountFollowWriteChangedEvent = {
      status: "confirmed",
      action: "unfollow",
      target: {
        platform: "kick",
        channelId: "411439",
        channelName: "summit1g",
      },
      activeFollows: [],
    };
    registerStorageHandlers(mainWindow);
    attachKickFollowWriteService({
      onAccountWriteChanged,
    } as unknown as Parameters<typeof attachKickFollowWriteService>[0]);

    publish(event);

    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.FOLLOWS_ACCOUNT_WRITE_CHANGED, event);
    vi.mocked(mainWindow.isDestroyed).mockReturnValue(true);
    publish(event);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("swallows renderer send failures and logs only sanitized forwarding context", () => {
    let publish!: (event: KickAccountFollowWriteChangedEvent) => void;
    onAccountWriteChanged.mockImplementation((listener) => {
      publish = listener;
      return vi.fn();
    });

    const send = vi.fn(() => {
      throw new Error("render failure with raw-secret-value");
    });
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send,
      },
    } as unknown as BrowserWindow;
    const event: KickAccountFollowWriteChangedEvent = {
      status: "failed",
      action: "unfollow",
      target: {
        platform: "kick",
        channelId: "secret-channel-id",
        channelName: "secret-channel-name",
      },
      activeFollows: [],
      reason: "retry-expired",
    };

    registerStorageHandlers(mainWindow);
    attachKickFollowWriteService({
      onAccountWriteChanged,
    } as unknown as Parameters<typeof attachKickFollowWriteService>[0]);

    expect(() => publish(event)).not.toThrow();
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.FOLLOWS_ACCOUNT_WRITE_CHANGED, event);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "IPC:Follows",
      "Could not forward account-write transition to renderer"
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("raw-secret-value");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-channel-name");
  });
});
