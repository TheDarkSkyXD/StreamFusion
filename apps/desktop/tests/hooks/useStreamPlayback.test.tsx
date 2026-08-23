import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "@/shared/auth-types";
import { installElectronAPIMock } from "../test-utils";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ recoveryCount: 0 }),
}));

// Module-level playback cache and stagger state survive imports. Dynamic import
// after resetModules resets them.
const WAIT_OPTS = { timeout: 3000 };

beforeEach(() => {
  const api = installElectronAPIMock();
  api.streams.getPlaybackUrl = vi.fn().mockResolvedValue({
        success: true,
        data: { url: "https://example.com/stream.m3u8", format: "hls" },
      });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "electronAPI");
});

// Guards: playback URL logging must report timing and host metadata without leaking signed URLs.
// Guards: main stream and mini-player subscribers must share one in-flight playback request.
// Guards: a subscriber reusing identical in-flight or cached playback must not wait for the cold multistream stagger.
// Guards: sidebar/startup prefetch warms the same playback cache used by the player.
// Guards: reload failure after a live stream ends clears the stale playback URL so pages can show their offline state instead of remounting the dead HLS URL.
// Guards: changing stream identity never exposes the previous stream's playback URL during an intermediate render.
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

  // Guards: IPC data is untrusted until its closed playback-format union is validated.
  it("rejects an unsupported playback format from IPC", async () => {
    vi.resetModules();
    window.electronAPI!.streams.getPlaybackUrl = vi.fn().mockResolvedValue({
      success: true,
      data: { url: "https://example.com/stream.bin", format: "flash" },
    });
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const { result } = renderHook(() => useStreamPlayback("kick", "invalid-format"));
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

  it("does not let an empty hidden instance stagger the first real stream", async () => {
    vi.resetModules();
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");

    renderHook(() => useStreamPlayback("kick", ""));
    const { result } = renderHook(() => useStreamPlayback("kick", "xqc"));

    expect(window.electronAPI!.streams.getPlaybackUrl).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
  });

  it("reuses playback immediately across subscribers and logs reuse timing", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    let resolvePlayback!: (value: { success: true; data: { url: string; format: "hls" } }) => void;
    window.electronAPI!.streams.getPlaybackUrl = vi.fn(
      () =>
        new Promise<{ success: true; data: { url: string; format: "hls" } }>((resolve) => {
          resolvePlayback = resolve;
        })
    );
    const { logger } = await import("@/renderer/logging/logger");
    vi.mocked(logger.info).mockClear();
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");

    const first = renderHook(() => useStreamPlayback("kick", "shared-channel"));
    const second = renderHook(() => useStreamPlayback("kick", "shared-channel"));

    expect(window.electronAPI!.streams.getPlaybackUrl).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolvePlayback({
        success: true,
        data: { url: "https://media.example.test/live/stream.m3u8?token=secret", format: "hls" },
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(first.result.current.isLoading).toBe(false);
    expect(second.result.current.isLoading).toBe(false);

    const cached = renderHook(() => useStreamPlayback("kick", "shared-channel"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(cached.result.current.isLoading).toBe(false);
    expect(window.electronAPI!.streams.getPlaybackUrl).toHaveBeenCalledTimes(1);

    expect(logger.info).toHaveBeenCalledWith(
      "Hook:StreamPlayback",
      "playback URL ready",
      expect.objectContaining({
        cacheSource: "network",
        platform: "kick",
        identifier: "shared-channel",
        urlHost: "media.example.test",
      })
    );
    const readyCalls = vi
      .mocked(logger.info)
      .mock.calls.filter(
        ([tag, message, meta]) =>
          tag === "Hook:StreamPlayback" &&
          message === "playback URL ready" &&
          (meta as { identifier?: string } | undefined)?.identifier === "shared-channel"
      );
    expect(readyCalls.map(([, , meta]) => (meta as { cacheSource?: string }).cacheSource)).toEqual(
      expect.arrayContaining(["network"])
    );
    expect(
      readyCalls.some(([, , meta]) => {
        const cacheSource = (meta as { cacheSource?: string }).cacheSource;
        return cacheSource === "memory" || cacheSource === "in-flight";
      })
    ).toBe(true);
    expect(logger.info).not.toHaveBeenCalledWith(
      "Hook:StreamPlayback",
      "playback URL ready",
      expect.objectContaining({ url: expect.stringContaining("token=secret") })
    );
  });

  it("updates every subscriber when one playback owner requests a fresh URL", async () => {
    vi.resetModules();
    window.electronAPI!.streams.getPlaybackUrl = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: { url: "https://example.test/first.m3u8", format: "hls" },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { url: "https://example.test/refreshed.m3u8", format: "hls" },
      });
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const pageOwner = renderHook(() => useStreamPlayback("kick", "shared-refresh"));
    const visiblePlayer = renderHook(() => useStreamPlayback("kick", "shared-refresh"));

    await waitFor(
      () => expect(visiblePlayer.result.current.playback?.url).toContain("first.m3u8"),
      WAIT_OPTS
    );

    act(() => pageOwner.result.current.reload());

    await waitFor(
      () => expect(visiblePlayer.result.current.playback?.url).toContain("refreshed.m3u8"),
      WAIT_OPTS
    );
    expect(window.electronAPI!.streams.getPlaybackUrl).toHaveBeenCalledTimes(2);
  });

  it("prefetch warms the same cache used by the player hook", async () => {
    vi.resetModules();
    const { prefetchStreamPlayback, useStreamPlayback } = await import("@/hooks/useStreamPlayback");

    await prefetchStreamPlayback("kick", "prefetched-channel");
    expect(window.electronAPI!.streams.getPlaybackUrl).toHaveBeenCalledTimes(1);

    const { result } = renderHook(() => useStreamPlayback("kick", "prefetched-channel"));
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);

    expect(result.current.playback).toEqual({
      url: "https://example.com/stream.m3u8",
      format: "hls",
    });
    expect(window.electronAPI!.streams.getPlaybackUrl).toHaveBeenCalledTimes(1);
  });

  it("resets state when identifier changes", async () => {
    vi.resetModules();
    window.electronAPI!.streams.getPlaybackUrl = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: { url: "https://example.com/xqc.m3u8", format: "hls" },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { url: "https://example.com/adin.m3u8", format: "hls" },
      });
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const observations: Array<{ id: string; playback: string | null }> = [];
    const { result, rerender } = renderHook(
      ({ id }) => {
        const playbackState = useStreamPlayback("kick", id);
        observations.push({ id, playback: playbackState.playback?.url ?? null });
        return playbackState;
      },
      {
        initialProps: { id: "xqc" },
      }
    );
    await waitFor(
      () => expect(result.current.playback?.url).toBe("https://example.com/xqc.m3u8"),
      WAIT_OPTS
    );

    observations.length = 0;
    rerender({ id: "adin" });
    await waitFor(
      () => expect(result.current.playback?.url).toBe("https://example.com/adin.m3u8"),
      WAIT_OPTS
    );

    expect(observations).not.toContainEqual({
      id: "adin",
      playback: "https://example.com/xqc.m3u8",
    });
  });

  it("resets state when platform changes with the same identifier", async () => {
    vi.resetModules();
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const { result, rerender } = renderHook(
      ({ platform }: { platform: Platform }) => useStreamPlayback(platform, "shared-name"),
      { initialProps: { platform: "kick" as Platform } }
    );
    await waitFor(() => expect(result.current.playback).not.toBeNull(), WAIT_OPTS);
    rerender({ platform: "twitch" as Platform });
    expect(result.current.playback).toBeNull();
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
  });

  it("reload refetches the playback URL", async () => {
    vi.resetModules();
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const { result } = renderHook(() => useStreamPlayback("kick", "reload-test"));
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
    const callsBefore = (window.electronAPI!.streams.getPlaybackUrl as ReturnType<typeof vi.fn>)
      .mock.calls.length;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
    expect(
      (window.electronAPI!.streams.getPlaybackUrl as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBeGreaterThan(callsBefore);
  });

  it("bumps playbackRevision when reload succeeds with the same URL", async () => {
    vi.resetModules();
    window.electronAPI!.streams.getPlaybackUrl = vi.fn().mockResolvedValue({
      success: true,
      data: { url: "https://example.com/same-url.m3u8", format: "hls" },
    });
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const { result } = renderHook(() => useStreamPlayback("kick", "same-url-reload"));

    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
    expect(result.current.playback?.url).toBe("https://example.com/same-url.m3u8");
    expect(result.current.playbackRevision).toBe(1);

    act(() => result.current.reload());

    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
    expect(result.current.playback?.url).toBe("https://example.com/same-url.m3u8");
    expect(result.current.playbackRevision).toBe(2);
  });

  it("reload failure clears the stale playback URL", async () => {
    vi.resetModules();
    window.electronAPI!.streams.getPlaybackUrl = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: { url: "https://example.com/live-before-end.m3u8", format: "hls" },
      })
      .mockResolvedValueOnce({
        success: false,
        error: "Channel is offline",
      });
    const { useStreamPlayback } = await import("@/hooks/useStreamPlayback");
    const { result } = renderHook(() => useStreamPlayback("kick", "ended-stream"));

    await waitFor(() => expect(result.current.playback).not.toBeNull(), WAIT_OPTS);

    act(() => result.current.reload());

    await waitFor(() => expect(result.current.isLoading).toBe(false), WAIT_OPTS);
    expect(result.current.error!.message).toContain("Channel is offline");
    expect(result.current.playback).toBeNull();
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
