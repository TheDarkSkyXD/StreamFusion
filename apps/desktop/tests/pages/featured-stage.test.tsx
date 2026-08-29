import { act } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOME_CAROUSEL_INTERVAL_DEFAULT_MS, useAppStore } from "@/store/app-store";

import { fireEvent, fixtures, renderWithProviders, screen } from "../test-utils";

const mocks = vi.hoisted(() => ({
  useChannelByUsername: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href="#" {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/features/discovery/components/stream/featured-stream", () => ({
  FeaturedStream: ({
    stream,
    streams,
    activeIndex,
    onActiveIndexChange,
    isAutoRotationEnabled,
  }: {
    stream: { title: string };
    streams: unknown[];
    activeIndex: number;
    onActiveIndexChange: (index: number) => void;
    isAutoRotationEnabled: boolean;
  }) => (
    <div
      data-testid="featured-media"
      data-active-index={activeIndex}
      data-auto-rotation-enabled={String(isAutoRotationEnabled)}
    >
      <p>{stream.title}</p>
      <p data-testid="featured-slide-count">{streams.length}</p>
      <button type="button" onClick={() => onActiveIndexChange(activeIndex + 1)}>
        Next featured stream
      </button>
    </div>
  ),
}));

vi.mock("@/features/chat/components/chat", () => ({
  ChatPanel: (props: {
    initialPlatform: string;
    initialChannel: string;
    channelId?: string;
    kickChannelId?: string;
    chatroomId?: number;
    showComposer?: boolean;
  }) => (
    <div
      data-testid="featured-chat-panel"
      data-platform={props.initialPlatform}
      data-channel={props.initialChannel}
      data-channel-id={props.channelId}
      data-kick-channel-id={props.kickChannelId}
      data-chatroom-id={props.chatroomId}
      data-show-composer={String(props.showComposer)}
    />
  ),
}));

vi.mock("@/features/discovery/data/queries/useChannels", () => ({
  useChannelByUsername: mocks.useChannelByUsername,
}));

import { FeaturedStage } from "@/pages/Home/components/featured-stage";

function setWideViewport(matches: boolean) {
  vi.mocked(window.matchMedia).mockImplementation(
    (query) =>
      ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as MediaQueryList
  );
}

// Guards: the media and chat rail use the same active stream identity through carousel changes.
// Guards: Kick chat never mounts until the authoritative channel has all required metadata.
// Guards: narrow layouts unmount the chat rail instead of keeping a hidden chat socket alive.
// Guards: Twitch Home chat starts from top-stream metadata without waiting on a duplicate channel lookup.
describe("FeaturedStage", () => {
  beforeEach(() => {
    mocks.useChannelByUsername.mockReset();
    useAppStore.setState({ homeCarouselIntervalMs: HOME_CAROUSEL_INTERVAL_DEFAULT_MS });
    setWideViewport(true);
    mocks.useChannelByUsername.mockReturnValue({
      data: fixtures.channel(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("mounts the Home chat rail without a composer", () => {
    const stream = fixtures.stream({ channelId: "fast-twitch-channel" });
    renderWithProviders(
      <FeaturedStage
        stream={stream}
        streams={[stream]}
        isLoading={false}
      />
    );

    expect(screen.getByTestId("featured-chat-panel")).toHaveAttribute(
      "data-show-composer",
      "false"
    );
    expect(screen.getByTestId("featured-chat-panel")).toHaveAttribute(
      "data-channel-id",
      "fast-twitch-channel"
    );
    expect(mocks.useChannelByUsername).not.toHaveBeenCalled();
  });

  it("changes chat targets with the active carousel stream", () => {
    const streams = [
      fixtures.stream({ id: "first", channelName: "first-channel", title: "First" }),
      fixtures.stream({ id: "second", channelName: "second-channel", title: "Second" }),
    ];
    mocks.useChannelByUsername.mockImplementation((username: string) => ({
      data: fixtures.channel({ username, id: `${username}-id` }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));

    renderWithProviders(
      <FeaturedStage
        stream={streams[0]}
        streams={streams}
        isLoading={false}
      />
    );

    expect(screen.getByTestId("featured-chat-panel")).toHaveAttribute(
      "data-channel",
      "first-channel"
    );
    fireEvent.click(screen.getByRole("button", { name: /next featured stream/i }));
    expect(screen.getByTestId("featured-chat-panel")).toHaveAttribute(
      "data-channel",
      "second-channel"
    );
  });

  it("keeps chat with the selected identity when the catalog order changes", () => {
    const first = fixtures.stream({ id: "first", channelName: "first-channel", title: "First" });
    const second = fixtures.stream({
      id: "second",
      channelName: "second-channel",
      title: "Second",
    });
    mocks.useChannelByUsername.mockImplementation((username: string) => ({
      data: fixtures.channel({ username, id: `${username}-id` }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));

    function ReorderableStage() {
      const [streams, setStreams] = useState([first, second]);
      return (
        <>
          <FeaturedStage
            stream={streams[0]}
            streams={streams}
            isLoading={false}
          />
          <button type="button" onClick={() => setStreams([second, first])}>
            Reorder catalog
          </button>
        </>
      );
    }

    renderWithProviders(<ReorderableStage />);
    fireEvent.click(screen.getByRole("button", { name: /next featured stream/i }));
    expect(screen.getByTestId("featured-chat-panel")).toHaveAttribute(
      "data-channel",
      "second-channel"
    );

    fireEvent.click(screen.getByRole("button", { name: /reorder catalog/i }));
    expect(screen.getByTestId("featured-chat-panel")).toHaveAttribute(
      "data-channel",
      "second-channel"
    );
  });

  it("renders a loading rail instead of mounting Kick chat without complete metadata", () => {
    const stream = fixtures.stream({ platform: "kick", channelName: "kick-channel" });
    mocks.useChannelByUsername.mockReturnValue({
      data: fixtures.channel({ platform: "kick", username: "kick-channel", id: "official-id" }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <FeaturedStage stream={stream} isLoading={false} />
    );

    expect(screen.queryByTestId("featured-chat-panel")).not.toBeInTheDocument();
    expect(screen.getByText(/chat is unavailable/i)).toBeInTheDocument();
  });

  it("uses the combined media and chat skeleton while the featured section loads", () => {
    renderWithProviders(<FeaturedStage isLoading={true} />);

    expect(screen.getByTestId("featured-stage-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("featured-chat-skeleton")).toBeInTheDocument();
  });

  it("does not render the chat rail below the wide breakpoint", () => {
    setWideViewport(false);
    renderWithProviders(
      <FeaturedStage stream={fixtures.stream()} isLoading={false} />
    );

    expect(screen.queryByTestId("featured-chat-rail")).not.toBeInTheDocument();
    expect(mocks.useChannelByUsername).not.toHaveBeenCalled();
  });

  it("pauses auto-rotation while focus remains inside chat", () => {
    vi.useFakeTimers();
    const streams = [
      fixtures.stream({ id: "first", channelName: "first-channel", title: "First" }),
      fixtures.stream({ id: "second", channelName: "second-channel", title: "Second" }),
    ];
    mocks.useChannelByUsername.mockImplementation((username: string) => ({
      data: fixtures.channel({ username }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));

    try {
      renderWithProviders(
        <FeaturedStage
          stream={streams[0]}
          streams={streams}
          isLoading={false}
        />
      );
      const rail = screen.getByTestId("featured-chat-rail");
      fireEvent.focusIn(rail);
      act(() => vi.advanceTimersByTime(HOME_CAROUSEL_INTERVAL_DEFAULT_MS));
      expect(screen.getByTestId("featured-media")).toHaveAttribute("data-active-index", "0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses one stage-owned timer for carousel rotation", () => {
    vi.useFakeTimers();
    setWideViewport(false);
    const streams = [
      fixtures.stream({ id: "first", channelName: "first-channel", title: "First" }),
      fixtures.stream({ id: "second", channelName: "second-channel", title: "Second" }),
    ];
    mocks.useChannelByUsername.mockImplementation((username: string) => ({
      data: fixtures.channel({ username }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));

    try {
      renderWithProviders(
        <FeaturedStage
          stream={streams[0]}
          streams={streams}
          isLoading={false}
        />
      );
      expect(screen.getByTestId("featured-media")).toHaveAttribute(
        "data-auto-rotation-enabled",
        "false"
      );
      act(() => vi.advanceTimersByTime(HOME_CAROUSEL_INTERVAL_DEFAULT_MS));
      expect(screen.getByTestId("featured-media")).toHaveAttribute("data-active-index", "1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the visible desktop chat connected to one stream during idle", () => {
    vi.useFakeTimers();
    const streams = [
      fixtures.stream({ id: "first", channelName: "first-channel", title: "First" }),
      fixtures.stream({ id: "second", channelName: "second-channel", title: "Second" }),
    ];
    mocks.useChannelByUsername.mockImplementation((username: string) => ({
      data: fixtures.channel({ username }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));

    try {
      renderWithProviders(
        <FeaturedStage
          stream={streams[0]}
          streams={streams}
          isLoading={false}
        />
      );
      act(() => vi.advanceTimersByTime(HOME_CAROUSEL_INTERVAL_DEFAULT_MS * 3));
      expect(screen.getByTestId("featured-media")).toHaveAttribute("data-active-index", "0");
      expect(screen.getByTestId("featured-chat-panel")).toHaveAttribute(
        "data-channel",
        "first-channel"
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
