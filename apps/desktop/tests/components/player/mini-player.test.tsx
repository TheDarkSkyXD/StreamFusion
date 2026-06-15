import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, renderWithProviders, screen } from "../../test-utils";

const routerState = vi.hoisted(() => ({
  pathname: "/",
}));
const mockNavigate = vi.hoisted(() => vi.fn());

const streamPlaybackMock = vi.hoisted(() => ({
  useStreamPlayback: vi.fn(() => ({
    playback: null,
    reload: vi.fn(),
    reloadAttempts: 0,
  })),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: routerState.pathname }),
}));

vi.mock("@/hooks/useStreamPlayback", () => streamPlaybackMock);

vi.mock("@/components/player/hls-player", () => ({
  HlsPlayer: () => <div data-testid="hls-player" />,
}));

vi.mock("@/components/player/twitch/twitch-hls-player", () => ({
  TwitchHlsPlayer: () => <div data-testid="twitch-hls-player" />,
}));

vi.mock("@/components/player/hooks/use-volume", () => ({
  useVolume: () => ({
    isMuted: true,
    handleToggleMute: vi.fn(),
    syncFromVideoElement: vi.fn(),
    volume: 50,
    handleVolumeChange: vi.fn(),
  }),
}));

import { MiniPlayer } from "@/components/player/mini-player";
import { usePipStore } from "@/store/pip-store";

function primePipStore() {
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
}

// Guards: mini-player must synchronously idle on /stream routes so the main player does not share startup with a duplicate playback subscriber.
describe("MiniPlayer playback routing", () => {
  beforeEach(() => {
    routerState.pathname = "/";
    streamPlaybackMock.useStreamPlayback.mockClear();
    mockNavigate.mockClear();
    usePipStore.setState({
      currentStream: null,
      isPipActive: false,
      isOnStreamPage: false,
    });
  });

  it("does not fetch playback or render while already on a stream route", () => {
    routerState.pathname = "/stream/kick/xqc";
    primePipStore();

    renderWithProviders(<MiniPlayer />);

    expect(streamPlaybackMock.useStreamPlayback).toHaveBeenCalledWith("kick", "");
    expect(screen.queryByTestId("hls-player")).not.toBeInTheDocument();
  });

  it("fetches playback and renders when the user leaves the stream route", () => {
    routerState.pathname = "/following";
    primePipStore();

    renderWithProviders(<MiniPlayer />);

    expect(streamPlaybackMock.useStreamPlayback).toHaveBeenCalledWith("kick", "xqc");
    expect(screen.getByTestId("hls-player")).toBeInTheDocument();
  });

  it("expands back to the stream Home tab", () => {
    routerState.pathname = "/following";
    primePipStore();

    renderWithProviders(<MiniPlayer />);
    fireEvent.click(screen.getAllByRole("button")[0]);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/stream/$platform/$channel",
      params: { platform: "kick", channel: "xqc" },
      search: { tab: "home" },
    });
  });
});
