import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { useShareAction } from "@/hooks/use-share-action";

// Guards: playable public links copy as plain URLs and visibly confirm success for exactly two seconds
// Guards: current channel-scoped Kick clip links are accepted as public content links
// Guards: clipboard failures remain retryable and surface the approved error message
// Guards: switching content resets Copied immediately and cancels the previous content's timer
describe("useShareAction", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies the public link and resets Copied after two seconds", async () => {
    writeText.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useShareAction({
        shareUrl: "https://clips.twitch.tv/Ace",
        isPlaybackReady: true,
        contentLabel: "Clip",
      })
    );

    await act(async () => result.current.share());

    expect(writeText).toHaveBeenCalledWith("https://clips.twitch.tv/Ace");
    expect(result.current.copied).toBe(true);
    expect(toastSuccess).toHaveBeenCalledWith("Link copied");

    act(() => vi.advanceTimersByTime(1_999));
    expect(result.current.copied).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.copied).toBe(false);
  });

  it("rejects playback and non-content URLs even when playback is ready", async () => {
    const { result } = renderHook(() =>
      useShareAction({
        shareUrl: "https://video.example/signed-playback.m3u8",
        isPlaybackReady: true,
        contentLabel: "Video",
      })
    );

    expect(result.current.canShare).toBe(false);
    await act(async () => result.current.share());
    expect(writeText).not.toHaveBeenCalled();
  });

  it("accepts the current channel-scoped Kick clip URL", async () => {
    writeText.mockResolvedValue(undefined);
    const shareUrl = "https://kick.com/streamer/clips/clip_01KYSZT17PEK9PQJ1PGD3XMVNX";
    const { result } = renderHook(() =>
      useShareAction({
        shareUrl,
        isPlaybackReady: true,
        contentLabel: "Clip",
      })
    );

    expect(result.current.canShare).toBe(true);
    await act(async () => result.current.share());
    expect(writeText).toHaveBeenCalledWith(shareUrl);
  });

  it("resets Copied and its timer when the public link changes", async () => {
    writeText.mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ shareUrl }) =>
        useShareAction({
          shareUrl,
          isPlaybackReady: true,
          contentLabel: "Clip",
        }),
      { initialProps: { shareUrl: "https://clips.twitch.tv/First" } }
    );

    await act(async () => result.current.share());
    expect(result.current.copied).toBe(true);
    act(() => vi.advanceTimersByTime(1_000));

    rerender({ shareUrl: "https://clips.twitch.tv/Second" });
    expect(result.current.copied).toBe(false);

    await act(async () => result.current.share());
    expect(result.current.copied).toBe(true);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.copied).toBe(true);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.copied).toBe(false);
  });

  it("keeps sharing retryable when the clipboard rejects", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const { result } = renderHook(() =>
      useShareAction({
        shareUrl: "https://kick.com/video/public-slug",
        isPlaybackReady: true,
        contentLabel: "Video",
      })
    );

    await act(async () => result.current.share());

    expect(result.current.canShare).toBe(true);
    expect(result.current.copied).toBe(false);
    expect(toastError).toHaveBeenCalledWith("Couldn’t copy link. Try again.");
  });
});
