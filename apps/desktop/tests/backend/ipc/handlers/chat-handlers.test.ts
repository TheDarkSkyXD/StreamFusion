import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/api/platforms/kick/endpoints/chat-endpoints", () => ({
  getKickChannelHistory: vi.fn(),
}));

vi.mock("@/backend/api/platforms/twitch/endpoints/chat-endpoints", () => ({
  getTwitchChannelHistory: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/kick-client", () => ({
  kickClient: {
    getUsersById: vi.fn(),
    getPublicChannelUserProfile: vi.fn(),
    getPublicChannel: vi.fn(),
  },
}));

vi.mock("@/backend/api/platforms/twitch/twitch-client", () => ({
  twitchClient: {
    getUsersByLogin: vi.fn(),
    getChannelByLogin: vi.fn(),
  },
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock("@/backend/services/storage-service", () => ({
  storageService: {
    getToken: vi.fn(() => null),
    getAppToken: vi.fn(() => null),
    isTokenExpired: vi.fn(() => true),
    isAppTokenExpired: vi.fn(() => true),
  },
}));

import { ipcMain } from "electron";

import { kickClient } from "@/backend/api/platforms/kick/kick-client";
import { registerChatHandlers } from "@/backend/ipc/handlers/chat-handlers";
import { badgeResolver } from "@/backend/services/chat/badge-resolver";

type MentionResult = { success: boolean; data: Array<{ userId: string; username: string; displayName: string; avatarUrl: string }>; error?: string };
type Handler<T = unknown> = (event: unknown, params: unknown) => Promise<T>;

function getHandler(channel: typeof IPC_CHANNELS.CHAT_ENRICH_MENTION_USERS): Handler<MentionResult>;
function getHandler(channel: string): Handler;
function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return (event, params) => Promise.resolve(Reflect.apply(call[1], undefined, [event, params]));
}

beforeEach(() => {
  vi.clearAllMocks();
  badgeResolver.clearCache();
  registerChatHandlers();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("registerChatHandlers", () => {
  it("registers chat history and mention enrichment channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.CHAT_GET_KICK_HISTORY);
    expect(channels).toContain(IPC_CHANNELS.CHAT_GET_TWITCH_HISTORY);
    expect(channels).toContain(IPC_CHANNELS.CHAT_GET_TWITCH_BADGE_CATALOG);
    expect(channels).toContain(IPC_CHANNELS.CHAT_GET_TWITCH_PINNED_MESSAGE);
    expect(channels).toContain(IPC_CHANNELS.CHAT_ENRICH_MENTION_USERS);
  });
});

// Guards: Anonymous Twitch badge retrieval runs in Electron main and follows Xtra's GQL source order before any authenticated Helix fallback.
// Guards: Badge catalog readiness is explicit, so an empty valid channel catalog cannot hide a failed global catalog.
describe("CHAT_GET_TWITCH_BADGE_CATALOG", () => {
  it("returns global and channel badges from GQL without auth credentials", async () => {
    const operations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { operationName: string };
        operations.push(body.operationName);
        if (body.operationName === "Badges") {
          return {
            ok: true,
            json: async () => ({
              data: {
                badges: [
                  {
                    setID: "moderator",
                    version: "1",
                    imageURL:
                      "https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/3",
                    title: "Moderator",
                  },
                ],
              },
            }),
          };
        }
        if (body.operationName === "UserBadges") {
          return {
            ok: true,
            json: async () => ({ data: { user: { broadcastBadges: [] } } }),
          };
        }
        if (body.operationName === "ChatList_Badges") {
          return {
            ok: true,
            json: async () => ({
              data: {
                badges: [
                  {
                    setID: "subscriber",
                    version: "0",
                    image1x:
                      "https://static-cdn.jtvnw.net/badges/v1/0c79afdf-10a9-4d28-9316-73a786af2578/1",
                    image2x:
                      "https://static-cdn.jtvnw.net/badges/v1/0c79afdf-10a9-4d28-9316-73a786af2578/2",
                    image4x:
                      "https://static-cdn.jtvnw.net/badges/v1/0c79afdf-10a9-4d28-9316-73a786af2578/3",
                    title: "Subscriber",
                  },
                ],
              },
            }),
          };
        }
        throw new Error(`Unexpected operation ${body.operationName}`);
      })
    );

    const handler = getHandler(IPC_CHANNELS.CHAT_GET_TWITCH_BADGE_CATALOG);
    const result = await handler(
      {},
      { broadcasterId: "111", channelLogin: "ninja", forceRefresh: true }
    );

    expect(operations).toEqual(["Badges", "UserBadges", "ChatList_Badges"]);
    expect(result).toEqual({
      success: true,
      data: {
        global: {
          source: "gql",
          badges: [
            {
              setId: "moderator",
              version: "1",
              imageUrl:
                "https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/3",
              title: "Moderator",
            },
          ],
        },
        channel: {
          source: "persisted-gql",
          badges: [
            {
              setId: "subscriber",
              version: "0",
              imageUrl:
                "https://static-cdn.jtvnw.net/badges/v1/0c79afdf-10a9-4d28-9316-73a786af2578/3",
              title: "Subscriber",
            },
          ],
        },
      },
    });
    expect(vi.mocked(fetch).mock.calls.every(([url]) => url === "https://gql.twitch.tv/gql")).toBe(
      true
    );
  });

  it.each([
    undefined,
    {},
    { broadcasterId: "channel-id", channelLogin: "ninja" },
    { broadcasterId: "111", channelLogin: "bad-login!" },
  ])("rejects malformed catalog requests without making a network call", async (params) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const handler = getHandler(IPC_CHANNELS.CHAT_GET_TWITCH_BADGE_CATALOG);

    await expect(handler({}, params)).resolves.toEqual({
      success: false,
      error: "Invalid Twitch badge catalog request",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("CHAT_GET_KICK_HISTORY", () => {
  it("returns { success: true, data } on success", async () => {
    const { getKickChannelHistory } = await import(
      "@/backend/api/platforms/kick/endpoints/chat-endpoints"
    );
    const messages = { messages: [], pinnedMessage: null };
    vi.mocked(getKickChannelHistory).mockResolvedValue(messages);

    const handler = getHandler(IPC_CHANNELS.CHAT_GET_KICK_HISTORY);
    const result = await handler({}, { channelId: "12345" });

    expect(result).toEqual({ success: true, data: messages });
  });

  it("returns { success: false, error } on thrown error", async () => {
    const { getKickChannelHistory } = await import(
      "@/backend/api/platforms/kick/endpoints/chat-endpoints"
    );
    vi.mocked(getKickChannelHistory).mockRejectedValue(new Error("network fail"));

    const handler = getHandler(IPC_CHANNELS.CHAT_GET_KICK_HISTORY);
    const result = await handler({}, { channelId: "12345" });

    expect(result).toEqual({ success: false, error: "network fail" });
  });
});

describe("CHAT_GET_TWITCH_HISTORY", () => {
  it("returns { success: true, data } on success", async () => {
    const { getTwitchChannelHistory } = await import(
      "@/backend/api/platforms/twitch/endpoints/chat-endpoints"
    );
    const rawIrc = { rawMessages: ["@badges= :tmi.twitch.tv PRIVMSG #test :hi"] };
    vi.mocked(getTwitchChannelHistory).mockResolvedValue(rawIrc);

    const handler = getHandler(IPC_CHANNELS.CHAT_GET_TWITCH_HISTORY);
    const result = await handler({}, { channel: "testchannel" });

    expect(result).toEqual({ success: true, data: rawIrc });
  });

  it("returns { success: false, error } on thrown error", async () => {
    const { getTwitchChannelHistory } = await import(
      "@/backend/api/platforms/twitch/endpoints/chat-endpoints"
    );
    vi.mocked(getTwitchChannelHistory).mockRejectedValue(new Error("timeout"));

    const handler = getHandler(IPC_CHANNELS.CHAT_GET_TWITCH_HISTORY);
    const result = await handler({}, { channel: "testchannel" });

    expect(result).toEqual({ success: false, error: "timeout" });
  });
});

// Guards: Twitch pin polling must go through main-process IPC so renderer DevTools does not log Chromium net::ERR_* fetch failures on every poll when DNS/Twitch is unavailable.
describe("CHAT_GET_TWITCH_PINNED_MESSAGE", () => {
  it("returns the active pin node on success", async () => {
    const pin = { id: "pin-1", pinnedMessage: { id: "msg-1" } };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            channel: {
              pinnedChatMessages: {
                edges: [{ node: pin }],
              },
            },
          },
        }),
      })
    );

    const handler = getHandler(IPC_CHANNELS.CHAT_GET_TWITCH_PINNED_MESSAGE);
    const result = await handler({}, { channel: "FitzBro" });

    expect(result).toEqual({ success: true, data: pin });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://gql.twitch.tv/gql");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).variables).toEqual({
      login: "fitzbro",
    });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.query).toContain("startsAt");
    expect(body.query).toContain("endsAt");
  });

  it("returns { success: false, error } on DNS or network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("ERR_NAME_NOT_RESOLVED")));

    const handler = getHandler(IPC_CHANNELS.CHAT_GET_TWITCH_PINNED_MESSAGE);
    const result = await handler({}, { channel: "fitzbro" });

    expect(result).toEqual({ success: false, error: "ERR_NAME_NOT_RESOLVED" });
  });
});

// Guards: Kick mention enrichment must return an avatar URL for known chatters even when Kick's profile endpoint has profile_pic:null, so the @ popup never falls back to bare initials for existing users.
describe("CHAT_ENRICH_MENTION_USERS", () => {
  it("returns a Kick default avatar when a channel user profile has no custom image", async () => {
    vi.mocked(kickClient.getUsersById).mockResolvedValue([]);
    vi.mocked(kickClient.getPublicChannelUserProfile).mockResolvedValue({
      userId: "4357508",
      username: "actionjacksonalwayswins",
      displayName: "ACTIONJACKSONALWAYSWINS",
      avatarUrl: "",
    });
    vi.mocked(kickClient.getPublicChannel).mockResolvedValue(null);

    const handler = getHandler(IPC_CHANNELS.CHAT_ENRICH_MENTION_USERS);
    const result = await handler(
      {},
      {
        platform: "kick",
        channel: "iceposeidon",
        users: [{ userId: "4357508", username: "ACTIONJACKSONALWAYSWINS" }],
      }
    );

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      userId: "4357508",
      username: "ACTIONJACKSONALWAYSWINS",
      displayName: "ACTIONJACKSONALWAYSWINS",
    });
    expect(result.data[0].avatarUrl).toMatch(/^data:image\/svg\+xml,/);
  });

  it("returns fallback avatars for remaining known Kick chatters after all lookups miss", async () => {
    vi.mocked(kickClient.getUsersById).mockResolvedValue([]);
    vi.mocked(kickClient.getPublicChannelUserProfile).mockResolvedValue(null);
    vi.mocked(kickClient.getPublicChannel).mockResolvedValue(null);

    const handler = getHandler(IPC_CHANNELS.CHAT_ENRICH_MENTION_USERS);
    const result = await handler(
      {},
      {
        platform: "kick",
        channel: "iceposeidon",
        users: [{ username: "NoCustomAvatarUser" }],
      }
    );

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      userId: "NoCustomAvatarUser",
      username: "NoCustomAvatarUser",
      displayName: "NoCustomAvatarUser",
    });
    expect(result.data[0].avatarUrl).toMatch(/^data:image\/svg\+xml,/);
  });
});
