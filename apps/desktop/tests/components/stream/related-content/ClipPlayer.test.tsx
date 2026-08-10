import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClipPlayer } from "@/components/stream/related-content/ClipPlayer";

const log = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/renderer/logging/logger", () => ({ logger: log }));

// Mock HLS.js
const mockHlsLoadSource = vi.fn();
const mockHlsAttachMedia = vi.fn();
const mockHlsOn = vi.fn();
const mockHlsDestroy = vi.fn();
const mockHlsConstructorConfigs: unknown[] = [];

vi.mock("hls.js", () => {
  return {
    default: class MockHls {
      static isSupported = vi.fn(() => true);
      static Events = {
        MANIFEST_PARSED: "hlsManifestParsed",
        ERROR: "hlsError",
      };
      static ErrorTypes = {
        NETWORK_ERROR: "networkError",
        MEDIA_ERROR: "mediaError",
      };
      loadSource = mockHlsLoadSource;
      attachMedia = mockHlsAttachMedia;
      on = mockHlsOn;
      destroy = mockHlsDestroy;
      recoverMediaError = vi.fn();

      constructor(config?: unknown) {
        mockHlsConstructorConfigs.push(config);
      }
    },
  };
});

// Mock hooks and utils
vi.mock("@/store/volume-store", () => ({
  useVolumeStore: () => ({
    volume: 50,
    isMuted: false,
    setVolume: vi.fn(),
    setMuted: vi.fn(),
  }),
}));

vi.mock("@/lib/utils", () => ({
  formatDuration: (seconds: number) => `${seconds}s`,
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  TwitchLoadingSpinner: () => <div data-testid="loading-spinner">Loading...</div>,
}));

describe("ClipPlayer", () => {
  // Guards: clip dialog HLS playback must use the stable VOD buffer profile so short Twitch/Kick clips do not rebuffer from low-latency defaults.
  // Guards: changing or closing a native clip must detach its media listeners so an abandoned source cannot update the next player session.
  // Guards: clip diagnostics must never serialize signed source URLs or their query credentials.
  beforeEach(() => {
    vi.clearAllMocks();
    mockHlsConstructorConfigs.length = 0;
  });

  afterEach(() => vi.restoreAllMocks());

  it("should initialize HLS for m3u8 streams", () => {
    render(<ClipPlayer src="http://example.com/video.m3u8" autoPlay={false} />);
    expect(mockHlsLoadSource).toHaveBeenCalledWith("http://example.com/video.m3u8");
  });

  it("should use the stable VOD/clip HLS buffering profile for m3u8 streams", () => {
    render(<ClipPlayer src="http://example.com/video.m3u8" autoPlay={false} />);

    expect(mockHlsConstructorConfigs[0]).toEqual(
      expect.objectContaining({
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 40_000_000,
        manifestLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 6,
      })
    );
  });

  it("should show loading spinner initially", () => {
    render(<ClipPlayer src="http://example.com/video.m3u8" />);
    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
  });

  it("should render video element for typical sources", () => {
    const { container } = render(<ClipPlayer src="http://example.com/video.mp4" />);
    const video = container.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute("src", "http://example.com/video.mp4");
  });

  it("does not include the source URL in diagnostics", () => {
    render(<ClipPlayer src="https://cdn.invalid/video.mp4?token=SENTINEL_CLIP_SECRET" />);

    expect(JSON.stringify(log.debug.mock.calls)).not.toContain("SENTINEL_CLIP_SECRET");
    expect(log.debug).toHaveBeenCalledWith(
      "Stream:ClipPlayer",
      "loading source",
      expect.objectContaining({ sourceType: "native" })
    );
  });

  it("removes native media listeners when the player unmounts", () => {
    const addListener = vi.spyOn(HTMLMediaElement.prototype, "addEventListener");
    const removeListener = vi.spyOn(HTMLMediaElement.prototype, "removeEventListener");
    const { unmount } = render(<ClipPlayer src="http://example.com/video.mp4" />);

    const loadedMetadataHandler = addListener.mock.calls
      .filter(([eventName]) => eventName === "loadedmetadata")
      .at(-1)?.[1];
    const errorHandler = addListener.mock.calls.filter(([eventName]) => eventName === "error").at(-1)?.[1];
    expect(loadedMetadataHandler).toBeTypeOf("function");
    expect(errorHandler).toBeTypeOf("function");

    unmount();

    expect(removeListener).toHaveBeenCalledWith("loadedmetadata", loadedMetadataHandler);
    expect(removeListener).toHaveBeenCalledWith("error", errorHandler);
  });

  it("should toggle play/pause on click", () => {
    const { container } = render(<ClipPlayer src="http://example.com/video.mp4" />);
    const video = container.querySelector("video") as HTMLVideoElement;

    // Mock play/pause methods
    video.play = vi.fn().mockResolvedValue(undefined);
    video.pause = vi.fn();
    Object.defineProperty(video, "paused", { value: true, writable: true });

    // Click wrapper to toggle play
    const wrapper = container.firstChild as Element;
    fireEvent.click(wrapper);
    expect(video.play).toHaveBeenCalled();

    // Simulate playing state
    Object.defineProperty(video, "paused", { value: false });
    fireEvent.click(wrapper);
    expect(video.pause).toHaveBeenCalled();
  });

  it("should handle volume controls", () => {
    render(<ClipPlayer src="http://example.com/video.mp4" />);

    // Find volume mute toggle using icon class logic (Volume2 is default for 50%)
    // We can query by the button that contains the volume icon
    // Since we can't easily query by icon match, we'll assume it's the second button in default controls (Play is first)
    // A better way is to find by generic role 'button' and filter or looking for specific accessibility text if added.
    // Looking at code: toggleMute is the button wrapping getVolumeIcon

    // Let's assume the volume button is present.
    // We can look for the volume slider input or interactions.
    // Code has a custom volume slider, not a native input[type=range] for volume, but a div.

    // Let's check if video volume is set from store
    const { container } = render(<ClipPlayer src="http://example.com/video.mp4" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.volume).toBe(0.5); // 50 / 100
  });
});
