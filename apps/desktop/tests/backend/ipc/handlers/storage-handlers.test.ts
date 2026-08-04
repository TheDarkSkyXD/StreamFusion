import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalFollow, Platform } from "@/shared/auth-types";
import { IPC_CHANNELS } from "@/shared/ipc-channels";
import { createIsolatedDatabaseTestLifecycle } from "../../../helpers/database-test-lifecycle";

// Capture ipcMain.handle registrations so we can invoke the FOLLOWS_ADD
// handler directly. storage-service is fully mocked — we only assert how the
// handler routes `source` based on per-platform token presence.
vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/services/storage-service", () => ({
  storageService: {
    hasToken: vi.fn(),
    addLocalFollow: vi.fn(),
    getActiveFollowsByPlatform: vi.fn(),
    getLocalFollowsByPlatform: vi.fn(),
    updateLocalFollow: vi.fn(),
  },
}));

vi.mock("@/backend/api/platforms/kick/kick-client", () => ({
  kickClient: {
    getChannelsByBroadcasterIds: vi.fn(),
    getPublicChannel: vi.fn(),
  },
}));

import { app, ipcMain } from "electron";

import { kickClient } from "@/backend/api/platforms/kick/kick-client";
import { registerStorageHandlers } from "@/backend/ipc/handlers/storage-handlers";
import { dbService } from "@/backend/services/database-service";
import { storageService } from "@/backend/services/storage-service";

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
describe("storage-handlers FOLLOWS_ADD — per-platform source routing", () => {
  it("signed in to Twitch -> rejects local add instead of creating a fake account follow", () => {
    vi.mocked(storageService.hasToken).mockImplementation((p: Platform) => p === "twitch");
    registerStorageHandlers();

    const follow = makeFollow("twitch");
    expect(() => getHandler(IPC_CHANNELS.FOLLOWS_ADD)({}, { follow })).toThrow(
      "Twitch account follows must be confirmed by Twitch"
    );

    expect(storageService.hasToken).toHaveBeenCalledWith("twitch");
    expect(storageService.addLocalFollow).not.toHaveBeenCalled();
  });

  it("signed in to Kick -> rejects local add instead of creating a fake account follow", () => {
    vi.mocked(storageService.hasToken).mockImplementation((p: Platform) => p === "kick");
    registerStorageHandlers();

    const follow = makeFollow("kick");
    expect(() => getHandler(IPC_CHANNELS.FOLLOWS_ADD)({}, { follow })).toThrow(
      "Kick account follows must be confirmed by Kick"
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
      "Twitch account follows must be confirmed by Twitch"
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

// Guards: renderer follow hydration must repair renamed Kick slugs before Following renders offline channel links.
describe("storage-handlers FOLLOWS_GET_ALL — Kick rename repair", () => {
  it("returns re-read Kick follows after repairing stale slugs by broadcaster id", async () => {
    const staleKickFollow = {
      id: "kick-row-1",
      platform: "kick",
      channelId: "123",
      channelName: "old-slug",
      displayName: "Old Slug",
      profileImage: "",
      followedAt: "2026-01-01T00:00:00.000Z",
      source: "guest",
    } as LocalFollow;
    const repairedKickFollow = {
      ...staleKickFollow,
      channelName: "new-slug",
      displayName: "New Slug",
      profileImage: "https://example.com/new.jpg",
    };
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
      const callCount = vi
        .mocked(storageService.getActiveFollowsByPlatform)
        .mock.calls.filter(([calledPlatform]) => calledPlatform === "kick").length;
      return callCount <= 1 ? [staleKickFollow] : [repairedKickFollow];
    });
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([
      {
        id: "123",
        platform: "kick",
        username: "new-slug",
        displayName: "New Slug",
        avatarUrl: "https://example.com/new.jpg",
      },
    ] as any);
    vi.mocked(kickClient.getPublicChannel).mockResolvedValue({
      id: "123",
      platform: "kick",
      username: "new-slug",
      displayName: "New Slug",
      avatarUrl: "https://example.com/new.jpg",
      kickUserId: "123",
      isVerified: false,
    } as any);
    registerStorageHandlers();

    const result = (await getHandler(IPC_CHANNELS.FOLLOWS_GET_ALL)({})) as LocalFollow[];

    expect(kickClient.getChannelsByBroadcasterIds).toHaveBeenCalledWith([123]);
    expect(storageService.updateLocalFollow).toHaveBeenCalledWith("kick-row-1", {
      channelName: "new-slug",
      displayName: "New Slug",
      profileImage: "https://example.com/new.jpg",
    });
    expect(result.map((follow) => follow.channelName)).toEqual(["twitchy", "new-slug"]);
  });

  it("repairs a slug-id active Kick row by borrowing the stable id from a hidden sibling row", async () => {
    const activeSlugOnlyFollow = {
      id: "kick-account-old-slug",
      platform: "kick",
      channelId: "old-slug",
      channelName: "old-slug",
      displayName: "Old Slug",
      profileImage: "",
      followedAt: "2026-01-01T00:00:00.000Z",
      source: "kick",
    } as LocalFollow;
    const hiddenGuestFollowWithStableId = {
      ...activeSlugOnlyFollow,
      id: "kick-guest-stable-id",
      channelId: "123",
      source: "guest",
    } as LocalFollow;
    const repairedKickFollow = {
      ...activeSlugOnlyFollow,
      channelId: "123",
      channelName: "new-slug",
      displayName: "New Slug",
    };

    vi.mocked(storageService.getActiveFollowsByPlatform).mockImplementation((platform) => {
      if (platform === "twitch") return [];
      const callCount = vi
        .mocked(storageService.getActiveFollowsByPlatform)
        .mock.calls.filter(([calledPlatform]) => calledPlatform === "kick").length;
      return callCount <= 1 ? [activeSlugOnlyFollow] : [repairedKickFollow];
    });
    vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([
      activeSlugOnlyFollow,
      hiddenGuestFollowWithStableId,
    ]);
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([
      {
        id: "123",
        platform: "kick",
        username: "new-slug",
        displayName: "New Slug",
        avatarUrl: "",
      },
    ] as any);
    vi.mocked(kickClient.getPublicChannel).mockResolvedValue({
      id: "123",
      platform: "kick",
      username: "new-slug",
      displayName: "New Slug",
      avatarUrl: "",
      kickUserId: "123",
      isVerified: false,
    } as any);
    registerStorageHandlers();

    const result = (await getHandler(IPC_CHANNELS.FOLLOWS_GET_ALL)({})) as LocalFollow[];

    expect(kickClient.getChannelsByBroadcasterIds).toHaveBeenCalledWith([123]);
    expect(storageService.updateLocalFollow).toHaveBeenCalledWith("kick-account-old-slug", {
      channelId: "123",
      channelName: "new-slug",
      displayName: "New Slug",
    });
    expect(
      result.map((follow) => `${follow.source}:${follow.channelId}:${follow.channelName}`)
    ).toEqual(["kick:123:new-slug"]);
  });
});
