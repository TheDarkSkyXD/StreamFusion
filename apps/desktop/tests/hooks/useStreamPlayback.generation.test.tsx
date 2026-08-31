import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installElectronAPIMock } from "../test-utils";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/features/settings/data/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ recoveryCount: 0 }),
}));

type PlaybackResult = {
  success: true;
  data: { url: string; format: "hls" };
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function playback(url: string): PlaybackResult {
  return { success: true, data: { url, format: "hls" } };
}

beforeEach(() => {
  installElectronAPIMock();
});

afterEach(() => {
  Reflect.deleteProperty(window, "electronAPI");
});

// Guards: a superseded playback request cannot overwrite a recovered cache generation when it resolves late.
// Guards: a superseded playback request cannot evict a recovered cache generation when it rejects late.
describe("useStreamPlayback cache generations", () => {
  it("keeps the recovered URL when the ordinary request resolves afterward", async () => {
    vi.resetModules();
    const ordinary = deferred<PlaybackResult>();
    const recovery = deferred<PlaybackResult>();
    window.electronAPI!.streams.getPlaybackUrl = vi
      .fn()
      .mockImplementationOnce(() => ordinary.promise)
      .mockImplementationOnce(() => recovery.promise);

    const { useStreamPlayback } = await import("@/features/playback/data/useStreamPlayback");
    const owner = renderHook(() => useStreamPlayback("kick", "late-success"));

    expect(window.electronAPI!.streams.getPlaybackUrl).toHaveBeenCalledTimes(1);
    act(() => owner.result.current.reload());
    await waitFor(() =>
      expect(window.electronAPI!.streams.getPlaybackUrl).toHaveBeenCalledTimes(2)
    );

    await act(async () => recovery.resolve(playback("https://example.test/recovered.m3u8")));
    await waitFor(() => expect(owner.result.current.playback?.url).toContain("recovered.m3u8"));

    await act(async () => ordinary.resolve(playback("https://example.test/stale.m3u8")));
    const laterSubscriber = renderHook(() => useStreamPlayback("kick", "late-success"));

    await waitFor(() =>
      expect(laterSubscriber.result.current.playback?.url).toContain("recovered.m3u8")
    );
    expect(window.electronAPI!.streams.getPlaybackUrl).toHaveBeenCalledTimes(2);
  });

  it("keeps the recovered entry when the ordinary request rejects afterward", async () => {
    vi.resetModules();
    const ordinary = deferred<PlaybackResult>();
    window.electronAPI!.streams.getPlaybackUrl = vi
      .fn()
      .mockImplementationOnce(() => ordinary.promise)
      .mockResolvedValueOnce(playback("https://example.test/recovered.m3u8"))
      .mockResolvedValue(playback("https://example.test/unexpected-third.m3u8"));

    const { useStreamPlayback } = await import("@/features/playback/data/useStreamPlayback");
    const owner = renderHook(() => useStreamPlayback("kick", "late-failure"));

    act(() => owner.result.current.reload());
    await waitFor(() => expect(owner.result.current.playback?.url).toContain("recovered.m3u8"));

    await act(async () => ordinary.reject(new Error("superseded request failed")));
    const laterSubscriber = renderHook(() => useStreamPlayback("kick", "late-failure"));

    await waitFor(() =>
      expect(laterSubscriber.result.current.playback?.url).toContain("recovered.m3u8")
    );
    expect(window.electronAPI!.streams.getPlaybackUrl).toHaveBeenCalledTimes(2);
  });
});
