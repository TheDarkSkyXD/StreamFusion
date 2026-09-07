import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleSeekHover: vi.fn(),
  useSeekPreview: vi.fn(),
}));
mocks.useSeekPreview.mockReturnValue({
  previewImage: "data:image/jpeg;base64,actual-frame",
  handleSeekHover: mocks.handleSeekHover,
});

vi.mock("@/features/playback/components/player/hooks/use-seek-preview", () => ({
  useSeekPreview: mocks.useSeekPreview,
}));
vi.mock("@/features/playback/components/player/hooks/use-default-quality", () => ({
  useDefaultQuality: vi.fn(),
}));
vi.mock("@/features/playback/components/player/hooks/use-fullscreen", () => ({
  useFullscreen: () => ({ isFullscreen: false, toggleFullscreen: vi.fn() }),
}));
vi.mock("@/features/playback/components/player/hooks/use-picture-in-picture", () => ({
  usePictureInPicture: () => ({ isPip: false, togglePip: vi.fn() }),
}));
vi.mock("@/features/playback/components/player/hooks/use-player-keyboard", () => ({
  usePlayerKeyboard: vi.fn(),
}));
vi.mock("@/features/playback/components/player/hooks/use-resume-playback", () => ({
  useResumePlayback: vi.fn(),
}));
vi.mock("@/features/playback/components/player/hooks/use-volume", () => ({
  useVolume: () => ({
    volume: 50,
    isMuted: false,
    handleVolumeChange: vi.fn(),
    handleToggleMute: vi.fn(),
    syncFromVideoElement: vi.fn(),
  }),
}));

vi.mock("@/features/playback/components/player/hls-player", async () => {
  const { forwardRef } = await import("react");
  return { HlsPlayer: forwardRef<HTMLVideoElement>((_props, ref) => <video ref={ref} />) };
});

vi.mock("@/features/playback/components/player/player-controls", async () => {
  const { createElement } = await import("react");
  return {
    PlayerControls: (props: {
      previewImage?: string;
      onSeekHover?: (time: number | null) => void;
    }) =>
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "preview-controls",
          "data-preview-image": props.previewImage,
          onClick: () => props.onSeekHover?.(12),
        },
        "preview"
      ),
  };
});
vi.mock("@/features/playback/components/player/kick/kick-player-controls", async () => {
  const { createElement } = await import("react");
  return {
    KickPlayerControls: (props: {
      previewImage?: string;
      onSeekHover?: (time: number | null) => void;
    }) =>
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "preview-controls",
          "data-preview-image": props.previewImage,
          onClick: () => props.onSeekHover?.(12),
        },
        "preview"
      ),
  };
});
vi.mock("@/features/playback/components/player/twitch/twitch-player-controls", async () => {
  const { createElement } = await import("react");
  return {
    TwitchPlayerControls: (props: {
      previewImage?: string;
      onSeekHover?: (time: number | null) => void;
    }) =>
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "preview-controls",
          "data-preview-image": props.previewImage,
          onClick: () => props.onSeekHover?.(12),
        },
        "preview"
      ),
  };
});

import { KickVideoPlayer } from "@/features/playback/components/player/kick/kick-video-player";
import { TwitchVideoPlayer } from "@/features/playback/components/player/twitch/twitch-video-player";
import { VideoPlayer } from "@/features/playback/components/player/video-player";

// Guards: clip players must show frames decoded for the hovered second instead of channel avatars/posters
describe("platform clip seek previews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["generic", <VideoPlayer key="generic" platform="kick" streamUrl="clip.mp4" />],
    ["kick", <KickVideoPlayer key="kick" streamUrl="clip.mp4" />],
    ["twitch", <TwitchVideoPlayer key="twitch" streamUrl="clip.mp4" />],
  ])("wires the real-frame preview hook into the %s clip player", (_name, player) => {
    render(player);

    expect(mocks.useSeekPreview).toHaveBeenCalledWith({ streamUrl: "clip.mp4" });
    expect(screen.getByTestId("preview-controls")).toHaveAttribute(
      "data-preview-image",
      "data:image/jpeg;base64,actual-frame"
    );

    screen.getByTestId("preview-controls").click();
    expect(mocks.handleSeekHover).toHaveBeenCalledWith(12);
  });
});
