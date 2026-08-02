import type {
  ChatReplayWindowRequest,
  ChatReplayWindowResult,
} from "../../shared/chat-replay-types";
import {
  fetchKickChatReplayPage,
  type KickChatReplayResult,
} from "../api/platforms/kick/kick-chat-replay-source";
import {
  fetchTwitchChatReplayPage,
  type TwitchChatReplayRequest,
  type TwitchChatReplayResult,
} from "../api/platforms/twitch/twitch-chat-replay-source";

export interface ChatReplayCapabilityAdapter {
  loadWindow(request: ChatReplaySourceRequest): Promise<ChatReplaySourceResult>;
  paginationDirection?: "forward" | "backward";
}

interface ChatReplayAdapters {
  twitch: ChatReplayCapabilityAdapter;
  kick?: ChatReplayCapabilityAdapter;
}

interface ChatReplaySourceRequest extends TwitchChatReplayRequest {
  locator?: ChatReplayWindowRequest["locator"];
}

type ChatReplaySourceResult = TwitchChatReplayResult | KickChatReplayResult;

const CHAT_REPLAY_WINDOW_RADIUS_SECONDS = 120;
const CHAT_REPLAY_MAX_PAGES = 50;

function boundMessages(
  result: ChatReplaySourceResult,
  offsetSeconds: number
): ChatReplaySourceResult {
  if (result.capability !== "supported") return result;
  const minimumOffset = Math.max(0, offsetSeconds - CHAT_REPLAY_WINDOW_RADIUS_SECONDS);
  const maximumOffset = offsetSeconds + CHAT_REPLAY_WINDOW_RADIUS_SECONDS;
  return {
    ...result,
    messages: result.messages.filter(
      (message) => message.offsetSeconds >= minimumOffset && message.offsetSeconds <= maximumOffset
    ),
  };
}

async function loadPlatformWindow(
  adapter: ChatReplayCapabilityAdapter,
  request: ChatReplayWindowRequest,
  signal?: AbortSignal
): Promise<ChatReplaySourceResult> {
  const minimumOffset = Math.max(0, request.offsetSeconds - CHAT_REPLAY_WINDOW_RADIUS_SECONDS);
  const maximumOffset = request.offsetSeconds + CHAT_REPLAY_WINDOW_RADIUS_SECONDS;
  const paginationDirection = adapter.paginationDirection ?? "forward";
  let page = await adapter.loadWindow({
    videoId: request.videoId,
    offsetSeconds: paginationDirection === "backward" ? maximumOffset : minimumOffset,
    ...(request.locator ? { locator: request.locator } : {}),
    signal,
  });
  if (page.capability !== "supported") return page;

  const messages = [...page.messages];
  const seenCursors = new Set<string>();
  let pageCount = 1;
  while (page.hasNextPage && page.nextCursor && pageCount < CHAT_REPLAY_MAX_PAGES) {
    const pageOffsets = page.messages.map((message) => message.offsetSeconds);
    const boundaryOffset =
      pageOffsets.length === 0
        ? undefined
        : paginationDirection === "backward"
          ? Math.min(...pageOffsets)
          : Math.max(...pageOffsets);
    const windowCovered =
      boundaryOffset !== undefined &&
      (paginationDirection === "backward"
        ? boundaryOffset <= minimumOffset
        : boundaryOffset >= maximumOffset);
    if (windowCovered) break;
    if (seenCursors.has(page.nextCursor)) break;
    seenCursors.add(page.nextCursor);

    const nextPage = await adapter.loadWindow({
      videoId: request.videoId,
      cursor: page.nextCursor,
      ...(request.locator ? { locator: request.locator } : {}),
      signal,
    });
    if (nextPage.capability !== "supported") return nextPage;
    messages.push(...nextPage.messages);
    page = nextPage;
    pageCount += 1;
  }

  const loadedOffsets = messages.map((message) => message.offsetSeconds);
  const loadedBoundary =
    loadedOffsets.length === 0
      ? undefined
      : paginationDirection === "backward"
        ? Math.min(...loadedOffsets)
        : Math.max(...loadedOffsets);
  const safetyLimitLeftWindowUncovered =
    loadedBoundary === undefined ||
    (paginationDirection === "backward"
      ? loadedBoundary > minimumOffset
      : loadedBoundary < maximumOffset);
  if (pageCount === CHAT_REPLAY_MAX_PAGES && page.hasNextPage && safetyLimitLeftWindowUncovered) {
    return {
      capability: "transient-failure",
      videoId: request.videoId,
      reason: "Replay window exceeded the pagination safety limit",
    };
  }

  const uniqueMessages = [
    ...new Map(messages.map((message) => [message.id, message])).values(),
  ].sort(
    (left, right) => left.offsetSeconds - right.offsetSeconds || left.id.localeCompare(right.id)
  );
  return { ...page, messages: uniqueMessages };
}

export function createChatReplayService(adapters: ChatReplayAdapters) {
  return {
    async loadWindow(
      request: ChatReplayWindowRequest,
      signal?: AbortSignal
    ): Promise<ChatReplayWindowResult> {
      const adapter = adapters[request.platform];
      if (!adapter) {
        return {
          capability: "unsupported",
          platform: request.platform,
          videoId: request.videoId,
        };
      }

      const result = await loadPlatformWindow(adapter, request, signal);
      return { ...boundMessages(result, request.offsetSeconds), platform: request.platform };
    },
  };
}

export const chatReplayService = createChatReplayService({
  twitch: { loadWindow: fetchTwitchChatReplayPage },
  // Kick's undocumented history cursor walks backward from start_time.
  kick: { loadWindow: fetchKickChatReplayPage, paginationDirection: "backward" },
});
