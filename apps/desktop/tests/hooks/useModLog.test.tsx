import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useModLog } from "@/hooks/useModLog";

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

const sampleEntries = [
  {
    id: "1",
    channelId: "ch1",
    targetUserId: "u1",
    targetUsername: "user1",
    action: "ban" as const,
    moderatorUsername: "mod1",
    reason: "spam",
    timestamp: "2026-01-01T00:00:00Z",
  },
];

beforeEach(() => {
  // @ts-expect-error -- test-only stub
  window.electronAPI = {
    modLog: {
      query: vi.fn().mockResolvedValue(sampleEntries),
    },
  };
});

afterEach(() => {
  // @ts-expect-error -- clean up
  delete window.electronAPI;
});

describe("useModLog", () => {
  it("returns entries from the backend query", async () => {
    const { result } = renderHook(
      () => useModLog({ channelId: "ch1" }),
      { wrapper: makeWrapper() }
    );
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual(sampleEntries);
  });

  it("passes filter options through to the IPC call", async () => {
    const { result } = renderHook(
      () =>
        useModLog({
          channelId: "ch1",
          targetUserId: "u1",
          action: "ban",
          moderatorUsername: "mod1",
          limit: 10,
        }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(window.electronAPI!.modLog.query).toHaveBeenCalledWith({
      channelId: "ch1",
      targetUserId: "u1",
      action: "ban",
      moderatorUsername: "mod1",
      limit: 10,
    });
  });

  it("returns empty array when the query throws", async () => {
    window.electronAPI!.modLog.query = vi.fn().mockRejectedValue(new Error("db locked"));
    const { result } = renderHook(
      () => useModLog({ channelId: "ch1" }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);
  });

  it("returns empty array when the bridge returns a non-array", async () => {
    window.electronAPI!.modLog.query = vi.fn().mockResolvedValue("not-an-array");
    const { result } = renderHook(
      () => useModLog({ channelId: "ch1" }),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);
  });
});
