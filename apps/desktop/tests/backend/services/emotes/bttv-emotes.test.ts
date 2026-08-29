import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIpcReplyMock } from "../../../helpers/ipc-reply-mock";

// Guards: BTTV REST goes through electronAPI.emotes.bttv.* (main-process IPC) — calling renderer fetch reintroduces the DevTools red "Failed to load resource: ... 404" line PRD #62 closed
// Guards: 404 path is a null sentinel from main (NOT a thrown error) — the renderer logs at info and returns [] without hitting the ApiClient error log
// Guards: BTTV is Twitch-only and expects a numeric Twitch user id — non-twitch platforms and non-numeric channel ids short-circuit WITHOUT touching the IPC

const bttvApi = {
  getGlobal: createIpcReplyMock(),
  getUserByTwitchId: createIpcReplyMock(),
};

vi.stubGlobal("window", {
  electronAPI: {
    emotes: {
      bttv: bttvApi,
    },
  },
} as unknown as Window);

import { BTTVEmoteProvider, bttvEmoteProvider } from "@backend/services/emotes/bttv-emotes";

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
    bttvApi.getGlobal.mockReset();
    bttvApi.getUserByTwitchId.mockReset();
  });

  describe("fetchGlobalEmotes", () => {
    it("invokes electronAPI.emotes.bttv.getGlobal and transforms the response", async () => {
      bttvApi.getGlobal.mockResolvedValueOnce([
        makeBTTVEmote({ id: "g1", code: "SourPls" }),
        makeBTTVEmote({ id: "g2", code: "catJAM", animated: true }),
      ]);

      const result = await bttvEmoteProvider.fetchGlobalEmotes();

      expect(bttvApi.getGlobal).toHaveBeenCalledOnce();
      expect(result).toHaveLength(2);
      expect(result[0].provider).toBe("bttv");
      expect(result[0].isGlobal).toBe(true);
      expect(result[0].name).toBe("SourPls");
      expect(result[0].isAnimated).toBe(false);
      expect(result[1].isAnimated).toBe(true);
    });

    it("marks gif imageType as animated", async () => {
      bttvApi.getGlobal.mockResolvedValueOnce([
        makeBTTVEmote({ id: "g1", code: "GifEmote", imageType: "gif", animated: false }),
      ]);

      const result = await bttvEmoteProvider.fetchGlobalEmotes();
      expect(result[0].isAnimated).toBe(true);
    });

    it("rethrows on transport error so callers can decide", async () => {
      bttvApi.getGlobal.mockRejectedValueOnce(new Error("server error"));
      await expect(bttvEmoteProvider.fetchGlobalEmotes()).rejects.toThrow("server error");
    });
  });

  describe("fetchChannelEmotes", () => {
    it("invokes electronAPI.emotes.bttv.getUserByTwitchId(channelId) and merges channel+shared emotes", async () => {
      bttvApi.getUserByTwitchId.mockResolvedValueOnce({
        id: "bttv-user-1",
        bots: [],
        avatar: "https://example.com/avatar.png",
        channelEmotes: [makeBTTVEmote({ id: "ch1", code: "ChannelEmote" })],
        sharedEmotes: [makeBTTVEmote({ id: "sh1", code: "SharedEmote", animated: true })],
      });

      const result = await bttvEmoteProvider.fetchChannelEmotes("12345", "testuser");

      expect(bttvApi.getUserByTwitchId).toHaveBeenCalledWith("12345");
      expect(result).toHaveLength(2);
      expect(result[0].isGlobal).toBe(false);
      expect(result[0].channelId).toBe("12345");
      expect(result[0].name).toBe("ChannelEmote");
      expect(result[1].name).toBe("SharedEmote");
    });

    it("returns [] for non-twitch platform WITHOUT touching IPC", async () => {
      const result = await bttvEmoteProvider.fetchChannelEmotes("123", "test", "kick");
      expect(result).toEqual([]);
      expect(bttvApi.getUserByTwitchId).not.toHaveBeenCalled();
    });

    it("returns [] for non-numeric channel ID WITHOUT touching IPC", async () => {
      const result = await bttvEmoteProvider.fetchChannelEmotes("not-a-number", "test");
      expect(result).toEqual([]);
      expect(bttvApi.getUserByTwitchId).not.toHaveBeenCalled();
    });

    it("returns [] on null sentinel (channel not on BTTV)", async () => {
      bttvApi.getUserByTwitchId.mockResolvedValueOnce(null);
      const result = await bttvEmoteProvider.fetchChannelEmotes("99999", "nobody");
      expect(result).toEqual([]);
    });

    it("returns [] gracefully on transport error (5xx, network)", async () => {
      bttvApi.getUserByTwitchId.mockRejectedValueOnce(new Error("timeout"));
      const result = await bttvEmoteProvider.fetchChannelEmotes("12345", "user");
      expect(result).toEqual([]);
    });
  });

  describe("emote transformation", () => {
    it("includes user/owner info when present", async () => {
      bttvApi.getGlobal.mockResolvedValueOnce([
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
      bttvApi.getGlobal.mockResolvedValueOnce([makeBTTVEmote({ id: "no-owner", code: "NoOwner" })]);

      const result = await bttvEmoteProvider.fetchGlobalEmotes();
      expect(result[0].owner).toBeUndefined();
    });

    it("generates correct CDN URLs", async () => {
      bttvApi.getGlobal.mockResolvedValueOnce([makeBTTVEmote({ id: "cdn-test", code: "CDN" })]);

      const result = await bttvEmoteProvider.fetchGlobalEmotes();
      expect(result[0].urls.url1x).toBe("https://cdn.betterttv.net/emote/cdn-test/1x.webp");
      expect(result[0].urls.url2x).toBe("https://cdn.betterttv.net/emote/cdn-test/2x.webp");
      expect(result[0].urls.url4x).toBe("https://cdn.betterttv.net/emote/cdn-test/3x.webp");
    });

    it("all emotes are NOT zero-width", async () => {
      bttvApi.getGlobal.mockResolvedValueOnce([makeBTTVEmote()]);
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
      const url = BTTVEmoteProvider.buildEmoteUrl("abc123");
      expect(url).toBe("https://cdn.betterttv.net/emote/abc123/2x.webp");
    });

    it("builds CDN URL with custom size", () => {
      const url = BTTVEmoteProvider.buildEmoteUrl("abc123", "3x");
      expect(url).toBe("https://cdn.betterttv.net/emote/abc123/3x.webp");
    });
  });
});
