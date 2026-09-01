import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock("electron", () => ({
  ipcMain: { handle: electronMocks.handle },
}));

import { ipcMain } from "electron";

import { registerTwitchApiHandlers } from "@backend/ipc/handlers/twitch-api-handlers";
import type { MainRendererPort } from "@backend/ipc/main-renderer-port";
import { IPC_CHANNELS } from "@shared/ipc-channels";

type Handler = (
  event: { sender?: { id: number }; senderFrame?: { url?: string } },
  payload: unknown
) => Promise<unknown>;

function handlerFor(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const match = calls.find(([registered]) => registered === channel);
  if (!match) throw new Error(`Missing handler for ${channel}`);
  return match[1];
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Guards: renderer Twitch reads cross only an allowlisted capability boundary without credentials.
// Guards: opaque user-emote cursors get provider-sized headroom without widening unrelated Twitch inputs.
// Guards: block-list mutations accept only bounded target IDs and reject renderer credential injection.
describe("Twitch API IPC handlers", () => {
  it("maps a channel lookup capability to the main-owned Twitch service", async () => {
    const service = {
      execute: vi.fn().mockResolvedValue({
        ok: true,
        data: { id: "42", login: "streamer", displayName: "Streamer" },
      }),
      startEventSubFeed: vi.fn(),
      stopEventSubFeed: vi.fn(),
    };
    registerTwitchApiHandlers({ service });

    const payload = { operation: "resolve-channel", login: "Streamer" };
    const result = await handlerFor(IPC_CHANNELS.TWITCH_API_EXECUTE)(
      { senderFrame: { url: "http://localhost:5173/" } },
      payload
    );

    expect(service.execute).toHaveBeenCalledWith(payload);
    expect(result).toEqual({
      ok: true,
      data: { id: "42", login: "streamer", displayName: "Streamer" },
    });
    expect(JSON.stringify(result)).not.toMatch(/token|client.?id/i);
  });

  it("rejects untrusted senders and payloads outside the capability allowlist", async () => {
    const service = {
      execute: vi.fn(),
      startEventSubFeed: vi.fn(),
      stopEventSubFeed: vi.fn(),
    };
    registerTwitchApiHandlers({ service });
    const invoke = handlerFor(IPC_CHANNELS.TWITCH_API_EXECUTE);

    await expect(
      invoke(
        { senderFrame: { url: "https://attacker.example/" } },
        { operation: "resolve-channel", login: "streamer" }
      )
    ).resolves.toMatchObject({ ok: false, error: { code: "unauthorized" } });
    await expect(
      invoke(
        { senderFrame: { url: "file:///app/index.html" } },
        { operation: "request-url", url: "https://attacker.example/", accessToken: "secret" }
      )
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(service.execute).not.toHaveBeenCalled();
  });

  it("accepts the credential-free moderated-channels capability", async () => {
    const service = {
      execute: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      startEventSubFeed: vi.fn(),
      stopEventSubFeed: vi.fn(),
    };
    registerTwitchApiHandlers({ service });
    const payload = { operation: "get-moderated-channels", userId: "200" };

    await handlerFor(IPC_CHANNELS.TWITCH_API_EXECUTE)(
      { senderFrame: { url: "file:///app/index.html" } },
      payload
    );

    expect(service.execute).toHaveBeenCalledWith(payload);
  });

  it("accepts the credential-free chat-settings capability", async () => {
    const service = {
      execute: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      startEventSubFeed: vi.fn(),
      stopEventSubFeed: vi.fn(),
    };
    registerTwitchApiHandlers({ service });
    const payload = { operation: "get-chat-settings", broadcasterId: "100" };

    await handlerFor(IPC_CHANNELS.TWITCH_API_EXECUTE)(
      { senderFrame: { url: "file:///app/index.html" } },
      payload
    );

    expect(service.execute).toHaveBeenCalledWith(payload);
  });

  it("bounds opaque user-emote cursors without widening other pagination inputs", async () => {
    const service = {
      execute: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      startEventSubFeed: vi.fn(),
      stopEventSubFeed: vi.fn(),
    };
    registerTwitchApiHandlers({ service });
    const invoke = handlerFor(IPC_CHANNELS.TWITCH_API_EXECUTE);
    const event = { senderFrame: { url: "file:///app/index.html" } };
    const acceptedCursor = "c".repeat(8 * 1024);

    await expect(
      invoke(event, {
        operation: "get-user-emotes",
        userId: "200",
        after: acceptedCursor,
      })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      invoke(event, {
        operation: "get-user-emotes",
        userId: "200",
        after: `${acceptedCursor}x`,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } });
    await expect(
      invoke(event, {
        operation: "get-unban-requests",
        broadcasterId: "100",
        moderatorId: "200",
        status: "pending",
        after: "c".repeat(513),
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } });

    expect(service.execute).toHaveBeenCalledTimes(1);
    expect(service.execute).toHaveBeenCalledWith({
      operation: "get-user-emotes",
      userId: "200",
      after: acceptedCursor,
    });
  });

  it("accepts only structured moderation dashboard read capabilities", async () => {
    const service = {
      execute: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      startEventSubFeed: vi.fn(),
      stopEventSubFeed: vi.fn(),
    };
    registerTwitchApiHandlers({ service });
    const payload = {
      operation: "get-unban-requests",
      broadcasterId: "100",
      moderatorId: "200",
      status: "pending",
    };

    await handlerFor(IPC_CHANNELS.TWITCH_API_EXECUTE)(
      { senderFrame: { url: "file:///app/index.html" } },
      payload
    );

    expect(service.execute).toHaveBeenCalledWith(payload);
  });

  it("accepts a credential-free moderation mutation and rejects credential injection", async () => {
    const service = {
      execute: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      startEventSubFeed: vi.fn(),
      stopEventSubFeed: vi.fn(),
    };
    registerTwitchApiHandlers({ service });
    const invoke = handlerFor(IPC_CHANNELS.TWITCH_API_EXECUTE);
    const payload = {
      operation: "delete-chat-message",
      broadcasterId: "100",
      moderatorId: "200",
      messageId: "message-1",
    };

    await invoke({ senderFrame: { url: "file:///app/index.html" } }, payload);
    await invoke(
      { senderFrame: { url: "file:///app/index.html" } },
      { ...payload, accessToken: "secret" }
    );

    expect(service.execute).toHaveBeenCalledTimes(1);
    expect(service.execute).toHaveBeenCalledWith(payload);
  });

  it("accepts a structured channel-membership mutation", async () => {
    const service = {
      execute: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      startEventSubFeed: vi.fn(),
      stopEventSubFeed: vi.fn(),
    };
    registerTwitchApiHandlers({ service });
    const payload = { operation: "add-vip", broadcasterId: "100", userId: "300" };

    await handlerFor(IPC_CHANNELS.TWITCH_API_EXECUTE)(
      { senderFrame: { url: "file:///app/index.html" } },
      payload
    );

    expect(service.execute).toHaveBeenCalledWith(payload);
  });

  it("accepts credential-free block-list mutations and rejects credential injection", async () => {
    const service = {
      execute: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      startEventSubFeed: vi.fn(),
      stopEventSubFeed: vi.fn(),
    };
    registerTwitchApiHandlers({ service });
    const invoke = handlerFor(IPC_CHANNELS.TWITCH_API_EXECUTE);
    const payload = { operation: "block-user", targetUserId: "300" };

    await invoke({ senderFrame: { url: "file:///app/index.html" } }, payload);
    await invoke(
      { senderFrame: { url: "file:///app/index.html" } },
      { ...payload, accessToken: "secret" }
    );

    expect(service.execute).toHaveBeenCalledTimes(1);
    expect(service.execute).toHaveBeenCalledWith(payload);
  });

  it("accepts a structured unban-request resolution", async () => {
    const service = {
      execute: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      startEventSubFeed: vi.fn(),
      stopEventSubFeed: vi.fn(),
    };
    registerTwitchApiHandlers({ service });
    const payload = {
      operation: "resolve-unban-request",
      broadcasterId: "100",
      moderatorId: "200",
      unbanRequestId: "request-1",
      status: "approved",
    };

    await handlerFor(IPC_CHANNELS.TWITCH_API_EXECUTE)(
      { senderFrame: { url: "file:///app/index.html" } },
      payload
    );

    expect(service.execute).toHaveBeenCalledWith(payload);
  });

  it("validates poll and prediction mutations without accepting credentials", async () => {
    const service = {
      execute: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      startEventSubFeed: vi.fn(),
      stopEventSubFeed: vi.fn(),
    };
    registerTwitchApiHandlers({ service });
    const invoke = handlerFor(IPC_CHANNELS.TWITCH_API_EXECUTE);
    const payload = {
      operation: "create-prediction",
      broadcasterId: "100",
      title: "Outcome?",
      outcomes: ["Yes", "No"],
      predictionWindow: 120,
    };

    await invoke({ senderFrame: { url: "file:///app/index.html" } }, payload);
    await invoke(
      { senderFrame: { url: "file:///app/index.html" } },
      { ...payload, clientId: "renderer-secret" }
    );

    expect(service.execute).toHaveBeenCalledTimes(1);
    expect(service.execute).toHaveBeenCalledWith(payload);
  });

  it("starts and stops a main-owned EventSub feed and forwards events without credentials", async () => {
    let emitEvent: ((payload: unknown) => void) | undefined;
    const eventSub = {
      start: vi.fn(async (options) => {
        emitEvent = options.onEvent;
        return { ok: true as const, data: undefined };
      }),
      stop: vi.fn(),
    };
    const send = vi.fn();
    registerTwitchApiHandlers({
      service: { execute: vi.fn() },
      eventSub,
      renderer: {
        sendToOwner: (_ownerId: number, channel: string, payload: unknown) => {
          send(channel, payload);
          return true;
        },
      } as unknown as MainRendererPort,
    });
    const payload = { feedId: "feed-1", userId: "200", channelId: "100" };

    await handlerFor(IPC_CHANNELS.TWITCH_EVENTSUB_START)(
      { sender: { id: 1 }, senderFrame: { url: "file:///app/index.html" } },
      payload
    );
    emitEvent?.({ event: { action: "delete" } });
    await handlerFor(IPC_CHANNELS.TWITCH_EVENTSUB_STOP)(
      { senderFrame: { url: "file:///app/index.html" } },
      { feedId: "feed-1" }
    );

    expect(eventSub.start).toHaveBeenCalledWith(expect.objectContaining(payload));
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.TWITCH_EVENTSUB_EVENT, {
      feedId: "feed-1",
      payload: { event: { action: "delete" } },
    });
    expect(eventSub.stop).toHaveBeenCalledWith("feed-1");
    expect(JSON.stringify(eventSub.start.mock.calls)).not.toMatch(/access.?token|client.?id/i);
  });
});
