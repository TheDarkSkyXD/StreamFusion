import { describe, expect, it } from "vitest";

import { substituteThirdPartyEmotes } from "@backend/services/chat/third-party-emote-enrich";
import type { Emote } from "@backend/services/emotes/emote-types";
import type { ContentFragment } from "@shared/chat-types";

function emote(name: string, provider: Emote["provider"], opts: Partial<Emote> = {}): Emote {
  return {
    id: `id-${name}`,
    name,
    provider,
    isGlobal: false,
    isAnimated: false,
    isZeroWidth: false,
    urls: {
      url1x: `https://example.test/${name}/1x`,
      url2x: `https://example.test/${name}/2x`,
      url4x: `https://example.test/${name}/4x`,
    },
    ...opts,
  };
}

function buildMap(...emotes: Emote[]): Map<string, Emote> {
  return new Map(emotes.map((e) => [e.name, e]));
}

describe("substituteThirdPartyEmotes", () => {
  it("returns input unchanged when emote map is empty", () => {
    const fragments: ContentFragment[] = [{ type: "text", content: "Clap PepoG" }];
    expect(substituteThirdPartyEmotes(fragments, new Map())).toBe(fragments);
  });

  it("returns input unchanged when no token matches a known emote", () => {
    const fragments: ContentFragment[] = [{ type: "text", content: "hello world" }];
    const map = buildMap(emote("Clap", "7tv"));
    expect(substituteThirdPartyEmotes(fragments, map)).toBe(fragments);
  });

  it("substitutes a single 7TV emote inside a text run", () => {
    const fragments: ContentFragment[] = [{ type: "text", content: "hi Clap there" }];
    const map = buildMap(emote("Clap", "7tv"));
    const out = substituteThirdPartyEmotes(fragments, map);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ type: "text", content: "hi " });
    expect(out[1]).toMatchObject({
      type: "emote",
      name: "Clap",
      url: "https://example.test/Clap/2x",
    });
    expect(out[2]).toEqual({ type: "text", content: " there" });
  });

  it("substitutes multiple emotes and preserves whitespace between them", () => {
    const fragments: ContentFragment[] = [{ type: "text", content: "Clap  PepoG\tBruh" }];
    const map = buildMap(emote("Clap", "7tv"), emote("PepoG", "bttv"), emote("Bruh", "ffz"));
    const out = substituteThirdPartyEmotes(fragments, map);
    // Expect: [emote Clap, text "  ", emote PepoG, text "\t", emote Bruh]
    expect(
      out.map((f) =>
        f.type === "emote" ? `e:${f.name}` : `t:${(f as { content: string }).content}`
      )
    ).toEqual(["e:Clap", "t:  ", "e:PepoG", "t:\t", "e:Bruh"]);
  });

  it("does NOT substitute native Twitch / Kick emotes by name (server already encoded those)", () => {
    const fragments: ContentFragment[] = [{ type: "text", content: "Kappa tazoClap" }];
    const map = buildMap(emote("Kappa", "twitch"), emote("tazoClap", "kick"));
    expect(substituteThirdPartyEmotes(fragments, map)).toBe(fragments);
  });

  it("substitutes native Twitch / Kick emote names when includeNative: true", () => {
    // Used by the Twitch self-echo path — tmi.js's synthetic self-message
    // arrives without IRC emote tags (skipUpdatingEmotesets is on), so native
    // emote names like Kappa show up in text fragments and need resolving.
    const fragments: ContentFragment[] = [{ type: "text", content: "Kappa hi" }];
    const map = buildMap(emote("Kappa", "twitch"));
    const out = substituteThirdPartyEmotes(fragments, map, { includeNative: true });
    expect(out[0]).toMatchObject({ type: "emote", name: "Kappa" });
    expect(out[1]).toEqual({ type: "text", content: " hi" });
  });

  it("leaves existing emote / mention / link fragments untouched", () => {
    const fragments: ContentFragment[] = [
      { type: "emote", id: "1", name: "Kappa", url: "https://existing/emote" },
      { type: "text", content: "Clap" },
      { type: "mention", username: "alice" },
      { type: "link", url: "https://example.test", text: "example" },
    ];
    const map = buildMap(emote("Clap", "7tv"));
    const out = substituteThirdPartyEmotes(fragments, map);
    // Non-text fragments pass through by reference (same object identity).
    expect(out[0]).toBe(fragments[0]);
    expect(out[1]).toMatchObject({
      type: "emote",
      name: "Clap",
      url: "https://example.test/Clap/2x",
    });
    expect(out[2]).toBe(fragments[2]);
    expect(out[3]).toBe(fragments[3]);
  });

  it("preserves isAnimated and isZeroWidth flags from the matched emote", () => {
    const fragments: ContentFragment[] = [{ type: "text", content: "FloppaL" }];
    const map = buildMap(emote("FloppaL", "7tv", { isAnimated: true, isZeroWidth: true }));
    const out = substituteThirdPartyEmotes(fragments, map);
    expect(out[0]).toMatchObject({ type: "emote", isAnimated: true, isZeroWidth: true });
  });

  it("preserves provider geometry and density sources for layout-stable rendering", () => {
    const fragments: ContentFragment[] = [{ type: "text", content: "Wide" }];
    const map = buildMap(emote("Wide", "7tv", { width: 112, height: 28 }));
    const out = substituteThirdPartyEmotes(fragments, map);
    expect(out[0]).toMatchObject({
      type: "emote",
      width: 112,
      height: 28,
      url1x: "https://example.test/Wide/1x",
      url2x: "https://example.test/Wide/2x",
      url4x: "https://example.test/Wide/4x",
    });
  });

  it("uses url2x for chat emotes to avoid heavy 4x CDN requests", () => {
    const fragments: ContentFragment[] = [{ type: "text", content: "Clap" }];
    const out = substituteThirdPartyEmotes(fragments, buildMap(emote("Clap", "7tv")));
    expect(out[0]).toMatchObject({ type: "emote", url: "https://example.test/Clap/2x" });
  });

  it("falls back to url1x when url2x is absent", () => {
    const fragments: ContentFragment[] = [{ type: "text", content: "Clap" }];
    const noUrl2x = emote("Clap", "7tv");
    // @ts-expect-error - exercising a malformed provider record defensively
    noUrl2x.urls = { url1x: "https://example.test/Clap/1x" };
    const out = substituteThirdPartyEmotes(fragments, buildMap(noUrl2x));
    expect(out[0]).toMatchObject({ type: "emote", url: "https://example.test/Clap/1x" });
  });

  it("returns the same fragments array reference when nothing changed (cheap no-op signal)", () => {
    const fragments: ContentFragment[] = [{ type: "text", content: "nothing matches here" }];
    const map = buildMap(emote("Clap", "7tv"));
    expect(substituteThirdPartyEmotes(fragments, map)).toBe(fragments);
  });
});
