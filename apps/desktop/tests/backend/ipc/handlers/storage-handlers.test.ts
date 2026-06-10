import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalFollow, Platform } from "@/shared/auth-types";
import { IPC_CHANNELS } from "@/shared/ipc-channels";

// Capture ipcMain.handle registrations so we can invoke the FOLLOWS_ADD
// handler directly. storage-service is fully mocked — we only assert how the
// handler routes `source` based on per-platform token presence.
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/services/storage-service", () => ({
  storageService: {
    hasToken: vi.fn(),
    addLocalFollow: vi.fn(),
  },
}));

import { ipcMain } from "electron";

import { registerStorageHandlers } from "@/backend/ipc/handlers/storage-handlers";
import { storageService } from "@/backend/services/storage-service";

type AddArgs = { follow: Omit<LocalFollow, "id" | "followedAt"> };
type Handler = (event: unknown, args: AddArgs) => unknown;

function getFollowsAddHandler(): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([channel]) => channel === IPC_CHANNELS.FOLLOWS_ADD);
  if (!call) throw new Error("FOLLOWS_ADD handler was not registered");
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
});

// Guards: signed-in Kick Follow clicks must not create local rows that look like confirmed Kick account follows.
describe("storage-handlers FOLLOWS_ADD — per-platform source routing", () => {
  it("signed in to Twitch -> writes source = twitch", () => {
    vi.mocked(storageService.hasToken).mockImplementation((p: Platform) => p === "twitch");
    registerStorageHandlers();

    const follow = makeFollow("twitch");
    getFollowsAddHandler()({}, { follow });

    expect(storageService.hasToken).toHaveBeenCalledWith("twitch");
    expect(storageService.addLocalFollow).toHaveBeenCalledWith(follow, "twitch");
  });

  it("signed in to Kick -> rejects local add instead of creating a fake account follow", () => {
    vi.mocked(storageService.hasToken).mockImplementation((p: Platform) => p === "kick");
    registerStorageHandlers();

    const follow = makeFollow("kick");
    expect(() => getFollowsAddHandler()({}, { follow })).toThrow(
      "Kick account follows must be confirmed by Kick"
    );

    expect(storageService.addLocalFollow).not.toHaveBeenCalled();
  });

  it("signed out of the channel's platform → writes source='guest'", () => {
    vi.mocked(storageService.hasToken).mockReturnValue(false);
    registerStorageHandlers();

    const follow = makeFollow("kick");
    getFollowsAddHandler()({}, { follow });

    expect(storageService.addLocalFollow).toHaveBeenCalledWith(follow, "guest");
  });

  it("routes per the channel's OWN platform: signed in to Twitch only, following a Kick channel → 'guest'", () => {
    // hasToken true for twitch, false for kick. A Kick follow must be 'guest'
    // because the routing checks follow.platform, not "any signed-in platform".
    vi.mocked(storageService.hasToken).mockImplementation((p: Platform) => p === "twitch");
    registerStorageHandlers();

    const kickFollow = makeFollow("kick");
    getFollowsAddHandler()({}, { follow: kickFollow });
    expect(storageService.addLocalFollow).toHaveBeenCalledWith(kickFollow, "guest");

    const twitchFollow = makeFollow("twitch");
    getFollowsAddHandler()({}, { follow: twitchFollow });
    expect(storageService.addLocalFollow).toHaveBeenCalledWith(twitchFollow, "twitch");
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

    const result = getFollowsAddHandler()({}, { follow: makeFollow("kick") });
    expect(result).toBe(row);
  });
});
