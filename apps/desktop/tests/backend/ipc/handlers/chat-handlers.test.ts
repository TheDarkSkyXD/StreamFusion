import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { ipcMain } from "electron";

import { kickClient } from "@/backend/api/platforms/kick/kick-client";
import { registerChatHandlers } from "@/backend/ipc/handlers/chat-handlers";

type Handler = (event: unknown, params: unknown) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  registerChatHandlers();
});

describe("registerChatHandlers", () => {
  it("registers chat history and mention enrichment channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.CHAT_GET_KICK_HISTORY);
    expect(channels).toContain(IPC_CHANNELS.CHAT_GET_TWITCH_HISTORY);
    expect(channels).toContain(IPC_CHANNELS.CHAT_ENRICH_MENTION_USERS);
  });
});

describe("CHAT_GET_KICK_HISTORY", () => {
  it("returns { success: true, data } on success", async () => {
    const { getKickChannelHistory } = await import(
      "@/backend/api/platforms/kick/endpoints/chat-endpoints"
    );
    const messages = [{ id: "1", content: "hello" }];
    vi.mocked(getKickChannelHistory).mockResolvedValue(messages as any);

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
    const rawIrc = ["@badges= :tmi.twitch.tv PRIVMSG #test :hi"];
    vi.mocked(getTwitchChannelHistory).mockResolvedValue(rawIrc as any);

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
    const result = (await handler(
      {},
      {
        platform: "kick",
        channel: "iceposeidon",
        users: [{ userId: "4357508", username: "ACTIONJACKSONALWAYSWINS" }],
      }
    )) as any;

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
    const result = (await handler(
      {},
      {
        platform: "kick",
        channel: "iceposeidon",
        users: [{ username: "NoCustomAvatarUser" }],
      }
    )) as any;

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
