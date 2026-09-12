import { describe, expect, it } from "vitest";

import {
  relayResponseEnvelopeSchema,
  signedOutCategoriesBodySchema,
  signedOutChannelBodySchema,
  signedOutClipsBodySchema,
  signedOutSearchBodySchema,
  signedOutTopStreamsBodySchema,
  signedOutVideosBodySchema,
  type SignedOutSearchBody
} from "@streamfusion/core/relay";
import { createTwitchHelixCatalog } from "../adapters/twitch-helix-catalog";
import type {
  DiscoveryCatalog,
  DiscoveryPlatform
} from "../capabilities/discovery-catalog";
import { createSignedOutDiscoveryService } from "../domain/discovery-service";
import { createSignedOutDiscoveryRoute } from "../routes/signed-out-discovery-route";

function catalog(platform: DiscoveryPlatform): DiscoveryCatalog {
  return {
    platform,
    async topStreams() {
      return { platform, streams: [] };
    },
    async categories() {
      return { categories: [], platform };
    },
    async search({ query }): Promise<SignedOutSearchBody> {
      return { categories: [], channels: [], platform, query, streams: [] };
    },
    async channel() {
      return {
        channel: {
          avatarUrl: "https://example.com/a.png",
          displayName: "Alice",
          id: "c1",
          isLive: false,
          isPartner: false,
          isVerified: false,
          platform,
          username: "alice"
        },
        live: null,
        platform
      };
    },
    async videos() {
      return {
        channelId: "c1",
        platform,
        support: platform === "kick" ? "unsupported" : "available",
        videos: []
      };
    },
    async clips() {
      return {
        channelId: "c1",
        clips: [],
        platform,
        support: platform === "kick" ? "unsupported" : "available"
      };
    }
  };
}

function createRoute(
  input: {
    readonly allow?: boolean;
    readonly catalogs?: readonly DiscoveryCatalog[];
  } = {}
) {
  const scopes: string[] = [];
  const route = createSignedOutDiscoveryRoute({
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
    service: createSignedOutDiscoveryService({
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
  if (response === null) throw new Error("Expected discovery route response");
  return response;
}

describe("signed-out discovery route", () => {
  it("serves guest reads without a bearer and rejects invalid credentials", async () => {
    const { route } = createRoute();
    expect(
      (await request(route, "/v1/discovery/top-streams?platform=twitch", null))
        .status
    ).toBe(200);
    expect(
      (await request(route, "/v1/discovery/top-streams?platform=twitch", "bad"))
        .status
    ).toBe(401);
  });

  it("rejects unsupported platforms and empty search queries", async () => {
    const { route } = createRoute();
    expect(
      (await request(route, "/v1/discovery/categories?platform=other")).status
    ).toBe(400);
    expect(
      (await request(route, "/v1/discovery/search?platform=twitch&q=%20"))
        .status
    ).toBe(400);
  });

  it("returns unavailable when the platform credentials are absent", async () => {
    const { route } = createRoute({
      catalogs: [
        createTwitchHelixCatalog({
          credentials: null,
          fetch: async () => new Response(null, { status: 500 })
        })
      ]
    });
    expect(
      (await request(route, "/v1/discovery/top-streams?platform=twitch")).status
    ).toBe(503);
  });

  it("stops requests denied by the abuse rate limit", async () => {
    const { route } = createRoute({ allow: false });
    expect(
      (await request(route, "/v1/discovery/top-streams?platform=twitch")).status
    ).toBe(429);
  });

  it("returns Core-valid success envelopes", async () => {
    const { route, scopes } = createRoute();
    const topResponse = await request(
      route,
      "/v1/discovery/top-streams?platform=twitch"
    );
    const categoriesResponse = await request(
      route,
      "/v1/discovery/categories?platform=kick"
    );
    const searchResponse = await request(
      route,
      "/v1/discovery/search?platform=twitch&q=arcade"
    );
    const top: unknown = await topResponse.json();
    const categories: unknown = await categoriesResponse.json();
    const search: unknown = await searchResponse.json();

    expect(topResponse.status).toBe(200);
    expect(categoriesResponse.status).toBe(200);
    expect(searchResponse.status).toBe(200);
    expect(relayResponseEnvelopeSchema.is(top)).toBe(true);
    expect(relayResponseEnvelopeSchema.is(categories)).toBe(true);
    expect(relayResponseEnvelopeSchema.is(search)).toBe(true);
    if (
      !relayResponseEnvelopeSchema.is(top) ||
      !relayResponseEnvelopeSchema.is(categories) ||
      !relayResponseEnvelopeSchema.is(search) ||
      top.outcome.kind !== "success" ||
      categories.outcome.kind !== "success" ||
      search.outcome.kind !== "success"
    ) {
      throw new Error("Expected signed-out discovery success envelopes");
    }
    expect(signedOutTopStreamsBodySchema.is(top.outcome.body)).toBe(true);
    expect(signedOutCategoriesBodySchema.is(categories.outcome.body)).toBe(
      true
    );
    expect(signedOutSearchBodySchema.is(search.outcome.body)).toBe(true);
    expect(scopes).toContain(
      "abuse:discovery:top-streams:twitch:unknown-client"
    );
    expect(scopes).toContain(
      "discovery:top-streams:twitch:development:installation-1"
    );
  });

  it("returns channel, videos, and Kick-unsupported clips envelopes", async () => {
    const { route } = createRoute();
    const missing = await request(
      route,
      "/v1/discovery/channel?platform=twitch"
    );
    expect(missing.status).toBe(400);
    const channelResponse = await request(
      route,
      "/v1/discovery/channel?platform=twitch&login=alice"
    );
    const videosResponse = await request(
      route,
      "/v1/discovery/channel-videos?platform=twitch&id=c1"
    );
    const clipsResponse = await request(
      route,
      "/v1/discovery/channel-clips?platform=kick&login=alice"
    );
    const channel: unknown = await channelResponse.json();
    const videos: unknown = await videosResponse.json();
    const clips: unknown = await clipsResponse.json();
    expect(channelResponse.status).toBe(200);
    expect(videosResponse.status).toBe(200);
    expect(clipsResponse.status).toBe(200);
    if (
      !relayResponseEnvelopeSchema.is(channel) ||
      !relayResponseEnvelopeSchema.is(videos) ||
      !relayResponseEnvelopeSchema.is(clips) ||
      channel.outcome.kind !== "success" ||
      videos.outcome.kind !== "success" ||
      clips.outcome.kind !== "success"
    ) {
      throw new Error("Expected channel discovery success envelopes");
    }
    expect(signedOutChannelBodySchema.is(channel.outcome.body)).toBe(true);
    expect(signedOutVideosBodySchema.is(videos.outcome.body)).toBe(true);
    expect(signedOutClipsBodySchema.is(clips.outcome.body)).toBe(true);
    expect(clips.outcome.body).toMatchObject({
      platform: "kick",
      support: "unsupported"
    });
  });
});
