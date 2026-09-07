import type {
  ChatReplayMessage,
  ChatReplayWindowRequest,
} from "@shared/chat-replay-types";

export interface ChatReplaySourceRequest {
  videoId: string;
  offsetSeconds?: number;
  cursor?: string;
  locator?: ChatReplayWindowRequest["locator"];
  signal?: AbortSignal;
}

export type ChatReplaySourceResult =
  | {
      capability: "supported";
      videoId: string;
      messages: ChatReplayMessage[];
      nextCursor: string | null;
      hasNextPage: boolean;
    }
  | { capability: "empty"; videoId: string }
  | { capability: "unsupported"; videoId: string; reason?: string }
  | { capability: "transient-failure"; videoId: string; reason: string };

export interface ChatReplaySource {
  loadWindow(request: ChatReplaySourceRequest): Promise<ChatReplaySourceResult>;
  paginationDirection?: "forward" | "backward";
}

export interface ChatReplaySources {
  twitch: ChatReplaySource;
  kick?: ChatReplaySource;
}
