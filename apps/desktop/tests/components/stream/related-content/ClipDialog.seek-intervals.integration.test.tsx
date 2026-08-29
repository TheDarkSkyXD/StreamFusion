import { fireEvent, screen } from "@testing-library/react";
import React from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, routerMock } from "../../../test-utils";

import { ClipDialog } from "@/features/playback/components/related-content/ClipDialog";
import type { VideoOrClip } from "@/features/playback/components/related-content/types";
import { useHistoryStore } from "@/store/history-store";
import { useSeekIntervalStore } from "@/store/seek-interval-store";

vi.mock("@tanstack/react-router", () => routerMock());

vi.mock("@/features/playback/components/player/hls-player", () => ({
  HlsPlayer: React.forwardRef<
    HTMLVideoElement,
    React.VideoHTMLAttributes<HTMLVideoElement> & {
      currentLevel?: string;
      hlsConfig?: { pLoader?: unknown };
      onHlsInstance?: unknown;
      onQualityLevels?: unknown;
      sources?: Array<{ quality: string; url: string }>;
    }
  >(
    (
      {
        currentLevel: _currentLevel,
        hlsConfig,
        onHlsInstance: _onHlsInstance,
        onQualityLevels: _onQualityLevels,
        sources,
        ...props
      },
      ref
    ) => (
      <video
        ref={ref}
        data-testid="clip-media"
        data-source-count={sources?.length ?? 0}
        data-uses-kick-clip-loader={Boolean(hlsConfig?.pLoader).toString()}
        {...props}
      />
    )
  ),
}));

const twitchClip: VideoOrClip = {
  id: "twitch-clip-1",
  title: "Twitch clip",
  duration: "120",
  views: "10",
  date: "2026-01-01T00:00:00Z",
  thumbnailUrl: "https://example.test/twitch-clip.jpg",
  channelSlug: "twitch-channel",
  channelName: "Twitch Channel",
  platform: "twitch",
};

const kickClip: VideoOrClip = {
  id: "kick-clip-1",
  title: "Kick clip",
  duration: "120",
  views: "20",
  date: "2026-01-02T00:00:00Z",
  thumbnailUrl: "https://example.test/kick-clip.jpg",
  channelSlug: "kick-channel",
  channelName: "Kick Channel",
  platform: "kick",
};

function setMediaTimeline(video: HTMLVideoElement, currentTime: number, duration: number) {
  Object.defineProperty(video, "duration", { configurable: true, value: duration });
  video.currentTime = currentTime;
  fireEvent.durationChange(video);
  fireEvent.timeUpdate(video);
}

// Guards: Twitch clips must retain ClipDialog's real Twitch VOD player and its configured seek behavior.
// Guards: Kick clips must retain ClipDialog's real Kick VOD player and its configured seek behavior.
describe("ClipDialog seek intervals", () => {
  beforeAll(() => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  });

  beforeEach(() => {
    useHistoryStore.getState().clearHistory();
    useSeekIntervalStore.setState({ rewindSeconds: 7, forwardSeconds: 30 });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("rewinds a Twitch clip through the real Twitch VOD player", () => {
    renderWithProviders(
      <ClipDialog
        selectedClip={twitchClip}
        onClose={vi.fn()}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl="https://clips.twitch.tv/media/twitch-clip-1.m3u8"
        clipQualities={[
          { quality: "1080p", url: "https://clips.twitch.tv/media/twitch-clip-1-1080.m3u8" },
          { quality: "720p", url: "https://clips.twitch.tv/media/twitch-clip-1-720.m3u8" },
        ]}
        platform="twitch"
        channelName="twitch-channel"
        channelData={null}
        onPlaybackError={vi.fn()}
      />
    );

    const video = screen.getByTestId<HTMLVideoElement>("clip-media");
    expect(video).toHaveAttribute("data-source-count", "2");
    setMediaTimeline(video, 50, 120);

    fireEvent.click(screen.getByRole("button", { name: "Rewind 7 seconds" }));

    expect(video.currentTime).toBe(43);
    expect(screen.getByText("00:43 / 02:00")).toBeInTheDocument();
  });

  it("fast-forwards a Kick clip through the real Kick VOD player", () => {
    renderWithProviders(
      <ClipDialog
        selectedClip={kickClip}
        onClose={vi.fn()}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl="https://cdn.kick.com/clips/kick-clip-1/master.m3u8"
        platform="kick"
        channelName="kick-channel"
        channelData={null}
        onPlaybackError={vi.fn()}
      />
    );

    const video = screen.getByTestId<HTMLVideoElement>("clip-media");
    expect(video).toHaveAttribute("data-uses-kick-clip-loader", "true");
    setMediaTimeline(video, 50, 120);

    fireEvent.click(screen.getByRole("button", { name: "Fast forward 30 seconds" }));

    expect(video.currentTime).toBe(80);
    expect(screen.getByText("01:20 / 02:00")).toBeInTheDocument();
  });
});
