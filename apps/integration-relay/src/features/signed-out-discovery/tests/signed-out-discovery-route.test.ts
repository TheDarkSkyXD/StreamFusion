import { describe, expect, it } from "vitest";

import {
  relayResponseEnvelopeSchema,
  signedOutCategoriesBodySchema,
  signedOutSearchBodySchema,
  signedOutTopStreamsBodySchema,
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
    }
  };
}

function createRoute(input: {
  readonly allow?: boolean;
  readonly catalogs?: readonly DiscoveryCatalog[];
} = {}) {
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
  const headers = credential === null ? {} : { Authorization: `Bearer ${credential}` };
  const response = await route(new Request(`https://relay.test${path}`, { headers }), "request-1");
  if (response === null) throw new Error("Expected discovery route response");
  return response;
}

describe("signed-out discovery route", () => {
  it("rejects missing or invalid installation credentials", async () => {
    const { route } = createRoute();
    expect((await request(route, "/v1/discovery/top-streams?platform=twitch", null)).status).toBe(401);
    expect((await request(route, "/v1/discovery/top-streams?platform=twitch", "bad")).status).toBe(401);
  });

  it("rejects unsupported platforms and empty search queries", async () => {
    const { route } = createRoute();
    expect((await request(route, "/v1/discovery/categories?platform=other")).status).toBe(400);
    expect((await request(route, "/v1/discovery/search?platform=twitch&q=%20")).status).toBe(400);
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
    expect((await request(route, "/v1/discovery/top-streams?platform=twitch")).status).toBe(503);
  });

  it("stops requests denied by the abuse rate limit", async () => {
    const { route } = createRoute({ allow: false });
    expect((await request(route, "/v1/discovery/top-streams?platform=twitch")).status).toBe(429);
  });

  it("returns Core-valid success envelopes", async () => {
    const { route, scopes } = createRoute();
    const topResponse = await request(route, "/v1/discovery/top-streams?platform=twitch");
    const categoriesResponse = await request(route, "/v1/discovery/categories?platform=kick");
    const searchResponse = await request(route, "/v1/discovery/search?platform=twitch&q=arcade");
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
    expect(signedOutCategoriesBodySchema.is(categories.outcome.body)).toBe(true);
    expect(signedOutSearchBodySchema.is(search.outcome.body)).toBe(true);
    expect(scopes).toContain("abuse:discovery:top-streams:twitch:unknown-client");
    expect(scopes).toContain(
      "discovery:top-streams:twitch:development:installation-1"
    );
  });
});
