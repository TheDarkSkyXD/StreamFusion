import { describe, expect, it } from "vitest";

import {
  transformTwitchCategory,
  transformTwitchChannel,
  transformTwitchSearchChannel,
  transformTwitchStream,
} from "@/backend/api/platforms/twitch/twitch-transformers";

import type {
  TwitchApiChannel,
  TwitchApiGame,
  TwitchApiSearchChannel,
  TwitchApiStream,
} from "@/backend/api/platforms/twitch/twitch-types";

const STREAM: TwitchApiStream = {
  id: "stream-1",
  user_id: "u1",
  user_login: "testuser",
  user_name: "TestUser",
  game_id: "g1",
  game_name: "Just Chatting",
  type: "live",
  title: "Hello World",
  viewer_count: 1234,
  started_at: "2026-01-01T00:00:00Z",
  language: "en",
  thumbnail_url: "https://img.twitch.tv/{width}x{height}/thumb.jpg",
  tag_ids: [],
  tags: ["English", "Fun"],
  is_mature: false,
};

const GAME: TwitchApiGame = {
  id: "g1",
  name: "Just Chatting",
  box_art_url: "https://img.twitch.tv/boxart/{width}x{height}/jc.jpg",
  igdb_id: "12345",
};

const CHANNEL: TwitchApiChannel = {
  broadcaster_id: "b1",
  broadcaster_login: "streamer",
  broadcaster_name: "Streamer",
  broadcaster_language: "en",
  game_id: "g1",
  game_name: "Just Chatting",
  title: "Live stream title",
  delay: 0,
  tags: ["English"],
  content_classification_labels: [],
  is_branded_content: false,
};

const SEARCH_CHANNEL: TwitchApiSearchChannel = {
  broadcaster_language: "en",
  broadcaster_login: "found_user",
  display_name: "Found_User",
  game_id: "g1",
  game_name: "Just Chatting",
  id: "sc1",
  is_live: true,
  tags: ["English"],
  thumbnail_url: "https://img.twitch.tv/thumb.jpg",
  title: "Streaming now",
  started_at: "2026-01-01T00:00:00Z",
};

describe("transformTwitchStream", () => {
  it("maps all fields to UnifiedStream", () => {
    const result = transformTwitchStream(STREAM);

    expect(result.id).toBe("stream-1");
    expect(result.platform).toBe("twitch");
    expect(result.channelId).toBe("u1");
    expect(result.channelName).toBe("testuser");
    expect(result.channelDisplayName).toBe("TestUser");
    expect(result.channelAvatar).toBe("");
    expect(result.title).toBe("Hello World");
    expect(result.viewerCount).toBe(1234);
    expect(result.isLive).toBe(true);
    expect(result.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(result.language).toBe("en");
    expect(result.tags).toEqual(["English", "Fun"]);
    expect(result.isMature).toBe(false);
    expect(result.categoryId).toBe("g1");
    expect(result.categoryName).toBe("Just Chatting");
  });

  it("replaces {width}x{height} in thumbnail URL", () => {
    const result = transformTwitchStream(STREAM);
    expect(result.thumbnailUrl).toBe("https://img.twitch.tv/440x248/thumb.jpg");
  });

  it("sets isLive false when type is empty string", () => {
    const offline = { ...STREAM, type: "" as const };
    const result = transformTwitchStream(offline);
    expect(result.isLive).toBe(false);
  });

  it("handles missing tags (undefined)", () => {
    const noTags = { ...STREAM, tags: undefined as unknown as string[] };
    const result = transformTwitchStream(noTags);
    expect(result.tags).toEqual([]);
  });
});

describe("transformTwitchCategory", () => {
  it("maps all fields to UnifiedCategory", () => {
    const result = transformTwitchCategory(GAME);

    expect(result.id).toBe("g1");
    expect(result.platform).toBe("twitch");
    expect(result.name).toBe("Just Chatting");
    expect(result.igdbId).toBe("12345");
  });

  it("replaces {width}x{height} in box_art_url", () => {
    const result = transformTwitchCategory(GAME);
    expect(result.boxArtUrl).toBe("https://img.twitch.tv/boxart/285x380/jc.jpg");
  });

  it("handles missing igdb_id", () => {
    const noIgdb = { ...GAME, igdb_id: undefined };
    const result = transformTwitchCategory(noIgdb);
    expect(result.igdbId).toBeUndefined();
  });
});

describe("transformTwitchChannel", () => {
  it("maps channel fields without user data", () => {
    const result = transformTwitchChannel(CHANNEL);

    expect(result.id).toBe("b1");
    expect(result.platform).toBe("twitch");
    expect(result.username).toBe("streamer");
    expect(result.displayName).toBe("Streamer");
    expect(result.avatarUrl).toBe("");
    expect(result.isLive).toBe(false);
    expect(result.isVerified).toBe(false);
    expect(result.isPartner).toBe(false);
    expect(result.categoryId).toBe("g1");
    expect(result.categoryName).toBe("Just Chatting");
    expect(result.lastStreamTitle).toBe("Live stream title");
  });

  it("uses user data for avatar, banner, bio, and partner status when provided", () => {
    const user = {
      id: "b1",
      login: "streamer",
      display_name: "Streamer",
      profile_image_url: "https://img.twitch.tv/avatar.jpg",
      broadcaster_type: "partner" as const,
      offline_image_url: "https://img.twitch.tv/offline.jpg",
      description: "A cool streamer",
    };
    const result = transformTwitchChannel(CHANNEL, user);

    expect(result.avatarUrl).toBe("https://img.twitch.tv/avatar.jpg");
    expect(result.bannerUrl).toBe("https://img.twitch.tv/offline.jpg");
    expect(result.bio).toBe("A cool streamer");
    expect(result.isVerified).toBe(true);
    expect(result.isPartner).toBe(true);
  });

  it("treats empty game_id / title as undefined", () => {
    const noCategory = { ...CHANNEL, game_id: "", game_name: "", title: "" };
    const result = transformTwitchChannel(noCategory);

    expect(result.categoryId).toBeUndefined();
    expect(result.categoryName).toBeUndefined();
    expect(result.lastStreamTitle).toBeUndefined();
  });
});

describe("transformTwitchSearchChannel", () => {
  it("maps search channel fields to UnifiedChannel", () => {
    const result = transformTwitchSearchChannel(SEARCH_CHANNEL);

    expect(result.id).toBe("sc1");
    expect(result.platform).toBe("twitch");
    expect(result.username).toBe("found_user");
    expect(result.displayName).toBe("Found_User");
    expect(result.avatarUrl).toBe("https://img.twitch.tv/thumb.jpg");
    expect(result.isLive).toBe(true);
    expect(result.isVerified).toBe(false);
    expect(result.isPartner).toBe(false);
  });
});
