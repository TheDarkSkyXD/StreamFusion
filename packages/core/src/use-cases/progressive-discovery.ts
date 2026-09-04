import type {
  DiscoveryCancellationSignal,
  DiscoveryPageResult,
  DiscoveryPageSource,
} from "../capabilities/discovery.ts";

export type ProgressiveDiscoveryEndReason =
  | "exhausted"
  | "empty-page"
  | "repeated-cursor"
  | "safety-limit"
  | "rate-limited"
  | "cancelled";

export interface ProgressiveDiscoveryProfile {
  readonly pageSize: number;
  readonly maxPages: number;
  readonly maxRequests: number;
}

export interface ProgressiveDiscoveryRequest {
  readonly sessionId: string;
  readonly scope: string;
  readonly query: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly signal?: DiscoveryCancellationSignal;
}

export type ProgressiveDiscoveryResult<TItem> =
  | {
      readonly kind: "success";
      readonly data: readonly TItem[];
      readonly cursor?: string;
      readonly endReason?: ProgressiveDiscoveryEndReason;
      readonly retryAfterMs?: number;
      readonly scannedPages: number;
      readonly requestCount: number;
    }
  | {
      readonly kind: "failure";
      readonly error: unknown;
      readonly scannedPages: number;
      readonly requestCount: number;
    };

interface SessionState<TItem> {
  readonly query: string;
  readonly seenIds: Set<string>;
  readonly seenCursors: Set<string>;
  readonly pending: TItem[];
  sourceCursor?: string;
  terminal?: ProgressiveDiscoveryEndReason;
  scannedPages: number;
  requestCount: number;
  continuationSequence: number;
}

function createSession<TItem>(query: string): SessionState<TItem> {
  return {
    query,
    seenIds: new Set(),
    seenCursors: new Set(),
    pending: [],
    scannedPages: 0,
    requestCount: 0,
    continuationSequence: 0,
  };
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function createProgressiveDiscovery<
  TItem,
  TSource extends DiscoveryPageSource<TItem>,
>(options: {
  readonly source: TSource;
  readonly profile: ProgressiveDiscoveryProfile;
  readonly identify: (item: TItem) => string;
  readonly rank: (items: readonly TItem[], query: string) => readonly TItem[];
}) {
  if (
    !isPositiveInteger(options.profile.pageSize) ||
    !isPositiveInteger(options.profile.maxPages) ||
    !isPositiveInteger(options.profile.maxRequests)
  ) {
    throw new RangeError(
      "Progressive discovery budgets must be positive integers",
    );
  }

  const sessions = new Map<string, SessionState<TItem>>();

  return {
    clear(sessionId: string): void {
      for (const key of sessions.keys()) {
        if (key.startsWith(`${sessionId}:`)) sessions.delete(key);
      }
    },

    async next(
      request: ProgressiveDiscoveryRequest,
    ): Promise<ProgressiveDiscoveryResult<TItem>> {
      if (!isPositiveInteger(request.limit)) {
        return {
          kind: "failure",
          error: new RangeError(
            "Discovery result limit must be a positive integer",
          ),
          scannedPages: 0,
          requestCount: 0,
        };
      }
      const key = `${request.sessionId}:${request.scope}`;
      let state = sessions.get(key);
      if (
        !state ||
        state.query !== request.query ||
        (state.terminal === "rate-limited" && request.cursor === undefined)
      ) {
        state = createSession(request.query);
        sessions.set(key, state);
      }

      const continuationCursor = () => {
        state.continuationSequence += 1;
        return `${key}:${state.continuationSequence}`;
      };
      const success = (
        data: readonly TItem[],
        retryAfterMs?: number,
      ): ProgressiveDiscoveryResult<TItem> => {
        const hasContinuation = state.pending.length > 0 || !state.terminal;
        return {
          kind: "success",
          data,
          ...(hasContinuation ? { cursor: continuationCursor() } : {}),
          ...(!hasContinuation && state.terminal
            ? { endReason: state.terminal }
            : {}),
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          scannedPages: state.scannedPages,
          requestCount: state.requestCount,
        };
      };

      if (request.signal?.aborted) {
        state.terminal = "cancelled";
        return success([]);
      }
      if (state.pending.length > 0) {
        return success(state.pending.splice(0, request.limit));
      }
      if (state.terminal) return success([]);

      while (state.pending.length < request.limit && !state.terminal) {
        if (
          state.scannedPages >= options.profile.maxPages ||
          state.requestCount >= options.profile.maxRequests
        ) {
          state.terminal = "safety-limit";
          break;
        }
        if (request.signal?.aborted) {
          state.terminal = "cancelled";
          break;
        }
        const incomingCursor = state.sourceCursor;
        if (incomingCursor && state.seenCursors.has(incomingCursor)) {
          state.terminal = "repeated-cursor";
          break;
        }

        state.scannedPages += 1;
        state.requestCount += 1;
        let page: DiscoveryPageResult<TItem>;
        try {
          page = await options.source.loadPage({
            query: request.query,
            ...(incomingCursor === undefined ? {} : { cursor: incomingCursor }),
            limit: options.profile.pageSize,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          });
        } catch (error) {
          sessions.delete(key);
          return {
            kind: "failure",
            error,
            scannedPages: state.scannedPages,
            requestCount: state.requestCount,
          };
        }
        if (request.signal?.aborted) {
          state.terminal = "cancelled";
          break;
        }
        if (page.kind === "failure") {
          sessions.delete(key);
          return {
            kind: "failure",
            error: page.error,
            scannedPages: state.scannedPages,
            requestCount: state.requestCount,
          };
        }

        const unseen: TItem[] = [];
        for (const item of page.items) {
          const identity = options.identify(item);
          if (state.seenIds.has(identity)) continue;
          state.seenIds.add(identity);
          unseen.push(item);
        }
        state.pending.push(...options.rank(unseen, request.query));

        if (page.kind === "rate-limited") {
          state.terminal = "rate-limited";
          const data = state.pending.splice(0, request.limit);
          return success(data, page.retryAfterMs);
        }
        if (incomingCursor) state.seenCursors.add(incomingCursor);
        if (page.cursor === undefined) {
          state.terminal = page.items.length === 0 ? "empty-page" : "exhausted";
          break;
        }
        if (
          page.cursor === incomingCursor ||
          state.seenCursors.has(page.cursor)
        ) {
          state.terminal = "repeated-cursor";
          break;
        }
        state.sourceCursor = page.cursor;
      }

      return success(state.pending.splice(0, request.limit));
    },
  };
}
