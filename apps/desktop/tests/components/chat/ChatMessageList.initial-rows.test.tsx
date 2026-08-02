import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import type { ChatMessage } from "@/shared/chat-types";
import { buildChannelKey, DEFAULT_BATCHING_INTERVAL_MS, useChatStore } from "@/store/chat-store";

vi.mock("react-virtuoso", async () => {
  const React = await import("react");
  const INITIAL_VISIBLE_ROWS = 10;

  return {
    Virtuoso: ({
      data = [],
      itemContent,
      initialTopMostItemIndex,
      scrollerRef,
      className,
      style,
    }: {
      data?: ChatMessage[];
      itemContent: (index: number, message: ChatMessage) => React.ReactNode;
      initialTopMostItemIndex?: number;
      scrollerRef?: (ref: HTMLElement | null) => void;
      className?: string;
      style?: React.CSSProperties;
    }) => {
      React.useEffect(() => {
        const scroller = document.createElement("div");
        scrollerRef?.(scroller);

        return () => scrollerRef?.(null);
      }, [scrollerRef]);

      const endIndex =
        typeof initialTopMostItemIndex === "number"
          ? Math.min(initialTopMostItemIndex, data.length - 1)
          : data.length - 1;
      const startIndex = Math.max(0, endIndex - (INITIAL_VISIBLE_ROWS - 1));
      const visibleMessages = endIndex >= 0 ? data.slice(startIndex, endIndex + 1) : [];

      return (
        <div data-testid="virtuoso-scroller" className={className} style={style}>
          {visibleMessages.map((message, offset) => (
            <div key={message.id}>{itemContent(startIndex + offset, message)}</div>
          ))}
        </div>
      );
    },
  };
});

vi.mock("@/components/chat/ChatMessage", () => ({
  ChatMessage: ({ message }: { message: ChatMessage }) => (
    <div data-testid="chat-message">{message.rawContent}</div>
  ),
}));

const channelKey = buildChannelKey("twitch", "cached-channel");

function cachedMessage(index: number): ChatMessage {
  const label = `Cached message ${index}`;

  return {
    id: `cached-${index}`,
    platform: "twitch",
    type: "message",
    channel: "cached-channel",
    userId: `user-${index}`,
    username: `user-${index}`,
    displayName: `Viewer ${index}`,
    color: "#fff",
    badges: [],
    content: [{ type: "text", content: label }],
    rawContent: label,
    timestamp: new Date("2026-07-14T12:00:00.000Z"),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
    isHistorical: true,
  };
}

function resetChatStore() {
  useChatStore.getState().cleanupBatching();
  useChatStore.setState({
    messagesByChannel: {},
    pausedChannels: new Set(),
    batchingEnabled: true,
    batchingInterval: DEFAULT_BATCHING_INTERVAL_MS,
  });
}

function renderChatMessageList() {
  let view: ReturnType<typeof render> | undefined;

  act(() => {
    view = render(<ChatMessageList channelKey={channelKey} />);
  });

  return view!;
}

describe("ChatMessageList retained initial rows", () => {
  afterEach(() => {
    resetChatStore();
  });

  it("synchronously renders the final ten retained messages without ResizeObserver measurement", () => {
    const retainedMessages = Array.from({ length: 15 }, (_, index) => cachedMessage(index));
    act(() => {
      useChatStore.setState({ messagesByChannel: { [channelKey]: retainedMessages } });
    });

    renderChatMessageList();

    expect(screen.getAllByTestId("chat-message")).toHaveLength(10);
    expect(screen.getByText("Cached message 5")).toBeInTheDocument();
    expect(screen.getByText("Cached message 14")).toBeInTheDocument();
    expect(screen.queryByText("Cached message 4")).not.toBeInTheDocument();
  });

  it("keeps the empty list mounted without inventing an initial row", () => {
    renderChatMessageList();

    expect(screen.getByTestId("virtuoso-scroller")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-message")).not.toBeInTheDocument();
  });
});
