import { describe, expect, it } from "vitest";

import { createKickClipPlaybackSource } from "../adapters/kick/kick-clip-playback-source";

describe("Kick clip playback source", () => {
  it("resolves a restored clip target through Kick's clip endpoint", async () => {
    const requested: string[] = [];
    const resolver = createKickClipPlaybackSource({
      fetch: async (input) => {
        requested.push(String(input));
        return new Response(
          JSON.stringify({
            clip: {
              id: "clip_123",
              video_url: "https://clips.kick.com/clip_123.mp4",
            },
          }),
          { status: 200 },
        );
      },
    });
    const result = await resolver.resolve({
      signal: new AbortController().signal,
      target: {
        channelId: "668",
        channelName: "xqc",
        media: {
          durationSeconds: 27,
          id: "clip_123",
          kind: "clip",
          title: "A good moment",
        },
        platform: "kick",
      },
    });

    expect(requested).toEqual(["https://kick.com/api/v2/clips/clip_123"]);
    expect(result).toMatchObject({
      integration: "kick-v2-clip",
      kind: "resolved",
      sourceUri: "https://clips.kick.com/clip_123.mp4",
    });
  });
});
