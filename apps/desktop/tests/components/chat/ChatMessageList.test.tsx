import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessageList } from "@/features/chat/components/chat/ChatMessageList";
import { getRenderCounts, resetRenderCounts } from "@/components/dev/use-render-count";
import { type ChatDisplayPreferences, DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@shared/auth-types";
import type { ChatMessage } from "@shared/chat-types";
import { useAuthStore } from "@/store/auth-store";
import { buildChannelKey, DEFAULT_BATCHING_INTERVAL_MS, useChatStore } from "@/store/chat-store";

const virtuosoInitialIndexes = vi.hoisted<Array<number | undefined>>(() => []);
const virtuosoFirstItemIndexes = vi.hoisted<Array<number | undefined>>(() => []);
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
const virtuosoTotalListHeightChangedCallbacks = vi.hoisted<
  Array<((height: number) => void) | undefined>
>(() => []);
const virtuosoAtBottomStateChangeCallbacks = vi.hoisted<
  Array<((isAtBottom: boolean) => void) | undefined>
>(() => []);
const virtuosoFollowOutputCallbacks = vi.hoisted<
  Array<(isAtBottom: boolean) => "auto" | boolean>
>(() => []);
const virtuosoScrollToIndexCalls = vi.hoisted<
  Array<{
    index: number | "LAST";
    align?: "start" | "center" | "end";
    behavior?: "auto" | "smooth";
  }>
>(() => []);
const virtuosoScrollerHeight = vi.hoisted(() => ({ current: 1200 }));
const virtuosoScrollerScrollTopWrites = vi.hoisted<number[]>(() => []);
const virtuosoScrollers = vi.hoisted<HTMLElement[]>(() => []);

vi.mock("@/features/chat/components/chat/ChatMessage", () => ({
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

vi.mock("react-virtuoso", async () => {
  const React = await import("react");

  return {
    Virtuoso: React.forwardRef(
      (
        {
          data,
          itemContent,
          atBottomStateChange,
          totalListHeightChanged,
          followOutput,
          scrollerRef,
          initialTopMostItemIndex,
          firstItemIndex,
          overscan,
          increaseViewportBy,
          defaultItemHeight,
          className,
          style,
        }: {
          data: Array<{ id: string }>;
          itemContent: (i: number, m: unknown) => React.ReactNode;
          atBottomStateChange?: (atBottom: boolean) => void;
          totalListHeightChanged?: (height: number) => void;
          followOutput?: (isAtBottom: boolean) => "auto" | boolean;
          scrollerRef?: (el: HTMLElement | null) => void;
          initialTopMostItemIndex?: number;
          firstItemIndex?: number;
          overscan?: number;
          increaseViewportBy?: number | { top?: number; bottom?: number };
          defaultItemHeight?: number;
          className?: string;
          style?: React.CSSProperties;
        },
        ref
      ) => {
        React.useImperativeHandle(
          ref,
          () => ({
            autoscrollToBottom: () => undefined,
            scrollToIndex: (args: {
              index: number | "LAST";
              align?: "start" | "center" | "end";
              behavior?: "auto" | "smooth";
            }) => {
              virtuosoScrollToIndexCalls.push(args);
            },
          }),
          []
        );
        virtuosoInitialIndexes.push(initialTopMostItemIndex);
        virtuosoFirstItemIndexes.push(firstItemIndex);
        virtuosoWindowProps.push({ overscan, increaseViewportBy, defaultItemHeight });
        virtuosoItemContentRefs.push(itemContent);
        virtuosoLayoutProps.push({ className, style });
        virtuosoTotalListHeightChangedCallbacks.push(totalListHeightChanged);
        virtuosoAtBottomStateChangeCallbacks.push(atBottomStateChange);
        if (followOutput) {
          virtuosoFollowOutputCallbacks.push(followOutput);
        }
        const scroller = document.createElement("div");
        Object.defineProperty(scroller, "scrollHeight", {
          get: () => virtuosoScrollerHeight.current,
          configurable: true,
        });
        Object.defineProperty(scroller, "clientHeight", { value: 300, configurable: true });
        Object.defineProperty(scroller, "offsetWidth", { value: 340, configurable: true });
        Object.defineProperty(scroller, "clientWidth", { value: 330, configurable: true });
        let scrollTop = 1200 - 300;
        Object.defineProperty(scroller, "scrollTop", {
          get: () => scrollTop,
          set: (value) => {
            scrollTop = Math.min(
              Number(value),
              Math.max(0, virtuosoScrollerHeight.current - 300)
            );
            virtuosoScrollerScrollTopWrites.push(scrollTop);
          },
          configurable: true,
        });
        virtuosoScrollers.push(scroller);
        scrollerRef?.(scroller);
        const dispatchScrollbarPointer = (type: "pointerdown" | "pointerup") => {
          const pointer = new Event(type) as PointerEvent;
          Object.defineProperty(pointer, "pointerType", { value: "mouse" });
          Object.defineProperty(pointer, "clientX", { value: 0 });
          scroller.dispatchEvent(pointer);
        };
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
            <button
              type="button"
              onClick={() => {
                const wheel = new Event("wheel") as WheelEvent;
                Object.defineProperty(wheel, "deltaY", { value: -1 });
                scroller.dispatchEvent(wheel);
              }}
            >
              wheel up
            </button>
            <button
              type="button"
              onClick={() => {
                scroller.scrollTop = 600;
                atBottomStateChange?.(false);
              }}
            >
              hydrate away from bottom
            </button>
            <button
              type="button"
              onClick={() => {
                scroller.scrollTop = 500;
                scroller.dispatchEvent(new Event("scroll"));
              }}
            >
              scroll up without bottom state change
            </button>
            <button
              type="button"
              onClick={() => {
                dispatchScrollbarPointer("pointerdown");
                scroller.scrollTop = 881;
                scroller.dispatchEvent(new Event("scroll"));
                dispatchScrollbarPointer("pointerup");
              }}
            >
              scroll up to 19px gap
            </button>
            <button
              type="button"
              onClick={() => {
                dispatchScrollbarPointer("pointerdown");
                scroller.scrollTop = 880;
                scroller.dispatchEvent(new Event("scroll"));
                dispatchScrollbarPointer("pointerup");
              }}
            >
              scroll up to 20px gap
            </button>
            <button
              type="button"
              onClick={() => {
                dispatchScrollbarPointer("pointerdown");
                scroller.scrollTop = 880;
                scroller.dispatchEvent(new Event("scroll"));
                atBottomStateChange?.(false);
                dispatchScrollbarPointer("pointerup");
              }}
            >
              drag scrollbar up
            </button>
            <button
              type="button"
              onClick={() => {
                scroller.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }));
                scroller.scrollTop = 500;
                scroller.dispatchEvent(new Event("scroll"));
                atBottomStateChange?.(false);
                scroller.dispatchEvent(new KeyboardEvent("keyup", { key: "PageUp" }));
              }}
            >
              page up
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
      }
    ),
  };
});

const channelA = buildChannelKey("twitch", "alpha");
const channelB = buildChannelKey("twitch", "bravo");
const kickChannel = buildChannelKey("kick", "alpha");

function message(
  id: string,
  channel: string,
  displayName = id,
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
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
    ...overrides,
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
// Guards: virtualized row estimates follow persisted compact, cozy, and loose message spacing so unmeasured rows do not overlap or jump
// Guards: height-only growth of the visible newest row keeps a following view pinned through measured alignment and a bounded residual-gap correction
// Guards: passive height growth has one scroll authority and at most one paint-coalesced bottom commit
// Guards: wheel-up intent during the pause debounce must stop Virtuoso auto-follow so sending plus scrolling cannot snap back to bottom
// Guards: upward scroller movement from scrollbar dragging or page-key scrolling must stop later height growth from snapping chat back to bottom
// Guards: click-to-reply is only exposed when the platform orchestrator opts the list into reply behavior
// Guards: inline Unban is exposed only for senders known to be banned or timed out; missing unban state must not show it for ordinary users
// Guards: the new-messages divider appears after seeded history and connection system rows, only when real live chat begins, with the live platform's color
describe("ChatMessageList", () => {
  beforeEach(() => {
    resetChatStore();
    setChatDisplay({});
    resetRenderCounts();
    virtuosoInitialIndexes.length = 0;
    virtuosoWindowProps.length = 0;
    virtuosoItemContentRefs.length = 0;
    virtuosoLayoutProps.length = 0;
    virtuosoTotalListHeightChangedCallbacks.length = 0;
    virtuosoAtBottomStateChangeCallbacks.length = 0;
    virtuosoFollowOutputCallbacks.length = 0;
    virtuosoScrollToIndexCalls.length = 0;
    virtuosoScrollerHeight.current = 1200;
    virtuosoScrollerScrollTopWrites.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("empty: renders the virtuoso container even with no messages", () => {
    const { getByTestId } = render(<ChatMessageList channelKey={channelA} />);
    expect(getByTestId("virtuoso")).toBeInTheDocument();
  });

  it("keeps the virtualized pre-render window narrow for emote-heavy fast chat", () => {
    render(<ChatMessageList channelKey={channelA} />);
    expect(virtuosoWindowProps.at(-1)).toEqual({
      overscan: 80,
      increaseViewportBy: { top: 120, bottom: 240 },
      defaultItemHeight: 36,
    });
  });

  it("estimates compact chat rows from the current chat display preferences", () => {
    setChatDisplay({ density: "compact", fontSizePx: 16, emoteSizePx: 28 });

    render(<ChatMessageList channelKey={channelA} />);

    expect(virtuosoWindowProps.at(-1)?.defaultItemHeight).toBe(28);
  });

  it("updates the virtualized row estimate when persisted density changes from cozy to loose", () => {
    render(<ChatMessageList channelKey={channelA} />);
    expect(virtuosoWindowProps.at(-1)?.defaultItemHeight).toBe(36);

    act(() => {
      setChatDisplay({ density: "loose" });
    });

    expect(virtuosoWindowProps.at(-1)?.defaultItemHeight).toBe(52);
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

  it("marks the boundary between seeded history and live chat messages", () => {
    act(() => {
      useChatStore
        .getState()
        .prependMessages(channelA, [
          message("history", "alpha", "History", { isHistorical: true }),
        ]);
      useChatStore
        .getState()
        .addMessage(message("connecting", "alpha", "Connected", { type: "system" }));
      useChatStore.getState().addMessage(message("live", "alpha", "Live"));
    });

    const { container, getByLabelText, getByText } = render(
      <ChatMessageList channelKey={channelA} />
    );
    const renderedText = container.textContent ?? "";

    expect(getByText("New messages")).toBeInTheDocument();
    expect(getByLabelText("New messages")).toHaveStyle({ color: "#a970ff" });
    expect(renderedText.indexOf("Connected")).toBeLessThan(renderedText.indexOf("New messages"));
    expect(renderedText.indexOf("New messages")).toBeLessThan(renderedText.indexOf("Live"));
  });

  it("uses Kick green for the history-to-live divider in Kick chat", () => {
    act(() => {
      useChatStore.getState().prependMessages(kickChannel, [
        message("kick-history", "alpha", "History", {
          platform: "kick",
          isHistorical: true,
        }),
      ]);
      useChatStore.getState().addMessage(
        message("kick-live", "alpha", "Live", {
          platform: "kick",
        })
      );
    });

    const { getByLabelText } = render(<ChatMessageList channelKey={kickChannel} />);

    expect(getByLabelText("New messages")).toHaveStyle({ color: "#53fc18" });
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
    const initialTopMostItemIndex = virtuosoInitialIndexes.at(-1);
    expect(initialTopMostItemIndex).toBeTypeOf("number");

    act(() => {
      useChatStore.getState().addMessage(message("a", "alpha", "Alpha"));
      useChatStore.getState().addMessage(message("b", "alpha", "Bravo"));
    });

    expect(virtuosoInitialIndexes.at(-1)).toBe(initialTopMostItemIndex);
  });

  it("keeps virtual continuity and live follow through passive front trims and remeasurement", async () => {
    vi.useFakeTimers();
    setChatDisplay({ messageLimit: 20 });
    const seeded = Array.from({ length: 30 }, (_, index) =>
      message(`seed-${index}`, "alpha", `Seed ${index}`)
    );
    useChatStore.setState({ messagesByChannel: { [channelA]: seeded } });

    const { queryByRole } = render(<ChatMessageList channelKey={channelA} />);
    const firstItemIndexBeforeTrim = virtuosoFirstItemIndexes.at(-1);

    act(() => {
      useChatStore.getState().addMessage(message("after-trim", "alpha", "After trim"));
    });

    expect(useChatStore.getState().messagesByChannel[channelA]).toHaveLength(11);
    expect.soft(virtuosoFirstItemIndexes.at(-1)).toBe(
      (firstItemIndexBeforeTrim ?? 0) + 20
    );

    const scroller = virtuosoScrollers.at(-1);
    expect(scroller).toBeDefined();
    virtuosoScrollerHeight.current = 1272;
    if (scroller) {
      scroller.scrollTop = 500;
      virtuosoScrollerScrollTopWrites.length = 0;
      scroller.dispatchEvent(new Event("scroll"));
    }
    virtuosoScrollToIndexCalls.length = 0;
    act(() => {
      virtuosoTotalListHeightChangedCallbacks.at(-1)?.(1272);
    });

    expect.soft(virtuosoFollowOutputCallbacks.at(-1)?.(false)).toBe(false);
    expect.soft(virtuosoScrollToIndexCalls).toEqual([]);
    expect.soft(virtuosoScrollerScrollTopWrites).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect.soft(virtuosoScrollerScrollTopWrites).toEqual([972]);
    expect.soft(useChatStore.getState().pausedChannels.has(channelA)).toBe(false);
    expect.soft(
      queryByRole("button", { name: /chat paused due to scroll/i })
    ).not.toBeInTheDocument();
  });

  it("realigns when the visible newest row grows after measurement without a child mutation", async () => {
    vi.useFakeTimers();
    act(() => {
      useChatStore.getState().addMessage(message("seed", "alpha", "Seed"));
    });
    render(<ChatMessageList channelKey={channelA} />);
    const onHeightChanged = virtuosoTotalListHeightChangedCallbacks.at(-1);
    expect(onHeightChanged).toBeTypeOf("function");
    virtuosoScrollToIndexCalls.length = 0;
    expect(virtuosoScrollerScrollTopWrites).toHaveLength(0);

    virtuosoScrollerHeight.current = 1272;
    act(() => {
      virtuosoAtBottomStateChangeCallbacks.at(-1)?.(false);
      onHeightChanged?.(1272);
    });

    expect(virtuosoFollowOutputCallbacks.at(-1)?.(true)).toBe(false);
    expect(virtuosoScrollToIndexCalls).toEqual([]);
    expect(virtuosoScrollerScrollTopWrites).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(virtuosoScrollerScrollTopWrites).toEqual([972]);
  });

  it("uses one coalesced direct commit as the only passive bottom-follow authority", () => {
    const pendingFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const frameId = nextFrameId++;
      pendingFrames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frameId) => {
      pendingFrames.delete(frameId);
    });
    act(() => {
      useChatStore.getState().addMessage(message("seed", "alpha", "Seed"));
    });
    render(<ChatMessageList channelKey={channelA} />);
    const onHeightChanged = virtuosoTotalListHeightChangedCallbacks.at(-1);
    expect(onHeightChanged).toBeTypeOf("function");
    expect(virtuosoFollowOutputCallbacks.at(-1)?.(false)).toBe(false);
    virtuosoScrollToIndexCalls.length = 0;
    virtuosoScrollerScrollTopWrites.length = 0;

    act(() => {
      onHeightChanged?.(1236);
      onHeightChanged?.(1272);
    });

    expect(virtuosoScrollToIndexCalls).toEqual([]);
    expect(virtuosoScrollerScrollTopWrites).toEqual([]);
    expect(pendingFrames.size).toBe(1);

    virtuosoScrollerHeight.current = 1272;
    act(() => {
      pendingFrames.values().next().value?.(0);
    });

    expect(virtuosoScrollToIndexCalls).toEqual([]);
    expect(virtuosoScrollerScrollTopWrites).toEqual([972]);
  });

  it("uses the reported list height when the scroller height lags remeasurement", () => {
    let commitFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      commitFrame = callback;
      return 1;
    });
    act(() => {
      useChatStore.getState().addMessage(message("seed", "alpha", "Seed"));
    });
    render(<ChatMessageList channelKey={channelA} />);
    const onHeightChanged = virtuosoTotalListHeightChangedCallbacks.at(-1);
    expect(onHeightChanged).toBeTypeOf("function");
    expect(virtuosoScrollerHeight.current).toBe(1200);
    virtuosoScrollToIndexCalls.length = 0;
    virtuosoScrollerScrollTopWrites.length = 0;

    act(() => {
      onHeightChanged?.(1272);
    });

    expect(virtuosoScrollToIndexCalls).toEqual([]);
    expect(virtuosoScrollerScrollTopWrites).toEqual([]);
    virtuosoScrollerHeight.current = 1272;
    act(() => {
      commitFrame?.(0);
    });
    expect(virtuosoScrollerScrollTopWrites).toEqual([972]);
  });

  it("settles passive hydration at newest, then never yanks after the viewer scrolls up", async () => {
    vi.useFakeTimers();
    const { getByRole, getByText, queryByRole } = render(
      <ChatMessageList channelKey={channelA} />
    );

    act(() => {
      useChatStore.getState().prependMessages(channelA, [
        message("hydrated-history", "alpha", "Hydrated history", { isHistorical: true }),
      ]);
      useChatStore.getState().addMessage(message("first-live", "alpha", "First live"));
    });
    expect(getByText("Hydrated history")).toBeInTheDocument();
    expect(getByText("First live")).toBeInTheDocument();

    virtuosoScrollerHeight.current = 1272;
    fireEvent.click(getByText("hydrate away from bottom"));
    virtuosoScrollToIndexCalls.length = 0;
    virtuosoScrollerScrollTopWrites.length = 0;
    act(() => {
      virtuosoTotalListHeightChangedCallbacks.at(-1)?.(1272);
    });

    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(false);
    expect(
      queryByRole("button", { name: /chat paused due to scroll/i })
    ).not.toBeInTheDocument();
    expect(virtuosoFollowOutputCallbacks.at(-1)?.(false)).toBe(false);
    expect(virtuosoScrollToIndexCalls).toEqual([]);
    expect(virtuosoScrollerScrollTopWrites).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(virtuosoScrollerScrollTopWrites).toEqual([972]);

    fireEvent.click(getByText("drag scrollbar up"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    const scrollToBottomControl = getByRole("button", {
      name: /chat paused due to scroll/i,
    });
    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);
    expect(scrollToBottomControl).toBeVisible();
    expect(virtuosoFollowOutputCallbacks.at(-1)?.(false)).toBe(false);

    virtuosoScrollToIndexCalls.length = 0;
    virtuosoScrollerScrollTopWrites.length = 0;
    act(() => {
      useChatStore.getState().addMessage(message("second-live", "alpha", "Second live"));
    });
    virtuosoScrollerHeight.current = 1344;
    act(() => {
      virtuosoTotalListHeightChangedCallbacks.at(-1)?.(1344);
    });

    expect(getByText("Second live")).toBeInTheDocument();
    expect(virtuosoScrollToIndexCalls).toHaveLength(0);
    expect(virtuosoScrollerScrollTopWrites).toHaveLength(0);

    fireEvent.click(scrollToBottomControl);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(virtuosoScrollToIndexCalls).toEqual([
      { index: "LAST", align: "end", behavior: "auto" },
    ]);
    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);
    expect(scrollToBottomControl).toBeVisible();

    act(() => {
      virtuosoAtBottomStateChangeCallbacks.at(-1)?.(true);
    });

    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(false);
    expect(
      queryByRole("button", { name: /chat paused due to scroll/i })
    ).not.toBeInTheDocument();
    expect(virtuosoFollowOutputCallbacks.at(-1)?.(true)).toBe(false);
  });

  it("disables all auto-follow immediately on wheel-up intent before pause debounce completes", () => {
    const { getByText } = render(<ChatMessageList channelKey={channelA} />);
    const followOutput = virtuosoFollowOutputCallbacks.at(-1);
    expect(followOutput).toBeTypeOf("function");
    expect(followOutput?.(true)).toBe(false);

    fireEvent.click(getByText("wheel up"));

    expect(followOutput?.(false)).toBe(false);
    virtuosoScrollToIndexCalls.length = 0;
    virtuosoScrollerScrollTopWrites.length = 0;

    virtuosoScrollerHeight.current = 1272;
    act(() => {
      virtuosoTotalListHeightChangedCallbacks.at(-1)?.(1272);
    });

    expect(virtuosoScrollToIndexCalls).toHaveLength(0);
    expect(virtuosoScrollerScrollTopWrites).toHaveLength(0);
  });

  it.each([
    ["Twitch", channelA, "twitch", "wheel up"],
    ["Kick", kickChannel, "kick", "drag scrollbar up"],
  ] as const)(
    "%s fresh history shows the scroll-to-bottom control on the first upward input",
    async (_platformName, channelKey, platform, upwardControl) => {
      vi.useFakeTimers();
      act(() => {
        useChatStore.getState().prependMessages(channelKey, [
          message(`${platform}-history`, "alpha", "History", {
            platform,
            isHistorical: true,
          }),
        ]);
      });

      const { getByRole, getByText, queryByRole } = render(
        <ChatMessageList channelKey={channelKey} />
      );

      expect(
        queryByRole("button", { name: /chat paused due to scroll/i })
      ).not.toBeInTheDocument();

      fireEvent.click(getByText("hydrate away from bottom"));
      expect(
        queryByRole("button", { name: /chat paused due to scroll/i })
      ).not.toBeInTheDocument();

      fireEvent.click(getByText(upwardControl));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      expect(
        getByRole("button", { name: /chat paused due to scroll/i })
      ).toBeVisible();
    }
  );

  it.each([
    ["Twitch", channelA, "twitch", "wheel up"],
    ["Kick", kickChannel, "kick", "drag scrollbar up"],
  ] as const)(
    "%s async history hydration shows the control on the first upward input",
    async (_platformName, channelKey, platform, upwardControl) => {
      vi.useFakeTimers();
      const { getByRole, getByText, queryByRole, queryByTestId } = render(
        <ChatMessageList channelKey={channelKey} />
      );

      expect(queryByTestId("chat-message")).not.toBeInTheDocument();
      expect(
        queryByRole("button", { name: /chat paused due to scroll/i })
      ).not.toBeInTheDocument();

      act(() => {
        useChatStore.getState().prependMessages(channelKey, [
          message(`${platform}-async-history`, "alpha", "Hydrated history", {
            platform,
            isHistorical: true,
          }),
        ]);
      });
      expect(getByText("Hydrated history")).toBeInTheDocument();

      fireEvent.click(getByText("hydrate away from bottom"));
      expect(
        queryByRole("button", { name: /chat paused due to scroll/i })
      ).not.toBeInTheDocument();

      fireEvent.click(getByText(upwardControl));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      expect(
        getByRole("button", { name: /chat paused due to scroll/i })
      ).toBeVisible();
    }
  );

  it.each([
    ["scrollbar dragging", "drag scrollbar up"],
    ["PageUp keyboard scrolling", "page up"],
  ])(
    "keeps auto-follow disabled after %s moves the scroller away from bottom",
    (_inputMethod, controlName) => {
      const { getByText } = render(<ChatMessageList channelKey={channelA} />);
      const followOutput = virtuosoFollowOutputCallbacks.at(-1);
      expect(followOutput).toBeTypeOf("function");

      fireEvent.click(getByText(controlName));

      expect(followOutput?.(false)).toBe(false);
      virtuosoScrollToIndexCalls.length = 0;
      virtuosoScrollerScrollTopWrites.length = 0;

      virtuosoScrollerHeight.current = 1272;
      act(() => {
        virtuosoTotalListHeightChangedCallbacks.at(-1)?.(1272);
      });

      expect(virtuosoScrollToIndexCalls).toHaveLength(0);
      expect(virtuosoScrollerScrollTopWrites).toHaveLength(0);
    }
  );

  it("settles a keyed platform remount before its first upward input", async () => {
    vi.useFakeTimers();
    const { getByRole, getByText, queryByRole, rerender } = render(
      <ChatMessageList key={channelA} channelKey={channelA} />
    );

    fireEvent.click(getByText("leave bottom"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(getByRole("button", { name: /chat paused due to scroll/i })).toBeVisible();
    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);

    rerender(<ChatMessageList key={kickChannel} channelKey={kickChannel} />);

    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);
    expect(useChatStore.getState().pausedChannels.has(kickChannel)).toBe(false);
    expect(
      queryByRole("button", { name: /chat paused due to scroll/i })
    ).not.toBeInTheDocument();

    act(() => {
      useChatStore.getState().prependMessages(kickChannel, [
        message("kick-remount-history", "alpha", "Kick remount history", {
          platform: "kick",
          isHistorical: true,
        }),
      ]);
      useChatStore.getState().addMessage(
        message("kick-remount-live", "alpha", "Kick remount live", { platform: "kick" })
      );
    });
    expect(getByText("Kick remount history")).toBeInTheDocument();
    expect(getByText("Kick remount live")).toBeInTheDocument();

    virtuosoScrollerHeight.current = 1272;
    fireEvent.click(getByText("hydrate away from bottom"));
    virtuosoScrollToIndexCalls.length = 0;
    virtuosoScrollerScrollTopWrites.length = 0;
    act(() => {
      virtuosoTotalListHeightChangedCallbacks.at(-1)?.(1272);
    });

    expect(virtuosoScrollToIndexCalls).toEqual([]);
    expect(virtuosoScrollerScrollTopWrites).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(virtuosoScrollerScrollTopWrites).toEqual([972]);
    expect(virtuosoFollowOutputCallbacks.at(-1)?.(false)).toBe(false);
    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);
    expect(useChatStore.getState().pausedChannels.has(kickChannel)).toBe(false);
    expect(
      queryByRole("button", { name: /chat paused due to scroll/i })
    ).not.toBeInTheDocument();

    fireEvent.click(getByText("drag scrollbar up"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);
    expect(useChatStore.getState().pausedChannels.has(kickChannel)).toBe(true);
    expect(getByRole("button", { name: /chat paused due to scroll/i })).toBeVisible();
  });

  it("shows the scroll-to-bottom control only at the meaningful bottom-gap threshold", async () => {
    vi.useFakeTimers();
    const { getByText, queryByRole } = render(<ChatMessageList channelKey={channelA} />);

    fireEvent.click(getByText("scroll up to 19px gap"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(false);
    expect(
      queryByRole("button", { name: /chat paused due to scroll/i })
    ).not.toBeInTheDocument();

    fireEvent.click(getByText("scroll up to 20px gap"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);
    expect(
      queryByRole("button", { name: /chat paused due to scroll/i })
    ).toBeVisible();
  });

  it("keeps the scroll-to-bottom control paused until the list confirms bottom", async () => {
    vi.useFakeTimers();
    const { getByRole, getByText, queryByRole } = render(
      <ChatMessageList channelKey={channelA} />
    );

    fireEvent.click(getByText("leave bottom"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    const scrollToBottomControl = getByRole("button", {
      name: /chat paused due to scroll/i,
    });
    fireEvent.click(scrollToBottomControl);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(virtuosoScrollToIndexCalls).toContainEqual({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);
    expect(scrollToBottomControl).toBeVisible();
    expect(virtuosoFollowOutputCallbacks.at(-1)?.(false)).toBe(false);

    act(() => {
      virtuosoAtBottomStateChangeCallbacks.at(-1)?.(true);
    });

    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(false);
    expect(
      queryByRole("button", { name: /chat paused due to scroll/i })
    ).not.toBeInTheDocument();
    expect(virtuosoFollowOutputCallbacks.at(-1)?.(true)).toBe(false);
  });

  it("settles a residual bottom gap after the return-to-live trim commits", async () => {
    vi.useFakeTimers();
    const { getByRole, getByText, queryByRole } = render(
      <ChatMessageList channelKey={channelA} />
    );

    fireEvent.click(getByText("leave bottom"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    virtuosoScrollerHeight.current = 1230;
    virtuosoScrollToIndexCalls.length = 0;
    virtuosoScrollerScrollTopWrites.length = 0;
    const scrollToBottomControl = getByRole("button", { name: /scroll to live/i });
    fireEvent.click(scrollToBottomControl);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(virtuosoScrollToIndexCalls).toEqual([
      { index: "LAST", align: "end", behavior: "auto" },
    ]);
    expect(virtuosoScrollerScrollTopWrites).toEqual([930]);
    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);
    expect(scrollToBottomControl).toBeVisible();

    act(() => {
      virtuosoAtBottomStateChangeCallbacks.at(-1)?.(true);
    });

    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(false);
    expect(
      queryByRole("button", { name: /scroll to live/i })
    ).not.toBeInTheDocument();
  });

  it("trims a paused backlog before the deferred return-to-live scroll", async () => {
    vi.useFakeTimers();
    setChatDisplay({ messageLimit: 50 });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      return window.setTimeout(() => callback(0), 0);
    });
    const { getByRole, getByText } = render(<ChatMessageList channelKey={channelA} />);

    fireEvent.click(getByText("leave bottom"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    act(() => {
      useChatStore.setState({
        messagesByChannel: {
          [channelA]: Array.from({ length: 80 }, (_, index) =>
            message(`paused-${index}`, "alpha", `Paused ${index}`)
          ),
        },
      });
    });
    virtuosoScrollToIndexCalls.length = 0;

    fireEvent.click(getByRole("button", { name: /scroll to live/i }));

    expect(useChatStore.getState().messagesByChannel[channelA]).toHaveLength(50);
    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);
    expect(virtuosoScrollToIndexCalls).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(virtuosoScrollToIndexCalls).toEqual([
      { index: "LAST", align: "end", behavior: "auto" },
    ]);
  });

  it("keeps settling live growth after return-to-live is clicked but before bottom confirms", async () => {
    vi.useFakeTimers();
    const { getByRole, getByText, queryByRole } = render(
      <ChatMessageList channelKey={channelA} />
    );

    fireEvent.click(getByText("leave bottom"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    const scrollToBottomControl = getByRole("button", {
      name: /scroll to live/i,
    });
    fireEvent.click(scrollToBottomControl);
    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);
    expect(scrollToBottomControl).toBeVisible();

    virtuosoScrollToIndexCalls.length = 0;
    virtuosoScrollerScrollTopWrites.length = 0;
    virtuosoScrollerHeight.current = 1272;
    act(() => {
      useChatStore.getState().addMessage(message("live-during-return", "alpha", "New live"));
    });
    act(() => {
      virtuosoTotalListHeightChangedCallbacks.at(-1)?.(1272);
    });

    expect(virtuosoScrollToIndexCalls).toEqual([]);
    expect(virtuosoScrollerScrollTopWrites).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(virtuosoScrollerScrollTopWrites).toEqual([972]);
    expect(virtuosoFollowOutputCallbacks.at(-1)?.(false)).toBe(false);
    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(true);
    expect(scrollToBottomControl).toBeVisible();

    act(() => {
      virtuosoAtBottomStateChangeCallbacks.at(-1)?.(true);
    });

    expect(useChatStore.getState().pausedChannels.has(channelA)).toBe(false);
    expect(
      queryByRole("button", { name: /scroll to live/i })
    ).not.toBeInTheDocument();
    expect(virtuosoFollowOutputCallbacks.at(-1)?.(true)).toBe(false);
  });

  it("renders an accessible width-safe scroll-to-live control above chat chrome", async () => {
    vi.useFakeTimers();
    const { getByRole, getByText } = render(<ChatMessageList channelKey={channelA} />);

    fireEvent.click(getByText("leave bottom"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    const control = getByRole("button", { name: /scroll to (live|newest)/i });
    const wrapper = control.parentElement;

    expect(wrapper).toHaveClass(
      "absolute",
      "inset-x-2",
      "max-w-full",
      "pointer-events-none",
      "z-[60]"
    );
    expect(control).toHaveClass(
      "pointer-events-auto",
      "max-w-full",
      "min-w-0",
      "bg-[#2d2d2d]",
      "focus-visible:ring-2",
      "motion-reduce:transition-none"
    );
    expect(control.querySelector('[data-icon="arrow-down"]')).toBeInTheDocument();
  });

  it("keeps the paused control and unread count stable as live messages arrive", async () => {
    vi.useFakeTimers();
    const { getByRole, getByText } = render(<ChatMessageList channelKey={channelA} />);

    fireEvent.click(getByText("leave bottom"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    virtuosoScrollToIndexCalls.length = 0;
    virtuosoScrollerScrollTopWrites.length = 0;
    act(() => {
      useChatStore.getState().addMessage(message("live-while-paused", "alpha", "New live"));
      virtuosoScrollerHeight.current = 1272;
    });
    act(() => {
      virtuosoTotalListHeightChangedCallbacks.at(-1)?.(1272);
    });

    const scrollToBottomControl = getByRole("button", {
      name: /chat paused due to scroll/i,
    });
    expect(scrollToBottomControl).toBeVisible();
    expect(scrollToBottomControl).toHaveTextContent("1 new message");
    expect(virtuosoScrollToIndexCalls).toHaveLength(0);
    expect(virtuosoScrollerScrollTopWrites).toHaveLength(0);
    expect(virtuosoFollowOutputCallbacks.at(-1)?.(false)).toBe(false);
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
