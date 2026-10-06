import { expect, it } from "vitest";
import { resolveMessageParts } from "../domain/message-parts";

const catalog = [
  {
    id: "third-party",
    name: "Kappa",
    insertion: "Kappa",
    provider: "7tv" as const,
    imageUrl: "https://example.com/kappa.webp",
    staticImageUrl: "https://example.com/static.webp",
    animatedImageUrl: "https://example.com/animated.webp",
    zeroWidth: true,
  },
];

it("preserves a native platform emote when a third-party emote has the same name", () => {
  const native = [
    {
      kind: "emote" as const,
      text: "Kappa",
      imageUrl: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0",
    },
  ];
  expect(
    resolveMessageParts("Kappa", catalog, native, { animatedEmotes: false }),
  ).toEqual([
    {
      kind: "emote",
      text: "Kappa",
      imageUrl: "https://static-cdn.jtvnw.net/emoticons/v2/25/static/dark/2.0",
    },
  ]);
  expect(resolveMessageParts("Kappa", catalog, native)).toEqual(native);
});

it("uses catalog static frames and stacks only catalog zero-width emotes", () => {
  const base = {
    id: "base",
    name: "Base",
    insertion: "Base",
    provider: "bttv" as const,
    imageUrl: "https://example.com/base.png",
  };
  expect(
    resolveMessageParts("Base Kappa", [base, ...catalog], undefined, {
      animatedEmotes: false,
    }),
  ).toEqual([
    {
      kind: "emote-stack",
      emotes: [
        { kind: "emote", text: "Base", imageUrl: base.imageUrl },
        {
          kind: "emote",
          text: "Kappa",
          imageUrl: "https://example.com/static.webp",
        },
      ],
    },
  ]);
  expect(
    resolveMessageParts("Kappa", catalog, undefined, {
      renderEmotesAsText: true,
    }),
  ).toEqual([{ kind: "text", text: "Kappa" }]);
});
