import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/shared/chat-types";
import {
  type KickHeldMessage,
  useKickAutoModQueueStore,
} from "@/store/kick-automod-queue";
import { useChatStore } from "@/store/chat-store";

// Mock the kick-chat service: the tab installs an interceptor via
// `setAutomodInterceptor`. We only need to confirm the tab calls it (we test
// the filter behavior in its own test file).
const setInterceptorMock = vi.fn();
vi.mock("@/backend/services/chat/kick-chat", () => ({
  kickChatService: {
    setAutomodInterceptor: (fn: unknown) => setInterceptorMock(fn),
  },
}));

// Stub the config hook so tests don't touch SQLite.
vi.mock("@/hooks/useKickAutoModConfig", () => ({
  useKickAutoModConfig: () => ({
    config: null,
    reload: vi.fn(),
    setBlocklist: vi.fn(),
    setSeverity: vi.fn(),
    addAllowlistUser: vi.fn(),
  }),
}));

import { KickAutoModTab } from "@/components/chat/mod/tabs/KickAutoModTab";

const CHANNEL_ID = "kick-c1";
const CHANNEL_SLUG = "test-streamer";
const CHATROOM_ID = 42;

function makeChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-k1",
    platform: "kick",
    type: "message",
    channel: CHANNEL_SLUG,
    userId: "u1",
    username: "baduser",
    displayName: "BadUser",
    color: "#fff",
    badges: [],
    content: [{ type: "text", content: "spam now" }],
    rawContent: "spam now",
    timestamp: new Date(),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
    ...overrides,
  } as ChatMessage;
}

function makeHeld(overrides: Partial<KickHeldMessage> = {}): KickHeldMessage {
  return {
    messageId: "msg-k1",
    channelSlug: CHANNEL_SLUG,
    chatroomId: CHATROOM_ID,
    senderUserId: "u1",
    senderUsername: "baduser",
    rawText: "spam now",
    category: "blocklist",
    matchedKeyword: "spam",
    parsedMessage: makeChatMessage(),
    heldAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  setInterceptorMock.mockReset();
  useKickAutoModQueueStore.setState({ byKey: new Map() });
  // Stub electronAPI for tests that fire the timeout action; harmless for others.
  (globalThis.window as unknown as { electronAPI: unknown }).electronAPI = {
    auth: { getToken: vi.fn().mockResolvedValue({ accessToken: "tok" }) },
  };
});

afterEach(() => {
  delete (globalThis.window as unknown as { electronAPI?: unknown })
    .electronAPI;
});

describe("KickAutoModTab", () => {
  it("renders held messages for the current channel", () => {
    useKickAutoModQueueStore.setState({
      byKey: new Map([[`${CHANNEL_SLUG}:msg-k1`, makeHeld()]]),
    });
    render(
      <KickAutoModTab
        channelId={CHANNEL_ID}
        channelSlug={CHANNEL_SLUG}
        chatroomId={CHATROOM_ID}
      />,
    );
    expect(screen.getByText("baduser")).toBeInTheDocument();
    expect(screen.getByText("spam now")).toBeInTheDocument();
    expect(screen.getByTestId("kick-automod-category").textContent).toContain(
      "blocklist",
    );
  });

  it("Approve releases the parsed message into chat-store and removes from queue", () => {
    const addMessageSpy = vi.fn();
    useChatStore.setState({ addMessage: addMessageSpy } as any);
    useKickAutoModQueueStore.setState({
      byKey: new Map([[`${CHANNEL_SLUG}:msg-k1`, makeHeld()]]),
    });
    render(
      <KickAutoModTab
        channelId={CHANNEL_ID}
        channelSlug={CHANNEL_SLUG}
        chatroomId={CHATROOM_ID}
      />,
    );
    fireEvent.click(screen.getByTestId("kick-automod-approve"));
    expect(addMessageSpy).toHaveBeenCalledTimes(1);
    const released = addMessageSpy.mock.calls[0][0] as ChatMessage;
    expect(released.id).toBe("msg-k1");
    expect(useKickAutoModQueueStore.getState().byKey.size).toBe(0);
  });

  it("Deny removes from queue without releasing the message", () => {
    const addMessageSpy = vi.fn();
    useChatStore.setState({ addMessage: addMessageSpy } as any);
    useKickAutoModQueueStore.setState({
      byKey: new Map([[`${CHANNEL_SLUG}:msg-k1`, makeHeld()]]),
    });
    render(
      <KickAutoModTab
        channelId={CHANNEL_ID}
        channelSlug={CHANNEL_SLUG}
        chatroomId={CHATROOM_ID}
      />,
    );
    fireEvent.click(screen.getByTestId("kick-automod-deny"));
    expect(addMessageSpy).not.toHaveBeenCalled();
    expect(useKickAutoModQueueStore.getState().byKey.size).toBe(0);
  });

  it("renders an empty state when no held messages exist", () => {
    render(
      <KickAutoModTab
        channelId={CHANNEL_ID}
        channelSlug={CHANNEL_SLUG}
        chatroomId={CHATROOM_ID}
      />,
    );
    expect(screen.getByText(/No held messages/i)).toBeInTheDocument();
    // Tab still installs the interceptor on mount.
    expect(setInterceptorMock).toHaveBeenCalled();
  });
});
