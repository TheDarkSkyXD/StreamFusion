import type { UnifiedChannel } from "@/backend/api/unified/platform-types";
import { mapWithConcurrency } from "@/backend/search/progressive-stream-search";
import type { Platform } from "@/shared/auth-types";

export type RecentContentSearchEndReason = "exhausted" | "safety-limit" | "rate-limited";

export interface RecentContentSearchProfile {
  pageSize: number;
  maxConcurrentRequests: number;
}

export interface RecentContentSearchProviderPage<T> {
  data: T[];
  cursor?: string;
}

export interface RecentContentSearchSource {
  searchChannels(
    query: string,
    options: {
      cursor?: string;
      limit: number;
      signal: AbortSignal;
      consumeRequest: () => void;
    }
  ): Promise<RecentContentSearchProviderPage<UnifiedChannel>>;
  fetchContent(
    channel: UnifiedChannel,
    options: {
      cursor?: string;
      limit: number;
      signal: AbortSignal;
      consumeRequest: () => void;
    }
  ): Promise<RecentContentSearchProviderPage<unknown>>;
}

export interface RecentContentSearchRequest {
  sessionId: string;
  platform: Platform;
  query: string;
  limit: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface RecentContentSearchPage<TContent> {
  data: TContent[];
  cursor?: string;
  endReason?: RecentContentSearchEndReason;
  retryAfterMs?: number;
  requestCount: number;
  matchedChannelCount: number;
}

interface SessionState<TContent> {
  query: string;
  startedAt: number;
  requestCount: number;
  matchedChannelCount: number;
  loaded: boolean;
  pending: TContent[];
  endReason?: RecentContentSearchEndReason;
}

function abortError(label: string): Error {
  const error = new Error(`${label} search cancelled`);
  error.name = "AbortError";
  return error;
}

function assertActive(signal: AbortSignal | undefined, label: string): void {
  if (signal?.aborted) throw abortError(label);
}

function retryAfter(error: unknown): number | undefined | null {
  if (!error || typeof error !== "object") return null;
  const value = error as { status?: unknown; statusCode?: unknown; retryAfterMs?: unknown };
  if (value.status !== 429 && value.statusCode !== 429) return null;
  return typeof value.retryAfterMs === "number" ? value.retryAfterMs : undefined;
}

export function createProgressiveRecentContentSearch<TContent>(options: {
  source: RecentContentSearchSource;
  profile: RecentContentSearchProfile;
  filterRankAndDeduplicate: (values: readonly unknown[], query: string) => TContent[];
  label: string;
}) {
  const sessions = new Map<string, SessionState<TContent>>();

  const collectChannels = async (
    query: string,
    signal: AbortSignal,
    consumeRequest: () => void
  ): Promise<UnifiedChannel[]> => {
    const channels = new Map<string, UnifiedChannel>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      assertActive(signal, options.label);
      const page = await options.source.searchChannels(query, {
        cursor,
        limit: options.profile.pageSize,
        signal,
        consumeRequest,
      });
      assertActive(signal, options.label);
      for (const channel of page.data) {
        channels.set(`${channel.platform}:${channel.id}`, channel);
      }
      if (!page.cursor || seenCursors.has(page.cursor)) {
        hasMore = false;
      } else {
        seenCursors.add(page.cursor);
        cursor = page.cursor;
      }
    }

    return [...channels.values()];
  };

  const collectContent = async (
    channel: UnifiedChannel,
    signal: AbortSignal,
    consumeRequest: () => void
  ): Promise<unknown[]> => {
    const content: unknown[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      assertActive(signal, options.label);
      const page = await options.source.fetchContent(channel, {
        cursor,
        limit: options.profile.pageSize,
        signal,
        consumeRequest,
      });
      assertActive(signal, options.label);
      content.push(...page.data);
      if (!page.cursor || seenCursors.has(page.cursor)) {
        hasMore = false;
      } else {
        seenCursors.add(page.cursor);
        cursor = page.cursor;
      }
    }

    return content;
  };

  return {
    clear(sessionId: string): void {
      for (const key of sessions.keys()) {
        if (key.startsWith(`${sessionId}:`)) sessions.delete(key);
      }
    },

    async next(request: RecentContentSearchRequest): Promise<RecentContentSearchPage<TContent>> {
      assertActive(request.signal, options.label);
      const key = `${request.sessionId}:${request.platform}`;
      let state = sessions.get(key);
      if (
        !state ||
        state.query !== request.query ||
        (state.endReason === "rate-limited" && !request.cursor)
      ) {
        state = {
          query: request.query,
          startedAt: Date.now(),
          requestCount: 0,
          matchedChannelCount: 0,
          loaded: false,
          pending: [],
        };
        sessions.set(key, state);
      }

      if (!state.loaded) {
        state.loaded = true;
        const consumeRequest = () => {
          state.requestCount += 1;
        };
        const internalController = new AbortController();
        const signal = request.signal
          ? AbortSignal.any([request.signal, internalController.signal])
          : internalController.signal;

        try {
          const channels = await collectChannels(request.query, signal, consumeRequest);
          assertActive(request.signal, options.label);
          state.matchedChannelCount = channels.length;
          const pages = await mapWithConcurrency(
            channels,
            options.profile.maxConcurrentRequests,
            async (channel) => {
              try {
                return await collectContent(channel, signal, consumeRequest);
              } catch (error) {
                internalController.abort();
                throw error;
              }
            }
          );
          state.pending = options.filterRankAndDeduplicate(pages.flat(), request.query);
          state.endReason = "exhausted";
        } catch (error) {
          assertActive(request.signal, options.label);
          const advertisedDelay = retryAfter(error);
          if (advertisedDelay !== null) {
            state.endReason = "rate-limited";
            return {
              data: [],
              endReason: state.endReason,
              retryAfterMs: advertisedDelay,
              requestCount: state.requestCount,
              matchedChannelCount: state.matchedChannelCount,
            };
          }
          sessions.delete(key);
          throw error;
        }
      }

      const data = state.pending.splice(0, request.limit);
      return {
        data,
        cursor: state.pending.length > 0 ? `${key}:${state.pending.length}` : undefined,
        endReason: state.pending.length > 0 ? undefined : state.endReason,
        requestCount: state.requestCount,
        matchedChannelCount: state.matchedChannelCount,
      };
    },
  };
}
