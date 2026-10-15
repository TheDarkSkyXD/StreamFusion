import { describe, expect, it } from "vitest";

import { createTwitchGqlGuestReader } from "../adapters/twitch/twitch-gql-guest";

describe("twitch gql guest reader", () => {
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
                  game: {
                    id: "509658",
                    name: "Just Chatting",
                    slug: "just-chatting",
                  },
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

  it("returns each top stream once across duplicate edges and pages", async () => {
    const requestedCursors: (string | null)[] = [];
    const stream = (id: number) => ({
      broadcaster: {
        broadcastSettings: { language: "en" },
        id: `channel-${id}`,
        login: `channel-${id}`,
      },
      id: `stream-${id}`,
      title: `Stream ${id}`,
    });
    const reader = createTwitchGqlGuestReader({
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          variables?: { cursor?: string | null };
        };
        const cursor = body.variables?.cursor ?? null;
        requestedCursors.push(cursor);
        const ids = cursor === null ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 1] : [2, 10];
        return new Response(
          JSON.stringify({
            data: {
              streams: {
                edges: ids.map((id) => ({
                  cursor: `edge-${id}`,
                  node: stream(id),
                })),
                pageInfo: { hasNextPage: cursor === null },
              },
            },
          }),
          { status: 200 },
        );
      },
    });

    const result = await reader.getTopStreams({ language: "en" });

    expect(result.status).toBe("complete");
    expect(result.items.map((item) => item.id)).toEqual([
      "stream-1",
      "stream-2",
      "stream-3",
      "stream-4",
      "stream-5",
      "stream-6",
      "stream-7",
      "stream-8",
      "stream-9",
      "stream-10",
    ]);
    expect(requestedCursors).toEqual([null, "edge-1"]);
  });
});
