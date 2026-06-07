import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/api/platforms/kick/kick-send-window", () => ({
  ensureSendWindowReady: vi.fn(),
  sendKickChatMessage: vi.fn(),
  disposeSendWindow: vi.fn(),
}));

import { ipcMain } from "electron";

import {
  disposeSendWindow,
  ensureSendWindowReady,
  sendKickChatMessage,
} from "@/backend/api/platforms/kick/kick-send-window";
import { registerKickChatHandlers } from "@/backend/ipc/handlers/kick-chat-handlers";

type Handler = (event: unknown, payload?: unknown) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  registerKickChatHandlers();
});

describe("registerKickChatHandlers", () => {
  it("registers all three IPC channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.KICK_CHAT_ENSURE_SEND_WINDOW_READY);
    expect(channels).toContain(IPC_CHANNELS.KICK_CHAT_SEND_MESSAGE);
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
  it("passes chatroomId and content to sendKickChatMessage", async () => {
    const expected = { ok: true, status: 200 };
    vi.mocked(sendKickChatMessage).mockResolvedValue(expected as any);

    const handler = getHandler(IPC_CHANNELS.KICK_CHAT_SEND_MESSAGE);
    const result = await handler({}, { chatroomId: 42, content: "hello" });

    expect(sendKickChatMessage).toHaveBeenCalledWith(42, "hello");
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
