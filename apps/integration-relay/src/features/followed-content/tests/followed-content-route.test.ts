import { describe, expect, it } from "vitest";

import {
  followedChannelsBodySchema,
  followedClipsBodySchema,
  followedStreamsBodySchema,
  followedVideosBodySchema,
  relayResponseEnvelopeSchema
} from "@streamfusion/core/relay";
import { createKickFollowedCatalog } from "../adapters/kick-followed-catalog";
import { createTwitchFollowedCatalog } from "../adapters/twitch-followed-catalog";
import type {
  FollowedContentCatalog,
  FollowedPlatform
} from "../capabilities/followed-content-catalog";
import { createFollowedContentService } from "../domain/followed-content-service";
import { createFollowedContentRoute } from "../routes/followed-content-route";

function catalog(platform: FollowedPlatform): FollowedContentCatalog {
  return {
    platform,
    async followedStreams() {
      return { missing: [], platform, streams: [] };
    },
    async followedChannels() {
      return { channels: [], missing: [], platform };
    },
    async followedVideos({ channelId }) {
      return {
        channelId,
        platform,
        supported: platform === "twitch",
        videos: []
      };
    },
    async followedClips({ channelId }) {
      return {
        channelId,
        clips: [],
        platform,
        supported: platform === "twitch"
      };
    }
  };
}

function createRoute(
  input: {
    readonly allow?: boolean;
    readonly catalogs?: readonly FollowedContentCatalog[];
  } = {}
) {
  const scopes: string[] = [];
  const route = createFollowedContentRoute({
    authorizer: {
      async authenticatedInstallation(credential) {
        return credential === "valid-credential"
          ? { environment: "development", installationId: "installation-1" }
          : null;
      },
      async authorizeRead(credential) {
        return credential === "valid-credential" ? { allowed: true } : null;
      }
    },
    now: () => 1_000,
    rateLimiter: {
      async consume({ scope }) {
        scopes.push(scope);
        return input.allow ?? true;
      }
    },
    service: createFollowedContentService({
      catalogs: input.catalogs ?? [catalog("twitch"), catalog("kick")]
    })
  });
  return { route, scopes };
}

async function request(
  route: ReturnType<typeof createRoute>["route"],
  path: string,
  credential: string | null = "valid-credential"
): Promise<Response> {
  const headers =
    credential === null ? {} : { Authorization: `Bearer ${credential}` };
  const response = await route(
    new Request(`https://relay.test${path}`, { headers }),
    "request-1"
  );
  if (response === null) throw new Error("Expected followed-content response");
  return response;
}

describe("followed-content route", () => {
  it("rejects missing or invalid installation credentials", async () => {
    const { route } = createRoute();
    expect(
      (
        await request(
          route,
          "/v1/followed-content/streams?platform=twitch&login=alice",
          null
        )
      ).status
    ).toBe(401);
    expect(
      (
        await request(
          route,
          "/v1/followed-content/streams?platform=twitch&login=alice",
          "bad"
        )
      ).status
    ).toBe(401);
  });

  it("rejects unsupported platforms and empty identity batches", async () => {
    const { route } = createRoute();
    expect(
      (
        await request(
          route,
          "/v1/followed-content/channels?platform=other&login=alice"
        )
      ).status
    ).toBe(400);
    expect(
      (await request(route, "/v1/followed-content/streams?platform=twitch"))
        .status
    ).toBe(400);
  });

  it("returns unavailable when the platform credentials are absent", async () => {
    const { route } = createRoute({
      catalogs: [
        createTwitchFollowedCatalog({
          credentials: null,
          fetch: async () => new Response(null, { status: 500 })
        })
      ]
    });
    expect(
      (
        await request(
          route,
          "/v1/followed-content/streams?platform=twitch&login=alice"
        )
      ).status
    ).toBe(503);
  });

  it("stops requests denied by the abuse rate limit", async () => {
    const { route } = createRoute({ allow: false });
    expect(
      (
        await request(
          route,
          "/v1/followed-content/streams?platform=twitch&login=alice"
        )
      ).status
    ).toBe(429);
  });

  it("returns Core-valid success envelopes for identity and recorded reads", async () => {
    const { route, scopes } = createRoute();
    const streamsResponse = await request(
      route,
      "/v1/followed-content/streams?platform=twitch&id=71092938&login=alice"
    );
    const channelsResponse = await request(
      route,
      "/v1/followed-content/channels?platform=kick&login=alice"
    );
    const videosResponse = await request(
      route,
      "/v1/followed-content/videos?platform=kick&channelId=411439"
    );
    const clipsResponse = await request(
      route,
      "/v1/followed-content/clips?platform=twitch&channelId=c1&sort=views&period=week"
    );
    const streams: unknown = await streamsResponse.json();
    const channels: unknown = await channelsResponse.json();
    const videos: unknown = await videosResponse.json();
    const clips: unknown = await clipsResponse.json();

    expect(streamsResponse.status).toBe(200);
    expect(channelsResponse.status).toBe(200);
    expect(videosResponse.status).toBe(200);
    expect(clipsResponse.status).toBe(200);
    if (
      !relayResponseEnvelopeSchema.is(streams) ||
      !relayResponseEnvelopeSchema.is(channels) ||
      !relayResponseEnvelopeSchema.is(videos) ||
      !relayResponseEnvelopeSchema.is(clips) ||
      streams.outcome.kind !== "success" ||
      channels.outcome.kind !== "success" ||
      videos.outcome.kind !== "success" ||
      clips.outcome.kind !== "success"
    ) {
      throw new Error("Expected followed-content success envelopes");
    }
    expect(followedStreamsBodySchema.is(streams.outcome.body)).toBe(true);
    expect(followedChannelsBodySchema.is(channels.outcome.body)).toBe(true);
    expect(followedVideosBodySchema.is(videos.outcome.body)).toBe(true);
    expect(followedClipsBodySchema.is(clips.outcome.body)).toBe(true);
    expect(videos.outcome.body).toMatchObject({
      platform: "kick",
      supported: false,
      videos: []
    });
    expect(scopes).toContain(
      "abuse:followed-content:streams:twitch:unknown-client"
    );
    expect(scopes).toContain(
      "followed-content:streams:twitch:development:installation-1"
    );
  });
});

describe("followed-content provider catalogs", () => {
  it("maps Twitch identity reads and treats Kick recorded as unsupported", async () => {
    const twitch = createTwitchFollowedCatalog({
      credentials: { clientId: "twitch-client", clientSecret: "twitch-secret" },
      fetch: helixFetch(),
      now: () => Date.parse("2026-09-12T00:00:00.000Z")
    });
    const kick = createKickFollowedCatalog({
      credentials: { clientId: "kick-client", clientSecret: "kick-secret" },
      fetch: async () => new Response(null, { status: 500 })
    });
    const streams = await twitch.followedStreams([
      { kind: "login", value: "alice" }
    ]);
    const videos = await kick.followedVideos({
      channelId: "411439",
      sort: "recent"
    });
    expect(streams !== null && followedStreamsBodySchema.is(streams)).toBe(
      true
    );
    expect(streams?.missing).toEqual([]);
    expect(videos).toEqual({
      channelId: "411439",
      platform: "kick",
      supported: false,
      videos: []
    });
  });
});

function helixFetch(): typeof globalThis.fetch {
  return async (input) => {
    const url = String(input);
    if (url === "https://id.twitch.tv/oauth2/token") {
      return json({ access_token: "twitch-app-token", expires_in: 3_600 });
    }
    if (url.includes("/helix/streams?")) {
      return json({
        data: [
          {
            game_id: "509658",
            game_name: "Just Chatting",
            id: "stream-1",
            language: "en",
            started_at: "2026-09-11T00:00:00Z",
            thumbnail_url: "https://cdn.test/{width}x{height}.jpg",
            title: "Live",
            type: "live",
            user_id: "c1",
            user_login: "alice",
            user_name: "Alice",
            viewer_count: 12
          }
        ]
      });
    }
    return new Response(null, { status: 404 });
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
