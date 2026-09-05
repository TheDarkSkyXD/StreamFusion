import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MergedChatFeed } from "@/features/chat/components/chat/MergedChatFeed";
import type { MergedChatMessage } from "@/features/chat/data/multi-chat-feed";
import { createMultiChatChannel } from "@/features/chat/data/multi-chat-feed";
import { useChatStore } from "@/store/chat-store";
import type { ChatMessage } from "@shared/chat-types";

const virtuosoAtBottomStateChangeCallbacks = vi.hoisted<
  Array<((isAtBottom: boolean) => void) | undefined>
>(() => []);
const virtuosoScrollToIndex = vi.hoisted(() => vi.fn());

vi.mock("@/features/chat/components/chat/ChatMessage", () => ({
  ChatMessage: () => <div data-testid="chat-message" />,
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
        }: {
          data: MergedChatMessage[];
          itemContent: (index: number, message: MergedChatMessage) => React.ReactNode;
          atBottomStateChange?: (isAtBottom: boolean) => void;
        },
        ref
      ) => {
        React.useImperativeHandle(ref, () => ({ scrollToIndex: virtuosoScrollToIndex }), []);
        virtuosoAtBottomStateChangeCallbacks.push(atBottomStateChange);

        return (
          <div data-testid="virtuoso">
            {data.map((message, index) => (
              <div key={message.key}>{itemContent(index, message)}</div>
            ))}
          </div>
        );
      }
    ),
  };
});

const channel = createMultiChatChannel("twitch", "alpha", "Alpha");
const message: ChatMessage = {
  id: "message-1",
  platform: "twitch",
  type: "message",
  channel: "alpha",
  userId: "user-1",
  username: "user-1",
  displayName: "User 1",
  color: "#fff",
  badges: [],
  content: [{ type: "text", content: "Hello" }],
  rawContent: "Hello",
  timestamp: new Date("2026-09-05T00:00:00.000Z"),
  isDeleted: false,
  isHighlighted: false,
  isAction: false,
};

// Guards: merged chat must give viewers an accessible way to resume live follow after they scroll away from the bottom
describe("MergedChatFeed", () => {
  beforeEach(() => {
    useChatStore.getState().cleanupBatching();
    useChatStore.setState({ messagesByChannel: { [channel.key]: [message] } });
    virtuosoAtBottomStateChangeCallbacks.length = 0;
    virtuosoScrollToIndex.mockReset();
  });

  it("returns to the newest merged message and waits for bottom confirmation", () => {
    const { getByRole, queryByRole } = render(
      <MergedChatFeed channels={[channel]} onSelectChannel={() => undefined} />
    );

    expect(queryByRole("button", { name: /scroll to live/i })).not.toBeInTheDocument();

    act(() => {
      virtuosoAtBottomStateChangeCallbacks.at(-1)?.(false);
    });

    const returnToLiveButton = getByRole("button", { name: /scroll to live/i });
    expect(returnToLiveButton).toHaveTextContent("Chat paused due to scroll");
    fireEvent.click(returnToLiveButton);

    expect(virtuosoScrollToIndex).toHaveBeenCalledOnce();
    expect(virtuosoScrollToIndex).toHaveBeenCalledWith({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
    expect(returnToLiveButton).toBeVisible();

    act(() => {
      virtuosoAtBottomStateChangeCallbacks.at(-1)?.(true);
    });

    expect(queryByRole("button", { name: /scroll to live/i })).not.toBeInTheDocument();
  });
});
