import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pusher-js is loaded at module-init time by kick-chat.ts but only used inside
// connect() / joinChannel(). These tests bypass those paths by populating the
// internal channels map directly, so a no-op mock is enough to import the file.
vi.mock("pusher-js", () => ({
  default: vi.fn(),
}));

// The kick-chat service now goes through `window.electronAPI.kickChat` for all
// send-window operations (the direct kick-send-window import was leaking
// electron + better-sqlite3 into the renderer bundle). Stub the window surface
// here so the tests can assert on the bridge surface instead of the underlying
// module. See `apps/desktop/src/backend/ipc/handlers/kick-chat-handlers.ts`.
const kickChatApi = {
  ensureSendWindowReady: vi.fn(() => Promise.resolve()),
  sendMessage: vi.fn(),
  disposeSendWindow: vi.fn(() => Promise.resolve()),
};

vi.stubGlobal("window", {
  electronAPI: {
    kickChat: kickChatApi,
  },
} as unknown as Window);

import { KickChatService } from "@/backend/services/chat/kick-chat";
import { buildChannelKey, useChatStore } from "@/store/chat-store";
import type { ChatMessage } from "@/shared/chat-types";
import type { KickChatMessageEvent } from "@/backend/services/chat/kick-parser";

// Guards: kick-chat sendMessage wire format — POST /public/v1/chat must carry the
// broadcaster's user_id (channel data.id), NOT the chatroom id used for Pusher.
// These are two distinct numeric ids on Kick; swapping them or falling back to
// chatroomId reintroduces the pre-306a8e5 bug where Kick rejects every send.
// Guards: 401 must surface a user-actionable message naming the recovery path
// (disconnect/reconnect Kick), not a bare "401 Unauthorized" — without that hint
// existing users hit by the chat:write scope rollout have no way to recover.

interface InternalChannelInfo {
  slug: string;
  chatroomId: number;
  broadcasterUserId?: number;
  pusherChannel?: { unbind_all: () => void };
}

interface ServiceInternals {
  channels: Map<string, InternalChannelInfo>;
  channelUsers: Map<string, number>;
}

function makeService(): { service: KickChatService; internals: ServiceInternals } {
  const service = new KickChatService();
  const internals = service as unknown as ServiceInternals;
  return { service, internals };
}

function makeChatMessage(id: string, channel: string): ChatMessage {
  return {
    id,
    platform: "kick",
    channel,
    userId: "user-1",
    username: "tester",
    displayName: "Tester",
    color: "#fff",
    content: [{ type: "text", content: "hello" }],
    badges: [],
    rawContent: "hello",
    timestamp: new Date(),
    type: "message",
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
  };
}

function seedKickBucket(channel: string): string {
  const channelKey = buildChannelKey("kick", channel);
  const message = makeChatMessage("m-1", channel);
  useChatStore.setState({
    messagesByChannel: { [channelKey]: [message] },
    pausedChannels: new Set([channelKey]),
  });
  return channelKey;
}

afterEach(() => {
  useChatStore.setState({
    messagesByChannel: {},
    pausedChannels: new Set(),
  });
});

describe("KickChatService channel-scoped release eviction", () => {
  it("keeps a channel bucket while another panel still holds it, then evicts on the last release", async () => {
    const { service, internals } = makeService();
    const channelKey = seedKickBucket("xqc");
    const pusherChannel = { unbind_all: vi.fn() };
    internals.channels.set("xqc", {
      slug: "xqc",
      chatroomId: 1,
      broadcasterUserId: 2,
      pusherChannel,
    });

    service.acquire("xqc");
    service.acquire("xqc");

    await service.release("xqc");

    expect(useChatStore.getState().messagesByChannel[channelKey]).toHaveLength(1);
    expect(useChatStore.getState().pausedChannels.has(channelKey)).toBe(true);
    expect(internals.channels.has("xqc")).toBe(true);
    expect(pusherChannel.unbind_all).not.toHaveBeenCalled();

    await service.release("xqc");

    expect(useChatStore.getState().messagesByChannel[channelKey]).toBeUndefined();
    expect(useChatStore.getState().pausedChannels.has(channelKey)).toBe(false);
    expect(internals.channels.has("xqc")).toBe(false);
  });

  it("evicts active channel buckets during force shutdown", async () => {
    const { service, internals } = makeService();
    const channelKey = seedKickBucket("xqc");
    const pusher = {
      connection: { unbind_all: vi.fn() },
      disconnect: vi.fn(),
    };
    (service as unknown as { pusher: typeof pusher }).pusher = pusher;
    internals.channels.set("xqc", {
      slug: "xqc",
      chatroomId: 1,
      broadcasterUserId: 2,
      pusherChannel: { unbind_all: vi.fn() },
    });
    service.acquire("xqc");

    await service.forceShutdown();

    expect(useChatStore.getState().messagesByChannel[channelKey]).toBeUndefined();
    expect(useChatStore.getState().pausedChannels.has(channelKey)).toBe(false);
    expect(internals.channelUsers.has("xqc")).toBe(false);
  });
});

describe("KickChatService.sendMessage", () => {
  beforeEach(() => {
    kickChatApi.sendMessage.mockResolvedValue({
      ok: true,
      messageId: "01JAXK8N",
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    kickChatApi.sendMessage.mockReset();
    kickChatApi.ensureSendWindowReady.mockClear();
    kickChatApi.disposeSendWindow.mockClear();
  });

  it("calls sendKickChatMessage with chatroomId plus broadcaster_user_id for official fallback", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111,
      broadcasterUserId: 42,
    });
    await service.sendMessage("ac7ionman", "hello");
    expect(kickChatApi.sendMessage).toHaveBeenCalledWith(999_111, "hello", 42);
    const [firstArg] = kickChatApi.sendMessage.mock.calls[0]!;
    expect(firstArg).not.toBe(42);
  });

  it("surfaces auth-expired as an actionable error with reconnect hint", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111,
      broadcasterUserId: 42,
    });
    kickChatApi.sendMessage.mockResolvedValueOnce({
      ok: false,
      kind: "auth-expired",
      message: "Kick session expired — reconnect Kick in Settings.",
    });
    await expect(service.sendMessage("ac7ionman", "hi")).rejects.toThrow(/reconnect Kick/i);
  });

  it("optimistic echo uses pre-rendered fragments when provided (emote images, not raw text)", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111,
      broadcasterUserId: 42,
    });
    const messages: any[] = [];
    service.on("message", (m) => messages.push(m));
    const fragments = [
      { type: "text" as const, content: "hi " },
      {
        type: "emote" as const,
        id: "12345",
        name: "PeepoClap",
        url: "https://files.kick.com/emotes/12345/fullsize",
        isAnimated: false,
        isZeroWidth: false,
      },
    ];
    await service.sendMessage(
      "ac7ionman",
      "hi PeepoClap",
      { id: 7, username: "me", slug: "me" },
      fragments,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toEqual(fragments);
    // rawContent stays the wire string for parity with the inbound Pusher shape.
    expect(messages[0].rawContent).toBe("hi PeepoClap");
  });

  // Guards: local Kick reply echoes must render with the same replyTo row as incoming Kick/Twitch replies.
  it("optimistic echo includes local reply metadata when provided", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111,
      broadcasterUserId: 42,
    });
    const messages: any[] = [];
    service.on("message", (m) => messages.push(m));
    const replyTo = {
      parentMessageId: "parent-1",
      parentUserId: "parent-user",
      parentUsername: "alice",
      parentDisplayName: "Alice",
      parentMessageBody: "hello there",
    };
    const fragments = [{ type: "text" as const, content: "hi back" }];

    await service.sendMessage(
      "ac7ionman",
      "@alice hi back",
      { id: 7, username: "me", slug: "me" },
      fragments,
      replyTo,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toEqual(fragments);
    expect(messages[0].rawContent).toBe("@alice hi back");
    expect(messages[0].replyTo).toEqual(replyTo);
  });

  it("optimistic echo falls back to a single text fragment when fragments are omitted", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111,
      broadcasterUserId: 42,
    });
    const messages: any[] = [];
    service.on("message", (m) => messages.push(m));
    await service.sendMessage("ac7ionman", "hi", { id: 7, username: "me", slug: "me" });
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toEqual([{ type: "text", content: "hi" }]);
  });

  it("optimistic echo does not synthesize a moderator badge for the signed-in Kick user", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111,
      broadcasterUserId: 42,
    });
    const messages: any[] = [];
    service.on("message", (m) => messages.push(m));

    service.setModeratorState("ac7ionman", true);
    await service.sendMessage("ac7ionman", "mod hi", { id: 7, username: "me", slug: "me" });

    service.setModeratorState("ac7ionman", false);
    await service.sendMessage("ac7ionman", "viewer hi", { id: 7, username: "me", slug: "me" });

    expect(messages[0].badges.some((badge: { setId: string }) => badge.setId === "moderator")).toBe(
      false
    );
    expect(messages[1].badges.some((badge: { setId: string }) => badge.setId === "moderator")).toBe(
      false
    );
  });

  it("optimistic echo strips stale cached moderator badges but keeps ordinary badges", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111,
      broadcasterUserId: 42,
    });
    const messages: any[] = [];
    service.on("message", (m) => messages.push(m));
    const cachedBadges = new Map<string, Array<{ setId: string; version: string; imageUrl: string; title: string }>>([
      [
        "7",
        [
          { setId: "subscriber", version: "1", imageUrl: "", title: "Subscriber" },
          { setId: "moderator", version: "1", imageUrl: "", title: "Moderator" },
        ],
      ],
    ]);
    (service as any).senderBadgesCache.set("ac7ionman", cachedBadges);

    service.setModeratorState("ac7ionman", true);
    await service.sendMessage("ac7ionman", "cached badge hi", {
      id: 7,
      username: "me",
      slug: "me",
    });

    expect(messages[0].badges.map((badge: { setId: string }) => badge.setId)).toEqual([
      "subscriber",
    ]);
  });

  it("incoming broadcaster messages drop Kick moderator badges before rendering and caching", () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111,
      broadcasterUserId: 7,
    });
    const messages: any[] = [];
    service.on("message", (m) => messages.push(m));
    const event: KickChatMessageEvent = {
      id: "msg-broadcaster-1",
      chatroom_id: 999_111,
      content: "broadcaster hi",
      type: "message",
      created_at: "2026-06-28T20:00:00Z",
      sender: {
        id: 7,
        username: "Me",
        slug: "me",
        identity: {
          color: "#53FC18",
          badges: [
            { type: "broadcaster", text: "Broadcaster" },
            { type: "moderator", text: "Moderator" },
            { type: "subscriber", text: "Sub", count: 3 },
          ],
        },
      },
    };

    (service as any).handleChatMessage(event, "ac7ionman");

    expect(messages).toHaveLength(1);
    expect(messages[0].badges.map((badge: { setId: string }) => badge.setId)).toEqual([
      "broadcaster",
      "subscriber",
    ]);
    const cache = (service as any).senderBadgesCache.get("ac7ionman").get("7");
    expect(cache.map((badge: { setId: string }) => badge.setId)).toEqual([
      "broadcaster",
      "subscriber",
    ]);
  });

  it("surfaces rate-limited cleanly", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111,
      broadcasterUserId: 42,
    });
    kickChatApi.sendMessage.mockResolvedValueOnce({
      ok: false,
      kind: "rate-limited",
      message: "Slow down — Kick rate limit.",
      retryAfterSeconds: 5,
    });
    await expect(service.sendMessage("ac7ionman", "hi")).rejects.toThrow(/Slow down/);
  });
});

describe("KickChatService.joinChannel send-window warmup", () => {
  // Guards: joining Kick chat must not warm the hidden kick.com send window during stream startup.
  // Chat send still initializes it on demand via sendMessage, avoiding hidden player/network churn.
  it("does not warm the send window until a message is sent", async () => {
    const { service, internals } = makeService();
    // Fake Pusher state so joinChannel doesn't blow up on the WebSocket path.
    (service as any).pusher = {
      connection: { state: "connected" },
      subscribe: vi.fn(() => ({ bind: vi.fn() })),
    };
    (service as any).connectionState = "connected";
    await service.joinChannel("ac7ionman", 999_111, 42);
    expect(kickChatApi.ensureSendWindowReady).not.toHaveBeenCalled();
    expect(internals.channels.has("ac7ionman")).toBe(true);
  });
});

describe("send-window disposal", () => {
  it("leaveChannel that empties the active set disposes the window", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111,
      broadcasterUserId: 42,
    });
    (service as any).pusher = {
      connection: { state: "connected" },
      unsubscribe: vi.fn(),
    };
    await service.leaveChannel("ac7ionman");
    expect(kickChatApi.disposeSendWindow).toHaveBeenCalled();
  });

  it("leaveChannel that leaves other channels active does NOT dispose", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", { slug: "ac7ionman", chatroomId: 999_111, broadcasterUserId: 42 });
    internals.channels.set("xqc", { slug: "xqc", chatroomId: 1, broadcasterUserId: 2 });
    (service as any).pusher = {
      connection: { state: "connected" },
      unsubscribe: vi.fn(),
    };
    kickChatApi.disposeSendWindow.mockClear();
    await service.leaveChannel("ac7ionman");
    expect(kickChatApi.disposeSendWindow).not.toHaveBeenCalled();
  });

  it("forceShutdown disposes the window", async () => {
    const { service } = makeService();
    kickChatApi.disposeSendWindow.mockClear();
    await service.forceShutdown();
    expect(kickChatApi.disposeSendWindow).toHaveBeenCalled();
  });
});

describe("KickChatService teardown does not race the Pusher socket close", () => {
  // Guards: leaveChannel must skip pusher.unsubscribe when connection.state is not 'connected' — pusher-js otherwise tries to flush the unsubscribe frame on a closing/closed socket and logs "WebSocket is already in CLOSING or CLOSED state"
  // Guards: leaveChannel must also skip pusher.unsubscribe when the raw WebSocket is already CLOSING/CLOSED even if Pusher's public state still says connected
  // Guards: final-user release must not enqueue channel unsubscribe frames immediately before shutdown closes the shared Pusher socket
  // Guards: disconnect() must defer closing a CONNECTING raw WebSocket until it opens, preventing the browser-level "WebSocket is closed before the connection is established" console error
  // Guards: disconnect() must not call pusher.unsubscribe per channel — closing the socket implicitly unsubscribes server-side, and the explicit frame races the close
  // Guards: forceShutdown() must keep per-channel unbind_all() (local closure cleanup) but drop pusher.unsubscribe (socket-touching frame that races the disconnect)
  function makePusherStub(
    state: "connected" | "disconnected" | "connecting" | "unavailable" | "failed",
    socketReadyState: number = 1,
  ) {
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    return {
      connection: {
        state,
        connection: {
          transport: {
            state: socketReadyState === 1 ? "open" : "connecting",
            socket: { readyState: socketReadyState },
          },
        },
        bind: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          const existing = handlers.get(event) ?? new Set();
          existing.add(handler);
          handlers.set(event, existing);
        }),
        unbind: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          handlers.get(event)?.delete(handler);
        }),
        unbind_all: vi.fn(() => handlers.clear()),
      },
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
      __emitConnection: (event: string, ...args: unknown[]) => {
        for (const handler of handlers.get(event) ?? []) handler(...args);
      },
    };
  }

  function joinFakeChannel(
    internals: ServiceInternals,
    slug: string,
    chatroomId: number,
    pusherChannel: { unbind_all: () => void }
  ): void {
    internals.channels.set(slug, {
      slug,
      chatroomId,
      broadcasterUserId: chatroomId + 1,
      pusherChannel,
    });
  }

  it("leaveChannel does not call pusher.unsubscribe when the socket is already disconnected", async () => {
    const { service, internals } = makeService();
    const pusher = makePusherStub("disconnected");
    (service as unknown as { pusher: typeof pusher }).pusher = pusher;
    const pusherChannel = { unbind_all: vi.fn() };
    joinFakeChannel(internals, "ac7ionman", 999_111, pusherChannel);

    await service.leaveChannel("ac7ionman");

    expect(pusher.unsubscribe).not.toHaveBeenCalled();
    expect(internals.channels.has("ac7ionman")).toBe(false);
    expect(pusherChannel.unbind_all).toHaveBeenCalledOnce();
  });

  it("leaveChannel does not call pusher.unsubscribe when Pusher still says connected but the raw socket is closing", async () => {
    const { service, internals } = makeService();
    const pusher = makePusherStub("connected", 2);
    (service as unknown as { pusher: typeof pusher }).pusher = pusher;
    const pusherChannel = { unbind_all: vi.fn() };
    joinFakeChannel(internals, "ac7ionman", 999_111, pusherChannel);

    await service.leaveChannel("ac7ionman");

    expect(pusher.unsubscribe).not.toHaveBeenCalled();
    expect(internals.channels.has("ac7ionman")).toBe(false);
    expect(pusherChannel.unbind_all).toHaveBeenCalledOnce();
  });

  it("release does not enqueue unsubscribe frames when the final user is about to disconnect the socket", async () => {
    const { service, internals } = makeService();
    const pusher = makePusherStub("connected");
    (service as unknown as { pusher: typeof pusher }).pusher = pusher;
    const pusherChannel = { unbind_all: vi.fn() };
    joinFakeChannel(internals, "ac7ionman", 999_111, pusherChannel);
    service.acquire("ac7ionman");

    await service.release("ac7ionman");

    expect(pusher.unsubscribe).not.toHaveBeenCalled();
    expect(pusher.disconnect).toHaveBeenCalledOnce();
    expect(internals.channels.has("ac7ionman")).toBe(false);
    expect(pusherChannel.unbind_all).toHaveBeenCalledOnce();
  });

  it("disconnect does not call pusher.unsubscribe per channel; only pusher.disconnect", async () => {
    const { service, internals } = makeService();
    const pusher = makePusherStub("connected");
    (service as unknown as { pusher: typeof pusher }).pusher = pusher;
    joinFakeChannel(internals, "ac7ionman", 999_111, { unbind_all: vi.fn() });
    joinFakeChannel(internals, "xqc", 1_234, { unbind_all: vi.fn() });

    await service.disconnect();

    expect(pusher.unsubscribe).not.toHaveBeenCalled();
    expect(pusher.disconnect).toHaveBeenCalledOnce();
  });

  it("disconnect waits for a connecting raw socket to open before closing Pusher", async () => {
    const { service, internals } = makeService();
    const pusher = makePusherStub("connecting", 0);
    (service as unknown as { pusher: typeof pusher }).pusher = pusher;
    joinFakeChannel(internals, "ac7ionman", 999_111, { unbind_all: vi.fn() });

    await service.disconnect();

    expect(pusher.unsubscribe).not.toHaveBeenCalled();
    expect(pusher.disconnect).not.toHaveBeenCalled();
    expect(pusher.connection.bind).toHaveBeenCalledWith("connected", expect.any(Function));

    pusher.connection.state = "connected";
    pusher.connection.connection.transport.state = "open";
    pusher.connection.connection.transport.socket.readyState = 1;
    pusher.__emitConnection("connected");

    expect(pusher.disconnect).toHaveBeenCalledOnce();
    expect(pusher.connection.unbind).toHaveBeenCalledWith("connected", expect.any(Function));
    expect(pusher.connection.unbind).toHaveBeenCalledWith("failed", expect.any(Function));
    expect(pusher.connection.unbind).toHaveBeenCalledWith("disconnected", expect.any(Function));
  });

  it("forceShutdown unbinds per-channel handlers but does not call pusher.unsubscribe", async () => {
    const { service, internals } = makeService();
    const pusher = makePusherStub("connected");
    (service as unknown as { pusher: typeof pusher }).pusher = pusher;
    const chan1 = { unbind_all: vi.fn() };
    const chan2 = { unbind_all: vi.fn() };
    joinFakeChannel(internals, "ac7ionman", 999_111, chan1);
    joinFakeChannel(internals, "xqc", 1_234, chan2);

    await service.forceShutdown();

    expect(chan1.unbind_all).toHaveBeenCalledOnce();
    expect(chan2.unbind_all).toHaveBeenCalledOnce();
    expect(pusher.connection.unbind_all).toHaveBeenCalledOnce();
    expect(pusher.unsubscribe).not.toHaveBeenCalled();
    expect(pusher.disconnect).toHaveBeenCalledOnce();
  });
});
