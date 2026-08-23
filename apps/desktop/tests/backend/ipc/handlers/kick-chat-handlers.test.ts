import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/api/platforms/kick/kick-send-window", () => ({
  banKickChatUser: vi.fn(),
  ensureSendWindowReady: vi.fn(),
  getKickChannelViewerRole: vi.fn(),
  sendKickChatMessage: vi.fn(),
  timeoutKickChatUser: vi.fn(),
  unbanKickChatUser: vi.fn(),
  deleteKickChatMessage: vi.fn(),
  disposeSendWindow: vi.fn(),
}));

import { ipcMain } from "electron";

import {
  banKickChatUser,
  deleteKickChatMessage,
  disposeSendWindow,
  ensureSendWindowReady,
  getKickChannelViewerRole,
  sendKickChatMessage,
  timeoutKickChatUser,
  unbanKickChatUser,
} from "@/backend/api/platforms/kick/kick-send-window";
import type { KickChannelViewerRoleResult, KickSendResult, KickWebApiMutationResult } from "@/backend/api/platforms/kick/kick-send-window";
import { registerKickChatHandlers } from "@/backend/ipc/handlers/kick-chat-handlers";

type Handler = (event: unknown, payload?: unknown) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return (event, payload) => Promise.resolve(Reflect.apply(call[1], undefined, [event, payload]));
}

beforeEach(() => {
  vi.clearAllMocks();
  registerKickChatHandlers();
});

describe("registerKickChatHandlers", () => {
  it("registers Kick chat IPC channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.KICK_CHAT_ENSURE_SEND_WINDOW_READY);
    expect(channels).toContain(IPC_CHANNELS.KICK_CHAT_SEND_MESSAGE);
    expect(channels).toContain(IPC_CHANNELS.KICK_CHAT_BAN_USER);
    expect(channels).toContain(IPC_CHANNELS.KICK_CHAT_TIMEOUT_USER);
    expect(channels).toContain(IPC_CHANNELS.KICK_CHAT_UNBAN_USER);
    expect(channels).toContain(IPC_CHANNELS.KICK_CHAT_DELETE_MESSAGE);
    expect(channels).toContain(IPC_CHANNELS.KICK_CHAT_GET_VIEWER_ROLE);
    expect(channels).toContain(IPC_CHANNELS.KICK_CHAT_DISPOSE_SEND_WINDOW);
  });
});

describe("KICK_CHAT_ENSURE_SEND_WINDOW_READY", () => {
  it("delegates to ensureSendWindowReady", async () => {
    vi.mocked(ensureSendWindowReady).mockResolvedValue(undefined);

    const handler = getHandler(IPC_CHANNELS.KICK_CHAT_ENSURE_SEND_WINDOW_READY);
    await handler({});

    expect(ensureSendWindowReady).toHaveBeenCalledTimes(1);
  });
});

describe("KICK_CHAT_SEND_MESSAGE", () => {
  it("passes chatroom id and content directly to the hidden-window sender", async () => {
    const expected = { ok: true, messageId: undefined } satisfies KickSendResult;
    vi.mocked(sendKickChatMessage).mockResolvedValue(expected);

    const handler = getHandler(IPC_CHANNELS.KICK_CHAT_SEND_MESSAGE);
    const payload = { chatroomId: 42, content: "hello", channelSlug: "xqc" };
    const result = await handler(
      { senderFrame: { url: "http://localhost:5173/#/stream/kick/xqc" } },
      payload
    );

    expect(sendKickChatMessage).toHaveBeenCalledWith(42, "hello", "xqc");
    expect(result).toBe(expected);
  });

  it("rejects unexpected renderer origins before sending", async () => {
    const handler = getHandler(IPC_CHANNELS.KICK_CHAT_SEND_MESSAGE);

    await expect(
      handler(
        { senderFrame: { url: "https://untrusted.example/" } },
        { chatroomId: 42, content: "hello" }
      )
    ).resolves.toMatchObject({ ok: false, kind: "unknown" });

    expect(sendKickChatMessage).not.toHaveBeenCalled();
  });
});

describe("KICK_CHAT_BAN_USER", () => {
  it("passes channelSlug and username to banKickChatUser", async () => {
    const expected = { ok: true, status: 200, body: "{}" } satisfies KickWebApiMutationResult;
    vi.mocked(banKickChatUser).mockResolvedValue(expected);

    const handler = getHandler(IPC_CHANNELS.KICK_CHAT_BAN_USER);
    const result = await handler(
      { senderFrame: { url: "http://localhost:5173/#/stream/kick/xqc" } },
      { channelSlug: "xqc", username: "baduser" }
    );

    expect(banKickChatUser).toHaveBeenCalledWith("xqc", "baduser");
    expect(result).toBe(expected);
  });
});

describe("KICK_CHAT_TIMEOUT_USER", () => {
  it("passes channelSlug, username, and duration to timeoutKickChatUser", async () => {
    const expected = { ok: true, status: 200, body: "{}" } satisfies KickWebApiMutationResult;
    vi.mocked(timeoutKickChatUser).mockResolvedValue(expected);

    const handler = getHandler(IPC_CHANNELS.KICK_CHAT_TIMEOUT_USER);
    const result = await handler(
      { senderFrame: { url: "http://localhost:5173/#/stream/kick/xqc" } },
      { channelSlug: "xqc", username: "baduser", duration: 10 }
    );

    expect(timeoutKickChatUser).toHaveBeenCalledWith("xqc", "baduser", 10);
    expect(result).toBe(expected);
  });
});

describe("KICK_CHAT_UNBAN_USER", () => {
  it("passes channelSlug and username to unbanKickChatUser", async () => {
    const expected = { ok: true, status: 200, body: "{}" } satisfies KickWebApiMutationResult;
    vi.mocked(unbanKickChatUser).mockResolvedValue(expected);

    const handler = getHandler(IPC_CHANNELS.KICK_CHAT_UNBAN_USER);
    const result = await handler(
      { senderFrame: { url: "http://localhost:5173/#/stream/kick/xqc" } },
      { channelSlug: "xqc", username: "baduser" }
    );

    expect(unbanKickChatUser).toHaveBeenCalledWith("xqc", "baduser");
    expect(result).toBe(expected);
  });
});

describe("KICK_CHAT_DELETE_MESSAGE", () => {
  it("passes chatroomId and messageId to deleteKickChatMessage", async () => {
    const expected = { ok: true, status: 204, body: "" } satisfies KickWebApiMutationResult;
    vi.mocked(deleteKickChatMessage).mockResolvedValue(expected);

    const handler = getHandler(IPC_CHANNELS.KICK_CHAT_DELETE_MESSAGE);
    const result = await handler(
      { senderFrame: { url: "http://localhost:5173/#/stream/kick/xqc" } },
      { chatroomId: 42, messageId: "msg-1" }
    );

    expect(deleteKickChatMessage).toHaveBeenCalledWith(42, "msg-1");
    expect(result).toBe(expected);
  });
});

describe("KICK_CHAT_GET_VIEWER_ROLE", () => {
  it("passes channelSlug to getKickChannelViewerRole", async () => {
    const expected = { ok: true, isModerator: true, status: 200 } satisfies KickChannelViewerRoleResult;
    vi.mocked(getKickChannelViewerRole).mockResolvedValue(expected);

    const handler = getHandler(IPC_CHANNELS.KICK_CHAT_GET_VIEWER_ROLE);
    const result = await handler(
      { senderFrame: { url: "http://localhost:5173/#/stream/kick/xqc" } },
      { channelSlug: "xqc" }
    );

    expect(getKickChannelViewerRole).toHaveBeenCalledWith("xqc");
    expect(result).toBe(expected);
  });
});

describe("KICK_CHAT_DISPOSE_SEND_WINDOW", () => {
  it("delegates to disposeSendWindow", async () => {
    vi.mocked(disposeSendWindow).mockResolvedValue(undefined);

    const handler = getHandler(IPC_CHANNELS.KICK_CHAT_DISPOSE_SEND_WINDOW);
    await handler({});

    expect(disposeSendWindow).toHaveBeenCalledTimes(1);
  });
});
