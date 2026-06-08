import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guards: HlsPlayer reuses the same HLS instance across `src` prop changes
 * within a single mount lifetime. Channel-hopping inside a slot should not
 * destroy + re-create the decoder. Hls.destroy() runs ONLY on unmount.
 *
 * Slice 09 of the renderer-OOM PRD (#51, issue #60). The sequence on src
 * change is detachMedia() -> loadSource(newUrl) -> attachMedia(video), per
 * the HLS.js docs for live source swaps.
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
    levels: unknown[] = [];
    config = { backBufferLength: 30 };
    currentLevel = -1;
    startLevel = -1;

    constructor() {
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

import { HlsPlayer } from "@/components/player/hls-player";

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

  it("reuses the same HLS instance when src changes (detach -> loadSource -> attach), no destroy", () => {
    const { rerender } = render(<HlsPlayer src="https://x.test/a.m3u8" />);
    const initial = fakeHlsModule.instances[0] as FakeHlsInstance;

    rerender(<HlsPlayer src="https://x.test/b.m3u8" />);

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

  it("destroys the HLS instance on unmount", () => {
    const { unmount } = render(<HlsPlayer src="https://x.test/a.m3u8" />);
    const hls = fakeHlsModule.instances[0] as FakeHlsInstance;
    expect(hls.destroy).not.toHaveBeenCalled();

    unmount();

    expect(hls.destroy).toHaveBeenCalledTimes(1);
  });
});
