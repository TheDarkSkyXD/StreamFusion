import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();

import { twitchEmoteProvider } from "@/backend/services/emotes/twitch-emotes";

function mockJsonOnce(value: unknown) {
  executeMock.mockResolvedValueOnce({ ok: true, data: value });
}

function mockRejectOnce(err: unknown) {
  executeMock.mockRejectedValueOnce(err);
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

// Guards: Twitch emote reads stay behind the credential-free main-process capability boundary and transform Helix responses into the shared emote shape.
// Guards: user-emote reads require a validated token subject and scope, paginate all results, and preserve completed pages when a later page fails.
describe("TwitchEmoteProvider", () => {
  beforeEach(() => {
    executeMock.mockReset();
    vi.stubGlobal("window", {
      electronAPI: {
        twitch: { execute: executeMock },
        auth: {},
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("configure", () => {
    it("marks the IPC-backed provider as configured", () => {
      twitchEmoteProvider.configure();
      expect(twitchEmoteProvider.configured).toBe(true);
    });

    it("does not accept renderer-owned Twitch credentials", () => {
      expect(twitchEmoteProvider.configure.length).toBe(0);
    });

    it("can disable Helix reads after Twitch signs out", async () => {
      twitchEmoteProvider.configure();
      twitchEmoteProvider.disable();

      await expect(twitchEmoteProvider.fetchGlobalEmotes()).resolves.toEqual([]);
      expect(executeMock).not.toHaveBeenCalled();
    });
  });

  describe("fetchGlobalEmotes", () => {
    it("returns empty array when not configured", async () => {
      const provider = Object.create(
        Object.getPrototypeOf(twitchEmoteProvider),
        Object.getOwnPropertyDescriptors(twitchEmoteProvider)
      );
      expect(Reflect.set(provider, "isConfigured", false)).toBe(true);

      const result = await provider.fetchGlobalEmotes();
      expect(result).toEqual([]);
    });

    it("fetches and transforms global emotes", async () => {
      twitchEmoteProvider.configure();
      mockJsonOnce({
        data: [makeTwitchEmote(), makeTwitchEmote({ id: "emote-2", name: "PogChamp" })],
      });

      const result = await twitchEmoteProvider.fetchGlobalEmotes();

      expect(executeMock).toHaveBeenCalledWith({ operation: "get-global-emotes" });
      expect(result).toHaveLength(2);
      expect(result[0].provider).toBe("twitch");
      expect(result[0].isGlobal).toBe(true);
      expect(result[0].name).toBe("Kappa");
      expect(result[0].isZeroWidth).toBe(false);
    });

    it("uses animated format when available", async () => {
      twitchEmoteProvider.configure();
      mockJsonOnce({
        data: [makeTwitchEmote({ format: ["static", "animated"] })],
      });

      const result = await twitchEmoteProvider.fetchGlobalEmotes();

      expect(result[0].isAnimated).toBe(true);
      expect(result[0].urls.url1x).toContain("animated");
    });

    it("returns empty array on API error", async () => {
      twitchEmoteProvider.configure();
      mockRejectOnce(new Error("API error"));

      await expect(twitchEmoteProvider.fetchGlobalEmotes()).resolves.toEqual([]);
    });
  });

  describe("fetchChannelEmotes", () => {
    it("fetches channel emotes with broadcaster_id", async () => {
      twitchEmoteProvider.configure();
      mockJsonOnce({
        data: [
          makeTwitchEmote({
            id: "ch-1",
            name: "ChannelEmote",
            owner_id: "99",
            emote_type: "subscriptions",
          }),
        ],
      });

      const result = await twitchEmoteProvider.fetchChannelEmotes("12345");

      expect(executeMock).toHaveBeenCalledWith({
        operation: "get-channel-emotes",
        broadcasterId: "12345",
      });
      expect(result).toHaveLength(1);
      expect(result[0].isGlobal).toBe(false);
      expect(result[0].channelId).toBe("12345");
      expect(result[0].owner?.id).toBe("99");
      expect(result[0].subscribersOnly).toBe(true);
    });

    it("returns empty array on 404", async () => {
      twitchEmoteProvider.configure();
      mockRejectOnce({ response: { status: 404 } });

      const result = await twitchEmoteProvider.fetchChannelEmotes("999");
      expect(result).toEqual([]);
    });

    it("returns empty array on non-404 error", async () => {
      twitchEmoteProvider.configure();
      mockRejectOnce(new Error("server error"));

      await expect(twitchEmoteProvider.fetchChannelEmotes("999")).resolves.toEqual([]);
    });

    it("fetches channel emotes without exposing the Twitch token to the renderer provider", async () => {
      twitchEmoteProvider.configure();
      const getValidTwitchToken = vi.fn().mockResolvedValue("fresh-token");
      vi.stubGlobal("window", {
        electronAPI: {
          auth: { getValidTwitchToken },
          twitch: { execute: executeMock },
        },
      });
      mockJsonOnce({ data: [] });

      await twitchEmoteProvider.fetchChannelEmotes("999");

      expect(getValidTwitchToken).not.toHaveBeenCalled();
      expect(executeMock).toHaveBeenCalledWith({
        operation: "get-channel-emotes",
        broadcasterId: "999",
      });
    });
  });

  describe("fetchEmoteSet", () => {
    it("fetches emote set by ID", async () => {
      twitchEmoteProvider.configure();
      mockJsonOnce({
        data: [makeTwitchEmote({ id: "set-emote", name: "SetEmote" })],
      });

      const result = await twitchEmoteProvider.fetchEmoteSet("set-123");

      expect(executeMock).toHaveBeenCalledWith({
        operation: "get-emote-set",
        emoteSetId: "set-123",
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("SetEmote");
    });
  });

  describe("fetchUserEmotes", () => {
    it("skips the scoped user-emotes request when tokenStatus lacks user:read:emotes", async () => {
      twitchEmoteProvider.configure();
      const tokenStatus = vi.fn(async () => ({
        connected: true,
        valid: true,
        platform: "twitch",
        scopes: ["chat:read", "chat:edit"],
      }));
      const getTwitchUser = vi.fn(async () => ({ id: "user-123" }));
      vi.stubGlobal("window", {
        electronAPI: {
          auth: {
            tokenStatus,
            getTwitchUser,
            getValidTwitchToken: vi.fn(async () => "fresh-token"),
          },
          twitch: { execute: executeMock },
        },
      });

      const result = await twitchEmoteProvider.fetchUserEmotes();

      expect(result).toEqual([]);
      expect(tokenStatus).toHaveBeenCalledWith("twitch");
      expect(getTwitchUser).not.toHaveBeenCalled();
      expect(executeMock).not.toHaveBeenCalled();
    });

    it("does not retry user emotes from a retained profile when restored auth is invalid", async () => {
      twitchEmoteProvider.configure();
      const tokenStatus = vi.fn(async () => ({
        connected: true,
        valid: false,
        platform: "twitch" as const,
        userId: "validated-user",
        scopes: ["user:read:emotes"],
      }));
      const getTwitchUser = vi.fn(async () => ({ id: "retained-profile-user" }));
      vi.stubGlobal("window", {
        electronAPI: {
          auth: { tokenStatus, getTwitchUser },
          twitch: { execute: executeMock },
        },
      });

      await expect(twitchEmoteProvider.fetchUserEmotes()).resolves.toEqual([]);
      await expect(twitchEmoteProvider.fetchUserEmotes()).resolves.toEqual([]);

      expect(tokenStatus).toHaveBeenCalledTimes(2);
      expect(getTwitchUser).not.toHaveBeenCalled();
      expect(executeMock).not.toHaveBeenCalled();
    });

    it("fetches signed-in user's non-global emotes across pages", async () => {
      twitchEmoteProvider.configure();
      vi.stubGlobal("window", {
        electronAPI: {
          auth: {
            tokenStatus: vi.fn(async () => ({
              platform: "twitch" as const,
              connected: true,
              valid: true,
              userId: "user-123",
              scopes: ["user:read:emotes"],
            })),
          },
          twitch: { execute: executeMock },
        },
      });
      mockJsonOnce({
        data: [
          makeTwitchEmote({ id: "global-1", name: "Kappa", emote_type: "globals" }),
          makeTwitchEmote({
            id: "sub-1",
            name: "StreamerSub",
            emote_type: "subscriptions",
            owner_id: "owner-1",
          }),
        ],
        pagination: { cursor: "next" },
      });
      mockJsonOnce({
        data: [
          makeTwitchEmote({
            id: "follow-1",
            name: "FollowerWave",
            emote_type: "follower",
            owner_id: "owner-2",
          }),
        ],
        pagination: {},
      });
      mockJsonOnce({
        data: [
          {
            id: "owner-1",
            login: "streamerone",
            display_name: "StreamerOne",
            profile_image_url: "https://example.test/streamerone/avatar.webp",
          },
          {
            id: "owner-2",
            login: "followchan",
            display_name: "FollowChan",
            profile_image_url: "https://example.test/followchan/avatar.webp",
          },
        ],
      });

      const result = await twitchEmoteProvider.fetchUserEmotes();

      expect(executeMock).toHaveBeenCalledTimes(3);
      expect(executeMock.mock.calls[0][0]).toEqual({
        operation: "get-user-emotes",
        userId: "user-123",
        after: undefined,
      });
      expect(executeMock.mock.calls[1][0]).toEqual({
        operation: "get-user-emotes",
        userId: "user-123",
        after: "next",
      });
      expect(executeMock.mock.calls[2][0]).toEqual({
        operation: "get-users",
        userIds: ["owner-1", "owner-2"],
      });
      expect(result.map((emote) => emote.name)).toEqual(["StreamerSub", "FollowerWave"]);
      expect(result.every((emote) => emote.availability === "user")).toBe(true);
      expect(result.map((emote) => emote.owner?.displayName)).toEqual([
        "StreamerOne",
        "FollowChan",
      ]);
      expect(result.map((emote) => emote.owner?.avatarUrl)).toEqual([
        "https://example.test/streamerone/avatar.webp",
        "https://example.test/followchan/avatar.webp",
      ]);
    });

    it("keeps user emotes from completed pages when a later page fails", async () => {
      twitchEmoteProvider.configure();
      vi.stubGlobal("window", {
        electronAPI: {
          auth: {
            tokenStatus: vi.fn(async () => ({
              platform: "twitch" as const,
              connected: true,
              valid: true,
              userId: "user-123",
              scopes: ["user:read:emotes"],
            })),
          },
          twitch: { execute: executeMock },
        },
      });
      mockJsonOnce({
        data: [
          makeTwitchEmote({
            id: "sub-1",
            name: "StreamerSub",
            emote_type: "subscriptions",
          }),
        ],
        pagination: { cursor: "next" },
      });
      mockRejectOnce(new Error("page two failed"));

      const result = await twitchEmoteProvider.fetchUserEmotes();

      expect(executeMock).toHaveBeenCalledTimes(2);
      expect(result.map((emote) => emote.name)).toEqual(["StreamerSub"]);
      expect(result[0].availability).toBe("user");
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
    function buildEmoteUrl(...args: [string, ("static" | "animated")?, ("light" | "dark")?, ("1.0" | "2.0" | "3.0")?]): string {
      const candidate = Reflect.get(twitchEmoteProvider.constructor, "buildEmoteUrl");
      if (typeof candidate !== "function") throw new Error("Twitch emote URL builder is unavailable");
      const result: unknown = Reflect.apply(candidate, twitchEmoteProvider.constructor, args);
      if (typeof result !== "string") throw new Error("Twitch emote URL builder returned a non-string value");
      return result;
    }

    it("builds URL with defaults", () => {
      const url = buildEmoteUrl("123");
      expect(url).toBe("https://static-cdn.jtvnw.net/emoticons/v2/123/default/dark/3.0");
    });

    it("builds URL with custom format and theme", () => {
      const url = buildEmoteUrl(
        "123",
        "animated",
        "light",
        "1.0"
      );
      expect(url).toBe("https://static-cdn.jtvnw.net/emoticons/v2/123/animated/light/1.0");
    });
  });
});
