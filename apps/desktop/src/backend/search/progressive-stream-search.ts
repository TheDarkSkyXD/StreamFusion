import type { UnifiedStream } from "@/backend/api/unified/platform-types";
import { filterRankAndDeduplicateStreams } from "@/backend/search/search-match-contract";
import type { SearchRequestConsumer } from "@/backend/search/search-request-budget";
import type { Platform } from "@/shared/auth-types";
import type { StreamSearchEndReason } from "@/shared/search-types";
import streamSearchBudgetProfile from "./stream-search-budget-profile.json";

export interface StreamDirectoryPage {
  data: UnifiedStream[];
  cursor?: string;
  endReason?: StreamSearchEndReason;
  retryAfterMs?: number;
}

export interface StreamDirectorySource {
  platform: Platform;
  fetchNative(
    query: string,
    options: { signal?: AbortSignal; consumeRequest: SearchRequestConsumer }
  ): Promise<UnifiedStream[]>;
  fetchDirectoryPage(options: {
    cursor?: string;
    limit: number;
    signal?: AbortSignal;
    consumeRequest: SearchRequestConsumer;
  }): Promise<StreamDirectoryPage>;
}

export interface StreamSearchBudgetProfile {
  pageSize: number;
  maxPages: number;
  maxRequests: number;
  maxDurationMs: number;
  maxConcurrentRequests?: number;
}

export const STREAM_SEARCH_BUDGET_CALIBRATION = streamSearchBudgetProfile;
export const STREAM_SEARCH_BUDGET_PROFILES = streamSearchBudgetProfile.budgets satisfies Record<
  Platform,
  StreamSearchBudgetProfile
>;

export async function mapWithConcurrency<T, TResult>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await task(values[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

export interface ProgressiveStreamSearchRequest {
  sessionId: string;
  query: string;
  platform: Platform;
  limit: number;
  liveOnly?: boolean;
  cursor?: string;
  signal?: AbortSignal;
}

export interface ProgressiveStreamSearchPage {
  data: UnifiedStream[];
  cursor?: string;
  endReason?: StreamSearchEndReason;
  retryAfterMs?: number;
  scannedPages: number;
  requestCount: number;
}

interface SessionState {
  query: string;
  cursor?: string;
  nativeLoaded: boolean;
  seenIds: Set<string>;
  seenCursors: Set<string>;
  pending: UnifiedStream[];
  scannedPages: number;
  requestCount: number;
  continuationSequence: number;
  terminal?: StreamSearchEndReason;
}

const failureProgress = new WeakMap<object, { scannedPages: number; requestCount: number }>();

function attachFailureProgress(error: unknown, state: SessionState): object {
  const failure = error && typeof error === "object" ? error : new Error(String(error));
  failureProgress.set(failure, {
    scannedPages: state.scannedPages,
    requestCount: state.requestCount,
  });
  return failure;
}

export function readStreamSearchFailureProgress(
  error: unknown
): { scannedPages: number; requestCount: number } | undefined {
  return error && typeof error === "object" ? failureProgress.get(error) : undefined;
}

interface ProgressiveStreamSearchOptions {
  sources: Partial<Record<Platform, StreamDirectorySource>>;
  profile: StreamSearchBudgetProfile;
  now?: () => number;
  timeoutSignal?: (milliseconds: number) => AbortSignal;
}

function createState(query: string): SessionState {
  return {
    query,
    nativeLoaded: false,
    seenIds: new Set(),
    seenCursors: new Set(),
    pending: [],
    scannedPages: 0,
    requestCount: 0,
    continuationSequence: 0,
  };
}

function readRateLimit(error: unknown): number | undefined | null {
  if (!error || typeof error !== "object") return null;
  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    retryAfter?: unknown;
    retryAfterMs?: unknown;
  };
  if (value.status !== 429 && value.statusCode !== 429) return null;
  if (typeof value.retryAfterMs === "number") return value.retryAfterMs;
  return typeof value.retryAfter === "number" ? value.retryAfter * 1_000 : undefined;
}

function assertActive(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Stream search cancelled");
  error.name = "AbortError";
  throw error;
}

export function createProgressiveStreamSearch(options: ProgressiveStreamSearchOptions) {
  const sessions = new Map<string, SessionState>();

  return {
    clear(sessionId: string) {
      for (const key of sessions.keys()) {
        if (key.startsWith(`${sessionId}:`)) sessions.delete(key);
      }
    },

    async next(request: ProgressiveStreamSearchRequest): Promise<ProgressiveStreamSearchPage> {
      assertActive(request.signal);
      const source = options.sources[request.platform];
      if (!source) throw new Error(`No Stream directory source for ${request.platform}`);

      const key = `${request.sessionId}:${request.platform}`;
      let state = sessions.get(key);
      if (
        !state ||
        state.query !== request.query ||
        (state.terminal === "rate-limited" && !request.cursor)
      ) {
        state = createState(request.query);
        sessions.set(key, state);
      }

      const continuationCursor = () => {
        state.continuationSequence += 1;
        return `${request.sessionId}:${request.platform}:${state.continuationSequence}`;
      };
      const consumeRequest = () => {
        state.requestCount += 1;
      };
      const operationSignal = request.signal ?? new AbortController().signal;

      const hadPending = state.pending.length > 0;
      let matches: UnifiedStream[] = state.pending.splice(0, request.limit);
      if (hadPending) {
        const hasContinuation = state.pending.length > 0 || !state.terminal;
        return {
          data: matches,
          cursor: hasContinuation ? continuationCursor() : undefined,
          endReason: hasContinuation ? undefined : state.terminal,
          scannedPages: state.scannedPages,
          requestCount: state.requestCount,
        };
      }
      if (state.terminal) {
        return {
          data: [],
          endReason: state.terminal,
          scannedPages: state.scannedPages,
          requestCount: state.requestCount,
        };
      }
      const nativeCandidates: UnifiedStream[] = [];
      if (!state.nativeLoaded) {
        let native: UnifiedStream[];
        try {
          native = await source.fetchNative(request.query, {
            signal: operationSignal,
            consumeRequest,
          });
          state.nativeLoaded = true;
        } catch (error) {
          throw attachFailureProgress(error, state);
        }
        nativeCandidates.push(...native);
        assertActive(request.signal);
      }

      const currentState = state;
      const collectEligible = (values: readonly UnifiedStream[]) => {
        const unseen = values.filter((item) => {
          const identity = `${item.platform}:${item.id}`;
          if (currentState.seenIds.has(identity)) return false;
          currentState.seenIds.add(identity);
          return true;
        });
        return filterRankAndDeduplicateStreams(unseen, request.query);
      };

      matches.push(...collectEligible(nativeCandidates));
      if (matches.length > request.limit) {
        state.pending.push(...matches.slice(request.limit));
        matches = matches.slice(0, request.limit);
      }
      while (matches.length < request.limit) {
        const incomingCursor = state.cursor;
        if (incomingCursor && state.seenCursors.has(incomingCursor)) {
          state.terminal = "repeated-cursor";
          break;
        }

        state.scannedPages += 1;
        let page: StreamDirectoryPage;
        try {
          page = await source.fetchDirectoryPage({
            cursor: incomingCursor,
            limit: options.profile.pageSize,
            signal: operationSignal,
            consumeRequest,
          });
          assertActive(request.signal);
        } catch (error) {
          const retryAfterMs = readRateLimit(error);
          if (retryAfterMs === null) throw attachFailureProgress(error, state);
          state.terminal = "rate-limited";
          return {
            data: matches,
            endReason: state.terminal,
            retryAfterMs,
            scannedPages: state.scannedPages,
            requestCount: state.requestCount,
          };
        }
        if (incomingCursor) state.seenCursors.add(incomingCursor);
        const mergedMatches = [...matches, ...collectEligible(page.data)];
        if (mergedMatches.length > request.limit) {
          state.pending.push(...mergedMatches.slice(request.limit));
        }
        matches = mergedMatches.slice(0, request.limit);

        if (page.endReason === "rate-limited") {
          state.terminal = "rate-limited";
          return {
            data: matches,
            endReason: state.terminal,
            retryAfterMs: page.retryAfterMs,
            scannedPages: state.scannedPages,
            requestCount: state.requestCount,
          };
        }
        if (!page.cursor) {
          state.terminal = page.endReason ?? (page.data.length === 0 ? "empty-page" : "exhausted");
          break;
        }
        if (page.cursor === incomingCursor || state.seenCursors.has(page.cursor)) {
          state.terminal = "repeated-cursor";
          break;
        }
        state.cursor = page.cursor;
        if (matches.length > 0) break;
      }

      return {
        data: matches,
        cursor: state.pending.length > 0 || !state.terminal ? continuationCursor() : undefined,
        endReason: state.pending.length > 0 ? undefined : state.terminal,
        scannedPages: state.scannedPages,
        requestCount: state.requestCount,
      };
    },
  };
}
