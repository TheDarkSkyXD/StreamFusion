import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Module-level instanceCounter accumulates across tests, increasing stagger
// delays for later tests. Dynamic import after resetModules resets it.
const WAIT_OPTS = { timeout: 3000 };

beforeEach(() => {
  // @ts-expect-error -- test-only stub
  window.electronAPI = {
    streams: {
      getPlaybackUrl: vi.fn().mockResolvedValue({
        success: true,
        data: { url: "https://example.com/stream.m3u8", format: "hls" },
      }),
    },
  };
});

afterEach(() => {
  // @ts-expect-error -- clean up
  delete window.electronAPI;
});

describe("useStreamPlayback", () => {
  it("returns loading=true initially and resolves with playback data", async () => {
    vi.resetModules();
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const { result } = renderHook(() => useStreamPlayback("kick", "xqc"));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
    expect(result.current.playback).toEqual({
      url: "https://example.com/stream.m3u8",
      format: "hls",
    });
    expect(result.current.error).toBeNull();
  });

  it("returns error when the backend fails", async () => {
    vi.resetModules();
    window.electronAPI!.streams.getPlaybackUrl = vi.fn().mockResolvedValue({
      success: false,
      error: "Channel is offline",
    });
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const { result } = renderHook(() => useStreamPlayback("kick", "offline"));
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.playback).toBeNull();
  });

  it("returns isLoading=false and no request when identifier is empty", async () => {
    vi.resetModules();
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const { result } = renderHook(() => useStreamPlayback("kick", ""));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.playback).toBeNull();
    expect(window.electronAPI!.streams.getPlaybackUrl).not.toHaveBeenCalled();
  });

  it("resets state when identifier changes", async () => {
    vi.resetModules();
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const { result, rerender } = renderHook(
      ({ id }) => useStreamPlayback("kick", id),
      { initialProps: { id: "xqc" } }
    );
    await waitFor(() => expect(result.current.playback).not.toBeNull(), WAIT_OPTS);
    rerender({ id: "adin" });
    expect(result.current.playback).toBeNull();
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
  });

  it("reload refetches the playback URL", async () => {
    vi.resetModules();
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const { result } = renderHook(() => useStreamPlayback("kick", "reload-test"));
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
    const callsBefore = (window.electronAPI!.streams.getPlaybackUrl as ReturnType<typeof vi.fn>).mock.calls.length;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
    expect(
      (window.electronAPI!.streams.getPlaybackUrl as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBeGreaterThan(callsBefore);
  });

  it("reload stops after MAX_RELOAD_ATTEMPTS (3) consecutive failures", async () => {
    vi.resetModules();
    window.electronAPI!.streams.getPlaybackUrl = vi.fn().mockResolvedValue({
      success: false,
      error: "stream error",
    });
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const { result } = renderHook(() => useStreamPlayback("kick", "broken"));
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);

    for (let i = 0; i < 3; i++) {
      act(() => result.current.reload());
      await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
    }
    act(() => result.current.reload());
    expect(result.current.error!.message).toContain("Max reload attempts");
  });

  it("reloadAttempts resets to 0 on successful load", async () => {
    vi.resetModules();
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const { result } = renderHook(() => useStreamPlayback("kick", "success-test"));
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
    expect(result.current.reloadAttempts).toBe(0);
  });

  it("detects proxy URLs and sets isUsingProxy", async () => {
    vi.resetModules();
    window.electronAPI!.streams.getPlaybackUrl = vi.fn().mockResolvedValue({
      success: true,
      data: { url: "https://cdn-perfprod.com/stream.m3u8", format: "hls" },
    });
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const { result } = renderHook(() => useStreamPlayback("twitch", "proxy-detect-test"));
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
    expect(result.current.isUsingProxy).toBe(true);
  });

  it("retryWithoutProxy clears error and playback state before re-fetching", async () => {
    vi.resetModules();
    window.electronAPI!.streams.getPlaybackUrl = vi.fn().mockResolvedValue({
      success: true,
      data: { url: "https://cdn-perfprod.com/stream.m3u8", format: "hls" },
    });
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const { result } = renderHook(() => useStreamPlayback("twitch", "retry-proxy-test"));
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
    expect(result.current.isUsingProxy).toBe(true);

    act(() => result.current.retryWithoutProxy());
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
    expect(result.current.error).toBeNull();
    expect(result.current.playback).not.toBeNull();
  });
});
