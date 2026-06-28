import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guards: HlsPlayer reuses the same live HLS instance across `src` prop changes
 * within a single mount lifetime. Channel-hopping inside a slot should not
 * destroy + re-create the decoder. Hls.destroy() runs ONLY on unmount.
 *
 * Slice 09 of the renderer-OOM PRD (#51, issue #60). The sequence on src
 * change is detachMedia() -> loadSource(newUrl) -> attachMedia(video), per
 * the HLS.js docs for live source swaps.
 * Guards: Quality selection changes must not reload the same HLS source during startup.
 * Guards: VOD/clip playback uses a stability-first HLS config instead of the low-latency live config.
 * Guards: HLS listeners are registered before source loading starts so cached VOD manifests cannot fire readiness events before the player hears them.
 */

const fakeHlsModule = vi.hoisted(() => {
  const instances: FakeHls[] = [];

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
      BUFFER_FLUSHING: "hlsBufferFlushing",
    };
    static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };
    static ErrorDetails = { MANIFEST_LOAD_ERROR: "manifestLoadError" };

    loadSource = vi.fn();
    attachMedia = vi.fn();
    detachMedia = vi.fn();
    on = vi.fn();
    off = vi.fn();
    destroy = vi.fn();
    startLoad = vi.fn();
    stopLoad = vi.fn();
    recoverMediaError = vi.fn();
    trigger = vi.fn();
    levels: unknown[] = [];
    config = { backBufferLength: 30 };
    constructorConfig: Record<string, unknown> | undefined;
    currentLevel = -1;
    startLevel = -1;

    constructor(config?: Record<string, unknown>) {
      this.constructorConfig = config;
      instances.push(this);
    }
  }

  return {
    FakeHls,
    instances,
    reset: () => {
      instances.length = 0;
    },
  };
});

type FakeHlsInstance = InstanceType<typeof fakeHlsModule.FakeHls>;

vi.mock("hls.js", () => ({ default: fakeHlsModule.FakeHls }));

vi.mock("@/components/player/kick/kick-clip-loader", () => ({
  createKickClipPlaylistLoader: () => function TestKickClipPlaylistLoader() {},
  isKickClipPlaylistUrl: (url: string) => url.includes("/clips/"),
}));

import { HlsPlayer } from "@/components/player/hls-player";
import { KickHlsPlayer } from "@/components/player/kick/kick-hls-player";

beforeEach(() => {
  fakeHlsModule.reset();
  vi.clearAllMocks();
});

describe("HlsPlayer source reuse (slice 09)", () => {
  it("constructs HLS exactly once on initial mount", () => {
    render(<HlsPlayer src="https://x.test/a.m3u8" />);
    expect(fakeHlsModule.instances).toHaveLength(1);
    const hls = fakeHlsModule.instances[0] as FakeHlsInstance;
    expect(hls.loadSource).toHaveBeenCalledWith("https://x.test/a.m3u8");
    expect(hls.attachMedia).toHaveBeenCalledTimes(1);
  });

  it("registers HLS listeners before starting the source load", () => {
    render(<HlsPlayer src="https://x.test/a.m3u8" />);
    const hls = fakeHlsModule.instances[0] as FakeHlsInstance;
    const manifestRegistration = hls.on.mock.calls.find(
      ([event]) => event === fakeHlsModule.FakeHls.Events.MANIFEST_PARSED
    );

    expect(manifestRegistration).toBeDefined();
    expect(hls.on.mock.invocationCallOrder[0]).toBeLessThan(
      hls.loadSource.mock.invocationCallOrder[0]
    );
  });

  it("reuses the same live HLS instance when src changes (detach -> loadSource -> attach), no destroy", () => {
    const { rerender } = render(<HlsPlayer src="https://x.test/a.m3u8" isLive />);
    const initial = fakeHlsModule.instances[0] as FakeHlsInstance;

    rerender(<HlsPlayer src="https://x.test/b.m3u8" isLive />);

    // Same instance — no new construction.
    expect(fakeHlsModule.instances).toHaveLength(1);
    expect(fakeHlsModule.instances[0]).toBe(initial);

    // Reuse sequence happened on the existing instance.
    expect(initial.detachMedia).toHaveBeenCalledTimes(1);
    expect(initial.loadSource).toHaveBeenCalledWith("https://x.test/b.m3u8");
    expect(initial.attachMedia).toHaveBeenCalledTimes(2);

    // Destroy must NOT have fired on the src change.
    expect(initial.destroy).not.toHaveBeenCalled();
  });

  it("does not reload the source when only currentLevel changes", () => {
    const { rerender } = render(<HlsPlayer src="https://x.test/a.m3u8" currentLevel="auto" />);
    const hls = fakeHlsModule.instances[0] as FakeHlsInstance;
    hls.levels = [{}];
    expect(hls.loadSource).toHaveBeenCalledTimes(1);

    rerender(<HlsPlayer src="https://x.test/a.m3u8" currentLevel="0" />);

    expect(fakeHlsModule.instances).toHaveLength(1);
    expect(hls.detachMedia).not.toHaveBeenCalled();
    expect(hls.loadSource).toHaveBeenCalledTimes(1);
    expect(hls.attachMedia).toHaveBeenCalledTimes(1);
    expect(hls.currentLevel).toBe(0);
  });

  it("destroys the HLS instance on unmount", () => {
    const { unmount } = render(<HlsPlayer src="https://x.test/a.m3u8" />);
    const hls = fakeHlsModule.instances[0] as FakeHlsInstance;
    expect(hls.destroy).not.toHaveBeenCalled();

    unmount();

    expect(hls.destroy).toHaveBeenCalledTimes(1);
  });

  it("uses the stable VOD/clip buffering profile for non-live HLS sources", () => {
    render(<HlsPlayer src="https://x.test/clip.m3u8" />);
    const hls = fakeHlsModule.instances[0] as FakeHlsInstance;

    expect(hls.constructorConfig).toEqual(
      expect.objectContaining({
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        manifestLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 6,
      })
    );
  });

  it("merges adapter-provided HLS config into the root engine config", () => {
    const TestPlaylistLoader = function TestPlaylistLoader() {};

    render(
      <HlsPlayer
        src="https://x.test/clip.m3u8"
        hlsConfig={{ pLoader: TestPlaylistLoader as never }}
      />
    );
    const hls = fakeHlsModule.instances[0] as FakeHlsInstance;

    expect(hls.constructorConfig).toEqual(
      expect.objectContaining({
        pLoader: TestPlaylistLoader,
      })
    );
  });

  it("keeps Kick clip playlist loader wiring in the Kick HLS adapter", () => {
    render(<KickHlsPlayer src="https://stream.kick.com/clips/example/playlist.m3u8" />);
    const hls = fakeHlsModule.instances[0] as FakeHlsInstance;

    expect(hls.constructorConfig?.pLoader).toEqual(expect.any(Function));
  });

  it("uses the stability-first live buffering defaults for live HLS sources", () => {
    render(<HlsPlayer src="https://x.test/live.m3u8" isLive />);
    const hls = fakeHlsModule.instances[0] as FakeHlsInstance;

    expect(hls.constructorConfig).toEqual(
      expect.objectContaining({
        lowLatencyMode: false,
        liveSyncDurationCount: 4,
        backBufferLength: 5,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        manifestLoadingMaxRetry: 1,
        fragLoadingMaxRetry: 4,
      })
    );
  });

  it("stops live HLS loading while paused and resumes at the live edge on play", () => {
    const { container } = render(<HlsPlayer src="https://x.test/live.m3u8" isLive />);
    const hls = fakeHlsModule.instances[0] as FakeHlsInstance;
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;

    video.dispatchEvent(new Event("pause"));
    expect(hls.stopLoad).toHaveBeenCalledTimes(1);

    video.dispatchEvent(new Event("play"));
    expect(hls.startLoad).toHaveBeenCalledWith(-1);
  });

  it("periodically flushes live media older than the configured back buffer", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<HlsPlayer src="https://x.test/live.m3u8" isLive />);
      const hls = fakeHlsModule.instances[0] as FakeHlsInstance;
      const video = container.querySelector("video");
      expect(video).not.toBeNull();
      if (!video) return;
      video.currentTime = 42;

      const manifestHandlers = hls.on.mock.calls
        .filter(([event]) => event === fakeHlsModule.FakeHls.Events.MANIFEST_PARSED)
        .map(([, handler]) => handler as (event: string, data: { levels: unknown[] }) => void);
      act(() => {
        for (const handler of manifestHandlers) {
          handler(fakeHlsModule.FakeHls.Events.MANIFEST_PARSED, { levels: [] });
        }
      });

      act(() => {
        vi.advanceTimersByTime(60 * 1000);
      });

      expect(hls.trigger).toHaveBeenCalledWith("hlsBufferFlushing", {
        startOffset: 0,
        endOffset: 37,
        endOffsetSubtitles: 37,
        type: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
