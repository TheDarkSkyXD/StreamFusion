import { beforeEach, describe, expect, it, vi } from "vitest";

import { TwitchFollowWriteError } from "@backend/api/platforms/twitch/endpoints/follow-endpoints";
import { createTwitchFollowWriteService } from "@backend/services/twitch-follow-write-service";
import type { UnifiedChannel } from "@shared/platform-types";
import type { LocalFollow } from "@shared/auth-types";

const target = {
  platform: "twitch",
  channelId: "141981764",
  channelName: "example_channel",
  displayName: "Example Channel",
  profileImage: "https://static.example/stale.png",
} satisfies Omit<LocalFollow, "id" | "followedAt">;

const authoritativeChannel = {
  id: "141981764",
  platform: "twitch",
  username: "example_channel",
  displayName: "ExampleChannel",
  avatarUrl: "https://static.example/authoritative.png",
  isLive: false,
  isVerified: false,
  isPartner: false,
} satisfies UnifiedChannel;

const confirmedFollow = {
  ...target,
  id: "twitch:141981764",
  displayName: authoritativeChannel.displayName,
  profileImage: authoritativeChannel.avatarUrl,
  followedAt: "2026-08-03T12:00:00.000Z",
  source: "twitch",
} satisfies LocalFollow;

// Guards: a private Twitch mutation is only accepted; a fresh Helix followed-list
// must confirm it before account state is published to the renderer.
describe("twitch-follow-write-service", () => {
  const storage = {
    hasToken: vi.fn(),
    upsertSyncedFollows: vi.fn(),
    getActiveFollowsByPlatform: vi.fn(),
  };
  const getCredential = vi.fn();
  const clearCredential = vi.fn();
  const getCurrentUser = vi.fn();
  const writeTwitchAccountFollow = vi.fn();
  const getAllFollowedChannels = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    storage.hasToken.mockReturnValue(true);
    storage.upsertSyncedFollows.mockReturnValue({
      accountCount: 1,
      pendingCount: 0,
      addedCount: 1,
      removedCount: 0,
    });
    storage.getActiveFollowsByPlatform.mockReturnValue([confirmedFollow]);
    getCredential.mockResolvedValue({
      clientId: "xtra-client",
      accessToken: "test-token",
      userId: "write-account-42",
    });
    getCurrentUser.mockResolvedValue({ id: "write-account-42" });
    writeTwitchAccountFollow.mockResolvedValue({ status: "accepted" });
    getAllFollowedChannels.mockResolvedValue([authoritativeChannel]);
  });

  it("confirms an authenticated follow from a fresh authoritative followed-list", async () => {
    const service = createTwitchFollowWriteService({
      storage,
      getCredential,
      clearCredential,
      getCurrentUser,
      writeTwitchAccountFollow,
      getAllFollowedChannels,
    });

    await expect(service.write(target, "follow")).resolves.toEqual({
      status: "confirmed",
      activeFollows: [confirmedFollow],
    });

    expect(writeTwitchAccountFollow).toHaveBeenCalledWith({
      action: "follow",
      channelId: target.channelId,
      credential: {
        clientId: "xtra-client",
        accessToken: "test-token",
        userId: "write-account-42",
      },
    });
    expect(getAllFollowedChannels).toHaveBeenCalledOnce();
    expect(storage.upsertSyncedFollows).toHaveBeenCalledWith(
      "twitch",
      [
        {
          platform: "twitch",
          channelId: authoritativeChannel.id,
          channelName: authoritativeChannel.username,
          displayName: authoritativeChannel.displayName,
          profileImage: authoritativeChannel.avatarUrl,
        },
      ],
      { pruneAbsent: true }
    );
    expect(storage.getActiveFollowsByPlatform).toHaveBeenCalledWith("twitch");
  });

  it("confirms an authenticated unfollow only after the channel is absent remotely", async () => {
    getAllFollowedChannels.mockResolvedValue([]);
    storage.getActiveFollowsByPlatform.mockReturnValue([]);
    const service = createTwitchFollowWriteService({
      storage,
      getCredential,
      clearCredential,
      getCurrentUser,
      writeTwitchAccountFollow,
      getAllFollowedChannels,
    });

    await expect(service.write(target, "unfollow")).resolves.toEqual({
      status: "confirmed",
      activeFollows: [],
    });

    expect(writeTwitchAccountFollow).toHaveBeenCalledWith({
      action: "unfollow",
      channelId: target.channelId,
      credential: {
        clientId: "xtra-client",
        accessToken: "test-token",
        userId: "write-account-42",
      },
    });
    expect(storage.upsertSyncedFollows).toHaveBeenCalledWith("twitch", [], {
      pruneAbsent: true,
    });
  });

  it("does not publish success when the authoritative refresh fails", async () => {
    getAllFollowedChannels.mockRejectedValue(new Error("network timeout"));
    const service = createTwitchFollowWriteService({
      storage,
      getCredential,
      clearCredential,
      getCurrentUser,
      writeTwitchAccountFollow,
      getAllFollowedChannels,
    });

    await expect(service.write(target, "follow")).rejects.toMatchObject({
      name: "TwitchFollowWriteError",
      code: "transient",
      message: "Twitch could not confirm the follow change. Try again.",
    });

    expect(storage.upsertSyncedFollows).not.toHaveBeenCalled();
    expect(storage.getActiveFollowsByPlatform).not.toHaveBeenCalled();
  });

  it("clears rejected follow authorization and explains that Twitch must be reconnected", async () => {
    writeTwitchAccountFollow.mockRejectedValue(
      new TwitchFollowWriteError(
        "authorization-required",
        "Reconnect Twitch follow access, then try again."
      )
    );
    const service = createTwitchFollowWriteService({
      storage,
      getCredential,
      clearCredential,
      getCurrentUser,
      writeTwitchAccountFollow,
      getAllFollowedChannels,
    });

    await expect(service.write(target, "follow")).rejects.toMatchObject({
      name: "TwitchFollowWriteError",
      code: "authorization-required",
      message: "Reconnect Twitch follow access, then try again.",
    });

    expect(clearCredential).toHaveBeenCalledOnce();
    expect(getAllFollowedChannels).not.toHaveBeenCalled();
    expect(storage.upsertSyncedFollows).not.toHaveBeenCalled();
  });

  it("explains missing or insufficient follow-write authorization", async () => {
    getCredential.mockRejectedValue(
      new Error("Twitch follow authorization returned an invalid credential")
    );
    const service = createTwitchFollowWriteService({
      storage,
      getCredential,
      clearCredential,
      getCurrentUser,
      writeTwitchAccountFollow,
      getAllFollowedChannels,
    });

    await expect(service.write(target, "follow")).rejects.toMatchObject({
      name: "TwitchFollowWriteError",
      code: "authorization-required",
      message: "Reconnect Twitch follow access, then try again.",
    });

    expect(writeTwitchAccountFollow).not.toHaveBeenCalled();
    expect(getAllFollowedChannels).not.toHaveBeenCalled();
  });

  it("rejects a follow-write credential authorized for a different Twitch account", async () => {
    getCurrentUser.mockResolvedValue({ id: "main-account-99" });
    const service = createTwitchFollowWriteService({
      storage,
      getCredential,
      clearCredential,
      getCurrentUser,
      writeTwitchAccountFollow,
      getAllFollowedChannels,
    });

    await expect(service.write(target, "follow")).rejects.toMatchObject({
      name: "TwitchFollowWriteError",
      code: "authorization-required",
      message: "Authorize Twitch follow access with the same Twitch account, then try again.",
    });

    expect(clearCredential).toHaveBeenCalledOnce();
    expect(writeTwitchAccountFollow).not.toHaveBeenCalled();
    expect(getAllFollowedChannels).not.toHaveBeenCalled();
  });

  it("requires the main Twitch session without discarding valid follow authorization", async () => {
    getCurrentUser.mockResolvedValue(null);
    const service = createTwitchFollowWriteService({
      storage,
      getCredential,
      clearCredential,
      getCurrentUser,
      writeTwitchAccountFollow,
      getAllFollowedChannels,
    });

    await expect(service.write(target, "follow")).rejects.toMatchObject({
      name: "TwitchFollowWriteError",
      code: "authorization-required",
      message: "Reconnect Twitch, then try the follow change again.",
    });

    expect(clearCredential).not.toHaveBeenCalled();
    expect(writeTwitchAccountFollow).not.toHaveBeenCalled();
    expect(getAllFollowedChannels).not.toHaveBeenCalled();
  });
});
