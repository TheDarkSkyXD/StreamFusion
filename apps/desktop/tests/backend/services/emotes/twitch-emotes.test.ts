import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();

vi.mock("@/lib/api-client", () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

import { twitchEmoteProvider } from "@/backend/services/emotes/twitch-emotes";

function mockJsonOnce(value: unknown) {
  getMock.mockReturnValueOnce({ json: () => Promise.resolve(value) });
}

function mockRejectOnce(err: unknown) {
  getMock.mockReturnValueOnce({ json: () => Promise.reject(err) });
}

function makeTwitchEmote(overrides: Record<string, unknown> = {}) {
  return {
    id: "emote-1",
    name: "Kappa",
    images: {
      url_1x: "https://static-cdn.jtvnw.net/emoticons/v2/emote-1/static/dark/1.0",
      url_2x: "https://static-cdn.jtvnw.net/emoticons/v2/emote-1/static/dark/2.0",
      url_4x: "https://static-cdn.jtvnw.net/emoticons/v2/emote-1/static/dark/3.0",
    },
    format: ["static"],
    scale: ["1.0", "2.0", "3.0"],
    theme_mode: ["dark"],
    ...overrides,
  };
}

describe("TwitchEmoteProvider", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("configure", () => {
    it("marks provider as configured with valid credentials", () => {
      twitchEmoteProvider.configure("client-id", "access-token");
      expect(twitchEmoteProvider.configured).toBe(true);
    });
  });

  describe("fetchGlobalEmotes", () => {
    it("returns empty array when not configured", async () => {
      const provider = Object.create(
        Object.getPrototypeOf(twitchEmoteProvider),
        Object.getOwnPropertyDescriptors(twitchEmoteProvider)
      );
      (provider as any).isConfigured = false;

      const result = await provider.fetchGlobalEmotes();
      expect(result).toEqual([]);
    });

    it("fetches and transforms global emotes", async () => {
      twitchEmoteProvider.configure("cid", "token");
      mockJsonOnce({
        data: [makeTwitchEmote(), makeTwitchEmote({ id: "emote-2", name: "PogChamp" })],
      });

      const result = await twitchEmoteProvider.fetchGlobalEmotes();

      expect(getMock).toHaveBeenCalledTimes(1);
      expect(getMock.mock.calls[0][0]).toBe("https://api.twitch.tv/helix/chat/emotes/global");
      expect(result).toHaveLength(2);
      expect(result[0].provider).toBe("twitch");
      expect(result[0].isGlobal).toBe(true);
      expect(result[0].name).toBe("Kappa");
      expect(result[0].isZeroWidth).toBe(false);
    });

    it("uses animated format when available", async () => {
      twitchEmoteProvider.configure("cid", "token");
      mockJsonOnce({
        data: [makeTwitchEmote({ format: ["static", "animated"] })],
      });

      const result = await twitchEmoteProvider.fetchGlobalEmotes();

      expect(result[0].isAnimated).toBe(true);
      expect(result[0].urls.url1x).toContain("animated");
    });

    it("returns empty array on API error", async () => {
      twitchEmoteProvider.configure("cid", "token");
      mockRejectOnce(new Error("API error"));

      await expect(twitchEmoteProvider.fetchGlobalEmotes()).resolves.toEqual([]);
    });
  });

  describe("fetchChannelEmotes", () => {
    it("fetches channel emotes with broadcaster_id", async () => {
      twitchEmoteProvider.configure("cid", "token");
      mockJsonOnce({
        data: [makeTwitchEmote({ id: "ch-1", name: "ChannelEmote", owner_id: "99" })],
      });

      const result = await twitchEmoteProvider.fetchChannelEmotes("12345");

      expect(getMock.mock.calls[0][0]).toContain("broadcaster_id=12345");
      expect(result).toHaveLength(1);
      expect(result[0].isGlobal).toBe(false);
      expect(result[0].channelId).toBe("12345");
      expect(result[0].owner?.id).toBe("99");
    });

    it("returns empty array on 404", async () => {
      twitchEmoteProvider.configure("cid", "token");
      mockRejectOnce({ response: { status: 404 } });

      const result = await twitchEmoteProvider.fetchChannelEmotes("999");
      expect(result).toEqual([]);
    });

    it("returns empty array on non-404 error", async () => {
      twitchEmoteProvider.configure("cid", "token");
      mockRejectOnce(new Error("server error"));

      await expect(twitchEmoteProvider.fetchChannelEmotes("999")).resolves.toEqual([]);
    });

    it("refreshes the Twitch token before fetching channel emotes when the bridge is available", async () => {
      twitchEmoteProvider.configure("cid", "stale-token");
      const getValidTwitchToken = vi.fn().mockResolvedValue("fresh-token");
      vi.stubGlobal("window", {
        electronAPI: {
          auth: { getValidTwitchToken },
        },
      });
      mockJsonOnce({ data: [] });

      await twitchEmoteProvider.fetchChannelEmotes("999");

      expect(getValidTwitchToken).toHaveBeenCalledTimes(1);
      expect(getMock.mock.calls[0][1]).toMatchObject({
        headers: {
          "Client-ID": "cid",
          Authorization: "Bearer fresh-token",
        },
      });
    });
  });

  describe("fetchEmoteSet", () => {
    it("fetches emote set by ID", async () => {
      twitchEmoteProvider.configure("cid", "token");
      mockJsonOnce({
        data: [makeTwitchEmote({ id: "set-emote", name: "SetEmote" })],
      });

      const result = await twitchEmoteProvider.fetchEmoteSet("set-123");

      expect(getMock.mock.calls[0][0]).toContain("emote_set_id=set-123");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("SetEmote");
    });
  });

  describe("getEmoteUrl", () => {
    it("returns correct size URLs", () => {
      const emote = {
        id: "1",
        name: "Test",
        provider: "twitch" as const,
        isGlobal: true,
        isAnimated: false,
        isZeroWidth: false,
        urls: {
          url1x: "https://example.com/1x",
          url2x: "https://example.com/2x",
          url4x: "https://example.com/4x",
        },
      };

      expect(twitchEmoteProvider.getEmoteUrl(emote, "1x")).toBe("https://example.com/1x");
      expect(twitchEmoteProvider.getEmoteUrl(emote, "2x")).toBe("https://example.com/2x");
      expect(twitchEmoteProvider.getEmoteUrl(emote, "4x")).toBe("https://example.com/4x");
    });

    it("falls back to url2x when url4x is missing", () => {
      const emote = {
        id: "1",
        name: "Test",
        provider: "twitch" as const,
        isGlobal: true,
        isAnimated: false,
        isZeroWidth: false,
        urls: {
          url1x: "https://example.com/1x",
          url2x: "https://example.com/2x",
        },
      };

      expect(twitchEmoteProvider.getEmoteUrl(emote, "4x")).toBe("https://example.com/2x");
    });
  });

  describe("buildEmoteUrl (static)", () => {
    it("builds URL with defaults", () => {
      const url = (twitchEmoteProvider.constructor as any).buildEmoteUrl("123");
      expect(url).toBe("https://static-cdn.jtvnw.net/emoticons/v2/123/default/dark/3.0");
    });

    it("builds URL with custom format and theme", () => {
      const url = (twitchEmoteProvider.constructor as any).buildEmoteUrl(
        "123",
        "animated",
        "light",
        "1.0"
      );
      expect(url).toBe("https://static-cdn.jtvnw.net/emoticons/v2/123/animated/light/1.0");
    });
  });
});
