import { twitchAccountReader } from "@backend/features/authentication/composition/twitch-account-reader";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@shared/ipc-channels";
import { createIsolatedDatabaseTestLifecycle } from "../../../../../../../tests/helpers/database-test-lifecycle";

vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@backend/features/discovery/composition/twitch-discovery", () => ({
  twitchDiscovery: { resolveChannel: vi.fn(), isAuthenticated: vi.fn() },
}));
vi.mock("@backend/features/authentication/composition/twitch-account-reader", () => ({
  twitchAccountReader: { getAllFollowedChannels: vi.fn() },
}));

vi.mock("@backend/features/discovery/composition/kick-discovery", () => ({
  kickDiscovery: {
    resolveChannel: vi.fn(),
    getChannelsByBroadcasterIds: vi.fn(),
    getOfficialChannelAccountStatus: vi.fn(),
    getPublicChannel: vi.fn(),
    searchChannels: vi.fn(),
  },
}));

vi.mock("@backend/features/authentication/data/authentication-repository", () => ({
  authenticationRepository: {
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

import { kickDiscovery } from "@backend/features/discovery/composition/kick-discovery";
import { twitchDiscovery } from "@backend/features/discovery/composition/twitch-discovery";
import { authenticationRepository } from "@backend/features/authentication/data/authentication-repository";
import { registerChannelHandlers } from "@backend/features/discovery/routes/channel-routes";
import { dbService } from "@backend/services/database-service";
import type { LocalFollow } from "@shared/auth-types";
import type { UnifiedChannel } from "@shared/platform-types";

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
  vi.mocked(authenticationRepository.getActiveFollowsByPlatform).mockReturnValue([]);
  vi.mocked(authenticationRepository.getLocalFollowsByPlatform).mockReturnValue([]);
  vi.mocked(authenticationRepository.getKickUser).mockReturnValue(null);
  vi.mocked(kickDiscovery.getOfficialChannelAccountStatus).mockResolvedValue("unavailable");
  registerChannelHandlers({
    twitchFollows: twitchAccountReader,
    readers: { twitch: twitchDiscovery, kick: kickDiscovery },
  });
});
afterEach(() => {
  databaseLifecycle.dispose();
});
// Guards: CHANNELS_GET_BY_ID / CHANNELS_GET_BY_USERNAME / CHANNELS_GET_FOLLOWED IPC handlers — platform-discriminated routing (twitch → twitchDiscovery, kick → kickDiscovery), the {success, data}/{success, error} envelope contract, and the "Twitch not authenticated returns empty array (doesn't throw)" path. Wiring-only "registers all three channel IPC channels" assertion was removed in U20.c — getHandler() throws if a channel isn't registered, so the behavior tests below already pin the registration as a side-effect.
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
    vi.mocked(twitchDiscovery.resolveChannel).mockResolvedValue(channel);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_ID);
    const result = await handler({}, { platform: "twitch", channelId: "123" });

    expect(result).toEqual({ success: true, data: channel });
    expect(twitchDiscovery.resolveChannel).toHaveBeenCalledWith({ kind: "id", value: "123" });
  });

  it("returns null data when Twitch channel not found", async () => {
    vi.mocked(twitchDiscovery.resolveChannel).mockResolvedValue(null);

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
    vi.mocked(kickDiscovery.resolveChannel).mockResolvedValue(channel);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_ID);
    const result = await handler({}, { platform: "kick", channelId: "456" });

    expect(result).toEqual({ success: true, data: channel });
    expect(kickDiscovery.resolveChannel).toHaveBeenCalledWith({ kind: "id", value: "456" });
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(twitchDiscovery.resolveChannel).mockRejectedValue(new Error("API down"));

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_ID);
    const result = await handler({}, { platform: "twitch", channelId: "123" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("API down");
  });
});

// Guards: stale Twitch and Kick follow logins resolve through stable channel IDs and persist canonical profile metadata.
// Guards: slug-keyed Kick follows recover renamed channels through the exact broadcaster ID embedded in the canonical avatar URL.
// Guards: every resolved Kick channel refreshes matching stored follow identity in the main process, including direct lookups.
// Guards: exact-identity Kick rename refresh consolidates duplicate platform-source rows into the canonical current channel.
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
    vi.mocked(twitchDiscovery.resolveChannel).mockResolvedValue(channel);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "twitch", username: "testuser" });

    expect(result).toEqual({ success: true, data: channel });
    expect(twitchDiscovery.resolveChannel).toHaveBeenCalledWith({
      kind: "slug",
      value: "testuser",
    });
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
    vi.mocked(twitchDiscovery.resolveChannel).mockResolvedValueOnce(null);
    vi.mocked(authenticationRepository.getActiveFollowsByPlatform).mockReturnValue([
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
    vi.mocked(twitchDiscovery.resolveChannel).mockResolvedValueOnce(renamedChannel);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "twitch", username: "old-login" });

    expect(result).toEqual({ success: true, data: renamedChannel });
    expect(twitchDiscovery.resolveChannel).toHaveBeenNthCalledWith(2, {
      kind: "id",
      value: "123",
    });
    expect(authenticationRepository.updateLocalFollow).toHaveBeenCalledWith("twitch-row-1", {
      channelName: "new-login",
      displayName: "New Login",
      profileImage: "https://example.com/new-login.jpg",
    });
  });

  it("does not send a legacy Twitch login to the ID lookup", async () => {
    vi.mocked(twitchDiscovery.resolveChannel).mockResolvedValue(null);
    vi.mocked(authenticationRepository.getActiveFollowsByPlatform).mockReturnValue([
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
    expect(twitchDiscovery.resolveChannel).toHaveBeenCalledOnce();
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
    vi.mocked(kickDiscovery.resolveChannel).mockResolvedValue(channel);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "kick", username: "kickuser" });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ ...channel, accountStatus: "active" }),
    });
    expect(kickDiscovery.resolveChannel).toHaveBeenCalledWith(
      { kind: "slug", value: "kickuser" },
      undefined
    );
    expect(authenticationRepository.upsertSyncedFollows).not.toHaveBeenCalled();
  });

  it("refreshes stale follow identity after a direct authoritative Kick lookup", async () => {
    const channel = {
      id: "20120336",
      platform: "kick",
      username: "hennytingzz",
      displayName: "Hennytingzz",
      avatarUrl: "https://files.kick.com/images/user/21103818/profile_image/fullsize.webp",
      kickUserId: "21103818",
      isLive: false,
      isVerified: false,
      isPartner: false,
    } satisfies UnifiedChannel;
    vi.mocked(kickDiscovery.resolveChannel).mockResolvedValue(channel);
    vi.mocked(authenticationRepository.getActiveFollowsByPlatform).mockReturnValue([
      {
        id: "kick-row-henny",
        platform: "kick",
        channelId: "hennythingz1",
        channelName: "hennythingz1",
        displayName: "hennythingz1",
        profileImage:
          "https://files.kick.com/images/user/21103818/profile_image/conversion/old.webp",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "kick",
      },
    ]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "kick", username: "hennythingz1" });

    expect(result.success).toBe(true);
    expect(authenticationRepository.updateLocalFollow).toHaveBeenCalledWith("kick-row-henny", {
      channelId: "21103818",
      channelName: "hennytingzz",
      displayName: "Hennytingzz",
      profileImage: "https://files.kick.com/images/user/21103818/profile_image/fullsize.webp",
    });
  });

  it("classifies a positively resolved offline Kick channel as active", async () => {
    vi.mocked(kickDiscovery.resolveChannel).mockResolvedValue({
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
    vi.mocked(kickDiscovery.resolveChannel).mockResolvedValue({
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
    vi.mocked(kickDiscovery.searchChannels).mockResolvedValue({
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
    vi.mocked(kickDiscovery.resolveChannel).mockRejectedValue(new Error("Kick API error: 503"));
    vi.mocked(authenticationRepository.getActiveFollowsByPlatform).mockReturnValue([
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
    vi.mocked(kickDiscovery.resolveChannel).mockResolvedValue(null);
    vi.mocked(kickDiscovery.getOfficialChannelAccountStatus).mockResolvedValue("not_found");
    vi.mocked(authenticationRepository.getActiveFollowsByPlatform).mockReturnValue([
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
    expect(kickDiscovery.getOfficialChannelAccountStatus).toHaveBeenCalledWith("deleted-slug");
    expect(authenticationRepository.removeLocalFollow).toHaveBeenCalledWith("kick-row-deleted");
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
    vi.mocked(kickDiscovery.resolveChannel).mockResolvedValue(null);
    vi.mocked(authenticationRepository.getActiveFollowsByPlatform).mockReturnValue([
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
    vi.mocked(kickDiscovery.getChannelsByBroadcasterIds).mockResolvedValue([renamedChannel]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "kick", username: "old-slug" });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ ...renamedChannel, accountStatus: "active" }),
    });
    expect(authenticationRepository.updateLocalFollow).toHaveBeenCalledWith("kick-row-1", {
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
    vi.mocked(kickDiscovery.resolveChannel).mockResolvedValue(null);
    vi.mocked(authenticationRepository.getActiveFollowsByPlatform).mockReturnValue([
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
    vi.mocked(kickDiscovery.getChannelsByBroadcasterIds).mockResolvedValue([renamedChannel]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "kick", username: "abby201" });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ ...renamedChannel, accountStatus: "active" }),
    });
    expect(kickDiscovery.getChannelsByBroadcasterIds).toHaveBeenCalledWith([110821336]);
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
    vi.mocked(kickDiscovery.resolveChannel).mockResolvedValue(null);
    vi.mocked(authenticationRepository.getActiveFollowsByPlatform).mockReturnValue([
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
    vi.mocked(kickDiscovery.getChannelsByBroadcasterIds).mockResolvedValue([renamedChannel]);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    await handler({}, { platform: "kick", username: "abby201" });

    expect(authenticationRepository.upsertSyncedFollows).toHaveBeenCalledWith(
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
    vi.mocked(kickDiscovery.resolveChannel).mockResolvedValue(channel);
    vi.mocked(authenticationRepository.getKickUser).mockReturnValue({
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
    vi.mocked(kickDiscovery.resolveChannel).mockRejectedValue(new Error("not found"));

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_BY_USERNAME);
    const result = await handler({}, { platform: "kick", username: "x" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("not found");
  });
});

// Guards: a large Kick followed-channel read preserves every durable follow when bounded metadata repair fails, without per-follow searches, status probes, or deletion.
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
    vi.mocked(twitchDiscovery.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchAccountReader.getAllFollowedChannels).mockResolvedValue(channels);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = await handler({}, { platform: "twitch" });

    expect(result).toEqual({ success: true, data: channels });
  });

  it("returns empty array when Twitch is not authenticated", async () => {
    vi.mocked(twitchDiscovery.isAuthenticated).mockReturnValue(false);

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = await handler({}, { platform: "twitch" });

    expect(result).toEqual({ success: true, data: [] });
    expect(twitchAccountReader.getAllFollowedChannels).not.toHaveBeenCalled();
  });

  it("keeps 179 Kick follows without per-follow requests after bulk repair is rate limited", async () => {
    const follows = Array.from({ length: 179 }, (_, index): LocalFollow => ({
      id: `row-${index}`,
      platform: "kick",
      channelId: String(100_000 + index),
      channelName: `channel-${index}`,
      displayName: `Channel ${index}`,
      profileImage: "",
      followedAt: "2026-01-01T00:00:00.000Z",
      source: "kick",
    }));
    vi.mocked(authenticationRepository.getActiveFollowsByPlatform).mockReturnValue(follows);
    vi.mocked(authenticationRepository.getLocalFollowsByPlatform).mockReturnValue(follows);
    vi.mocked(kickDiscovery.getChannelsByBroadcasterIds).mockRejectedValue(
      Object.assign(new Error("Kick API rate limit active; retry after 60s"), {
        status: 429,
        retryAfterMs: 60_000,
      })
    );

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = await handler({}, { platform: "kick" });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(179);
    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "100000",
          username: "channel-0",
          accountStatus: "unavailable",
        }),
      ])
    );
    expect(kickDiscovery.searchChannels).toHaveBeenCalledTimes(0);
    expect(kickDiscovery.getOfficialChannelAccountStatus).toHaveBeenCalledTimes(0);
    expect(authenticationRepository.removeLocalFollow).toHaveBeenCalledTimes(0);
  });

  it("preserves an unresolved Kick follow with unavailable account state", async () => {
    vi.mocked(authenticationRepository.getActiveFollowsByPlatform).mockReturnValue([
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

  it("preserves a stable-ID Kick follow when bulk repair finds no provider row", async () => {
    vi.mocked(authenticationRepository.getActiveFollowsByPlatform).mockReturnValue([
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
    vi.mocked(kickDiscovery.getChannelsByBroadcasterIds).mockResolvedValue([]);

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
    expect(authenticationRepository.removeLocalFollow).not.toHaveBeenCalled();
  });

  it("dedupes duplicate Kick account follows by slug while preserving richer metadata", async () => {
    vi.mocked(authenticationRepository.getActiveFollowsByPlatform).mockReturnValue([
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
    vi.mocked(authenticationRepository.getActiveFollowsByPlatform).mockReturnValue([
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
    vi.mocked(kickDiscovery.getChannelsByBroadcasterIds).mockResolvedValue([
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
    vi.mocked(kickDiscovery.getPublicChannel).mockResolvedValue({
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
    expect(kickDiscovery.getChannelsByBroadcasterIds).toHaveBeenCalledWith([123]);
    expect(authenticationRepository.updateLocalFollow).toHaveBeenCalledWith("row-1", {
      channelName: "new-slug",
      displayName: "New Slug",
    });
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(twitchDiscovery.isAuthenticated).mockReturnValue(true);
    vi.mocked(twitchAccountReader.getAllFollowedChannels).mockRejectedValue(new Error("timeout"));

    const handler = getHandler(IPC_CHANNELS.CHANNELS_GET_FOLLOWED);
    const result = await handler({}, { platform: "twitch" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("timeout");
  });
});
