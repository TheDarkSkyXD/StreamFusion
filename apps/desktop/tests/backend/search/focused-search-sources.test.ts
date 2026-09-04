import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UnifiedChannel, UnifiedClip, UnifiedVideo } from "@shared/platform-types";
import { filterRankAndDeduplicateVideos } from "@backend/search/search-match-contract";

const clients = vi.hoisted(() => ({
  twitch: {
    platform: "twitch" as const,
    resolveChannel: vi.fn(),
    searchChannels: vi.fn(),
    readChannelVideos: vi.fn(),
    readCategoryVideos: vi.fn(),
    readChannelClips: vi.fn(),
    readCategoryClips: vi.fn(),
    getStreamsByLogins: vi.fn(),
  },
  kick: {
    platform: "kick" as const,
    resolveChannel: vi.fn(),
    searchChannels: vi.fn(),
    readChannelVideos: vi.fn(),
    readCategoryVideos: vi.fn(),
    readChannelClips: vi.fn(),
    readCategoryClips: vi.fn(),
    getStreamBySlug: vi.fn(),
  },
}));

vi.mock("@backend/api/platforms/twitch/twitch-client", () => ({ twitchClient: clients.twitch }));
vi.mock("@backend/api/platforms/kick/kick-client", () => ({ kickClient: clients.kick }));

import { createFocusedRecentContentSources } from "@backend/search/focused-search-sources";

const focusedRecentContentSources = createFocusedRecentContentSources(clients);

function channel(id: string, platform: "twitch" | "kick"): UnifiedChannel {
  return {
    id,
    platform,
    username: `creator_${id}`,
    displayName: `Creator ${id}`,
    avatarUrl: "",
    isLive: false,
    isVerified: false,
    isPartner: false,
  };
}

const options = () => ({
  cursor: "incoming",
  limit: 50,
  signal: new AbortController().signal,
  consumeRequest: vi.fn(),
});

// Guards: focused media discovery forwards every provider cursor instead of truncating results to eight channels or one content page.
describe("focused recent content sources", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["twitch", "kick"] as const)(
    "forwards %s channel pagination without a total cap",
    async (platform) => {
      const owners = Array.from({ length: 12 }, (_, index) => channel(String(index), platform));
      clients[platform].searchChannels.mockResolvedValue({ data: owners, cursor: "channels-next" });

      const result = await focusedRecentContentSources[platform].videos.searchChannels(
        "creator",
        options()
      );

      expect(clients[platform].searchChannels).toHaveBeenCalledWith("creator", {
        limit: 50,
        cursor: "incoming",
        liveOnly: false,
      });
      expect(result.data).toHaveLength(12);
      expect(result.cursor).toBe("channels-next");
    }
  );

  it("forwards Twitch and Kick VOD and clip cursors", async () => {
    const twitch = channel("t", "twitch");
    const kick = channel("k", "kick");
    const kickVideo: UnifiedVideo = {
      id: "kick-video",
      platform: "kick",
      channelId: "k",
      channelName: "creator_k",
      channelDisplayName: "Creator k",
      channelAvatar: "",
      title: "Recent broadcast",
      thumbnailUrl: "https://example.com/kick-video.webp",
      duration: 3_600,
      viewCount: 100,
      publishedAt: "2026-08-24T00:00:00.000Z",
      url: "https://kick.com/video/kick-video",
      shareUrl: "https://kick.com/video/kick-video",
      type: "archive",
    };
    const kickClip: UnifiedClip = {
      id: "kick-clip",
      platform: "kick",
      channelId: "k",
      channelName: "creator_k",
      channelDisplayName: "Creator k",
      channelAvatar: "",
      title: "Recent clip",
      thumbnailUrl: "https://example.com/kick-clip.webp",
      clipUrl: "https://kick.com/clip/kick-clip",
      embedUrl: "https://kick.com/clip/kick-clip",
      duration: 30,
      viewCount: 10,
      createdAt: "2026-08-24T00:00:00.000Z",
      creatorName: "viewer",
    };
    clients.twitch.readChannelVideos.mockResolvedValue({ data: [], cursor: "tv-next" });
    clients.twitch.readChannelClips.mockResolvedValue({ data: [], cursor: "tc-next" });
    clients.kick.readChannelVideos.mockResolvedValue({
      data: [kickVideo],
      cursor: "kv-next",
    });
    clients.kick.readChannelClips.mockResolvedValue({
      data: [kickClip],
      cursor: "kc-next",
    });

    const [twitchVideos, twitchClips, kickVideos, kickClips] = await Promise.all([
      focusedRecentContentSources.twitch.videos.fetchVideos(twitch, options()),
      focusedRecentContentSources.twitch.clips.fetchClips(twitch, options()),
      focusedRecentContentSources.kick.videos.fetchVideos(kick, options()),
      focusedRecentContentSources.kick.clips.fetchClips(kick, options()),
    ]);

    expect([twitchVideos.cursor, twitchClips.cursor, kickVideos.cursor, kickClips.cursor]).toEqual([
      "tv-next",
      "tc-next",
      "kv-next",
      "kc-next",
    ]);
    expect(kickVideos.data[0]).toMatchObject({
      channelId: "k",
      channelName: "creator_k",
      channelDisplayName: "Creator k",
    });
    expect(kickClips.data[0]).toMatchObject({
      channelId: "k",
      channelName: "creator_k",
      channelDisplayName: "Creator k",
    });
    expect(filterRankAndDeduplicateVideos(kickVideos.data, "creator_k")).toHaveLength(1);
    expect(clients.kick.readChannelVideos).toHaveBeenCalledWith(kick, {
      limit: 50,
      cursor: "incoming",
      signal: expect.any(AbortSignal),
    });
  });
});
