import { describe, expect, it } from "vitest";

import { KickEmoteProvider } from "@/backend/services/emotes/kick-emotes";

// transformEmote is private; we exercise it through fetchChannelEmotes' transform
// by reaching into the class. Vitest is happy to access private methods at runtime —
// the type signature is the only barrier and we cast through it for the test.
type TransformEmoteFn = (
  emote: { id: number; channel_id?: number; name: string; subscribers_only: boolean },
  channelId?: string,
) => unknown;

function transform(): TransformEmoteFn {
  const provider = new KickEmoteProvider();
  // biome-ignore lint/suspicious/noExplicitAny: reaching into private for test
  return ((provider as any).transformEmote as TransformEmoteFn).bind(provider);
}

describe("KickEmoteProvider.transformEmote", () => {
  it("threads subscribers_only: true through to subscribersOnly", () => {
    const out = transform()(
      { id: 1, name: "subEmote", subscribers_only: true },
      "channel-42",
    ) as { subscribersOnly?: boolean };
    expect(out.subscribersOnly).toBe(true);
  });

  it("threads subscribers_only: false through to subscribersOnly", () => {
    const out = transform()(
      { id: 2, name: "globalEmote", subscribers_only: false },
      "channel-42",
    ) as { subscribersOnly?: boolean };
    expect(out.subscribersOnly).toBe(false);
  });

  it("does not throw when subscribers_only is missing (defensive)", () => {
    expect(() =>
      transform()(
        { id: 3, name: "weirdEmote" } as never,
        "channel-42",
      ),
    ).not.toThrow();
  });

  it("preserves all other emote fields", () => {
    const out = transform()(
      { id: 99, name: "PogChamp", subscribers_only: true, channel_id: 1234 },
      "channel-99",
    ) as {
      id: string;
      name: string;
      provider: string;
      isGlobal: boolean;
      isAnimated: boolean;
      isZeroWidth: boolean;
      channelId?: string;
      urls: { url1x: string; url2x: string; url4x?: string };
    };
    expect(out.id).toBe("99");
    expect(out.name).toBe("PogChamp");
    expect(out.provider).toBe("kick");
    expect(out.isGlobal).toBe(false);
    expect(out.isAnimated).toBe(false);
    expect(out.isZeroWidth).toBe(false);
    expect(out.channelId).toBe("channel-99");
    expect(out.urls.url1x).toContain("/emotes/99/");
    expect(out.urls.url2x).toContain("/emotes/99/");
    expect(out.urls.url4x).toContain("/emotes/99/");
  });
});
