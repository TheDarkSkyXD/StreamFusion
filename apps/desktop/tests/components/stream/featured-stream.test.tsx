import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOME_CAROUSEL_INTERVAL_DEFAULT_MS, useAppStore } from "@/store/app-store";
import { useVolumeStore } from "@/store/volume-store";

import { fireEvent, fixtures, renderWithProviders, routerMock, screen } from "../../test-utils";

const mocks = vi.hoisted(() => ({
  useStreamPlayback: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => routerMock());

vi.mock("@/components/ui/proxied-image", () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div data-testid="featured-img">{alt}</div>,
}));

vi.mock("@/hooks/useStreamPlayback", () => ({
  useStreamPlayback: mocks.useStreamPlayback,
}));

vi.mock("@/store/adblock-store", () => ({
  useAdBlockStore: (selector: (state: { enableAdBlock: boolean }) => boolean) =>
    selector({ enableAdBlock: true }),
}));

vi.mock("@/components/player/hls-player", () => ({
  HlsPlayer: ({
    src,
    autoPlay,
    muted,
    volume,
    preferredQuality,
    onError,
  }: {
    src: string;
    autoPlay?: boolean;
    muted?: boolean;
    volume?: number;
    preferredQuality?: string;
    onError?: () => void;
  }) => (
    <div
      data-testid="featured-preview-player"
      data-src={src}
      data-autoplay={String(autoPlay)}
      data-muted={String(muted)}
      data-volume={String(volume)}
      data-preferred-quality={preferredQuality}
      onClick={onError}
    />
  ),
}));

vi.mock("@/components/player/twitch/twitch-hls-player", () => ({
  TwitchHlsPlayer: ({
    src,
    channelName,
    enableAdBlock,
    autoPlay,
    muted,
    volume,
    preferredQuality,
    onError,
  }: {
    src: string;
    channelName: string;
    enableAdBlock?: boolean;
    autoPlay?: boolean;
    muted?: boolean;
    volume?: number;
    preferredQuality?: string;
    onError?: () => void;
  }) => (
    <div
      data-testid="featured-twitch-preview-player"
      data-src={src}
      data-channel-name={channelName}
      data-enable-ad-block={String(enableAdBlock)}
      data-autoplay={String(autoPlay)}
      data-muted={String(muted)}
      data-volume={String(volume)}
      data-preferred-quality={preferredQuality}
      onClick={onError}
    />
  ),
}));

import { FeaturedStream } from "@/components/stream/featured-stream";

// Guards: loading state renders a skeleton variant so the featured slot does not flash blank while streams load.
// Guards: no-data state renders null because the parent owns empty-state layout.
// Guards: success state renders title, channel, viewer badge, and watch CTA in the hero panel.
// Guards: carousel state switches the active stream without refetching or remounting the home page.
// Guards: exactly one muted preview starts automatically so Home feels live without audible autoplay.
// Guards: Home preview playback is capped at 360p to keep long-running renderer and GPU memory bounded.
// Guards: an offline featured channel advances once to the next candidate instead of leaving a dead hero or retry-looping every failed candidate.
// Guards: preview audio can be user-unmuted without navigating away from the carousel.
// Guards: Twitch previews use the same ad-blocking HLS player path as normal stream playback.
// Guards: autoplay state advances the featured slide using the user's configured interval.
// Guards: duplicate stream tags render once in first-seen order so repeated labels cannot hide a distinct hero tag or trigger duplicate React keys.
describe("FeaturedStream", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ homeCarouselIntervalMs: HOME_CAROUSEL_INTERVAL_DEFAULT_MS });
    useVolumeStore.setState({ volume: 100, isMuted: false });
    mocks.useStreamPlayback.mockReturnValue({
      playback: { url: "https://example.com/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      isUsingProxy: false,
      retryWithoutProxy: vi.fn(),
      reloadAttempts: 0,
    });
  });

  it("loading: renders skeleton variant when isLoading=true", () => {
    const { container } = renderWithProviders(<FeaturedStream isLoading={true} />);
    expect(container.querySelector('[class*="rounded-lg"]')).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain("h-[560px]");
  });

  it("renders nothing when no stream and not loading", () => {
    const { container } = renderWithProviders(<FeaturedStream />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the media banner details when a stream is provided", () => {
    renderWithProviders(
      <FeaturedStream
        stream={fixtures.stream({
          title: "My Featured",
          channelDisplayName: "Feature Channel",
          viewerCount: 6900,
        })}
      />
    );

    expect(screen.getAllByText(/my featured/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/feature channel/i).length).toBeGreaterThan(0);
    expect(screen.getByText("6.9K")).toBeInTheDocument();
    expect(screen.getAllByText(/watch now/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("featured-twitch-preview-player")).toHaveAttribute(
      "data-autoplay",
      "true"
    );
    expect(screen.getByTestId("featured-twitch-preview-player")).toHaveAttribute(
      "data-preferred-quality",
      "360p"
    );
    expect(screen.getByRole("button", { name: /unmute preview/i })).toBeInTheDocument();
  });

  it("renders duplicate tag labels once before applying the two-pill limit", () => {
    renderWithProviders(
      <FeaturedStream
        stream={fixtures.stream({
          categoryName: undefined,
          language: undefined,
          tags: ["Tactical", "Tactical", "RTS", "RTS"],
        })}
      />
    );

    expect(screen.getAllByText(/^(Tactical|RTS)$/).map((tag) => tag.textContent)).toEqual([
      "Tactical",
      "RTS",
    ]);
  });

  it("starts muted preview playback immediately and lets the user unmute it", () => {
    renderWithProviders(
      <FeaturedStream stream={fixtures.stream({ platform: "kick", channelName: "kickchan" })} />
    );

    expect(screen.getByTestId("featured-preview-player")).toHaveAttribute("data-muted", "true");
    expect(screen.getByTestId("featured-preview-player")).toHaveAttribute("data-autoplay", "true");
    expect(screen.getByTestId("featured-preview-player")).toHaveAttribute("data-volume", "1");
    expect(screen.getByTestId("featured-preview-player")).toHaveAttribute(
      "data-preferred-quality",
      "360p"
    );
    fireEvent.click(screen.getByRole("button", { name: /unmute preview/i }));
    expect(screen.getByTestId("featured-preview-player")).toHaveAttribute("data-muted", "false");
    expect(screen.getByRole("button", { name: /mute preview/i })).toBeInTheDocument();
  });

  it("uses the Twitch ad-blocking player for Twitch previews", () => {
    renderWithProviders(
      <FeaturedStream stream={fixtures.stream({ platform: "twitch", channelName: "twitchchan" })} />
    );

    expect(screen.getByTestId("featured-twitch-preview-player")).toHaveAttribute(
      "data-channel-name",
      "twitchchan"
    );
    expect(screen.getByTestId("featured-twitch-preview-player")).toHaveAttribute(
      "data-enable-ad-block",
      "true"
    );
  });

  it("uses the standard HLS player for Kick previews", () => {
    renderWithProviders(
      <FeaturedStream stream={fixtures.stream({ platform: "kick", channelName: "kickchan" })} />
    );

    expect(screen.getByTestId("featured-preview-player")).toHaveAttribute(
      "data-src",
      "https://example.com/live.m3u8"
    );
    expect(screen.queryByTestId("featured-twitch-preview-player")).not.toBeInTheDocument();
  });

  it.each([
    ["twitch", "bg-[#9146FF]", "text-white"],
    ["kick", "bg-[#53FC18]", "text-black"],
  ] as const)(
    "uses %s color for the live dot and Watch now button",
    (platform, expectedBgClass, expectedTextClass) => {
      const { container } = renderWithProviders(
        <FeaturedStream stream={fixtures.stream({ platform })} />
      );

      const liveDot = container.querySelector(".absolute.left-4.top-4 span");
      expect(liveDot?.className).toContain(expectedBgClass);

      const watchNowButton = screen.getAllByText(/watch now/i)[0];
      expect(watchNowButton.className).toContain(expectedBgClass);
      expect(watchNowButton.className).toContain(expectedTextClass);
    }
  );

  it("switches active stream with carousel controls", () => {
    const streams = [
      fixtures.stream({
        id: "s1",
        channelName: "first-channel",
        title: "First Featured",
        channelDisplayName: "First Channel",
      }),
      fixtures.stream({
        id: "s2",
        channelName: "second-channel",
        title: "Second Featured",
        channelDisplayName: "Second Channel",
      }),
    ];

    renderWithProviders(<FeaturedStream stream={streams[0]} streams={streams} />);

    expect(screen.getAllByText(/first featured/i).length).toBeGreaterThan(0);
    expect(mocks.useStreamPlayback).toHaveBeenLastCalledWith("twitch", "first-channel");
    fireEvent.click(screen.getByRole("button", { name: /next featured stream/i }));
    expect(screen.getAllByText(/second featured/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/second channel/i).length).toBeGreaterThan(0);
    expect(mocks.useStreamPlayback).toHaveBeenLastCalledWith("twitch", "second-channel");
    expect(screen.getByTestId("featured-twitch-preview-player")).toHaveAttribute(
      "data-autoplay",
      "true"
    );
  });

  it("advances to the next candidate when the active preview is unavailable", () => {
    const streams = [
      fixtures.stream({ id: "offline", channelName: "offline-channel" }),
      fixtures.stream({ id: "live", channelName: "live-channel" }),
    ];

    renderWithProviders(<FeaturedStream stream={streams[0]} streams={streams} />);
    fireEvent.click(screen.getByTestId("featured-twitch-preview-player"));

    expect(mocks.useStreamPlayback).toHaveBeenLastCalledWith("twitch", "live-channel");
  });

  it("reports carousel changes to a controlled owner", () => {
    const onActiveIndexChange = vi.fn();
    const streams = [
      fixtures.stream({ id: "s1", title: "First Featured" }),
      fixtures.stream({ id: "s2", title: "Second Featured" }),
    ];

    renderWithProviders(
      <FeaturedStream
        stream={streams[0]}
        streams={streams}
        activeIndex={0}
        onActiveIndexChange={onActiveIndexChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /next featured stream/i }));
    expect(onActiveIndexChange).toHaveBeenCalledWith(1);
    expect(screen.getAllByText(/first featured/i).length).toBeGreaterThan(0);
  });

  it("does not start a second timer when a controlled owner rotates the carousel", () => {
    vi.useFakeTimers();
    const onActiveIndexChange = vi.fn();
    const streams = [
      fixtures.stream({ id: "s1", title: "First Featured" }),
      fixtures.stream({ id: "s2", title: "Second Featured" }),
    ];

    try {
      renderWithProviders(
        <FeaturedStream
          stream={streams[0]}
          streams={streams}
          activeIndex={0}
          onActiveIndexChange={onActiveIndexChange}
          isAutoRotationEnabled={false}
        />
      );
      act(() => {
        vi.advanceTimersByTime(HOME_CAROUSEL_INTERVAL_DEFAULT_MS);
      });
      expect(onActiveIndexChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-advances to the next stream every 15 seconds", () => {
    vi.useFakeTimers();
    const streams = [
      fixtures.stream({ id: "s1", title: "First Featured", channelDisplayName: "First Channel" }),
      fixtures.stream({ id: "s2", title: "Second Featured", channelDisplayName: "Second Channel" }),
    ];

    try {
      renderWithProviders(<FeaturedStream stream={streams[0]} streams={streams} />);

      expect(screen.getAllByText(/first featured/i).length).toBeGreaterThan(0);
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      expect(screen.getAllByText(/second featured/i).length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the configured carousel interval for auto-advance", () => {
    vi.useFakeTimers();
    useAppStore.setState({ homeCarouselIntervalMs: 30_000 });
    const streams = [
      fixtures.stream({ id: "s1", title: "First Featured", channelDisplayName: "First Channel" }),
      fixtures.stream({ id: "s2", title: "Second Featured", channelDisplayName: "Second Channel" }),
    ];

    try {
      renderWithProviders(<FeaturedStream stream={streams[0]} streams={streams} />);

      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      expect(screen.getAllByText(/first featured/i).length).toBeGreaterThan(0);

      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      expect(screen.getAllByText(/second featured/i).length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
