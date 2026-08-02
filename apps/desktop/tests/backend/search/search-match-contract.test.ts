import { describe, expect, it } from "vitest";

import {
  filterRankAndDeduplicateChannels,
  filterRankAndDeduplicateCategories,
  filterRankAndDeduplicateStreams,
  isValidUnifiedChannel,
  isValidUnifiedCategory,
  isValidUnifiedStream,
  normalizeSearchTokens,
  mergeExactCrossPlatformCategories,
  rankChannelMatch,
  rankCategoryMatch,
  rankStreamMatch,
} from "@/backend/search/search-match-contract";

// Guards: submitted search normalizes user-visible query syntax consistently before deciding eligibility
describe("search match contract", () => {
  it("matches every category query token against only its visible name and supplied tags", () => {
    const category = {
      id: "509658",
      platform: "twitch" as const,
      name: "Just Chatting",
      boxArtUrl: "",
      tags: ["Social", "English"],
      slug: "hidden-universe",
    };

    expect(rankCategoryMatch(category, "chat social english")).not.toBeNull();
    expect(rankCategoryMatch(category, "chat missing")).toBeNull();
    expect(rankCategoryMatch(category, "hidden universe")).toBeNull();
    expect(filterRankAndDeduplicateCategories([category], "hidden universe")).toEqual([]);
  });

  it("ranks category exact, prefix, fuzzy, tag, and popularity matches deterministically", () => {
    const category = (id: string, name: string, viewerCount: number, tags: string[] = []) => ({
      id,
      platform: "twitch" as const,
      name,
      boxArtUrl: "",
      viewerCount,
      tags,
    });

    expect(
      filterRankAndDeduplicateCategories(
        [
          category("tag-small", "Other", 10, ["Streamer"]),
          category("fuzzy", "Stremaer", 999),
          category("prefix", "Streamer Games", 1),
          category("exact", "Streamer", 1),
          category("tag-large", "Another", 50, ["Streamer"]),
        ],
        "streamer"
      ).map((result) => result.id)
    ).toEqual(["exact", "prefix", "fuzzy", "tag-large", "tag-small"]);
  });

  it("does not match categories for a one-character query", () => {
    expect(
      filterRankAndDeduplicateCategories(
        [{ id: "1", platform: "kick", name: "Art", boxArtUrl: "", tags: [] }],
        "a"
      )
    ).toEqual([]);
  });

  it("merges only exact normalized cross-platform category names and retains both IDs", () => {
    const categories = [
      {
        id: "twitch-just-chatting",
        platform: "twitch" as const,
        name: "Just Chatting",
        boxArtUrl: "twitch.jpg",
        viewerCount: 10,
      },
      {
        id: "kick-just-chatting",
        platform: "kick" as const,
        name: "just_chatting",
        boxArtUrl: "kick.jpg",
        viewerCount: 20,
      },
      {
        id: "kick-chatting",
        platform: "kick" as const,
        name: "Just Chatting IRL",
        boxArtUrl: "near.jpg",
        viewerCount: 30,
      },
    ];

    expect(mergeExactCrossPlatformCategories(categories)).toEqual([
      {
        ...categories[1],
        crossPlatformId: "twitch-just-chatting",
        crossPlatformName: "Just Chatting",
      },
      categories[2],
    ]);
  });

  it("rejects malformed category navigation, popularity, and tag values", () => {
    const category = {
      id: "509658",
      platform: "twitch",
      name: "Just Chatting",
      boxArtUrl: "",
      viewerCount: 42,
      tags: ["Social"],
    };

    expect(isValidUnifiedCategory(category)).toBe(true);
    expect(isValidUnifiedCategory({ ...category, id: "" })).toBe(false);
    expect(isValidUnifiedCategory({ ...category, platform: "youtube" })).toBe(false);
    expect(isValidUnifiedCategory({ ...category, name: "" })).toBe(false);
    expect(isValidUnifiedCategory({ ...category, viewerCount: Number.NaN })).toBe(false);
    expect(isValidUnifiedCategory({ ...category, tags: ["Social", 42] })).toBe(false);
  });

  it("normalizes Unicode case, accents, separators, repeated tokens, numbers, and emoji", () => {
    expect(normalizeSearchTokens("  @Stréamer__UNIVER--streamer  24/7 🎮🎮  ")).toEqual([
      "streamer",
      "univer",
      "24",
      "7",
      "🎮",
    ]);
  });

  it("keeps flag and joined-family emoji as meaningful grapheme tokens", () => {
    expect(normalizeSearchTokens("Go 🇺🇸 👨‍👩‍👧 🇺🇸")).toEqual(["go", "🇺🇸", "👨‍👩‍👧"]);
  });

  it("requires every query token to match a channel display name or username", () => {
    const channel = {
      username: "streamer_universe",
      displayName: "The Universe",
      bio: "secret qualifying phrase",
    };

    expect(rankChannelMatch(channel, "streamer univer")).not.toBeNull();
    expect(rankChannelMatch(channel, "streamer missing")).toBeNull();
    expect(rankChannelMatch(channel, "secret phrase")).toBeNull();
  });

  it("allows one insertion, deletion, substitution, or adjacent transposition only from five characters", () => {
    const channel = { username: "streamer", displayName: "Streamer" };

    expect(rankChannelMatch(channel, "stremaer")).not.toBeNull();
    expect(rankChannelMatch(channel, "stremer")).not.toBeNull();
    expect(rankChannelMatch(channel, "strezmer")).not.toBeNull();
    expect(rankChannelMatch(channel, "strxeamer")).not.toBeNull();
    expect(rankChannelMatch({ username: "game", displayName: "Game" }, "gaem")).toBeNull();
    expect(rankChannelMatch(channel, "stxxamer")).toBeNull();
  });

  it("limits a one-character query to a channel identity prefix", () => {
    expect(
      rankChannelMatch({ username: "alpha", displayName: "Alpha Creator" }, "a")
    ).not.toBeNull();
    expect(rankChannelMatch({ username: "beta", displayName: "The Alpha" }, "a")).toBeNull();
  });

  it("matches streams only through visible title, channel identity, category, tags, or language fields", () => {
    const stream = {
      channelName: "creator",
      channelDisplayName: "Creator",
      title: "Streamer challenge",
      categoryName: "Universe Sandbox",
      tags: ["Educational"],
      language: "English",
      description: "hidden secret",
    };

    expect(rankStreamMatch(stream, "streamer univer education english creator")).not.toBeNull();
    expect(rankStreamMatch(stream, "hidden secret")).toBeNull();
    expect(rankStreamMatch(stream, "s")).toBeNull();
  });

  it("rejects malformed navigation data while allowing existing empty-image fallbacks", () => {
    const channel = {
      id: "channel-1",
      platform: "twitch",
      username: "creator",
      displayName: "Creator",
      avatarUrl: "",
      isLive: true,
      isVerified: false,
      isPartner: false,
    };
    const stream = {
      id: "stream-1",
      platform: "twitch",
      channelId: "channel-1",
      channelName: "creator",
      channelDisplayName: "Creator",
      channelAvatar: "",
      title: "Visible title",
      viewerCount: 0,
      thumbnailUrl: "",
      isLive: true,
      startedAt: null,
      language: "en",
      tags: [],
    };

    expect(isValidUnifiedChannel(channel)).toBe(true);
    expect(isValidUnifiedStream(stream)).toBe(true);
    expect(isValidUnifiedChannel({ ...channel, username: "" })).toBe(false);
    expect(isValidUnifiedStream({ ...stream, channelName: undefined })).toBe(false);
    expect(isValidUnifiedStream({ ...stream, title: "" })).toBe(false);
    expect(isValidUnifiedStream({ ...stream, tags: undefined })).toBe(false);
  });

  it("normalizes missing Channel and Stream images to the existing empty fallback", () => {
    const channelWithoutImage = {
      id: "channel-without-image",
      platform: "twitch",
      username: "streamer",
      displayName: "Streamer",
      isLive: true,
      isVerified: false,
      isPartner: false,
    };
    const streamWithoutImages = {
      id: "stream-without-images",
      platform: "twitch",
      channelId: "channel-without-image",
      channelName: "streamer",
      channelDisplayName: "Streamer",
      title: "Streamer live",
      viewerCount: 42,
      isLive: true,
      startedAt: null,
      language: "en",
      tags: [],
    };

    expect(filterRankAndDeduplicateChannels([channelWithoutImage], "streamer")).toEqual([
      { ...channelWithoutImage, avatarUrl: "" },
    ]);
    expect(filterRankAndDeduplicateStreams([streamWithoutImages], "streamer")).toEqual([
      { ...streamWithoutImages, channelAvatar: "", thumbnailUrl: "" },
    ]);
  });

  it("ranks exact then prefix then fuzzy channel identities and deduplicates per Platform identity", () => {
    const channel = (id: string, username: string, followerCount: number) => ({
      id,
      platform: "twitch" as const,
      username,
      displayName: username,
      avatarUrl: "",
      isLive: false,
      isVerified: false,
      isPartner: false,
      followerCount,
    });
    const exact = channel("exact", "streamer", 1);
    const prefix = channel("prefix", "streamer_world", 1000);
    const fuzzyPopular = channel("fuzzy-popular", "stremaer", 50);
    const fuzzySmaller = channel("fuzzy-smaller", "streamre", 10);

    expect(
      filterRankAndDeduplicateChannels(
        [fuzzySmaller, prefix, fuzzyPopular, exact, { ...exact, followerCount: 9999 }],
        "streamer"
      ).map((result) => result.id)
    ).toEqual(["exact", "prefix", "fuzzy-popular", "fuzzy-smaller"]);
  });

  it("ranks stream identity before title, category, and tags with popularity only breaking ties", () => {
    const stream = (id: string, overrides: Record<string, unknown> = {}) => ({
      id,
      platform: "twitch" as const,
      channelId: `channel-${id}`,
      channelName: "other_creator",
      channelDisplayName: "Other Creator",
      channelAvatar: "",
      title: "Other broadcast",
      viewerCount: 1,
      thumbnailUrl: "",
      isLive: true,
      startedAt: null,
      language: "en",
      tags: [],
      ...overrides,
    });
    const exact = stream("exact", { channelName: "streamer" });
    const prefix = stream("prefix", { channelName: "streamer_world" });
    const fuzzy = stream("fuzzy", { channelName: "stremaer" });
    const title = stream("title", { title: "Streamer", viewerCount: 9999 });
    const category = stream("category", { categoryName: "Streamer games" });
    const tagPopular = stream("tag-popular", { tags: ["Streamer"], viewerCount: 50 });
    const tagSmaller = stream("tag-smaller", { tags: ["Streamer"], viewerCount: 10 });

    expect(
      filterRankAndDeduplicateStreams(
        [
          tagSmaller,
          category,
          title,
          prefix,
          fuzzy,
          tagPopular,
          exact,
          { ...exact, viewerCount: 10000 },
        ],
        "streamer"
      ).map((result) => result.id)
    ).toEqual(["exact", "prefix", "fuzzy", "title", "category", "tag-popular", "tag-smaller"]);
  });

  it("ranks an exact Stream identity above an exact Stream title", () => {
    const visibleFields = {
      categoryName: undefined,
      tags: [] as string[],
      language: "en",
    };

    const identityRank = rankStreamMatch(
      {
        ...visibleFields,
        channelName: "streamer",
        channelDisplayName: "Streamer",
        title: "Unrelated broadcast",
      },
      "streamer"
    );
    const titleRank = rankStreamMatch(
      {
        ...visibleFields,
        channelName: "other_creator",
        channelDisplayName: "Other Creator",
        title: "Streamer",
      },
      "streamer"
    );

    expect(identityRank).toEqual({ tier: 0, editDistance: 0 });
    expect(titleRank).toEqual({ tier: 3, editDistance: 0 });
  });

  it("keeps the same ID across Platforms and keeps Channel and Stream identities separate", () => {
    const channel = (platform: "twitch" | "kick") => ({
      id: "shared-id",
      platform,
      username: "streamer",
      displayName: "Streamer",
      avatarUrl: "",
      isLive: true,
      isVerified: false,
      isPartner: false,
    });
    const stream = (platform: "twitch" | "kick") => ({
      id: "shared-id",
      platform,
      channelId: "shared-id",
      channelName: "streamer",
      channelDisplayName: "Streamer",
      channelAvatar: "",
      title: "Streamer live",
      viewerCount: 1,
      thumbnailUrl: "",
      isLive: true,
      startedAt: null,
      language: "en",
      tags: [],
    });

    const channels = filterRankAndDeduplicateChannels(
      [channel("twitch"), channel("kick")],
      "streamer"
    );
    const streams = filterRankAndDeduplicateStreams([stream("twitch"), stream("kick")], "streamer");

    expect(channels.map((result) => `${result.platform}:${result.id}`).sort()).toEqual([
      "kick:shared-id",
      "twitch:shared-id",
    ]);
    expect(streams.map((result) => `${result.platform}:${result.id}`).sort()).toEqual([
      "kick:shared-id",
      "twitch:shared-id",
    ]);
    expect(channels).toHaveLength(2);
    expect(streams).toHaveLength(2);
  });
});
