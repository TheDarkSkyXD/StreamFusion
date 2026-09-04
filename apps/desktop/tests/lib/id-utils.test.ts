import { describe, expect, it } from "vitest";

import { dedupeChannelsByIdentity, dedupeStreamsByChannelIdentity } from "@/lib/id-utils";
import { channelsMatch } from "@streamfusion/core/platform";

describe("channelsMatch", () => {
  it("returns false across platforms even when id and username both match", () => {
    expect(
      channelsMatch(
        { platform: "twitch", id: "12345", username: "xqc" },
        { platform: "kick", id: "12345", username: "xqc" }
      )
    ).toBe(false);
  });

  it("returns true on same platform with different ids but matching slug (legacy Kick user_id vs channel.id)", () => {
    expect(
      channelsMatch(
        { platform: "kick", id: "421500", username: "chickenandy" },
        { platform: "kick", id: "411439", username: "chickenandy" }
      )
    ).toBe(true);
  });

  it("returns true on same id even when usernames differ (channel renamed)", () => {
    expect(
      channelsMatch(
        { platform: "twitch", id: "42", username: "old_handle" },
        { platform: "twitch", id: "42", username: "new_handle" }
      )
    ).toBe(true);
  });

  it("returns false when both ids are empty and usernames differ", () => {
    expect(
      channelsMatch(
        { platform: "kick", id: "", username: "alice" },
        { platform: "kick", id: "", username: "bob" }
      )
    ).toBe(false);
  });

  it("falls back to username when one side has no id", () => {
    expect(
      channelsMatch(
        { platform: "twitch", id: "", username: "lirik" },
        { platform: "twitch", id: "23161357", username: "lirik" }
      )
    ).toBe(true);
  });

  it("matches username case-insensitively", () => {
    expect(
      channelsMatch(
        { platform: "kick", id: "676", username: "xQc" },
        { platform: "kick", id: "999", username: "XQC" }
      )
    ).toBe(true);
  });
});

describe("dedupeChannelsByIdentity", () => {
  it("dedupes same-platform slug matches with different ids and keeps the richer metadata", () => {
    const channels = dedupeChannelsByIdentity([
      {
        platform: "kick",
        id: "channel-1",
        username: "hennytingzz",
        displayName: "hennytingzz",
        avatarUrl: "",
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
      {
        platform: "kick",
        id: "user-21103818",
        username: "Hennytingzz",
        displayName: "Hennytingzz",
        avatarUrl: "https://example.com/hennytingzz.webp",
        isLive: false,
        isVerified: true,
        isPartner: false,
      },
    ]);

    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({
      platform: "kick",
      username: "Hennytingzz",
      displayName: "Hennytingzz",
      avatarUrl: "https://example.com/hennytingzz.webp",
      isVerified: true,
    });
  });

  it("does not merge matching names across Twitch and Kick", () => {
    const channels = dedupeChannelsByIdentity([
      {
        platform: "twitch",
        id: "123",
        username: "acoprn1010",
        displayName: "acoprn1010",
        avatarUrl: "https://example.com/twitch.webp",
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
      {
        platform: "kick",
        id: "456",
        username: "acoprn1010",
        displayName: "acoprn1010",
        avatarUrl: "https://example.com/kick.webp",
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
    ]);

    expect(channels).toHaveLength(2);
  });
});

describe("dedupeStreamsByChannelIdentity", () => {
  it("dedupes same-platform live results with different ids but the same broadcaster slug", () => {
    const base = {
      platform: "kick" as const,
      channelDisplayName: "xQc",
      channelAvatar: "",
      title: "LIVE",
      viewerCount: 6300,
      thumbnailUrl: "",
      isLive: true,
      startedAt: null,
      language: "en",
      tags: [],
    };

    const streams = dedupeStreamsByChannelIdentity([
      { ...base, id: "remote-live", channelId: "kick-user-id", channelName: "xqc" },
      { ...base, id: "public-live", channelId: "kick-channel-id", channelName: "XQC" },
    ]);

    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ platform: "kick", channelName: "xqc" });
  });

  it("keeps same-named Twitch and Kick broadcasters separate", () => {
    const base = {
      id: "live",
      channelId: "channel",
      channelName: "xqc",
      channelDisplayName: "xQc",
      channelAvatar: "",
      title: "LIVE",
      viewerCount: 6300,
      thumbnailUrl: "",
      isLive: true,
      startedAt: null,
      language: "en",
      tags: [],
    };

    expect(
      dedupeStreamsByChannelIdentity([
        { ...base, platform: "twitch" },
        { ...base, platform: "kick" },
      ])
    ).toHaveLength(2);
  });
});
