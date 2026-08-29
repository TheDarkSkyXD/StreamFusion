import { useCallback, useEffect, useState } from "react";
import type { Platform } from "../../../../shared/auth-types";
import type {
  ChatReplayWindowRequest,
  ChatReplayWindowResult,
  VideoPlaybackSnapshot,
} from "../../../../shared/chat-replay-types";

const REPLAY_FETCH_BUCKET_SECONDS = 120;
const REPLAY_WINDOW_CACHE_LIMIT = 8;

interface UseChatReplayOptions {
  platform: Platform;
  videoId: string;
  playback: VideoPlaybackSnapshot;
  locator?: ChatReplayWindowRequest["locator"];
}

interface InFlightWindow {
  requestId: string;
  subscribers: number;
  promise: Promise<ChatReplayWindowResult | null>;
}

const windowCache = new Map<string, ChatReplayWindowResult>();
const inFlightWindows = new Map<string, InFlightWindow>();
let requestSequence = 0;

function cacheWindow(key: string, result: ChatReplayWindowResult): void {
  windowCache.delete(key);
  windowCache.set(key, result);
  while (windowCache.size > REPLAY_WINDOW_CACHE_LIMIT) {
    const oldestKey = windowCache.keys().next().value;
    if (oldestKey === undefined) break;
    windowCache.delete(oldestKey);
  }
}

function startWindowRequest(
  key: string,
  platform: Platform,
  videoId: string,
  playbackBucket: number,
  locatorChannelId: string | undefined,
  locatorStartedAt: string | undefined,
  locatorVideoUuid: string | undefined,
  retryRevision: number
): InFlightWindow {
  requestSequence += 1;
  const requestId = `chat-replay-${Date.now()}-${requestSequence}-${retryRevision}`;
  const promise = window.electronAPI.videos
    .getChatReplayWindow({
      platform,
      videoId,
      offsetSeconds: playbackBucket * REPLAY_FETCH_BUCKET_SECONDS,
      locator:
        locatorChannelId || locatorStartedAt || locatorVideoUuid
          ? {
              channelId: locatorChannelId,
              startedAt: locatorStartedAt,
              videoUuid: locatorVideoUuid,
            }
          : undefined,
      requestId,
    })
    .then((response) => {
      const result = response.success && response.data ? response.data : null;
      if (result && result.capability !== "transient-failure") cacheWindow(key, result);
      return result;
    })
    .catch(() => null)
    .finally(() => {
      if (inFlightWindows.get(key)?.requestId === requestId) inFlightWindows.delete(key);
    });
  const entry = { requestId, subscribers: 0, promise };
  inFlightWindows.set(key, entry);
  return entry;
}

export function clearChatReplayWindowCache(): void {
  windowCache.clear();
  inFlightWindows.clear();
}

export function useChatReplay({ platform, videoId, playback, locator }: UseChatReplayOptions) {
  const [result, setResult] = useState<ChatReplayWindowResult | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryRevision, setRetryRevision] = useState(0);
  const playbackBucket = Math.floor(playback.currentTime / REPLAY_FETCH_BUCKET_SECONDS);
  const locatorChannelId = locator?.channelId;
  const locatorStartedAt = locator?.startedAt;
  const locatorVideoUuid = locator?.videoUuid;
  const locatorKey = `${locatorChannelId ?? ""}:${locatorStartedAt ?? ""}:${locatorVideoUuid ?? ""}`;
  const windowKey = `${platform}:${videoId}:${playbackBucket}:${locatorKey}`;

  const retry = useCallback(() => {
    windowCache.delete(windowKey);
    setResult(null);
    setStatus("loading");
    setRetryRevision((revision) => revision + 1);
  }, [windowKey]);

  useEffect(() => {
    const key = windowKey;
    const cached = windowCache.get(key);
    if (cached) {
      cacheWindow(key, cached);
      setResult(cached);
      setStatus(cached.capability === "transient-failure" ? "error" : "ready");
      return;
    }

    setResult(null);
    setStatus("loading");
    const entry =
      inFlightWindows.get(key) ??
      startWindowRequest(
        key,
        platform,
        videoId,
        playbackBucket,
        locatorChannelId,
        locatorStartedAt,
        locatorVideoUuid,
        retryRevision
      );
    entry.subscribers += 1;
    let active = true;
    void entry.promise.then((nextResult) => {
      if (active) {
        setResult(nextResult);
        setStatus(nextResult && nextResult.capability !== "transient-failure" ? "ready" : "error");
      }
    });

    return () => {
      active = false;
      entry.subscribers -= 1;
      if (entry.subscribers === 0 && inFlightWindows.get(key) === entry) {
        inFlightWindows.delete(key);
        void window.electronAPI.videos
          .cancelChatReplayWindow({ requestId: entry.requestId })
          .catch(() => undefined);
      }
    };
  }, [
    platform,
    videoId,
    playbackBucket,
    locatorChannelId,
    locatorStartedAt,
    locatorVideoUuid,
    retryRevision,
    windowKey,
  ]);

  return { result, status, retry };
}
