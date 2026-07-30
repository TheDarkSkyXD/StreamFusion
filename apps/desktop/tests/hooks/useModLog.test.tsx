import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useModLog } from "@/hooks/useModLog";
import type { ModerationHistoryResult, ModLogEntry } from "@/shared/mod-log-types";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const occurredAt = Date.now();
const sampleEntries: ModLogEntry[] = [
  {
    id: 1,
    platform: "twitch",
    channelId: "ch1",
    channelSlug: "streamer",
    targetUserId: "u1",
    targetUsername: "user1",
    action: "ban",
    moderatorUserId: "m1",
    moderatorUsername: "mod1",
    durationSeconds: null,
    reason: "spam",
    provenance: "twitch-eventsub",
    providerEventId: "event-1",
    occurredAt,
    observedAt: occurredAt,
    createdAt: occurredAt,
  },
];

const readyResult: ModerationHistoryResult = {
  state: "ready",
  entries: sampleEntries,
  coverage: "complete",
};

function options() {
  return {
    platform: "twitch" as const,
    channelId: "ch1",
    channelSlug: "streamer",
  };
}

beforeEach(() => {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    modLog: {
      query: vi.fn().mockResolvedValue(readyResult),
    },
  };
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("useModLog", () => {
  it("keeps loading and ready history states distinct", async () => {
    const { result } = renderHook(() => useModLog(options()), {
      wrapper: makeWrapper(),
    });

    expect(result.current.result).toEqual({ state: "loading", entries: [] });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.result).toEqual(readyResult);
    expect(result.current.entries).toEqual(sampleEntries);
  });

  it("passes platform and channel identity through to authorization-aware IPC", async () => {
    const { result } = renderHook(
      () =>
        useModLog({
          ...options(),
          targetUserId: "u1",
          action: "ban",
          moderatorUsername: "mod1",
          limit: 5,
        }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(window.electronAPI.modLog.query).toHaveBeenCalledWith({
      platform: "twitch",
      channelId: "ch1",
      channelSlug: "streamer",
      targetUserId: "u1",
      action: "ban",
      moderatorUsername: "mod1",
      limit: 5,
    });
  });

  it("preserves verified-empty instead of collapsing it to an array", async () => {
    window.electronAPI.modLog.query = vi.fn().mockResolvedValue({
      state: "verified-empty",
      entries: [],
      coverage: "complete",
    });
    const { result } = renderHook(() => useModLog(options()), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.result.state).toBe("verified-empty");
  });

  it("preserves partial coverage and its reason", async () => {
    window.electronAPI.modLog.query = vi.fn().mockResolvedValue({
      state: "partial",
      entries: sampleEntries,
      coverage: "partial",
      reason: "observation-window",
    });
    const { result } = renderHook(() => useModLog(options()), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.result).toMatchObject({
      state: "partial",
      reason: "observation-window",
    });
  });

  it("keeps authorization errors distinct and retryable", async () => {
    window.electronAPI.modLog.query = vi.fn().mockResolvedValue({
      state: "error",
      entries: [],
      code: "unauthorized",
      retryable: true,
    });
    const { result } = renderHook(() => useModLog(options()), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.result).toEqual({
      state: "error",
      entries: [],
      code: "unauthorized",
      retryable: true,
    });
  });

  it("maps thrown and malformed bridge responses to query-failed", async () => {
    window.electronAPI.modLog.query = vi.fn().mockRejectedValue(new Error("db locked"));
    const first = renderHook(() => useModLog(options()), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.result).toMatchObject({
      state: "error",
      code: "query-failed",
    });
    first.unmount();

    window.electronAPI.modLog.query = vi.fn().mockResolvedValue("not-a-result");
    const second = renderHook(() => useModLog(options()), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.result).toMatchObject({
      state: "error",
      code: "query-failed",
    });
  });
});
