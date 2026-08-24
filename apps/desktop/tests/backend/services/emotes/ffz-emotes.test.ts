import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIpcReplyMock } from "../../../helpers/ipc-reply-mock";

// Guards: FFZ REST goes through electronAPI.emotes.ffz.* (main-process IPC) — calling renderer fetch reintroduces the DevTools 404 line PRD #62 closed
// Guards: 404 is a null sentinel from main (NOT a thrown error); renderer logs info and returns []
// Guards: FFZ is Twitch-only — Kick callers short-circuit WITHOUT touching the IPC. Renderer hands {name, channelId} to main and lets the service pick the endpoint

const ffzApi = {
  getGlobal: createIpcReplyMock(),
  getRoom: createIpcReplyMock(),
};

vi.stubGlobal("window", {
  electronAPI: {
    emotes: {
      ffz: ffzApi,
    },
  },
} as unknown as Window);

import { FFZEmoteProvider, ffzEmoteProvider } from "@/backend/services/emotes/ffz-emotes";

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
    ffzApi.getGlobal.mockReset();
    ffzApi.getRoom.mockReset();
  });

  describe("fetchGlobalEmotes", () => {
    it("invokes electronAPI.emotes.ffz.getGlobal and transforms default-set emotes", async () => {
      ffzApi.getGlobal.mockResolvedValueOnce({
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

      expect(ffzApi.getGlobal).toHaveBeenCalledOnce();
      expect(result).toHaveLength(2);
      expect(result[0].provider).toBe("ffz");
      expect(result[0].isGlobal).toBe(true);
      expect(result[0].name).toBe("LULW");
    });

    it("merges emotes from multiple default sets", async () => {
      ffzApi.getGlobal.mockResolvedValueOnce({
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

    it("rethrows on transport error so callers can decide", async () => {
      ffzApi.getGlobal.mockRejectedValueOnce(new Error("network error"));
      await expect(ffzEmoteProvider.fetchGlobalEmotes()).rejects.toThrow("network error");
    });
  });

  describe("fetchChannelEmotes", () => {
    it("hands {name, channelId} to main so the service can pick name-first vs id-fallback", async () => {
      ffzApi.getRoom.mockResolvedValueOnce({
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

      expect(ffzApi.getRoom).toHaveBeenCalledWith({ kind: "name", name: "testchannel" });
      expect(result).toHaveLength(1);
      expect(result[0].isGlobal).toBe(false);
      expect(result[0].channelId).toBe("12345");
    });

    it("omits name when only channelId is provided so main falls back to /room/id/{id}", async () => {
      ffzApi.getRoom.mockResolvedValueOnce({
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
          "100": { id: 100, _type: 1, title: "Channel Emotes", emoticons: [] },
        },
      });

      await ffzEmoteProvider.fetchChannelEmotes("12345");
      expect(ffzApi.getRoom).toHaveBeenCalledWith({ kind: "channel-id", channelId: "12345" });
    });

    it("returns [] for non-twitch platform WITHOUT touching IPC", async () => {
      const result = await ffzEmoteProvider.fetchChannelEmotes("123", "test", "kick");
      expect(result).toEqual([]);
      expect(ffzApi.getRoom).not.toHaveBeenCalled();
    });

    it("returns [] on null sentinel (channel not on FFZ)", async () => {
      ffzApi.getRoom.mockResolvedValueOnce(null);
      const result = await ffzEmoteProvider.fetchChannelEmotes("12345", "nonexistent");
      expect(result).toEqual([]);
    });

    it("returns [] gracefully on transport error", async () => {
      ffzApi.getRoom.mockRejectedValueOnce(new Error("timeout"));
      const result = await ffzEmoteProvider.fetchChannelEmotes("12345", "testchannel");
      expect(result).toEqual([]);
    });
  });

  describe("emote transformation", () => {
    it("marks modifier emotes as zero-width", async () => {
      ffzApi.getGlobal.mockResolvedValueOnce({
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
      ffzApi.getGlobal.mockResolvedValueOnce({
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
      ffzApi.getGlobal.mockResolvedValueOnce({
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
      const url = FFZEmoteProvider.buildEmoteUrl(42);
      expect(url).toBe("https://cdn.frankerfacez.com/emote/42/2");
    });

    it("builds CDN URL with custom size", () => {
      const url = FFZEmoteProvider.buildEmoteUrl(42, "4");
      expect(url).toBe("https://cdn.frankerfacez.com/emote/42/4");
    });
  });
});
