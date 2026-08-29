import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTwitchLiveRecovery } from "@/features/playback/components/player/hooks/use-twitch-live-recovery";
import type { PlayerError } from "@/features/playback/components/player/types";

const stalledPlayback: PlayerError = {
  code: "PLAYBACK_STALL",
  message: "Live video stopped presenting frames",
  fatal: true,
  shouldRefresh: true,
};

// Guards: a Twitch recovery budget belongs to the channel surface, so replacing a failed playback URL cannot reset it and create an endless refresh loop.
describe("useTwitchLiveRecovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows only two backoff refreshes across source revisions", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const onExhausted = vi.fn();
    const { result, rerender } = renderHook(
      ({ sourceRevision }) =>
        useTwitchLiveRecovery({
          sessionKey: "stream-page:twitch:xqc",
          sourceRevision,
          onRefresh,
          onExhausted,
        }),
      { initialProps: { sourceRevision: 1 } }
    );

    expect(result.current.handleError(stalledPlayback)).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender({ sourceRevision: 2 });
    expect(result.current.handleError(stalledPlayback)).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(onRefresh).toHaveBeenCalledTimes(2);

    rerender({ sourceRevision: 3 });
    expect(result.current.handleError(stalledPlayback)).toBe(false);
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  // Guards: leaving a channel or replacing its source must physically cancel a queued retry so stale playback cannot restart after navigation.
  it("cancels a pending refresh when its owner unmounts", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const { result, unmount } = renderHook(() =>
      useTwitchLiveRecovery({
        sessionKey: "multistream:s1:twitch:xqc",
        sourceRevision: 1,
        onRefresh,
        onExhausted: vi.fn(),
      })
    );

    expect(result.current.handleError(stalledPlayback)).toBe(true);
    unmount();
    await act(async () => vi.runAllTimersAsync());

    expect(onRefresh).not.toHaveBeenCalled();
  });

  // Guards: a failed URL refresh must not leave the player spinner waiting forever for a source revision that never arrives.
  it("exhausts the bounded budget when a refresh never produces a new source", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const onExhausted = vi.fn();
    const { result } = renderHook(() =>
      useTwitchLiveRecovery({
        sessionKey: "stream-page:twitch:xqc",
        sourceRevision: 1,
        onRefresh,
        onExhausted,
      })
    );

    expect(result.current.handleError(stalledPlayback)).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(9_500));

    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  // Guards: resolving another manifest is not proof of recovery; only a clean presented frame may replenish the automatic refresh budget.
  it("replenishes the budget only after playback reports a clean presented frame", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const onExhausted = vi.fn();
    const { result, rerender } = renderHook(
      ({ sourceRevision }) =>
        useTwitchLiveRecovery({
          sessionKey: "stream-page:twitch:xqc",
          sourceRevision,
          onRefresh,
          onExhausted,
        }),
      { initialProps: { sourceRevision: 1 } }
    );

    result.current.handleError(stalledPlayback);
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    rerender({ sourceRevision: 2 });
    result.current.handleError(stalledPlayback);
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    rerender({ sourceRevision: 3 });
    expect(result.current.handleError(stalledPlayback)).toBe(false);

    act(() => result.current.markPlaybackHealthy());
    expect(result.current.handleError(stalledPlayback)).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(onRefresh).toHaveBeenCalledTimes(3);
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });
});
