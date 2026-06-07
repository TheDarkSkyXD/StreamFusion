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

vi.mock("@/backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ipcMain } from "electron";

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
  it("registers both chat history channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.CHAT_GET_KICK_HISTORY);
    expect(channels).toContain(IPC_CHANNELS.CHAT_GET_TWITCH_HISTORY);
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
