import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalFollow } from "@shared/auth-types";
import { Platform } from "@streamfusion/core/platform";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import { createIsolatedDatabaseTestLifecycle } from "../../../helpers/database-test-lifecycle";

// Capture ipcMain.handle registrations so we can invoke the FOLLOWS_ADD
// handler directly. storage-service is fully mocked — we only assert how the
// handler routes `source` based on per-platform token presence.
vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@backend/services/storage-service", () => ({
  storageService: {
    hasToken: vi.fn(),
    addLocalFollow: vi.fn(),
    getActiveFollowsByPlatform: vi.fn(),
    getLocalFollowsByPlatform: vi.fn(),
    updateLocalFollow: vi.fn(),
  },
}));

import { app, ipcMain } from "electron";

import { registerStorageHandlers } from "@backend/ipc/handlers/storage-handlers";
import { dbService } from "@backend/services/database-service";
import { storageService } from "@backend/services/storage-service";

type AddArgs = { follow: Omit<LocalFollow, "id" | "followedAt"> };
type Handler = (event: unknown, args?: unknown) => unknown;

const databaseLifecycle = createIsolatedDatabaseTestLifecycle(
  dbService,
  (directory) => vi.mocked(app.getPath).mockReturnValue(directory),
  "streamfusion-storage-handlers-"
);

function getHandler(channelName: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([channel]) => channel === channelName);
  if (!call) throw new Error(`${channelName} handler was not registered`);
  return call[1];
}

function makeFollow(platform: Platform): AddArgs["follow"] {
  return {
    platform,
    channelId: platform === "kick" ? "411439" : "12345",
    channelName: platform === "kick" ? "summit1g" : "shroud",
    displayName: platform === "kick" ? "Summit1G" : "shroud",
    profileImage: "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  databaseLifecycle.initialize();
  vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([]);
  vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([]);
});

afterEach(() => {
  databaseLifecycle.dispose();
});

// Guards: signed-in account follows must not create local rows that look remotely confirmed.
// Guards: rejected account-follow details stay behind the IPC boundary and return only a diagnostic ID.
describe("storage-handlers FOLLOWS_ADD — per-platform source routing", () => {
  it("signed in to Twitch -> rejects local add instead of creating a fake account follow", () => {
    vi.mocked(storageService.hasToken).mockImplementation((p: Platform) => p === "twitch");
    registerStorageHandlers();

    const follow = makeFollow("twitch");
    expect(() => getHandler(IPC_CHANNELS.FOLLOWS_ADD)({}, { follow })).toThrow(
      "IPC request failed"
    );

    expect(storageService.hasToken).toHaveBeenCalledWith("twitch");
    expect(storageService.addLocalFollow).not.toHaveBeenCalled();
  });

  it("signed in to Kick -> rejects local add instead of creating a fake account follow", () => {
    vi.mocked(storageService.hasToken).mockImplementation((p: Platform) => p === "kick");
    registerStorageHandlers();

    const follow = makeFollow("kick");
    expect(() => getHandler(IPC_CHANNELS.FOLLOWS_ADD)({}, { follow })).toThrow(
      "IPC request failed"
    );

    expect(storageService.addLocalFollow).not.toHaveBeenCalled();
  });

  it("signed out of the channel's platform → writes source='guest'", () => {
    vi.mocked(storageService.hasToken).mockReturnValue(false);
    registerStorageHandlers();

    const follow = makeFollow("kick");
    getHandler(IPC_CHANNELS.FOLLOWS_ADD)({}, { follow });

    expect(storageService.addLocalFollow).toHaveBeenCalledWith(follow, "guest");
  });

  it("routes per the channel's OWN platform: signed in to Twitch only, following a Kick channel → 'guest'", () => {
    // hasToken true for twitch, false for kick. A Kick follow must be 'guest'
    // because the routing checks follow.platform, not "any signed-in platform".
    vi.mocked(storageService.hasToken).mockImplementation((p: Platform) => p === "twitch");
    registerStorageHandlers();

    const kickFollow = makeFollow("kick");
    getHandler(IPC_CHANNELS.FOLLOWS_ADD)({}, { follow: kickFollow });
    expect(storageService.addLocalFollow).toHaveBeenCalledWith(kickFollow, "guest");

    const twitchFollow = makeFollow("twitch");
    expect(() => getHandler(IPC_CHANNELS.FOLLOWS_ADD)({}, { follow: twitchFollow })).toThrow(
      "IPC request failed"
    );
    expect(storageService.addLocalFollow).toHaveBeenCalledOnce();
  });

  it("returns whatever addLocalFollow returns (pass-through)", () => {
    vi.mocked(storageService.hasToken).mockReturnValue(false);
    const row = {
      id: "x",
      platform: "kick",
      channelId: "411439",
      channelName: "summit1g",
      displayName: "Summit1G",
      profileImage: "",
      followedAt: "t",
      source: "guest",
    } as LocalFollow;
    vi.mocked(storageService.addLocalFollow).mockReturnValue(row);
    registerStorageHandlers();

    const result = getHandler(IPC_CHANNELS.FOLLOWS_ADD)({}, { follow: makeFollow("kick") });
    expect(result).toBe(row);
  });
});

// Guards: renderer hydration is a local database read and never waits for platform I/O.
// Kick metadata maintenance belongs to the background synchronization boundary.
describe("storage-handlers follow reads", () => {
  it("returns the persisted Twitch and Kick follows synchronously", () => {
    const kickFollow = {
      id: "kick-row-1",
      platform: "kick",
      channelId: "123",
      channelName: "kick-channel",
      displayName: "Kick Channel",
      profileImage: "",
      followedAt: "2026-01-01T00:00:00.000Z",
      source: "guest",
    } as LocalFollow;
    const twitchFollow = {
      id: "twitch-row-1",
      platform: "twitch",
      channelId: "456",
      channelName: "twitchy",
      displayName: "Twitchy",
      profileImage: "",
      followedAt: "2026-01-01T00:00:00.000Z",
      source: "guest",
    } as LocalFollow;

    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation((platform) => {
      if (platform === "twitch") return [twitchFollow];
      return [kickFollow];
    });
    registerStorageHandlers();

    const result = getHandler(IPC_CHANNELS.FOLLOWS_GET_ALL)({});

    expect(result).not.toBeInstanceOf(Promise);
    expect((result as LocalFollow[]).map((follow) => follow.channelName)).toEqual([
      "twitchy",
      "kick-channel",
    ]);
    expect(storageService.getActiveFollowsByPlatform).toHaveBeenCalledTimes(2);
  });

  it("returns one platform from the same local read boundary", () => {
    const kickFollow = {
      id: "kick-account-channel",
      platform: "kick",
      channelId: "123",
      channelName: "kick-channel",
      displayName: "Kick Channel",
      profileImage: "",
      followedAt: "2026-01-01T00:00:00.000Z",
      source: "kick",
    } as LocalFollow;
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([kickFollow]);
    registerStorageHandlers();

    const result = getHandler(IPC_CHANNELS.FOLLOWS_GET_BY_PLATFORM)({}, { platform: "kick" });

    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toEqual([kickFollow]);
    expect(storageService.getActiveFollowsByPlatform).toHaveBeenCalledOnce();
  });
});
