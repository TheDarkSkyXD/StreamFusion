import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();

vi.mock("@/lib/api-client", () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

import { bttvEmoteProvider } from "@/backend/services/emotes/bttv-emotes";

function mockJsonOnce(value: unknown) {
  getMock.mockReturnValueOnce({ json: () => Promise.resolve(value) });
}

function mockRejectOnce(err: unknown) {
  getMock.mockReturnValueOnce({ json: () => Promise.reject(err) });
}

function makeBTTVEmote(overrides: Record<string, unknown> = {}) {
  return {
    id: "bttv-1",
    code: "PepeHands",
    imageType: "png",
    animated: false,
    ...overrides,
  };
}

describe("BTTVEmoteProvider", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  describe("fetchGlobalEmotes", () => {
    it("fetches and transforms global emotes", async () => {
      mockJsonOnce([
        makeBTTVEmote({ id: "g1", code: "SourPls" }),
        makeBTTVEmote({ id: "g2", code: "catJAM", animated: true }),
      ]);

      const result = await bttvEmoteProvider.fetchGlobalEmotes();

      expect(getMock).toHaveBeenCalledTimes(1);
      expect(getMock.mock.calls[0][0]).toContain("/cached/emotes/global");
      expect(result).toHaveLength(2);
      expect(result[0].provider).toBe("bttv");
      expect(result[0].isGlobal).toBe(true);
      expect(result[0].name).toBe("SourPls");
      expect(result[0].isAnimated).toBe(false);
      expect(result[1].isAnimated).toBe(true);
    });

    it("marks gif imageType as animated", async () => {
      mockJsonOnce([
        makeBTTVEmote({ id: "g1", code: "GifEmote", imageType: "gif", animated: false }),
      ]);

      const result = await bttvEmoteProvider.fetchGlobalEmotes();
      expect(result[0].isAnimated).toBe(true);
    });

    it("throws on API error", async () => {
      mockRejectOnce(new Error("server error"));
      await expect(bttvEmoteProvider.fetchGlobalEmotes()).rejects.toThrow("server error");
    });
  });

  describe("fetchChannelEmotes", () => {
    it("fetches channel emotes for Twitch ID", async () => {
      mockJsonOnce({
        id: "bttv-user-1",
        bots: [],
        avatar: "https://example.com/avatar.png",
        channelEmotes: [makeBTTVEmote({ id: "ch1", code: "ChannelEmote" })],
        sharedEmotes: [makeBTTVEmote({ id: "sh1", code: "SharedEmote", animated: true })],
      });

      const result = await bttvEmoteProvider.fetchChannelEmotes("12345", "testuser");

      expect(getMock.mock.calls[0][0]).toContain("/cached/users/twitch/12345");
      expect(result).toHaveLength(2);
      expect(result[0].isGlobal).toBe(false);
      expect(result[0].channelId).toBe("12345");
      expect(result[0].name).toBe("ChannelEmote");
      expect(result[1].name).toBe("SharedEmote");
    });

    it("returns empty array for non-twitch platform", async () => {
      const result = await bttvEmoteProvider.fetchChannelEmotes("123", "test", "kick");
      expect(result).toEqual([]);
      expect(getMock).not.toHaveBeenCalled();
    });

    it("returns empty array for non-numeric channel ID", async () => {
      const result = await bttvEmoteProvider.fetchChannelEmotes("not-a-number", "test");
      expect(result).toEqual([]);
      expect(getMock).not.toHaveBeenCalled();
    });

    it("returns empty array on 404", async () => {
      mockRejectOnce({ response: { status: 404 } });
      const result = await bttvEmoteProvider.fetchChannelEmotes("99999", "nobody");
      expect(result).toEqual([]);
    });

    it("returns empty array on other errors (graceful)", async () => {
      mockRejectOnce(new Error("timeout"));
      const result = await bttvEmoteProvider.fetchChannelEmotes("12345", "user");
      expect(result).toEqual([]);
    });
  });

  describe("emote transformation", () => {
    it("includes user/owner info when present", async () => {
      mockJsonOnce([
        makeBTTVEmote({
          id: "owned-1",
          code: "OwnedEmote",
          user: {
            id: "u1",
            name: "creator",
            displayName: "Creator",
            providerId: "123",
          },
        }),
      ]);

      const result = await bttvEmoteProvider.fetchGlobalEmotes();
      expect(result[0].owner).toEqual({
        id: "u1",
        username: "creator",
        displayName: "Creator",
      });
    });

    it("omits owner when user is absent", async () => {
      mockJsonOnce([makeBTTVEmote({ id: "no-owner", code: "NoOwner" })]);

      const result = await bttvEmoteProvider.fetchGlobalEmotes();
      expect(result[0].owner).toBeUndefined();
    });

    it("generates correct CDN URLs", async () => {
      mockJsonOnce([makeBTTVEmote({ id: "cdn-test", code: "CDN" })]);

      const result = await bttvEmoteProvider.fetchGlobalEmotes();
      expect(result[0].urls.url1x).toBe("https://cdn.betterttv.net/emote/cdn-test/1x.webp");
      expect(result[0].urls.url2x).toBe("https://cdn.betterttv.net/emote/cdn-test/2x.webp");
      expect(result[0].urls.url4x).toBe("https://cdn.betterttv.net/emote/cdn-test/3x.webp");
    });

    it("all emotes are NOT zero-width", async () => {
      mockJsonOnce([makeBTTVEmote()]);
      const result = await bttvEmoteProvider.fetchGlobalEmotes();
      expect(result[0].isZeroWidth).toBe(false);
    });
  });

  describe("getEmoteUrl", () => {
    const emote = {
      id: "1",
      name: "Test",
      provider: "bttv" as const,
      isGlobal: true,
      isAnimated: false,
      isZeroWidth: false,
      urls: {
        url1x: "https://cdn.betterttv.net/emote/1/1x.webp",
        url2x: "https://cdn.betterttv.net/emote/1/2x.webp",
        url4x: "https://cdn.betterttv.net/emote/1/3x.webp",
      },
    };

    it("returns correct size URLs", () => {
      expect(bttvEmoteProvider.getEmoteUrl(emote, "1x")).toContain("1x");
      expect(bttvEmoteProvider.getEmoteUrl(emote, "2x")).toContain("2x");
      expect(bttvEmoteProvider.getEmoteUrl(emote, "4x")).toContain("3x");
    });

    it("falls back to url2x when url4x is missing", () => {
      const noFourX = { ...emote, urls: { url1x: "a", url2x: "b" } };
      expect(bttvEmoteProvider.getEmoteUrl(noFourX, "4x")).toBe("b");
    });
  });

  describe("buildEmoteUrl (static)", () => {
    it("builds CDN URL with default size", () => {
      const url = (bttvEmoteProvider.constructor as any).buildEmoteUrl("abc123");
      expect(url).toBe("https://cdn.betterttv.net/emote/abc123/2x.webp");
    });

    it("builds CDN URL with custom size", () => {
      const url = (bttvEmoteProvider.constructor as any).buildEmoteUrl("abc123", "3x");
      expect(url).toBe("https://cdn.betterttv.net/emote/abc123/3x.webp");
    });
  });
});
