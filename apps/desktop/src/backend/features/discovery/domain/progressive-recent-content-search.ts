import type { UnifiedChannel } from "@shared/platform-types";
import { Platform } from "@streamfusion/core/platform";

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
    options: PageOptions
  ): Promise<RecentContentSearchProviderPage<UnifiedChannel>>;
  fetchContent(
    channel: UnifiedChannel,
    options: PageOptions
  ): Promise<RecentContentSearchProviderPage<unknown>>;
}

interface PageOptions {
  cursor?: string;
  limit: number;
  signal: AbortSignal;
  consumeRequest: () => void;
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

type DiscoveryState =
  { kind: "open"; cursor?: string; seenCursors: Set<string> } | { kind: "exhausted" };

interface ContentLane {
  channel: UnifiedChannel;
  cursor?: string;
  seenCursors: Set<string>;
}

interface SessionState<TContent> {
  query: string;
  requestCount: number;
  matchedChannelCount: number;
  discovery: DiscoveryState;
  discoveredChannels: Set<string>;
  lanes: ContentLane[];
  pending: TContent[];
  emitted: Set<string>;
  activeController?: AbortController;
}

type WaveResult = { kind: "ok" } | { kind: "rate-limited"; retryAfterMs?: number };

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

function hasMore<TContent>(state: SessionState<TContent>): boolean {
  return state.pending.length > 0 || state.lanes.length > 0 || state.discovery.kind === "open";
}

export function createProgressiveRecentContentSearch<
  TContent extends { id: string; platform: Platform },
>(options: {
  source: RecentContentSearchSource;
  profile: RecentContentSearchProfile;
  filterRankAndDeduplicate: (values: readonly unknown[], query: string) => TContent[];
  label: string;
}) {
  const sessions = new Map<string, SessionState<TContent>>();

  const createState = (query: string): SessionState<TContent> => ({
    query,
    requestCount: 0,
    matchedChannelCount: 0,
    discovery: { kind: "open", seenCursors: new Set<string>() },
    discoveredChannels: new Set<string>(),
    lanes: [],
    pending: [],
    emitted: new Set<string>(),
  });

  const discoverChannels = async (
    state: SessionState<TContent>,
    query: string,
    signal: AbortSignal,
    consumeRequest: () => void
  ): Promise<void> => {
    if (state.discovery.kind === "exhausted") return;
    const discovery = state.discovery;
    const page = await options.source.searchChannels(query, {
      cursor: discovery.cursor,
      limit: options.profile.pageSize,
      signal,
      consumeRequest,
    });
    assertActive(signal, options.label);
    for (const channel of page.data) {
      const identity = `${channel.platform}:${channel.id}`;
      if (state.discoveredChannels.has(identity)) continue;
      state.discoveredChannels.add(identity);
      state.matchedChannelCount += 1;
      state.lanes.push({ channel, seenCursors: new Set<string>() });
    }
    if (!page.cursor || discovery.seenCursors.has(page.cursor)) {
      state.discovery = { kind: "exhausted" };
    } else {
      discovery.seenCursors.add(page.cursor);
      discovery.cursor = page.cursor;
    }
  };

  const fetchContentWave = async (
    state: SessionState<TContent>,
    query: string,
    signal: AbortSignal,
    consumeRequest: () => void
  ): Promise<WaveResult> => {
    const lanes = state.lanes.splice(0, options.profile.maxConcurrentRequests);
    const results = await Promise.allSettled(
      lanes.map(async (lane) => ({
        lane,
        page: await options.source.fetchContent(lane.channel, {
          cursor: lane.cursor,
          limit: options.profile.pageSize,
          signal,
          consumeRequest,
        }),
      }))
    );
    assertActive(signal, options.label);
    const ordinaryFailure = results.find(
      (result) => result.status === "rejected" && retryAfter(result.reason) === null
    );
    if (ordinaryFailure?.status === "rejected") {
      state.lanes.unshift(...lanes);
      throw ordinaryFailure.reason;
    }
    const rawContent: unknown[] = [];
    let rateLimited = false;
    let retryAfterMs: number | undefined;
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const lane = lanes[index];
      if (result.status === "rejected") {
        state.lanes.push(lane);
        const delay = retryAfter(result.reason);
        if (delay === null) continue;
        rateLimited = true;
        retryAfterMs = delay;
        continue;
      }
      rawContent.push(...result.value.page.data);
      const nextCursor = result.value.page.cursor;
      if (nextCursor && !lane.seenCursors.has(nextCursor)) {
        lane.seenCursors.add(nextCursor);
        lane.cursor = nextCursor;
        state.lanes.push(lane);
      }
    }
    for (const item of options.filterRankAndDeduplicate(rawContent, query)) {
      const identity = `${item.platform}:${item.id}`;
      if (state.emitted.has(identity)) continue;
      state.emitted.add(identity);
      state.pending.push(item);
    }
    return rateLimited ? { kind: "rate-limited", retryAfterMs } : { kind: "ok" };
  };

  return {
    clear(sessionId: string): void {
      for (const [key, state] of sessions) {
        if (!key.startsWith(`${sessionId}:`)) continue;
        state.activeController?.abort(abortError(options.label));
        sessions.delete(key);
      }
    },

    async next(request: RecentContentSearchRequest): Promise<RecentContentSearchPage<TContent>> {
      assertActive(request.signal, options.label);
      const key = `${request.sessionId}:${request.platform}`;
      let state = sessions.get(key);
      if (!state || state.query !== request.query) {
        state = createState(request.query);
        sessions.set(key, state);
      }
      const internalController = new AbortController();
      state.activeController = internalController;
      const signal = request.signal
        ? AbortSignal.any([request.signal, internalController.signal])
        : internalController.signal;
      const consumeRequest = () => {
        state.requestCount += 1;
      };

      try {
        let waveResult: WaveResult = { kind: "ok" };
        if (
          state.pending.length === 0 &&
          state.lanes.length === 0 &&
          state.discovery.kind === "open"
        ) {
          try {
            await discoverChannels(state, request.query, signal, consumeRequest);
          } catch (error) {
            const delay = retryAfter(error);
            if (delay === null) throw error;
            waveResult = { kind: "rate-limited", retryAfterMs: delay };
          }
        }
        if (waveResult.kind === "ok" && state.pending.length === 0 && state.lanes.length > 0) {
          waveResult = await fetchContentWave(state, request.query, signal, consumeRequest);
        }
        const data = state.pending.splice(0, request.limit);
        const hasContinuation = hasMore(state);
        return {
          data,
          cursor: hasContinuation
            ? `${key}:${state.requestCount}:${state.pending.length}`
            : undefined,
          endReason:
            waveResult.kind === "rate-limited"
              ? "rate-limited"
              : hasContinuation
                ? undefined
                : "exhausted",
          retryAfterMs: waveResult.kind === "rate-limited" ? waveResult.retryAfterMs : undefined,
          requestCount: state.requestCount,
          matchedChannelCount: state.matchedChannelCount,
        };
      } catch (error) {
        sessions.delete(key);
        throw error;
      } finally {
        if (state.activeController === internalController) state.activeController = undefined;
      }
    },
  };
}
