import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@shared/ipc-channels";
import { createIsolatedDatabaseTestLifecycle } from "../../../helpers/database-test-lifecycle";

vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@backend/api/platforms/twitch/twitch-client", () => ({
  twitchClient: {
    getChannelsById: vi.fn(),
    getChannelByLogin: vi.fn(),
    isAuthenticated: vi.fn(),
    getAllFollowedChannels: vi.fn(),
  },
}));

vi.mock("@backend/api/platforms/kick/kick-client", () => ({
  kickClient: {
    getChannel: vi.fn(),
    getChannelsByBroadcasterIds: vi.fn(),
    getOfficialChannelAccountStatus: vi.fn(),
    getPublicChannel: vi.fn(),
    searchChannels: vi.fn(),
  },
}));

vi.mock("@backend/services/storage-service", () => ({
  storageService: {
    getActiveFollowsByPlatform: vi.fn(),
    getLocalFollowsByPlatform: vi.fn(),
    getKickUser: vi.fn(),
    updateLocalFollow: vi.fn(),
    removeLocalFollow: vi.fn(),
    upsertSyncedFollows: vi.fn(),
  },
}));

vi.mock("@backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { app, ipcMain } from "electron";

import { kickClient } from "@backend/api/platforms/kick/kick-client";
import { twitchClient } from "@backend/api/platforms/twitch/twitch-client";
import type { UnifiedChannel } from "@shared/platform-types";
import { registerChannelHandlers } from "@backend/ipc/handlers/channel-handlers";
import { dbService } from "@backend/services/database-service";
import { storageService } from "@backend/services/storage-service";

type ChannelResult = { success: boolean; data: UnifiedChannel | null; error?: string };
type ChannelListResult = { success: boolean; data: UnifiedChannel[]; error?: string };
type Handler<T> = (event: unknown, params: unknown) => Promise<T>;

const databaseLifecycle = createIsolatedDatabaseTestLifecycle(
  dbService,
  (directory) => vi.mocked(app.getPath).mockReturnValue(directory),
  "streamfusion-channel-handlers-"
);

function getHandler(channel: typeof IPC_CHANNELS.CHANNELS_GET_BY_ID): Handler<ChannelResult>;
function getHandler(channel: typeof IPC_CHANNELS.CHANNELS_GET_BY_USERNAME): Handler<ChannelResult>;
function getHandler(channel: typeof IPC_CHANNELS.CHANNELS_GET_FOLLOWED): Handler<ChannelListResult>;
function getHandler<T>(channel: string): Handler<T> {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return (event, params) => Promise.resolve(Reflect.apply(call[1], undefined, [event, params]));
}

beforeEach(() => {
  vi.clearAllMocks();
  databaseLifecycle.initialize();
  vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([]);
  vi.mocked(storageService.getLocalFollowsByPlatform).mockReturnValue([]);
  vi.mocked(storageService.getKickUser).mockReturnValue(null);
  vi.mocked(kickClient.getOfficialChannelAccountStatus).mockResolvedValue("unavailable");
  registerChannelHandlers();
});
afterEach(() => {
  databaseLifecycle.dispose();
});
// Guards: CHANNELS_GET_BY_ID / CHANNELS_GET_BY_USERNAME / CHANNELS_GET_FOLLOWED IPC handlers — platform-discriminated routing (twitch → twitchClient, kick → kickClient), the {success, data}/{success, error} envelope contract, and the "Twitch not authenticated returns empty array (doesn't throw)" path. Wiring-only "registers all three channel IPC channels" assertion was removed in U20.c — getHandler() throws if a channel isn't registered, so the behavior tests below already pin the registration as a side-effect.
// Guards: renamed Kick follows repair identity metadata without competing with authoritative account-sync avatar persistence.

describe("CHANNELS_GET_BY_ID", () => {
  it("fetches Twitch channel by ID", async () => {
    const channel = {
      id: "123",
      platform: "twitch",
      username: "test",
      displayName: "test",
      avatarUrl: "",
      isLive: false,
      isVerified: false,
      isPartner: false,
    } satisfies UnifiedChannel;
    vi.mocked(twitchClient.getChannelsById).mockResolvedValue([channel]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_ID);
    const result = await handler({}, { platform: "twitch", channelId: "123" });

    expect(result).toEqual({ success: true, data: channel });
    expect(twitchClient.getChannelsById).toHaveBeenCalledWith(["123"]);
  });

  it("returns null data when Twitch channel not found", async () => {
    vi.mocked(twitchClient.getChannelsById).mockResolvedValue([]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_ID);
    const result = await handler({}, { platform: "twitch", channelId: "999" });

    expect(result).toEqual({ success: true, data: null });
  });

  it("fetches Kick channel by ID", async () => {
    const channel = {
      id: "456",
      platform: "kick",
      username: "kickuser",
      displayName: "kickuser",
      avatarUrl: "",
      isLive: false,
      isVerified: false,
      isPartner: false,
    } satisfies UnifiedChannel;
    vi.mocked(kickClient.getChannel).mockResolvedValue(channel);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_ID);
    const result = await handler({}, { platform: "kick", channelId: "456" });

    expect(result).toEqual({ success: true, data: channel });
    expect(kickClient.getChannel).toHaveBeenCalledWith("456");
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(twitchClient.getChannelsById).mockRejectedValue(new Error("API down"));

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_ID);
    const result = await handler({}, { platform: "twitch", channelId: "123" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("API down");
  });
});

// Guards: stale Twitch and Kick follow logins resolve through stable channel IDs and persist canonical profile metadata.
// Guards: slug-keyed Kick follows recover renamed channels through the exact broadcaster ID embedded in the canonical avatar URL.
// Guards: exact-identity Kick rename repair consolidates duplicate platform-source rows into the canonical current channel.
// Guards: direct Kick lookup uncertainty preserves cached identity as unavailable instead of returning null/deleting it.
// Guards: direct positive Kick resolution exposes active account state separately from offline stream state.
// Guards: direct Kick lookup preserves stable identity while exposing explicit search is_banned evidence as suspended.
// Guards: direct Kick lookup removes a slug-only cached follow only after the official API explicitly confirms not_found.
describe("CHANNELS_GET_BY_USERNAME", () => {
  it("fetches Twitch channel by login via GQL", async () => {
    const channel = {
      id: "123",
      platform: "twitch",
      username: "testuser",
      displayName: "testuser",
      avatarUrl: "",
      isLive: false,
      isVerified: false,
      isPartner: false,
    } satisfies UnifiedChannel;
    vi.mocked(twitchClient.getChannelByLogin).mockResolvedValue(channel);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "twitch", username: "testuser" });

    expect(result).toEqual({ success: true, data: channel });
    expect(twitchClient.getChannelByLogin).toHaveBeenCalledWith("testuser");
  });

  it("repairs a stale Twitch follow login through its stable channel ID", async () => {
    const renamedChannel = {
      id: "123",
      platform: "twitch",
      username: "new-login",
      displayName: "New Login",
      avatarUrl: "https://example.com/new-login.jpg",
      isLive: false,
      isVerified: false,
      isPartner: false,
    } satisfies UnifiedChannel;
    vi.mocked(twitchClient.getChannelByLogin).mockResolvedValue(null);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "twitch-row-1",
        platform: "twitch",
        channelId: "123",
        channelName: "old-login",
        displayName: "Old Login",
        profileImage: "https://example.com/old-login.jpg",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "twitch",
      },
    ]);
    vi.mocked(twitchClient.getChannelsById).mockResolvedValue([renamedChannel]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "twitch", username: "old-login" });

    expect(result).toEqual({ success: true, data: renamedChannel });
    expect(storageService.updateLocalFollow).toHaveBeenCalledWith("twitch-row-1", {
      channelName: "new-login",
      displayName: "New Login",
      profileImage: "https://example.com/new-login.jpg",
    });
  });

  it("does not send a legacy Twitch login to the ID lookup", async () => {
    vi.mocked(twitchClient.getChannelByLogin).mockResolvedValue(null);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "twitch-row-1",
        platform: "twitch",
        channelId: "old-login",
        channelName: "old-login",
        displayName: "Old Login",
        profileImage: "",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "twitch",
      },
    ]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "twitch", username: "old-login" });

    expect(result).toEqual({ success: true, data: null });
    expect(twitchClient.getChannelsById).not.toHaveBeenCalled();
  });

  it("fetches Kick channel by slug", async () => {
    const channel = {
      id: "456",
      platform: "kick",
      username: "kickuser",
      displayName: "kickuser",
      avatarUrl: "",
      isLive: false,
      isVerified: false,
      isPartner: false,
    } satisfies UnifiedChannel;
    vi.mocked(kickClient.getChannel).mockResolvedValue(channel);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "kick", username: "kickuser" });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ ...channel, accountStatus: "active" }),
    });
    expect(kickClient.getChannel).toHaveBeenCalledWith("kickuser");
    expect(storageService.upsertSyncedFollows).not.toHaveBeenCalled();
  });

  it("classifies a positively resolved offline Kick channel as active", async () => {
    vi.mocked(kickClient.getChannel).mockResolvedValue({
      id: "456",
      platform: "kick",
      username: "offline-kick",
      displayName: "OfflineKick",
      avatarUrl: "https://example.com/offline.webp",
      isLive: false,
      isVerified: false,
      isPartner: false,
      kickUserId: "456",
    });

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "kick", username: "offline-kick" });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        isLive: false,
        accountStatus: "active",
      }),
    });
  });

  it("returns explicit Kick search suspension without losing stable identity", async () => {
    vi.mocked(kickClient.getChannel).mockResolvedValue({
      id: "456",
      platform: "kick",
      username: "suspended-creator",
      displayName: "suspended-creator",
      avatarUrl: "",
      isLive: false,
      isVerified: false,
      isPartner: false,
      kickUserId: "456",
    });
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "search-row-456",
          platform: "kick",
          username: "suspended-creator",
          displayName: "SuspendedCreator",
          avatarUrl: "https://example.com/suspended.webp",
          isLive: false,
          isVerified: false,
          isPartner: false,
          accountStatus: "suspended",
        },
      ],
    });

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "kick", username: "suspended-creator" });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        id: "456",
        kickUserId: "456",
        username: "suspended-creator",
        displayName: "SuspendedCreator",
        avatarUrl: "https://example.com/suspended.webp",
        isLive: false,
        accountStatus: "suspended",
      }),
    });
  });

  it("preserves a cached Kick channel as unavailable when direct lookup fails", async () => {
    vi.mocked(kickClient.getChannel).mockRejectedValue(new Error("Kick API error: 503"));
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "kick-row-outage",
        platform: "kick",
        channelId: "123",
        channelName: "cached-channel",
        displayName: "CachedChannel",
        profileImage: "https://example.com/cached.webp",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
    ]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "kick", username: "cached-channel" });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        id: "123",
        username: "cached-channel",
        displayName: "CachedChannel",
        avatarUrl: "https://example.com/cached.webp",
        accountStatus: "unavailable",
      }),
    });
  });

  it("removes a slug-only cached Kick follow after authoritative not_found", async () => {
    vi.mocked(kickClient.getChannel).mockResolvedValue(null);
    vi.mocked(kickClient.getOfficialChannelAccountStatus).mockResolvedValue("not_found");
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "kick-row-deleted",
        platform: "kick",
        channelId: "deleted-slug",
        channelName: "deleted-slug",
        displayName: "DeletedSlug",
        profileImage: "",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
    ]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "kick", username: "deleted-slug" });

    expect(result).toEqual({ success: true, data: null });
    expect(kickClient.getOfficialChannelAccountStatus).toHaveBeenCalledWith("deleted-slug");
    expect(storageService.removeLocalFollow).toHaveBeenCalledWith("kick-row-deleted");
  });

  it("repairs a stale Kick follow slug through its stable broadcaster ID", async () => {
    const renamedChannel = {
      id: "456",
      platform: "kick",
      username: "new-slug",
      displayName: "New Slug",
      avatarUrl: "https://example.com/new-slug.jpg",
      isLive: false,
      isVerified: false,
      isPartner: false,
    } satisfies UnifiedChannel;
    vi.mocked(kickClient.getChannel).mockResolvedValue(null);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "kick-row-1",
        platform: "kick",
        channelId: "456",
        channelName: "old-slug",
        displayName: "Old Slug",
        profileImage: "https://example.com/old-slug.jpg",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
    ]);
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([renamedChannel]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "kick", username: "old-slug" });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ ...renamedChannel, accountStatus: "active" }),
    });
    expect(storageService.updateLocalFollow).toHaveBeenCalledWith("kick-row-1", {
      channelName: "new-slug",
      displayName: "New Slug",
      profileImage: "https://example.com/new-slug.jpg",
    });
  });

  it("repairs a slug-keyed Kick follow through the broadcaster ID in its avatar URL", async () => {
    const renamedChannel = {
      id: "110821336",
      platform: "kick",
      username: "abbyapple",
      displayName: "AbbyApple",
      avatarUrl: "https://files.kick.com/images/user/110821336/profile_image/conversion.webp",
      isLive: false,
      isVerified: false,
      isPartner: false,
    } satisfies UnifiedChannel;
    vi.mocked(kickClient.getChannel).mockResolvedValue(null);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "kick-row-legacy",
        platform: "kick",
        channelId: "abby201",
        channelName: "abby201",
        displayName: "Abby201",
        profileImage: "https://files.kick.com/images/user/110821336/profile_image/conversion.webp",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
    ]);
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([renamedChannel]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "kick", username: "abby201" });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ ...renamedChannel, accountStatus: "active" }),
    });
    expect(kickClient.getChannelsByBroadcasterIds).toHaveBeenCalledWith([110821336]);
  });

  it("consolidates duplicate platform Kick follows after exact avatar identity recovery", async () => {
    const avatarUrl = "https://files.kick.com/images/user/110821336/profile_image/conversion.webp";
    const renamedChannel = {
      id: "110821336",
      platform: "kick",
      username: "abbyapple",
      displayName: "AbbyApple",
      avatarUrl,
      isLive: false,
      isVerified: false,
      isPartner: false,
    } satisfies UnifiedChannel;
    vi.mocked(kickClient.getChannel).mockResolvedValue(null);
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "kick-row-legacy",
        platform: "kick",
        channelId: "abby201",
        channelName: "abby201",
        displayName: "Abby201",
        profileImage: avatarUrl,
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
      {
        id: "kick-row-current",
        platform: "kick",
        channelId: "abbyapple",
        channelName: "abbyapple",
        displayName: "AbbyApple",
        profileImage: avatarUrl,
        followedAt: "2026-02-01T00:00:00.000Z",
        source: "kick",
      },
    ]);
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([renamedChannel]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    await handler({}, { platform: "kick", username: "abby201" });

    expect(storageService.upsertSyncedFollows).toHaveBeenCalledWith(
      "kick",
      [
        {
          platform: "kick",
          channelId: "110821336",
          channelName: "abbyapple",
          displayName: "AbbyApple",
          profileImage: avatarUrl,
        },
      ],
      { pruneAbsent: false }
    );
  });

  it("enriches the authenticated Kick user's own channel with auth profile data", async () => {
    const channel = {
      id: "14362387",
      platform: "kick",
      username: "anonsociety",
      displayName: "anonsociety",
      avatarUrl: "",
      bio: "",
      isLive: false,
      isVerified: false,
      isPartner: false,
      kickUserId: "15132726",
    } satisfies UnifiedChannel;
    vi.mocked(kickClient.getChannel).mockResolvedValue(channel);
    vi.mocked(storageService.getKickUser).mockReturnValue({
      id: 15132726,
      username: "AnonSociety",
      slug: "anonsociety",
      profilePic: "https://kick.com/img/anon-avatar.webp",
      bio: "real bio",
      verified: true,
    });

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "kick", username: "anonsociety" });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        username: "anonsociety",
        displayName: "AnonSociety",
        avatarUrl: "https://kick.com/img/anon-avatar.webp",
        bio: "real bio",
        isVerified: true,
      }),
    });
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(kickClient.getChannel).mockRejectedValue(new Error("not found"));

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "kick", username: "x" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("not found");
  });
});

describe("CHANNELS_GET_FOLLOWED", () => {
  it("returns followed channels when Twitch is authenticated", async () => {
    const channels: UnifiedChannel[] = [
      {
        id: "1",
        platform: "twitch",
        username: "one",
        displayName: "one",
        avatarUrl: "",
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
      {
        id: "2",
        platform: "twitch",
        username: "two",
        displayName: "two",
        avatarUrl: "",
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
    ];
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchClient.getAllFollowedChannels).mockResolvedValue(channels);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = await handler({}, { platform: "twitch" });

    expect(result).toEqual({ success: true, data: channels });
  });

  it("returns empty array when Twitch is not authenticated", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(false);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = await handler({}, { platform: "twitch" });

    expect(result).toEqual({ success: true, data: [] });
    expect(twitchClient.getAllFollowedChannels).not.toHaveBeenCalled();
  });

  it("preserves an unresolved Kick follow with unavailable account state", async () => {
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "row-1",
        platform: "kick",
        channelId: "kick-1",
        channelName: "summit1g",
        displayName: "Summit1G",
        profileImage: "https://example.com/summit.jpg",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
    ]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick" });

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          id: "kick-1",
          platform: "kick",
          username: "summit1g",
          displayName: "Summit1G",
          avatarUrl: "https://example.com/summit.jpg",
          accountStatus: "unavailable",
        }),
      ],
    });
  });

  it("keeps an explicitly suspended Kick account visible in Following", async () => {
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "row-suspended",
        platform: "kick",
        channelId: "suspended-slug",
        channelName: "suspended-slug",
        displayName: "SuspendedSlug",
        profileImage: "https://example.com/cached-suspended.webp",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
    ]);
    vi.mocked(kickClient.searchChannels).mockResolvedValue({
      data: [
        {
          id: "provider-suspended-row",
          platform: "kick",
          username: "suspended-slug",
          displayName: "SuspendedSlug",
          avatarUrl: "https://example.com/provider-suspended.webp",
          isLive: false,
          isVerified: false,
          isPartner: false,
          accountStatus: "suspended",
        },
      ],
    });

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick" });

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          id: "suspended-slug",
          username: "suspended-slug",
          displayName: "SuspendedSlug",
          avatarUrl: "https://example.com/provider-suspended.webp",
          accountStatus: "suspended",
        }),
      ],
    });
  });

  it("removes and excludes a slug-only Kick follow after authoritative not_found", async () => {
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "row-deleted",
        platform: "kick",
        channelId: "deleted-slug",
        channelName: "deleted-slug",
        displayName: "DeletedSlug",
        profileImage: "",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
    ]);
    vi.mocked(kickClient.getOfficialChannelAccountStatus).mockResolvedValue("not_found");

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick" });

    expect(result).toEqual({ success: true, data: [] });
    expect(storageService.removeLocalFollow).toHaveBeenCalledWith("row-deleted");
  });

  it("preserves a stable-ID Kick follow when only its stale slug is not_found", async () => {
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "row-renamed",
        platform: "kick",
        channelId: "110821336",
        channelName: "abby201",
        displayName: "Abby201",
        profileImage: "https://files.kick.com/images/user/110821336/profile_image/conversion.webp",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
    ]);
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([]);
    vi.mocked(kickClient.getOfficialChannelAccountStatus).mockResolvedValue("not_found");

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick" });

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          id: "110821336",
          username: "abby201",
          kickUserId: "110821336",
          accountStatus: "unavailable",
        }),
      ],
    });
    expect(storageService.removeLocalFollow).not.toHaveBeenCalled();
  });

  it("dedupes duplicate Kick account follows by slug while preserving richer metadata", async () => {
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "row-1",
        platform: "kick",
        channelId: "channel-1",
        channelName: "hennytingzz",
        displayName: "hennytingzz",
        profileImage: "",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
      {
        id: "row-2",
        platform: "kick",
        channelId: "user-21103818",
        channelName: "Hennytingzz",
        displayName: "Hennytingzz",
        profileImage: "https://example.com/hennytingzz.webp",
        followedAt: "2026-01-02T00:00:00.000Z",
        source: "kick",
      },
    ]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick" });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      platform: "kick",
      username: "Hennytingzz",
      displayName: "Hennytingzz",
      avatarUrl: "https://example.com/hennytingzz.webp",
    });
  });

  it("repairs renamed Kick follow slugs before returning followed channels", async () => {
    vi.mocked(storageService.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "row-1",
        platform: "kick",
        channelId: "123",
        channelName: "old-slug",
        displayName: "Old Slug",
        profileImage: "",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
    ]);
    vi.mocked(kickClient.getChannelsByBroadcasterIds).mockResolvedValue([
      {
        id: "123",
        platform: "kick",
        username: "new-slug",
        displayName: "New Slug",
        avatarUrl: "https://example.com/new.jpg",
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
    ]);
    vi.mocked(kickClient.getPublicChannel).mockResolvedValue({
      id: "123",
      platform: "kick",
      username: "new-slug",
      displayName: "New Slug",
      avatarUrl: "https://example.com/new.jpg",
      kickUserId: "123",
      isLive: false,
      isVerified: false,
      isPartner: false,
    });

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick" });

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          id: "123",
          platform: "kick",
          username: "new-slug",
          displayName: "New Slug",
          avatarUrl: "https://example.com/new.jpg",
        }),
      ],
    });
    expect(kickClient.getChannelsByBroadcasterIds).toHaveBeenCalledWith([123]);
    expect(storageService.updateLocalFollow).toHaveBeenCalledWith("row-1", {
      channelName: "new-slug",
      displayName: "New Slug",
    });
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(twitchClient.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchClient.getAllFollowedChannels).mockRejectedValue(new Error("timeout"));

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = await handler({}, { platform: "twitch" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("timeout");
  });
});
