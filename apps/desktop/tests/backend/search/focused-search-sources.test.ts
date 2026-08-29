import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UnifiedChannel } from "@shared/platform-types";
import { filterRankAndDeduplicateVideos } from "@backend/search/search-match-contract";

const clients = vi.hoisted(() => ({
  twitch: {
    searchChannels: vi.fn(),
    getVideosByChannel: vi.fn(),
    getClipsByChannel: vi.fn(),
    getStreamsByLogins: vi.fn(),
  },
  kick: {
    searchChannels: vi.fn(),
    getVideos: vi.fn(),
    getClips: vi.fn(),
    getStreamBySlug: vi.fn(),
  },
}));

vi.mock("@backend/api/platforms/twitch/twitch-client", () => ({ twitchClient: clients.twitch }));
vi.mock("@backend/api/platforms/kick/kick-client", () => ({ kickClient: clients.kick }));

import { focusedRecentContentSources } from "@backend/search/focused-search-sources";

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

      expect(clients[platform].searchChannels).toHaveBeenCalledWith(
        "creator",
        platform === "twitch"
          ? { first: 50, after: "incoming", liveOnly: false }
          : { limit: 50, cursor: "incoming", liveOnly: false }
      );
      expect(result.data).toHaveLength(12);
      expect(result.cursor).toBe("channels-next");
    }
  );

  it("forwards Twitch and Kick VOD and clip cursors", async () => {
    const twitch = channel("t", "twitch");
    const kick = channel("k", "kick");
    clients.twitch.getVideosByChannel.mockResolvedValue({ data: [], cursor: "tv-next" });
    clients.twitch.getClipsByChannel.mockResolvedValue({ data: [], cursor: "tc-next" });
    clients.kick.getVideos.mockResolvedValue({
      data: [
        {
          id: "kick-video",
          platform: "kick",
          channelName: "",
          title: "Recent broadcast",
          thumbnailUrl: "https://example.com/kick-video.webp",
          duration: "01:00:00",
          views: "100",
          date: "2026-08-24T00:00:00.000Z",
          url: "https://kick.com/video/kick-video",
        },
      ],
      cursor: "kv-next",
    });
    clients.kick.getClips.mockResolvedValue({
      data: [{ id: "kick-clip", channelName: "" }],
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
  });
});
