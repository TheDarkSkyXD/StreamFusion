import { describe, expect, it, vi } from "vitest";
import type { UnifiedStream } from "@/backend/api/unified/platform-types";
import {
  createProgressiveStreamSearch,
  mapWithConcurrency,
  readStreamSearchFailureProgress,
  STREAM_SEARCH_BUDGET_CALIBRATION,
  STREAM_SEARCH_BUDGET_PROFILES,
  type StreamDirectorySource,
} from "@/backend/search/progressive-stream-search";

const stream = (id: string, title: string): UnifiedStream => ({
  id,
  platform: "twitch",
  channelId: `channel-${id}`,
  channelName: `creator_${id}`,
  channelDisplayName: `Creator ${id}`,
  channelAvatar: "",
  title,
  viewerCount: 10,
  thumbnailUrl: "",
  isLive: true,
  startedAt: null,
  language: "en",
  tags: [],
});

// Guards: progressive Stream search keeps scanning nonmatching directory pages until it finds a real visible-field match
describe("progressive Stream search", () => {
  it("preserves actual request counters when a provider fails", async () => {
    const source: StreamDirectorySource = {
      platform: "twitch",
      fetchNative: vi.fn(async (_query, { consumeRequest }) => {
        consumeRequest();
        consumeRequest();
        throw new Error("provider failed");
      }),
      fetchDirectoryPage: vi.fn(async () => ({ data: [] })),
    };
    const search = createProgressiveStreamSearch({
      sources: { twitch: source },
      profile: { pageSize: 20, maxPages: 2, maxRequests: 4, maxDurationMs: 1_000 },
      now: () => 0,
    });

    const failure = await search
      .next({
        sessionId: "failed-provider-count",
        query: "streamer",
        platform: "twitch",
        limit: 10,
      })
      .catch((error: unknown) => error);

    expect(readStreamSearchFailureProgress(failure)).toEqual({ scannedPages: 0, requestCount: 2 });
  });

  it("counts every attempted HTTP request without enforcing the legacy request cap", async () => {
    let dispatchedRequests = 0;
    const source: StreamDirectorySource = {
      platform: "kick",
      fetchNative: vi.fn(async (_query, { consumeRequest }) => {
        consumeRequest();
        dispatchedRequests += 1;
        consumeRequest();
        dispatchedRequests += 1;
        consumeRequest();
        dispatchedRequests += 1;
        consumeRequest();
        dispatchedRequests += 1;
        return [];
      }),
      fetchDirectoryPage: vi.fn(async ({ consumeRequest }) => {
        consumeRequest();
        return { data: [] };
      }),
    };
    const search = createProgressiveStreamSearch({
      sources: { kick: source },
      profile: { pageSize: 20, maxPages: 2, maxRequests: 3, maxDurationMs: 1_000 },
      now: () => 0,
    });

    const result = await search.next({
      sessionId: "actual-http-budget",
      query: "streamer",
      platform: "kick",
      limit: 10,
    });

    expect(dispatchedRequests).toBe(4);
    expect(result).toMatchObject({
      requestCount: 5,
      cursor: undefined,
      endReason: "empty-page",
    });
    expect(source.fetchDirectoryPage).toHaveBeenCalledTimes(1);
  });

  it("loads the checked-in profile calibrated from all Electron observations", () => {
    expect(STREAM_SEARCH_BUDGET_CALIBRATION).toMatchObject({
      calibrated: true,
      source: "electron-runtime-observations",
      observationCount: 6,
      generatedAt: expect.any(String),
    });
    expect(STREAM_SEARCH_BUDGET_PROFILES).toEqual(STREAM_SEARCH_BUDGET_CALIBRATION.budgets);
  });

  it("counts native search and hydration calls against the request budget", async () => {
    const source: StreamDirectorySource = {
      platform: "twitch",
      fetchNative: vi.fn(async (_query, { consumeRequest }) => {
        consumeRequest();
        consumeRequest();
        consumeRequest();
        return [];
      }),
      fetchDirectoryPage: vi.fn(async ({ consumeRequest }) => {
        consumeRequest();
        return { data: [] };
      }),
    };
    const search = createProgressiveStreamSearch({
      sources: { twitch: source },
      profile: { pageSize: 20, maxPages: 2, maxRequests: 4, maxDurationMs: 1_000 },
      now: () => 0,
    });

    const result = await search.next({
      sessionId: "native-call-budget",
      query: "streamer",
      platform: "twitch",
      limit: 10,
    });

    expect(source.fetchNative).toHaveBeenCalledWith(
      "streamer",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(source.fetchDirectoryPage).toHaveBeenCalledTimes(1);
    expect(result.requestCount).toBe(4);
  });

  it("allows provider work to outlive the legacy wall-clock budget", async () => {
    vi.useFakeTimers();
    let now = 0;
    const source: StreamDirectorySource = {
      platform: "twitch",
      fetchNative: vi.fn(
        () =>
          new Promise<UnifiedStream[]>((resolve) => {
            setTimeout(() => {
              now = 75;
              resolve([stream("slow-native", "Streamer after a slow native search")]);
            }, 75);
          })
      ),
      fetchDirectoryPage: vi.fn(async () => ({ data: [] })),
    };
    const timeoutSignal = vi.fn(() => new AbortController().signal);
    const search = createProgressiveStreamSearch({
      sources: { twitch: source },
      profile: { pageSize: 20, maxPages: 2, maxRequests: 3, maxDurationMs: 50 },
      now: () => now,
      timeoutSignal,
    });

    const pending = search.next({
      sessionId: "slow-directory",
      query: "streamer",
      platform: "twitch",
      limit: 10,
    });
    await vi.advanceTimersByTimeAsync(75);

    await expect(pending).resolves.toMatchObject({
      data: [expect.objectContaining({ id: "slow-native" })],
      endReason: "empty-page",
    });
    expect(timeoutSignal).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("calibrates native hydration concurrency through the injected profile limit", async () => {
    let active = 0;
    let maximumActive = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return value * 2;
    });

    expect(maximumActive).toBe(2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("returns a title match from a later directory page", async () => {
    const source: StreamDirectorySource = {
      platform: "twitch",
      fetchNative: vi.fn(async () => []),
      fetchDirectoryPage: vi
        .fn()
        .mockResolvedValueOnce({ data: [stream("1", "Unrelated broadcast")], cursor: "page-2" })
        .mockResolvedValueOnce({
          data: [stream("2", "Streamer University orientation")],
          cursor: undefined,
        }),
    };
    const search = createProgressiveStreamSearch({
      sources: { twitch: source },
      profile: { pageSize: 20, maxPages: 4, maxRequests: 5, maxDurationMs: 1_000 },
      now: () => 0,
    });

    const result = await search.next({
      sessionId: "session-1",
      query: "streamer univer",
      platform: "twitch",
      limit: 10,
    });

    expect(result.data.map((item) => item.id)).toEqual(["2"]);
    expect(source.fetchDirectoryPage).toHaveBeenCalledTimes(2);
    expect(result.endReason).toBe("exhausted");
  });

  it("deduplicates overlap between native and directory Stream results", async () => {
    const overlap = stream("overlap", "Streamer University live");
    const source: StreamDirectorySource = {
      platform: "twitch",
      fetchNative: vi.fn(async () => [overlap]),
      fetchDirectoryPage: vi.fn(async () => ({
        data: [overlap, stream("directory-only", "Streamer University Q&A")],
      })),
    };
    const search = createProgressiveStreamSearch({
      sources: { twitch: source },
      profile: { pageSize: 20, maxPages: 2, maxRequests: 3, maxDurationMs: 1_000 },
      now: () => 0,
    });

    const result = await search.next({
      sessionId: "native-directory-overlap",
      query: "streamer univer",
      platform: "twitch",
      limit: 10,
    });

    expect(result.data.map((item) => item.id)).toEqual(["overlap", "directory-only"]);
  });

  it("keeps Twitch and Kick cursor and terminal state independent", async () => {
    const twitchSource: StreamDirectorySource = {
      platform: "twitch",
      fetchNative: vi.fn(async () => []),
      fetchDirectoryPage: vi.fn(async () => ({
        data: [stream("twitch-only", "Streamer live")],
      })),
    };
    const kickSource: StreamDirectorySource = {
      platform: "kick",
      fetchNative: vi.fn(async () => []),
      fetchDirectoryPage: vi
        .fn()
        .mockResolvedValueOnce({ data: [], cursor: "kick-page-2" })
        .mockResolvedValueOnce({
          data: [{ ...stream("kick-only", "Streamer live"), platform: "kick" }],
        }),
    };
    const search = createProgressiveStreamSearch({
      sources: { twitch: twitchSource, kick: kickSource },
      profile: { pageSize: 20, maxPages: 3, maxRequests: 4, maxDurationMs: 1_000 },
      now: () => 0,
    });

    const [twitch, kick] = await Promise.all([
      search.next({
        sessionId: "two-platforms",
        query: "streamer",
        platform: "twitch",
        limit: 10,
      }),
      search.next({
        sessionId: "two-platforms",
        query: "streamer",
        platform: "kick",
        limit: 10,
      }),
    ]);

    expect(twitch).toMatchObject({ endReason: "exhausted", scannedPages: 1 });
    expect(kick).toMatchObject({ endReason: "exhausted", scannedPages: 2 });
    expect(twitch.data[0].platform).toBe("twitch");
    expect(kick.data[0].platform).toBe("kick");
  });

  it("ignores duplicate data across advancing cursors and continues scanning", async () => {
    const duplicate = stream("duplicate", "Unrelated broadcast");
    const source: StreamDirectorySource = {
      platform: "twitch",
      fetchNative: vi.fn(async () => []),
      fetchDirectoryPage: vi
        .fn()
        .mockResolvedValueOnce({ data: [duplicate], cursor: "cursor-a" })
        .mockResolvedValueOnce({ data: [duplicate], cursor: "cursor-b" })
        .mockResolvedValueOnce({
          data: [stream("match", "Streamer University")],
          cursor: undefined,
        }),
    };
    const search = createProgressiveStreamSearch({
      sources: { twitch: source },
      profile: { pageSize: 20, maxPages: 4, maxRequests: 5, maxDurationMs: 1_000 },
      now: () => 0,
    });

    const result = await search.next({
      sessionId: "advancing-duplicate-pages",
      query: "streamer univer",
      platform: "twitch",
      limit: 10,
    });

    expect(result.data.map((item) => item.id)).toEqual(["match"]);
    expect(source.fetchDirectoryPage).toHaveBeenCalledTimes(3);
  });

  it("turns a 429 into an explicit Retry-After terminal state", async () => {
    const rateLimitError = Object.assign(new Error("Too many requests"), {
      status: 429,
      retryAfterMs: 4_000,
    });
    const source: StreamDirectorySource = {
      platform: "kick",
      fetchNative: vi.fn(async () => []),
      fetchDirectoryPage: vi.fn(async () => {
        throw rateLimitError;
      }),
    };
    const search = createProgressiveStreamSearch({
      sources: { kick: source },
      profile: { pageSize: 20, maxPages: 4, maxRequests: 5, maxDurationMs: 1_000 },
      now: () => 0,
    });

    const result = await search.next({
      sessionId: "session-rate-limit",
      query: "streamer",
      platform: "kick",
      limit: 10,
    });

    expect(result).toMatchObject({
      data: [],
      endReason: "rate-limited",
      retryAfterMs: 4_000,
    });
  });

  it("returns overflow matches on the next request without refetching the directory page", async () => {
    const source: StreamDirectorySource = {
      platform: "twitch",
      fetchNative: vi.fn(async () => []),
      fetchDirectoryPage: vi.fn(async () => ({
        data: [
          stream("1", "Streamer University one"),
          stream("2", "Streamer University two"),
          stream("3", "Streamer University three"),
        ],
        cursor: "page-2",
      })),
    };
    const search = createProgressiveStreamSearch({
      sources: { twitch: source },
      profile: { pageSize: 20, maxPages: 4, maxRequests: 5, maxDurationMs: 1_000 },
      now: () => 0,
    });
    const request = {
      sessionId: "session-overflow",
      query: "streamer univer",
      platform: "twitch" as const,
      limit: 2,
    };

    const first = await search.next(request);
    const second = await search.next(request);

    expect(first.data.map((item) => item.id)).toEqual(["1", "2"]);
    expect(second.data.map((item) => item.id)).toEqual(["3"]);
    expect(source.fetchDirectoryPage).toHaveBeenCalledTimes(1);
  });

  it("keeps a continuation cursor until an exhausted page's queued matches are drained", async () => {
    const source: StreamDirectorySource = {
      platform: "twitch",
      fetchNative: vi.fn(async () => []),
      fetchDirectoryPage: vi.fn(async () => ({
        data: [
          stream("1", "Streamer one"),
          stream("2", "Streamer two"),
          stream("3", "Streamer three"),
        ],
      })),
    };
    const search = createProgressiveStreamSearch({
      sources: { twitch: source },
      profile: { pageSize: 20, maxPages: 4, maxRequests: 5, maxDurationMs: 1_000 },
      now: () => 0,
    });
    const request = {
      sessionId: "session-terminal-overflow",
      query: "streamer",
      platform: "twitch" as const,
      limit: 2,
    };

    const first = await search.next(request);
    const second = await search.next(request);

    expect(first.cursor).toEqual(expect.any(String));
    expect(first.endReason).toBeUndefined();
    expect(second.data.map((item) => item.id)).toEqual(["3"]);
    expect(second.endReason).toBe("exhausted");
  });

  it("does no native or directory work for an already-cancelled session", async () => {
    const controller = new AbortController();
    controller.abort();
    const source: StreamDirectorySource = {
      platform: "twitch",
      fetchNative: vi.fn(async () => []),
      fetchDirectoryPage: vi.fn(async () => ({ data: [] })),
    };
    const search = createProgressiveStreamSearch({
      sources: { twitch: source },
      profile: { pageSize: 20, maxPages: 4, maxRequests: 5, maxDurationMs: 1_000 },
    });

    await expect(
      search.next({
        sessionId: "session-cancelled",
        query: "streamer",
        platform: "twitch",
        limit: 10,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(source.fetchNative).not.toHaveBeenCalled();
    expect(source.fetchDirectoryPage).not.toHaveBeenCalled();
  });

  it("terminates a duplicate-page loop when the provider repeats its cursor", async () => {
    const source: StreamDirectorySource = {
      platform: "twitch",
      fetchNative: vi.fn(async () => []),
      fetchDirectoryPage: vi.fn(async () => ({
        data: [stream("duplicate", "Unrelated")],
        cursor: "stuck",
      })),
    };
    const search = createProgressiveStreamSearch({
      sources: { twitch: source },
      profile: { pageSize: 20, maxPages: 10, maxRequests: 11, maxDurationMs: 1_000 },
      now: () => 0,
    });

    const result = await search.next({
      sessionId: "session-stuck",
      query: "streamer",
      platform: "twitch",
      limit: 10,
    });

    expect(result.endReason).toBe("repeated-cursor");
    expect(source.fetchDirectoryPage).toHaveBeenCalledTimes(2);
  });

  it("ignores local scan budgets and continues to provider exhaustion", async () => {
    const source: StreamDirectorySource = {
      platform: "kick",
      fetchNative: vi.fn(async (_query, { consumeRequest }) => {
        consumeRequest();
        return [];
      }),
      fetchDirectoryPage: vi
        .fn()
        .mockImplementationOnce(async ({ consumeRequest }) => {
          consumeRequest();
          return { data: [], cursor: "page-2" };
        })
        .mockImplementationOnce(async ({ consumeRequest }) => {
          consumeRequest();
          return { data: [stream("resumed", "Streamer after the budget yield")] };
        }),
    };
    const search = createProgressiveStreamSearch({
      sources: { kick: source },
      profile: { pageSize: 7, maxPages: 1, maxRequests: 2, maxDurationMs: 1_000 },
      now: () => 0,
    });

    const result = await search.next({
      sessionId: "session-budget",
      query: "streamer",
      platform: "kick",
      limit: 10,
    });

    expect(result).toMatchObject({
      data: [expect.objectContaining({ id: "resumed" })],
      cursor: undefined,
      endReason: "exhausted",
      scannedPages: 2,
      requestCount: 3,
    });
    expect(source.fetchDirectoryPage).toHaveBeenCalledTimes(2);
    expect(source.fetchDirectoryPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 7 }));
  });
});
