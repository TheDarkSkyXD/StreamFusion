import { render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  instances: [] as Array<{
    destroy: ReturnType<typeof vi.fn>;
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
    detachMedia: ReturnType<typeof vi.fn>;
    emit: (event: string, data: unknown) => void;
  }>,
}));

vi.mock("hls.js", () => {
  class FakeHls {
    static isSupported() {
      return true;
    }
    static Events = {
      MANIFEST_PARSED: "hlsManifestParsed",
      LEVEL_SWITCHED: "hlsLevelSwitched",
      ERROR: "hlsError",
      MEDIA_ATTACHED: "hlsMediaAttached",
      FRAG_LOADED: "hlsFragLoaded",
    };
    static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };
    static ErrorDetails = { MANIFEST_LOAD_ERROR: "manifestLoadError" };
    listeners = new Map<string, Array<(event: string, data: unknown) => void>>();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    detachMedia = vi.fn();
    on = vi.fn((event: string, callback: (event: string, data: unknown) => void) => {
      const callbacks = this.listeners.get(event) ?? [];
      callbacks.push(callback);
      this.listeners.set(event, callbacks);
    });
    off = vi.fn((event: string) => {
      this.listeners.delete(event);
    });
    destroy = vi.fn();
    startLoad = vi.fn();
    stopLoad = vi.fn();
    recoverMediaError = vi.fn();
    levels = [];
    constructor() {
      h.instances.push(this);
    }
    emit(event: string, data: unknown) {
      for (const callback of this.listeners.get(event) ?? []) {
        callback(event, data);
      }
    }
  }
  return { default: FakeHls };
});

import { HlsPlayer } from "@/features/playback/components/player/hls-player";

// Guards: mount path — HlsPlayer ALWAYS mounts the <video> element so the layout is reserved before HLS init resolves; the parent's loading overlay sits on top until canplay fires
// Guards: error recovery contract — onError is invoked with PlayerError shape for NETWORK_ERROR / MEDIA_ERROR / NO_FRAGMENTS / STREAM_OFFLINE. Recovery sequence: nudge → startLoad → recoverMediaError → fatal shouldRefresh. The SUT's recovery logic owns this; tests/components/player/hls-player-stall-watchdog.test.tsx covers the stall-watchdog branch
// Note: full error-path coverage lives in hls-player-stall-watchdog.test.tsx + the player-controls test files. This file locks the video-element mount contract — the rest is delegated.
// Guards: callback prop changes do not reinitialize Twitch VOD HLS during startup and interrupt first-fragment loading
// Guards: VOD cleanup destroys HLS instead of reusing a half-started archive instance across effect setup cycles
// Guards: Twitch VOD autoplay recovery retries muted when Chromium blocks audible autoplay, so VODs do not sit forever on the loading spinner after playlists resolve
describe("HlsPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mount: always mounts the video element so the layout reserves space while HLS init resolves", () => {
    const { container } = render(<HlsPlayer src="https://x.test/playlist.m3u8" />);
    expect(container.querySelector("video")).toBeInTheDocument();
  });

  it("live Kick CDN manifest 404 asks the caller to refresh the playback URL", () => {
    const onError = vi.fn();
    render(
      <HlsPlayer
        src="https://fa723fc1b171.us-west-2.playback.live-video.net/api/video/v1/us-west-2/live.m3u8"
        isLive
        onError={onError}
      />
    );

    act(() => {
      h.instances[0].emit("hlsError", {
        details: "manifestLoadError",
        fatal: true,
        response: { code: 404, text: "Not Found" },
        type: "networkError",
        url: "https://fa723fc1b171.us-west-2.playback.live-video.net/api/video/v1/us-west-2/live.m3u8",
      });
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "STREAM_OFFLINE",
        fatal: true,
        shouldRefresh: true,
      })
    );
    expect(h.instances[0].destroy).toHaveBeenCalled();
  });

  it("non-Kick manifest 404 remains a confirmed offline signal", () => {
    const onError = vi.fn();
    render(
      <HlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/ninja.m3u8"
        isLive
        onError={onError}
      />
    );

    act(() => {
      h.instances[0].emit("hlsError", {
        details: "manifestLoadError",
        fatal: true,
        response: { code: 404, text: "Not Found" },
        type: "networkError",
        url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8",
      });
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "STREAM_OFFLINE",
        fatal: true,
        shouldRefresh: false,
      })
    );
  });

  it("live: tolerates a short gap between fragments without refreshing", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { container } = render(
      <HlsPlayer src="https://x.test/playlist.m3u8" isLive onError={onError} />
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;

    Object.defineProperty(video, "paused", { value: false, configurable: true });

    act(() => {
      h.instances[0].emit("hlsManifestParsed", { levels: [] });
      h.instances[0].emit("hlsFragLoaded", {});
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onError).not.toHaveBeenCalled();
    expect(h.instances[0].destroy).not.toHaveBeenCalled();
  });

  it("live Kick source: requests a fresh playback URL after the fragment watchdog expires", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { container } = render(
      <HlsPlayer
        src="https://fa723fc1b171.us-west-2.playback.live-video.net/api/video/v1/us-west-2/live.m3u8"
        isLive
        onError={onError}
      />
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;

    Object.defineProperty(video, "paused", { value: false, configurable: true });

    act(() => {
      h.instances[0].emit("hlsManifestParsed", { levels: [] });
      h.instances[0].emit("hlsFragLoaded", {});
    });

    act(() => {
      vi.advanceTimersByTime(19999);
    });
    expect(onError).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "STREAM_OFFLINE",
        fatal: true,
        shouldRefresh: true,
      })
    );
    expect(h.instances[0].destroy).toHaveBeenCalled();
  });

  it("vod: does not run live offline detection while waiting for fragments", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { container } = render(<HlsPlayer src="https://x.test/vod.m3u8" onError={onError} />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;

    Object.defineProperty(video, "paused", { value: false, configurable: true });

    act(() => {
      h.instances[0].emit("hlsManifestParsed", { levels: [] });
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onError).not.toHaveBeenCalled();
    expect(h.instances[0].destroy).not.toHaveBeenCalled();
  });

  it("vod: does not reinitialize HLS when callback props change during startup", () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const { rerender } = render(
      <HlsPlayer src="https://usher.ttvnw.net/vod/123.m3u8" onHlsInstance={firstCallback} />
    );

    rerender(
      <HlsPlayer src="https://usher.ttvnw.net/vod/123.m3u8" onHlsInstance={secondCallback} />
    );

    expect(h.instances).toHaveLength(1);
    expect(h.instances[0].loadSource).toHaveBeenCalledTimes(1);
    expect(h.instances[0].attachMedia).toHaveBeenCalledTimes(1);
    expect(h.instances[0].detachMedia).not.toHaveBeenCalled();
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).not.toHaveBeenCalled();
  });

  it("vod: destroys the current HLS instance on cleanup instead of reusing it", () => {
    const { rerender } = render(
      <HlsPlayer src="https://usher.ttvnw.net/vod/123.m3u8" autoPlay={false} />
    );
    const firstInstance = h.instances[0];

    rerender(<HlsPlayer src="https://usher.ttvnw.net/vod/123.m3u8" autoPlay />);

    expect(firstInstance.destroy).toHaveBeenCalled();
    expect(h.instances).toHaveLength(2);
    expect(h.instances[1].loadSource).toHaveBeenCalledWith("https://usher.ttvnw.net/vod/123.m3u8");
  });

  it("vod: leaves transient fragment load errors to HLS.js retries", () => {
    const onError = vi.fn();
    render(<HlsPlayer src="https://stream.kick.com/archive/playlist.m3u8" onError={onError} />);

    act(() => {
      for (let i = 0; i < 3; i++) {
        h.instances[0].emit("hlsError", {
          details: "fragLoadError",
          fatal: false,
          type: "networkError",
        });
      }
    });

    expect(onError).not.toHaveBeenCalled();
    expect(h.instances[0].destroy).not.toHaveBeenCalled();
  });

  it("vod: retries autoplay muted when Chromium blocks audible autoplay", async () => {
    vi.useFakeTimers();
    const blocked = Object.assign(new Error("Autoplay blocked"), { name: "NotAllowedError" });
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValueOnce(blocked)
      .mockResolvedValue(undefined);

    const { container } = render(<HlsPlayer src="https://usher.ttvnw.net/vod/123.m3u8" autoPlay />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;

    act(() => {
      h.instances[0].emit("hlsManifestParsed", { levels: [] });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(video.muted).toBe(true);
    expect(playSpy).toHaveBeenCalledTimes(2);
  });
});
