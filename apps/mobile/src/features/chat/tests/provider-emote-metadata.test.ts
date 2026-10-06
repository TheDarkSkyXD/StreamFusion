import { expect, it } from "vitest";
import { parseProviderEmotes } from "../adapters/provider-emotes";

it("uses 7TV's supplied static frame and active-set zero-width flag", () => {
  const [emote] = parseProviderEmotes("7tv", {
    emotes: [
      {
        id: "emote-1",
        name: "Spark",
        flags: 1,
        data: {
          animated: true,
          flags: 0,
          host: {
            url: "//cdn.7tv.app/emote-1",
            files: [
              {
                name: "2x.webp",
                static_name: "2x_static.webp",
                format: "WEBP",
              },
            ],
          },
        },
      },
    ],
  });
  expect(emote).toEqual({
    id: "emote-1",
    name: "Spark",
    provider: "7tv",
    insertion: "Spark",
    imageUrl: "https://cdn.7tv.app/emote-1/2x.webp",
    animatedImageUrl: "https://cdn.7tv.app/emote-1/2x.webp",
    staticImageUrl: "https://cdn.7tv.app/emote-1/2x_static.webp",
    zeroWidth: true,
  });
});

it("selects Twitch and FFZ animation with their real static alternatives", () => {
  expect(
    parseProviderEmotes("twitch", {
      data: [{ id: "1", name: "Wave", format: ["static", "animated"] }],
    })[0],
  ).toMatchObject({
    imageUrl: "https://static-cdn.jtvnw.net/emoticons/v2/1/animated/dark/2.0",
    staticImageUrl:
      "https://static-cdn.jtvnw.net/emoticons/v2/1/static/dark/2.0",
  });
  expect(
    parseProviderEmotes("ffz", {
      sets: {
        "3": {
          emoticons: [
            {
              id: 7,
              name: "Dance",
              modifier: true,
              urls: { "2": "//cdn.frankerfacez.com/emote/7/2" },
              animated: { "2": "//cdn.frankerfacez.com/emote/7/animated/2" },
            },
          ],
        },
      },
    })[0],
  ).toMatchObject({
    imageUrl: "https://cdn.frankerfacez.com/emote/7/animated/2",
    staticImageUrl: "https://cdn.frankerfacez.com/emote/7/2",
    zeroWidth: true,
  });
});
