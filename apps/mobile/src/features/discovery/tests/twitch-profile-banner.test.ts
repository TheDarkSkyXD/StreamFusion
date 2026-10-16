import { describe, expect, it } from "vitest";
import { createTwitchGqlGuestReader } from "../adapters/twitch/twitch-gql-guest";

describe("Twitch profile banners", () => {
  it("requests and preserves the profile banner for the channel header", async () => {
    const reader = createTwitchGqlGuestReader({
      fetch: async (_url, init) => {
        expect(String(init?.body)).toContain("bannerImageURL");
        return Response.json({
          data: {
            user: {
              id: "42",
              login: "viewer",
              displayName: "Viewer",
              profileImageURL: "https://example.test/avatar",
              bannerImageURL: "https://example.test/banner",
              stream: null,
            },
          },
        });
      },
    });
    const page = await reader.getChannel({ login: "viewer" });
    expect(page.channel?.bannerUrl).toBe("https://example.test/banner");
  });
});
