import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let recoveryCount = 0;
vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ recoveryCount }),
}));

beforeEach(() => {
  recoveryCount = 0;
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    streams: {
      getPlaybackUrl: vi.fn().mockResolvedValue({
        success: false,
        error: "network unavailable",
      }),
    },
  };
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

// Guards: confirmed network recovery retries a failed playback once after resetting its cap.
// Guards: unchanged recovery state and confirmed recovery while playback is healthy or empty do not fetch.
// Guards: recovery observed during an in-flight stale request remains pending if that request later fails.
describe("useStreamPlayback confirmed network recovery", () => {
  it("retries only the failed playback once when recovery increments", async () => {
    vi.resetModules();
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const failed = renderHook(() => useStreamPlayback("kick", "recovery-retry"));
    const empty = renderHook(() => useStreamPlayback("kick", ""));

    await waitFor(() => expect(failed.result.current.isLoading).toBe(false));
    for (let attempt = 0; attempt < 3; attempt++) {
      act(() => failed.result.current.reload());
      await waitFor(() => expect(failed.result.current.isLoading).toBe(false));
    }
    act(() => failed.result.current.reload());
    expect(failed.result.current.error?.message).toContain("Max reload attempts");

    const getPlaybackUrl = vi.mocked(window.electronAPI!.streams.getPlaybackUrl);
    expect(getPlaybackUrl).toHaveBeenCalledTimes(4);
    getPlaybackUrl.mockResolvedValue({
      success: true,
      data: { url: "https://example.test/recovered.m3u8", format: "hls" },
    });

    recoveryCount = 1;
    failed.rerender();
    empty.rerender();

    await waitFor(() => expect(failed.result.current.playback?.url).toContain("recovered.m3u8"));
    expect(failed.result.current.reloadAttempts).toBe(0);
    expect(getPlaybackUrl).toHaveBeenCalledTimes(5);

    failed.rerender();
    empty.rerender();
    expect(getPlaybackUrl).toHaveBeenCalledTimes(5);

    recoveryCount = 2;
    failed.rerender();
    empty.rerender();
    expect(getPlaybackUrl).toHaveBeenCalledTimes(5);
  });

  it("retains recovery while a stale playback request is still pending", async () => {
    vi.resetModules();
    let rejectFirstRequest!: (error: Error) => void;
    window.electronAPI!.streams.getPlaybackUrl = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirstRequest = reject;
          })
      )
      .mockResolvedValueOnce({
        success: true,
        data: { url: "https://example.test/fresh-after-recovery.m3u8", format: "hls" },
      });
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const playback = renderHook(() => useStreamPlayback("kick", "pending-at-recovery"));
    const getPlaybackUrl = vi.mocked(window.electronAPI!.streams.getPlaybackUrl);

    expect(playback.result.current.isLoading).toBe(true);
    recoveryCount = 1;
    playback.rerender();
    expect(getPlaybackUrl).toHaveBeenCalledTimes(1);

    await act(async () => rejectFirstRequest(new Error("stale request lost its network")));

    await waitFor(() =>
      expect(playback.result.current.playback?.url).toContain("fresh-after-recovery.m3u8")
    );
    expect(getPlaybackUrl).toHaveBeenCalledTimes(2);
  });
});
