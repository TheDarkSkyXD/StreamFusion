import { describe, expect, it } from "vitest";

import { createKickLiveCatalog } from "../adapters/kick/kick-live-catalog";
import { createKickOfficialChannelReader } from "../adapters/kick/kick-official-channel-reader";
import { mapKickPublicChannel } from "../adapters/kick/kick-public-catalog";
import { createTwitchGqlGuestReader } from "../adapters/twitch/twitch-gql-guest";
import { createTwitchHelixReader } from "../adapters/twitch/twitch-helix-reader";

const kickIdentity = {
  id: "42",
  platform: "kick",
  username: "creator",
} as const;

describe("provider profile metadata", () => {
  it("keeps Kick's public profile banner URL and leaves absent banners unset", () => {
    const channel = { id: 42, slug: "creator" };
    expect(
      mapKickPublicChannel({
        ...channel,
        banner_image: { url: "https://files.kick.com/profile/banner.jpg" },
        offline_banner_image: { url: "https://files.kick.com/offline.jpg" },
      })?.bannerUrl,
    ).toBe("https://files.kick.com/profile/banner.jpg");
    expect(mapKickPublicChannel(channel)?.bannerUrl).toBeUndefined();
    expect(
      mapKickPublicChannel({ ...channel, banner_image: null })?.bannerUrl,
    ).toBeUndefined();
  });

  it("reads Twitch guest followers from the channel query", async () => {
    let query = "";
    const reader = createTwitchGqlGuestReader({
      fetch: async (_url, init) => {
        query = String(init?.body);
        return Response.json({
          data: {
            user: {
              id: "42",
              login: "creator",
              displayName: "Creator",
              followers: { totalCount: 1234 },
              stream: null,
            },
          },
        });
      },
    });

    expect(
      (await reader.getChannel({ login: "creator" })).channel?.followerCount,
    ).toBe(1234);
    expect(query).toContain("followers { totalCount }");
  });

  it("shows public Twitch follower counts for a signed-in channel", async () => {
    const reader = createTwitchHelixReader({
      clientId: "client",
      readAccessToken: async () => "token",
      fetch: async (url) => {
        const path = String(url);
        if (path.includes("/helix/users?")) {
          return Response.json({
            data: [{ id: "42", login: "creator", display_name: "Creator" }],
          });
        }
        if (path.includes("/helix/channels?"))
          return Response.json({ data: [{}] });
        if (path.includes("/helix/streams?"))
          return Response.json({ data: [] });
        if (path.includes("gql.twitch.tv")) {
          return Response.json({
            data: {
              user: {
                id: "42",
                login: "creator",
                followers: { totalCount: 1234 },
                stream: null,
              },
            },
          });
        }
        throw new Error(`Unexpected URL ${path}`);
      },
    });

    expect(
      (
        await reader.getChannel({
          channel: { id: "42", platform: "twitch", username: "creator" },
        })
      ).channel?.followerCount,
    ).toBe(1234);
  });

  it("keeps unknown follower counts absent and accepts public Kick counts", () => {
    const base = { id: 42, slug: "creator", user: { username: "Creator" } };
    expect(mapKickPublicChannel(base)?.followerCount).toBeUndefined();
    expect(
      mapKickPublicChannel({ ...base, followersCount: 0 })?.followerCount,
    ).toBe(0);
    expect(
      mapKickPublicChannel({ ...base, followers_count: 1234 })?.followerCount,
    ).toBe(1234);
    expect(
      mapKickPublicChannel({ ...base, followers_count: -1 })?.followerCount,
    ).toBeUndefined();
  });

  it("treats a Kick v2 livestream object as live without an is_live flag", () => {
    const base = { id: 42, slug: "creator", user: { username: "Creator" } };
    expect(
      mapKickPublicChannel({ ...base, livestream: { id: 7 } })?.isLive,
    ).toBe(true);
    expect(mapKickPublicChannel({ ...base, livestream: null })?.isLive).toBe(
      false,
    );
    expect(
      mapKickPublicChannel({ ...base, stream: { is_live: false } })?.isLive,
    ).toBe(false);
  });

  it.each([undefined, 4321])(
    "enriches a live Kick profile with its public banner, catalog followers=%s",
    async (catalogFollowers) => {
      const urls: string[] = [];
      const fetcher: typeof globalThis.fetch = async (url) => {
        urls.push(String(url));
        if (String(url).includes("/private/v1/livestreams")) {
          return Response.json({
            data: {
              livestreams: [
                {
                  id: "live-1",
                  streamer: {
                    user: {
                      id: "user-1",
                      username: "Creator",
                      profile_picture: "avatar",
                    },
                    channel: {
                      id: "42",
                      slug: "creator",
                      banner_picture: "https://files.kick.com/profile/banner",
                      ...(catalogFollowers === undefined
                        ? {}
                        : { followers_count: catalogFollowers }),
                    },
                  },
                  metadata: { title: "Live" },
                  viewers_count: 10,
                },
              ],
            },
          });
        }
        if (String(url).includes("/api/v2/channels/creator")) {
          return Response.json({
            id: 42,
            slug: "creator",
            followers_count: 1234,
            banner_image: { url: "https://files.kick.com/profile/banner.jpg" },
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      };
      const reader = createKickOfficialChannelReader({
        fetch: fetcher,
        liveCatalog: createKickLiveCatalog({ fetch: fetcher }),
        readAccessToken: async () => null,
      });

      const page = await reader.getChannel({ channel: kickIdentity });
      expect(page).toMatchObject({
        channel: {
          avatarUrl: "avatar",
          bannerUrl: "https://files.kick.com/profile/banner.jpg",
          followerCount: catalogFollowers ?? 1234,
        },
        live: { id: "live-1" },
        status: "complete",
      });
      expect(urls).toContain("https://kick.com/api/v2/channels/creator");
    },
  );

  it("keeps the Kick live profile when public count lookup fails", async () => {
    const reader = createKickOfficialChannelReader({
      fetch: async () => {
        throw new Error("offline");
      },
      liveCatalog: {
        read: async () => ({
          kind: "ready",
          entries: [
            {
              channel: {
                avatarUrl: "avatar",
                displayName: "Creator",
                id: "42",
                isLive: true,
                isPartner: false,
                isVerified: false,
                platform: "kick",
                username: "creator",
              },
              playbackUrl: null,
              stream: {
                channelAvatar: "avatar",
                channelDisplayName: "Creator",
                channelId: "42",
                channelName: "creator",
                id: "live-1",
                isLive: true,
                language: "en",
                platform: "kick",
                startedAt: null,
                tags: [],
                thumbnailUrl: "",
                title: "Live",
                viewerCount: 10,
              },
            },
          ],
        }),
      },
      readAccessToken: async () => null,
    });

    expect(await reader.getChannel({ channel: kickIdentity })).toMatchObject({
      channel: { avatarUrl: "avatar" },
      live: { id: "live-1" },
      status: "complete",
    });
  });

  it.each([undefined, 4321])(
    "enriches a signed-in Kick profile with its public banner, official followers=%s",
    async (officialFollowers) => {
      const urls: string[] = [];
      const reader = createKickOfficialChannelReader({
        fetch: async (url) => {
          const path = String(url);
          urls.push(path);
          if (path.includes("api.kick.com/public/v1/channels")) {
            return Response.json({
              data: [
                {
                  id: 42,
                  slug: "creator",
                  user: { username: "Creator" },
                  ...(officialFollowers === undefined
                    ? {}
                    : { followers_count: officialFollowers }),
                },
              ],
            });
          }
          if (path.includes("kick.com/api/v2/channels/creator")) {
            return Response.json({
              id: 42,
              slug: "creator",
              followers_count: 1234,
              banner_image: {
                url: "https://files.kick.com/profile/banner.jpg",
              },
            });
          }
          throw new Error(`Unexpected URL ${path}`);
        },
        readAccessToken: async () => "token",
      });

      expect(
        (await reader.getChannel({ channel: kickIdentity })).channel,
      ).toMatchObject({
        followerCount: officialFollowers ?? 1234,
        bannerUrl: "https://files.kick.com/profile/banner.jpg",
      });
      expect(urls).toHaveLength(2);
    },
  );

  it("uses the existing Helix users batch for stream and search avatars", async () => {
    const urls: string[] = [];
    const reader = createTwitchHelixReader({
      clientId: "client",
      readAccessToken: async () => "token",
      fetch: async (url) => {
        const path = String(url);
        urls.push(path);
        if (path.includes("/users?"))
          return Response.json({
            data: [
              {
                id: "42",
                broadcaster_type: "partner",
                profile_image_url: "https://example.test/avatar.png",
              },
            ],
          });
        if (path.includes("/search/channels"))
          return Response.json({
            data: [
              {
                id: "42",
                broadcaster_login: "creator",
                display_name: "Creator",
                thumbnail_url: "https://example.test/live-thumbnail.png",
                is_live: false,
              },
            ],
          });
        if (path.includes("/streams?"))
          return Response.json({
            data: [
              {
                id: "live-1",
                user_id: "42",
                user_login: "creator",
                user_name: "Creator",
                type: "live",
              },
            ],
          });
        throw new Error(`Unexpected URL ${path}`);
      },
    });

    expect((await reader.getTopStreams()).items[0]?.channelAvatar).toBe(
      "https://example.test/avatar.png",
    );
    expect(
      (await reader.searchPage({ kind: "channels", query: "creator" })).items[0]
        ?.avatarUrl,
    ).toBe("https://example.test/avatar.png");
    expect(urls.filter((url) => url.includes("/users?"))).toHaveLength(2);
  });
});
