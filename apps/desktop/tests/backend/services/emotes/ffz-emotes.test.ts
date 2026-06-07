import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();

vi.mock("@/lib/api-client", () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

import { ffzEmoteProvider } from "@/backend/services/emotes/ffz-emotes";

function mockJsonOnce(value: unknown) {
  getMock.mockReturnValueOnce({ json: () => Promise.resolve(value) });
}

function mockRejectOnce(err: unknown) {
  getMock.mockReturnValueOnce({ json: () => Promise.reject(err) });
}

function makeFFZEmote(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "TestEmote",
    height: 32,
    width: 32,
    public: true,
    hidden: false,
    modifier: false,
    urls: {
      "1": "https://cdn.frankerfacez.com/emote/1/1",
      "2": "https://cdn.frankerfacez.com/emote/1/2",
      "4": "https://cdn.frankerfacez.com/emote/1/4",
    },
    ...overrides,
  };
}

describe("FFZEmoteProvider", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  describe("fetchGlobalEmotes", () => {
    it("fetches and transforms global emotes from default sets", async () => {
      mockJsonOnce({
        default_sets: [3],
        sets: {
          "3": {
            id: 3,
            _type: 0,
            title: "Global Emotes",
            emoticons: [
              makeFFZEmote({ id: 1, name: "LULW" }),
              makeFFZEmote({ id: 2, name: "CatJam" }),
            ],
          },
        },
      });

      const result = await ffzEmoteProvider.fetchGlobalEmotes();

      expect(getMock).toHaveBeenCalledTimes(1);
      expect(getMock.mock.calls[0][0]).toContain("/set/global");
      expect(result).toHaveLength(2);
      expect(result[0].provider).toBe("ffz");
      expect(result[0].isGlobal).toBe(true);
      expect(result[0].name).toBe("LULW");
    });

    it("merges emotes from multiple default sets", async () => {
      mockJsonOnce({
        default_sets: [3, 4],
        sets: {
          "3": {
            id: 3,
            _type: 0,
            title: "Set A",
            emoticons: [makeFFZEmote({ id: 1, name: "EmoteA" })],
          },
          "4": {
            id: 4,
            _type: 0,
            title: "Set B",
            emoticons: [makeFFZEmote({ id: 2, name: "EmoteB" })],
          },
        },
      });

      const result = await ffzEmoteProvider.fetchGlobalEmotes();
      expect(result).toHaveLength(2);
    });

    it("throws on API error", async () => {
      mockRejectOnce(new Error("network error"));
      await expect(ffzEmoteProvider.fetchGlobalEmotes()).rejects.toThrow("network error");
    });
  });

  describe("fetchChannelEmotes", () => {
    it("fetches channel emotes by name", async () => {
      mockJsonOnce({
        room: {
          _id: 1,
          twitch_id: 12345,
          id: "testchannel",
          is_group: false,
          display_name: "TestChannel",
          set: 100,
          moderator_badge: null,
        },
        sets: {
          "100": {
            id: 100,
            _type: 1,
            title: "Channel Emotes",
            emoticons: [makeFFZEmote({ id: 10, name: "ChannelEmote" })],
          },
        },
      });

      const result = await ffzEmoteProvider.fetchChannelEmotes("12345", "testchannel");

      expect(getMock.mock.calls[0][0]).toContain("/room/testchannel");
      expect(result).toHaveLength(1);
      expect(result[0].isGlobal).toBe(false);
      expect(result[0].channelId).toBe("12345");
    });

    it("uses ID lookup when name is not provided", async () => {
      mockJsonOnce({
        room: {
          _id: 1,
          twitch_id: 12345,
          id: "ch",
          is_group: false,
          display_name: "Ch",
          set: 100,
          moderator_badge: null,
        },
        sets: {
          "100": {
            id: 100,
            _type: 1,
            title: "Channel Emotes",
            emoticons: [],
          },
        },
      });

      await ffzEmoteProvider.fetchChannelEmotes("12345");
      expect(getMock.mock.calls[0][0]).toContain("/room/id/12345");
    });

    it("returns empty array for non-twitch platform", async () => {
      const result = await ffzEmoteProvider.fetchChannelEmotes("123", "test", "kick");
      expect(result).toEqual([]);
      expect(getMock).not.toHaveBeenCalled();
    });

    it("returns empty array on 404", async () => {
      mockRejectOnce({ response: { status: 404 } });
      const result = await ffzEmoteProvider.fetchChannelEmotes("12345", "nonexistent");
      expect(result).toEqual([]);
    });

    it("returns empty array on non-404 errors (graceful)", async () => {
      mockRejectOnce(new Error("timeout"));
      const result = await ffzEmoteProvider.fetchChannelEmotes("12345", "testchannel");
      expect(result).toEqual([]);
    });
  });

  describe("emote transformation", () => {
    it("marks modifier emotes as zero-width", async () => {
      mockJsonOnce({
        default_sets: [1],
        sets: {
          "1": {
            id: 1,
            _type: 0,
            title: "Global",
            emoticons: [makeFFZEmote({ id: 5, name: "Overlay", modifier: true })],
          },
        },
      });

      const result = await ffzEmoteProvider.fetchGlobalEmotes();
      expect(result[0].isZeroWidth).toBe(true);
    });

    it("uses animated URLs when available", async () => {
      mockJsonOnce({
        default_sets: [1],
        sets: {
          "1": {
            id: 1,
            _type: 0,
            title: "Global",
            emoticons: [
              makeFFZEmote({
                id: 5,
                name: "Animated",
                animated: {
                  "1": "https://cdn.frankerfacez.com/emote/5/animated/1",
                  "2": "https://cdn.frankerfacez.com/emote/5/animated/2",
                  "4": "https://cdn.frankerfacez.com/emote/5/animated/4",
                },
              }),
            ],
          },
        },
      });

      const result = await ffzEmoteProvider.fetchGlobalEmotes();
      expect(result[0].isAnimated).toBe(true);
      expect(result[0].urls.url1x).toContain("animated");
    });

    it("includes owner info when present", async () => {
      mockJsonOnce({
        default_sets: [1],
        sets: {
          "1": {
            id: 1,
            _type: 0,
            title: "Global",
            emoticons: [
              makeFFZEmote({
                id: 5,
                name: "Owned",
                owner: { _id: 42, name: "creator", display_name: "Creator" },
              }),
            ],
          },
        },
      });

      const result = await ffzEmoteProvider.fetchGlobalEmotes();
      expect(result[0].owner).toEqual({
        id: "42",
        username: "creator",
        displayName: "Creator",
      });
    });
  });

  describe("getEmoteUrl", () => {
    const emote = {
      id: "1",
      name: "Test",
      provider: "ffz" as const,
      isGlobal: true,
      isAnimated: false,
      isZeroWidth: false,
      urls: {
        url1x: "https://cdn.frankerfacez.com/emote/1/1",
        url2x: "https://cdn.frankerfacez.com/emote/1/2",
        url4x: "https://cdn.frankerfacez.com/emote/1/4",
      },
    };

    it("returns correct size URLs", () => {
      expect(ffzEmoteProvider.getEmoteUrl(emote, "1x")).toContain("/1");
      expect(ffzEmoteProvider.getEmoteUrl(emote, "2x")).toContain("/2");
      expect(ffzEmoteProvider.getEmoteUrl(emote, "4x")).toContain("/4");
    });

    it("falls back to url2x when url4x is missing", () => {
      const noFourX = { ...emote, urls: { url1x: "a", url2x: "b" } };
      expect(ffzEmoteProvider.getEmoteUrl(noFourX, "4x")).toBe("b");
    });
  });

  describe("buildEmoteUrl (static)", () => {
    it("builds CDN URL with default size", () => {
      const url = (ffzEmoteProvider.constructor as any).buildEmoteUrl(42);
      expect(url).toBe("https://cdn.frankerfacez.com/emote/42/2");
    });

    it("builds CDN URL with custom size", () => {
      const url = (ffzEmoteProvider.constructor as any).buildEmoteUrl(42, "4");
      expect(url).toBe("https://cdn.frankerfacez.com/emote/42/4");
    });
  });
});
