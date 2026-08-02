import { describe, expect, it, vi } from "vitest";
import { createChatReplayIpcHandlers } from "@/backend/ipc/handlers/chat-replay-handlers";

describe("Chat Replay IPC handlers", () => {
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
