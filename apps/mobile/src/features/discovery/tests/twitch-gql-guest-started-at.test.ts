import { describe, expect, it } from "vitest";

import { createTwitchGqlGuestReader } from "../adapters/twitch/twitch-gql-guest";

describe("twitch gql guest stream startedAt", () => {
  it("maps stream.createdAt into startedAt for channel pages", async () => {
    const queries: string[] = [];
    const reader = createTwitchGqlGuestReader({
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          query?: string;
        };
        queries.push(body.query ?? "");
        return new Response(
          JSON.stringify({
            data: {
              user: {
                description: "",
                displayName: "Ada",
                id: "1",
                login: "ada",
                profileImageURL: "https://cdn.example/a.png",
                stream: {
                  broadcaster: {
                    displayName: "Ada",
                    id: "1",
                    login: "ada",
                    profileImageURL: "https://cdn.example/a.png",
                    roles: { isAffiliate: false, isPartner: true },
                  },
                  createdAt: "2026-09-23T12:00:00Z",
                  freeformTags: [{ name: "english" }],
                  game: { id: "509658", name: "Just Chatting", slug: "just-chatting" },
                  id: "s1",
                  previewImageURL: "https://cdn.example/t.png",
                  title: "Building",
                  viewersCount: 50_443,
                },
              },
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      },
    });

    const page = await reader.getChannel({ login: "ada" });
    expect(queries.some((query) => query.includes("createdAt"))).toBe(true);
    expect(page.live?.viewerCount).toBe(50_443);
    expect(page.live?.startedAt).toBe("2026-09-23T12:00:00.000Z");
  });
});
