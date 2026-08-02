import type {
  CancelChatReplayWindowRequest,
  ChatReplayIpcWindowRequest,
  ChatReplayWindowRequest,
  ChatReplayWindowResult,
} from "../../../shared/chat-replay-types";

interface ChatReplayService {
  loadWindow(
    request: ChatReplayWindowRequest,
    signal?: AbortSignal
  ): Promise<ChatReplayWindowResult>;
}

function isWindowRequest(value: unknown): value is ChatReplayIpcWindowRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    (request.platform === "twitch" || request.platform === "kick") &&
    typeof request.videoId === "string" &&
    request.videoId.length > 0 &&
    typeof request.offsetSeconds === "number" &&
    Number.isFinite(request.offsetSeconds) &&
    request.offsetSeconds >= 0 &&
    typeof request.requestId === "string" &&
    request.requestId.length > 0 &&
    request.requestId.length <= 128
  );
}

function isCancelRequest(value: unknown): value is CancelChatReplayWindowRequest {
  if (!value || typeof value !== "object") return false;
  const requestId = (value as Record<string, unknown>).requestId;
  return typeof requestId === "string" && requestId.length > 0 && requestId.length <= 128;
}

export function createChatReplayIpcHandlers(service: ChatReplayService) {
  const controllers = new Map<string, AbortController>();

  return {
    async getWindow(params: unknown) {
      if (!isWindowRequest(params)) {
        return { success: false as const, error: "Invalid Chat Replay request" };
      }

      const controller = new AbortController();
      controllers.get(params.requestId)?.abort();
      controllers.set(params.requestId, controller);
      try {
        return {
          success: true as const,
          data: await service.loadWindow(params, controller.signal),
        };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Failed to load Chat Replay",
        };
      } finally {
        if (controllers.get(params.requestId) === controller) controllers.delete(params.requestId);
      }
    },

    cancelWindow(params: unknown) {
      if (!isCancelRequest(params)) return { cancelled: false };
      const controller = controllers.get(params.requestId);
      if (!controller) return { cancelled: false };
      controller.abort();
      controllers.delete(params.requestId);
      return { cancelled: true };
    },
  };
}
