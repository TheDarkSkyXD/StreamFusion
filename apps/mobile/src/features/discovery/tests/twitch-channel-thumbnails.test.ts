import { describe, expect, it } from "vitest";

import { createTwitchGqlGuestMediaReader } from "../adapters/twitch/twitch-gql-guest-media";

describe("Twitch channel thumbnails", () => {
  it("requests a sized video thumbnail instead of an unusable URL template", async () => {
    let requestBody = "";
    const reader = createTwitchGqlGuestMediaReader({
      fetch: async (_url, init) => {
        requestBody = String(init?.body);
        return Response.json({ data: { user: { videos: { edges: [] } } } });
      },
    });

    await reader.getChannelVideos({ login: "caseoh_" });

    expect(JSON.parse(requestBody)).toMatchObject({
      query: expect.stringMatching(
        /previewThumbnailURL\(\s*width:\s*640\s*,\s*height:\s*360\s*\)/u,
      ),
    });
  });

  it("preserves the provider image URL for clips", async () => {
    const thumbnailUrl =
      "https://static-cdn.jtvnw.net/twitch-video-assets/clip/landscape/thumb/thumb-0000000000-1920x1080.jpg";
    const reader = createTwitchGqlGuestMediaReader({
      fetch: async () =>
        Response.json({
          data: {
            user: {
              id: "267160288",
              login: "caseoh_",
              clips: {
                edges: [
                  {
                    node: {
                      slug: "clip-1",
                      title: "A moment",
                      thumbnailURL: thumbnailUrl,
                      createdAt: "2026-10-16T00:00:00Z",
                    },
                  },
                ],
              },
            },
          },
        }),
    });

    const result = await reader.getChannelClips({ login: "caseoh_" });

    expect(result.items[0]?.thumbnailUrl).toBe(thumbnailUrl);
  });
});
