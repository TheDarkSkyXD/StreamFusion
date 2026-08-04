import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChatReplayIpcHandlers,
  registerChatReplayHandlers,
} from "@/backend/ipc/handlers/chat-replay-handlers";
import { IPC_CHANNELS } from "@/shared/ipc-channels";

const electronMocks = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock("electron", () => ({ ipcMain: { handle: electronMocks.handle } }));

// Guards: the production preload replay methods reach named main-process load and cancel handlers.
describe("Chat Replay IPC handlers", () => {
  beforeEach(() => {
    electronMocks.handle.mockReset();
  });

  it("registers the replay load and cancellation channels", () => {
    registerChatReplayHandlers({ loadWindow: vi.fn() });

    expect(electronMocks.handle).toHaveBeenNthCalledWith(
      1,
      IPC_CHANNELS.VIDEOS_GET_CHAT_REPLAY_WINDOW,
      expect.any(Function)
    );
    expect(electronMocks.handle).toHaveBeenNthCalledWith(
      2,
      IPC_CHANNELS.VIDEOS_CANCEL_CHAT_REPLAY_WINDOW,
      expect.any(Function)
    );
  });

  it.each([
    null,
    {},
    { platform: "youtube", videoId: "video-1", offsetSeconds: 0, requestId: "request-1" },
    { platform: "twitch", videoId: "", offsetSeconds: 0, requestId: "request-1" },
    { platform: "twitch", videoId: "video-1", offsetSeconds: -1, requestId: "request-1" },
    { platform: "twitch", videoId: "video-1", offsetSeconds: 0, requestId: "" },
  ])("rejects malformed replay payloads without entering the service: %j", async (payload) => {
    const loadWindow = vi.fn();
    const handlers = createChatReplayIpcHandlers({ loadWindow });

    await expect(handlers.getWindow(payload)).resolves.toEqual({
      success: false,
      error: "Invalid Chat Replay request",
    });
    expect(loadWindow).not.toHaveBeenCalled();
  });

  it("aborts an in-flight main-process replay request", async () => {
    let observedSignal: AbortSignal | undefined;
    const loadWindow = vi.fn((_request, signal?: AbortSignal) => {
      observedSignal = signal;
      return new Promise<never>(() => undefined);
    });
    const handlers = createChatReplayIpcHandlers({ loadWindow });
    void handlers.getWindow({
      platform: "twitch",
      videoId: "video-1",
      offsetSeconds: 0,
      requestId: "request-1",
    });

    expect(handlers.cancelWindow({ requestId: "request-1" })).toEqual({ cancelled: true });
    expect(observedSignal?.aborted).toBe(true);
  });
});
