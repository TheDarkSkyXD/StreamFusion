import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-video", () => {
  return {
    createVideoPlayer: vi.fn(() => ({
      play: vi.fn(),
      pause: vi.fn(),
      release: vi.fn(),
      addListener: vi.fn(),
      muted: false,
      volume: 1,
      loop: false,
      currentTime: 0,
    })),
  };
});

describe("createExpoHlsFocusedPlaybackPort", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("starts an Expo HLS session when Media3 is absent", async () => {
    const { createExpoHlsFocusedPlaybackPort } = await import(
      "../adapters/expo/expo-hls-focused-playback"
    );
    const port = createExpoHlsFocusedPlaybackPort();
    const started = await port.start({
      requestHeaders: { "Client-ID": "test" },
      sessionId: "session-1",
      sourceUri: "https://example.com/index.m3u8" as never,
    });
    expect(started.kind).toBe("started");
    if (started.kind === "started") {
      expect(started.session.sessionId).toBe("session-1");
    }
    const ended = await port.end("session-1");
    expect(ended.kind).toBe("ended");
  });
});