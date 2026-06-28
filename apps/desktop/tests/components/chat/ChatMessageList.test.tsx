import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { getRenderCounts, resetRenderCounts } from "@/components/dev/use-render-count";
import { type ChatDisplayPreferences, DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@/shared/auth-types";
import type { ChatMessage } from "@/shared/chat-types";
import { useAuthStore } from "@/store/auth-store";
import { buildChannelKey, DEFAULT_BATCHING_INTERVAL_MS, useChatStore } from "@/store/chat-store";

const virtuosoInitialIndexes = vi.hoisted<Array<number | undefined>>(() => []);
const virtuosoWindowProps = vi.hoisted<
  Array<{
    overscan?: number;
    increaseViewportBy?: number | { top?: number; bottom?: number };
    defaultItemHeight?: number;
  }>
>(() => []);
const virtuosoItemContentRefs = vi.hoisted<Array<(i: number, m: unknown) => React.ReactNode>>(
  () => []
);
const virtuosoLayoutProps = vi.hoisted<Array<{ className?: string; style?: React.CSSProperties }>>(
  () => []
);

vi.mock("@/components/chat/ChatMessage", () => ({
  ChatMessage: ({
    message,
    onReply,
    onUnban,
  }: {
    message: { displayName: string };
    onReply?: () => void;
    onUnban?: () => void;
  }) => (
    <div
      data-testid="chat-message"
      data-can-reply={onReply ? "true" : "false"}
      data-can-unban={onUnban ? "true" : "false"}
    >
      {message.displayName}
    </div>
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
    defaultItemHeight,
    className,
    style,
  }: {
    data: Array<{ id: string }>;
    itemContent: (i: number, m: unknown) => React.ReactNode;
    atBottomStateChange?: (atBottom: boolean) => void;
    scrollerRef?: (el: HTMLElement | null) => void;
    initialTopMostItemIndex?: number;
    overscan?: number;
    increaseViewportBy?: number | { top?: number; bottom?: number };
    defaultItemHeight?: number;
    className?: string;
    style?: React.CSSProperties;
  }) => {
    virtuosoInitialIndexes.push(initialTopMostItemIndex);
    virtuosoWindowProps.push({ overscan, increaseViewportBy, defaultItemHeight });
    virtuosoItemContentRefs.push(itemContent);
    virtuosoLayoutProps.push({ className, style });
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
        <button type="button" onClick={() => scroller.dispatchEvent(new Event("mouseenter"))}>
          enter chat
        </button>
        <button type="button" onClick={() => scroller.dispatchEvent(new Event("mouseleave"))}>
          leave chat
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

function setChatDisplay(overrides: Partial<ChatDisplayPreferences>) {
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, ...overrides },
    } as typeof s.preferences,
  }));
}

// Guards: empty state (no messages yet) must still render the virtuoso container so the layout doesn't collapse and the next message has somewhere to mount
// Guards: per-channel message reads keep a busy multiview panel from re-rendering sibling ChatMessageList instances
// Guards: per-channel pause state renders the "Chat paused due to scroll" banner only for the panel the viewer scrolled
// Guards: Twitch-style Pause Chat preferences add mouseover and Alt-key pause triggers without breaking scroll pause.
// Guards: setPaused(channelKey, false) must fire on mount for the current channel so a reconnect doesn't strand the list in a paused state from the prior session
// Guards: rapid chat updates must not mutate Virtuoso's initial scroll index and flash/jump the visible list
// Guards: click-to-reply is only exposed when the platform orchestrator opts the list into reply behavior
// Guards: inline Unban is exposed only for senders known to be banned or timed out; missing unban state must not show it for ordinary users
describe("ChatMessageList", () => {
  beforeEach(() => {
    resetChatStore();
    setChatDisplay({});
    resetRenderCounts();
    virtuosoInitialIndexes.length = 0;
    virtuosoWindowProps.length = 0;
    virtuosoItemContentRefs.length = 0;
    virtuosoLayoutProps.length = 0;
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
      overscan: 150,
      increaseViewportBy: { top: 240, bottom: 480 },
      defaultItemHeight: 32,
    });
  });

  it("estimates compact chat rows from the current chat display preferences", () => {
    setChatDisplay({ density: "compact", fontSizePx: 16, emoteSizePx: 28 });

    render(<ChatMessageList channelKey={channelA} />);

    expect(virtuosoWindowProps.at(-1)?.defaultItemHeight).toBe(28);
  });

  it("keeps Virtuoso row rendering stable when parent action callbacks are recreated", () => {
    const channelContext = { channelId: "alpha", channelSlug: "alpha" };
    const { rerender } = render(
      <ChatMessageList
        channelKey={channelA}
        onPin={() => undefined}
        currentChannelContext={channelContext}
      />
    );
    const initialItemContent = virtuosoItemContentRefs.at(-1);

    rerender(
      <ChatMessageList
        channelKey={channelA}
        onPin={() => undefined}
        currentChannelContext={channelContext}
      />
    );

    expect(virtuosoItemContentRefs.at(-1)).toBe(initialItemContent);
  });

  it("prevents the virtualized chat scroller from exposing horizontal overflow", () => {
    const { container } = render(<ChatMessageList channelKey={channelA} />);

    expect(container.firstElementChild?.className).toContain("overflow-x-hidden");
    expect(virtuosoLayoutProps.at(-1)?.className).toContain("overflow-x-hidden");
    expect(virtuosoLayoutProps.at(-1)?.style?.overflowX).toBe("hidden");
    expect(virtuosoLayoutProps.at(-1)?.style?.overflowAnchor).toBe("none");
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

  it("passes reply only when onReply is provided", () => {
    act(() => {
      useChatStore.getState().addMessage(message("a", "alpha", "Alpha"));
    });

    const { getByTestId, rerender } = render(<ChatMessageList channelKey={channelA} />);
    expect(getByTestId("chat-message")).toHaveAttribute("data-can-reply", "false");

    rerender(<ChatMessageList channelKey={channelA} onReply={() => undefined} />);
    expect(getByTestId("chat-message")).toHaveAttribute("data-can-reply", "true");
  });

  it("passes unban only to rows whose sender is currently unbannable", () => {
    act(() => {
      useChatStore.getState().addMessage(message("a", "alpha", "Alpha"));
      useChatStore.getState().addMessage(message("b", "alpha", "Bravo"));
    });

    const { getAllByTestId } = render(
      <ChatMessageList
        channelKey={channelA}
        onUnban={() => undefined}
        unbanUserIds={new Set(["user-b"])}
      />
    );

    expect(getAllByTestId("chat-message")[0]).toHaveAttribute("data-can-unban", "false");
    expect(getAllByTestId("chat-message")[1]).toHaveAttribute("data-can-unban", "true");
  });

  it("does not pass unban when the unbannable set is missing", () => {
    act(() => {
      useChatStore.getState().addMessage(message("a", "alpha", "Alpha"));
    });

    const { getByTestId } = render(
      <ChatMessageList channelKey={channelA} onUnban={() => undefined} />
    );

    expect(getByTestId("chat-message")).toHaveAttribute("data-can-unban", "false");
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

  it("pauses while the chat pane is hovered when Mouseover pause is selected", () => {
    setChatDisplay({ pauseMode: "mouseover" });
    const { getByText } = render(<ChatMessageList channelKey={channelA} />);

    fireEvent.click(getByText("enter chat"));
    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);

    fireEvent.click(getByText("leave chat"));
    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(false);
  });

  it("pauses while Alt is held when Hold Alt Key pause is selected", () => {
    setChatDisplay({ pauseMode: "alt" });
    render(<ChatMessageList channelKey={channelA} />);

    fireEvent.keyDown(window, { key: "Alt" });
    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);

    fireEvent.keyUp(window, { key: "Alt" });
    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(false);
  });
});
