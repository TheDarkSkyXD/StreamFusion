import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => ({
  bind: vi.fn().mockResolvedValue(1),
  construct: vi.fn(),
  dispose: vi.fn().mockResolvedValue(undefined),
  setPresentation: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/features/playback/components/player/local-audio-capture", () => ({
  LocalAudioCaptureController: class {
    diagnostic = "worklet-test";
    constructor(options: unknown) {
      capture.construct(options);
    }
    bind = capture.bind;
    dispose = capture.dispose;
    setPresentation = capture.setPresentation;
    stop = capture.stop;
  },
}));

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn() },
}));

import { useLocalAudioCaptureProof } from "@/features/playback/components/player/hooks/use-local-audio-capture-proof";

// Guards: a refreshed playback URL for the same channel tears down and rebinds the dev capture tap.
describe("useLocalAudioCaptureProof", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rebinds when the player source changes even if the channel identity stays the same", async () => {
    const video = document.createElement("video");
    const videoRef = { current: video };
    const { rerender } = renderHook(
      ({ sourceKey }) =>
        useLocalAudioCaptureProof(videoRef, "twitch:talker", sourceKey, true, 0.38),
      { initialProps: { sourceKey: "manifest-a" } }
    );

    act(() => video.dispatchEvent(new Event("playing")));
    await waitFor(() => expect(capture.bind).toHaveBeenCalledWith(video, "twitch:talker"));

    rerender({ sourceKey: "manifest-b" });
    await waitFor(() => expect(capture.stop).toHaveBeenCalledOnce());
    act(() => video.dispatchEvent(new Event("playing")));

    await waitFor(() => expect(capture.bind).toHaveBeenCalledTimes(2));
  });

  it("updates mute and user volume presentation without rebinding the source", async () => {
    const video = document.createElement("video");
    const videoRef = { current: video };
    const { rerender } = renderHook(
      ({ muted, volume }) =>
        useLocalAudioCaptureProof(videoRef, "kick:talker", "manifest-a", muted, volume),
      { initialProps: { muted: true, volume: 0.38 } }
    );

    act(() => video.dispatchEvent(new Event("playing")));
    await waitFor(() => expect(capture.bind).toHaveBeenCalledOnce());
    expect(capture.construct).toHaveBeenCalledWith(
      expect.objectContaining({ initialPresentation: { muted: true, volume: 0.38 } })
    );

    capture.setPresentation.mockClear();
    rerender({ muted: false, volume: 0.38 });

    await waitFor(() => expect(capture.setPresentation).toHaveBeenCalledWith(false, 0.38));
    expect(capture.bind).toHaveBeenCalledOnce();
  });

  it("disposes the shared presentation hub only when the player hook unmounts", async () => {
    const video = document.createElement("video");
    const videoRef = { current: video };
    const { unmount } = renderHook(() =>
      useLocalAudioCaptureProof(videoRef, "twitch:talker", "manifest-a", true, 0.38)
    );

    act(() => video.dispatchEvent(new Event("playing")));
    await waitFor(() => expect(capture.bind).toHaveBeenCalledOnce());
    unmount();

    await waitFor(() => expect(capture.dispose).toHaveBeenCalledOnce());
  });
});
