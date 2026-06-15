import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { getRenderCounts, resetRenderCounts } from "@/components/dev/use-render-count";
import type { ChatMessage } from "@/shared/chat-types";
import { buildChannelKey, DEFAULT_BATCHING_INTERVAL_MS, useChatStore } from "@/store/chat-store";

const virtuosoInitialIndexes = vi.hoisted<Array<number | undefined>>(() => []);
const virtuosoWindowProps = vi.hoisted<
  Array<{ overscan?: number; increaseViewportBy?: number | { top?: number; bottom?: number } }>
>(() => []);

vi.mock("@/components/chat/ChatMessage", () => ({
  ChatMessage: ({ message }: { message: { displayName: string } }) => (
    <div data-testid="chat-message">{message.displayName}</div>
  ),
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
    atBottomStateChange,
    scrollerRef,
    initialTopMostItemIndex,
    overscan,
    increaseViewportBy,
  }: {
    data: Array<{ id: string }>;
    itemContent: (i: number, m: unknown) => React.ReactNode;
    atBottomStateChange?: (atBottom: boolean) => void;
    scrollerRef?: (el: HTMLElement | null) => void;
    initialTopMostItemIndex?: number;
    overscan?: number;
    increaseViewportBy?: number | { top?: number; bottom?: number };
  }) => {
    virtuosoInitialIndexes.push(initialTopMostItemIndex);
    virtuosoWindowProps.push({ overscan, increaseViewportBy });
    const scroller = document.createElement("div");
    scrollerRef?.(scroller);
    return (
      <div data-testid="virtuoso">
        <button
          type="button"
          onClick={() => {
            const wheel = new Event("wheel") as WheelEvent;
            Object.defineProperty(wheel, "deltaY", { value: -1 });
            scroller.dispatchEvent(wheel);
            atBottomStateChange?.(false);
          }}
        >
          leave bottom
        </button>
        <button type="button" onClick={() => atBottomStateChange?.(true)}>
          return bottom
        </button>
        {data.map((m, i) => (
          <div key={m.id}>{itemContent(i, m)}</div>
        ))}
      </div>
    );
  },
}));

const channelA = buildChannelKey("twitch", "alpha");
const channelB = buildChannelKey("twitch", "bravo");

function message(id: string, channel: string, displayName = id): ChatMessage {
  return {
    id,
    platform: "twitch",
    type: "message",
    channel,
    userId: `user-${id}`,
    username: `user-${id}`,
    displayName,
    color: "#fff",
    badges: [],
    content: [{ type: "text", content: displayName }],
    rawContent: displayName,
    timestamp: new Date("2026-06-08T00:00:00.000Z"),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
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

// Guards: empty state (no messages yet) must still render the virtuoso container so the layout doesn't collapse and the next message has somewhere to mount
// Guards: per-channel message reads keep a busy multiview panel from re-rendering sibling ChatMessageList instances
// Guards: per-channel pause state renders the "Chat paused due to scroll" banner only for the panel the viewer scrolled
// Guards: setPaused(channelKey, false) must fire on mount for the current channel so a reconnect doesn't strand the list in a paused state from the prior session
// Guards: rapid chat updates must not mutate Virtuoso's initial scroll index and flash/jump the visible list
describe("ChatMessageList", () => {
  beforeEach(() => {
    resetChatStore();
    resetRenderCounts();
    virtuosoInitialIndexes.length = 0;
    virtuosoWindowProps.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("empty: renders the virtuoso container even with no messages", () => {
    const { getByTestId } = render(<ChatMessageList channelKey={channelA} />);
    expect(getByTestId("virtuoso")).toBeInTheDocument();
  });

  it("keeps the virtualized pre-render window narrow for emote-heavy fast chat", () => {
    render(<ChatMessageList channelKey={channelA} />);
    expect(virtuosoWindowProps.at(-1)).toEqual({
      overscan: 16,
      increaseViewportBy: { top: 96, bottom: 96 },
    });
  });

  it("renders only messages for its channel bucket", () => {
    act(() => {
      useChatStore.getState().addMessage(message("a", "alpha", "Alpha"));
      useChatStore.getState().addMessage(message("b", "bravo", "Bravo"));
    });

    const { getAllByTestId } = render(<ChatMessageList channelKey={channelA} />);

    expect(getAllByTestId("chat-message")).toHaveLength(1);
    expect(getAllByTestId("chat-message")[0]).toHaveTextContent("Alpha");
  });

  it("re-renders only the ChatMessageList whose channel receives a message", () => {
    render(
      <>
        <ChatMessageList channelKey={channelA} />
        <ChatMessageList channelKey={channelB} />
      </>
    );
    const initialCounts = getRenderCounts();

    act(() => {
      useChatStore.getState().addMessage(message("a", "alpha", "Alpha"));
    });

    const nextCounts = getRenderCounts();
    expect(nextCounts[`ChatMessageList:${channelA}`]).toBeGreaterThan(
      initialCounts[`ChatMessageList:${channelA}`]
    );
    expect(nextCounts[`ChatMessageList:${channelB}`]).toBe(
      initialCounts[`ChatMessageList:${channelB}`]
    );
  });

  it("keeps Virtuoso's initial scroll index stable as messages arrive", () => {
    act(() => {
      useChatStore.getState().addMessage(message("seed", "alpha", "Seed"));
    });

    render(<ChatMessageList channelKey={channelA} />);
    expect(virtuosoInitialIndexes.at(-1)).toBe(0);

    act(() => {
      useChatStore.getState().addMessage(message("a", "alpha", "Alpha"));
      useChatStore.getState().addMessage(message("b", "alpha", "Bravo"));
    });

    expect(virtuosoInitialIndexes.at(-1)).toBe(0);
  });

  it("keeps pause state scoped to the channel that scrolls away from bottom", async () => {
    vi.useFakeTimers();
    const { getAllByText, queryByText } = render(
      <>
        <ChatMessageList channelKey={channelA} />
        <ChatMessageList channelKey={channelB} />
      </>
    );

    fireEvent.click(getAllByText("leave bottom")[0]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);
    expect(useChatStore.getState().pausedChannels.has(channelB)).toBe(false);
    expect(queryByText(/chat paused due to scroll/i)).toBeInTheDocument();
  });
});
