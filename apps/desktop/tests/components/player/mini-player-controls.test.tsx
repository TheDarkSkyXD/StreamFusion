import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen } from "../../test-utils";

const routerState = vi.hoisted(() => ({ pathname: "/following" }));
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: routerState.pathname }),
}));

vi.mock("@/hooks/useStreamPlayback", () => ({
  useStreamPlayback: () => ({
    playback: { url: "https://example.test/live.m3u8", format: "hls" },
    isLoading: false,
    error: null,
    reload: vi.fn(),
    reloadAttempts: 0,
  }),
}));

vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ recoveryCount: 0 }),
}));

vi.mock("@/components/player/kick", () => ({
  KickLivePlayer: () => <div data-testid="hls-player" />,
}));

vi.mock("@/components/player/twitch", () => ({
  TwitchLivePlayer: () => <div data-testid="twitch-hls-player" />,
}));

vi.mock("@/components/player/hooks/use-volume", () => ({
  useVolume: () => ({
    isMuted: false,
    handleToggleMute: vi.fn(),
    syncFromVideoElement: vi.fn(),
    volume: 50,
    handleVolumeChange: vi.fn(),
  }),
}));

import { MiniPlayer } from "@/components/player/mini-player";
import { usePipStore } from "@/store/pip-store";

// Guards: mini-player overlay and media buttons retain a pointer affordance without changing main-player controls.
describe("MiniPlayer control cursors", () => {
  beforeEach(() => {
    routerState.pathname = "/following";
    usePipStore.setState({
      currentStream: {
        platform: "kick",
        channelName: "xqc",
        channelDisplayName: "xQc",
        streamUrl: "https://example.test/live.m3u8",
      },
      isPipActive: true,
      isOnStreamPage: false,
    });
  });

  it("uses pointer treatment for every mini-player button", () => {
    renderWithProviders(<MiniPlayer />);

    const buttons = screen.getAllByRole("button");

    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button).toHaveClass("cursor-pointer");
      expect(button).toHaveClass("disabled:cursor-not-allowed");
    }
  });
});
