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

describe("storage-handlers FOLLOWS_ADD — per-platform source routing", () => {
  it("signed in to the channel's platform → writes source='local'", () => {
    vi.mocked(storageService.hasToken).mockReturnValue(true);
    registerStorageHandlers();

    const follow = makeFollow("kick");
    getFollowsAddHandler()({}, { follow });

    expect(storageService.hasToken).toHaveBeenCalledWith("kick");
    expect(storageService.addLocalFollow).toHaveBeenCalledWith(follow, "local");
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
    expect(storageService.addLocalFollow).toHaveBeenCalledWith(twitchFollow, "local");
  });

  it("returns whatever addLocalFollow returns (pass-through)", () => {
    vi.mocked(storageService.hasToken).mockReturnValue(true);
    const row = {
      id: "x",
      platform: "kick",
      channelId: "411439",
      channelName: "summit1g",
      displayName: "Summit1G",
      profileImage: "",
      followedAt: "t",
      source: "local",
    } as LocalFollow;
    vi.mocked(storageService.addLocalFollow).mockReturnValue(row);
    registerStorageHandlers();

    const result = getFollowsAddHandler()({}, { follow: makeFollow("kick") });
    expect(result).toBe(row);
  });
});
