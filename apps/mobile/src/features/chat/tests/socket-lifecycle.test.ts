import { describe, expect, it, vi } from "vitest";
import { createWatchChatSession } from "../adapters/create-watch-chat-session";
import type { WatchChatSocket } from "../capabilities/watch-chat";

describe("guest socket generations", () => {
  it("reconnects Twitch after an initial socket failure without manual retry", async () => {
    vi.useFakeTimers();
    try {
      const sockets: WatchChatSocket[] = [];
      const session = createWatchChatSession({
        fetch: async () => new Response("{}"),
        socketFactory: () => {
          const wire: WatchChatSocket = {
            onopen: null,
            onclose: null,
            onerror: null,
            onmessage: null,
            send: () => undefined,
            close: () => wire.onclose?.({ code: 1006 }),
          };
          sockets.push(wire);
          return wire;
        },
      });
      session.attach({ channelId: "1", channelName: "one", platform: "twitch" });
      sockets[0]?.onerror?.();
      sockets[0]?.onclose?.({ code: 1006 });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sockets).toHaveLength(2);
      sockets[1]?.onopen?.();
      expect(session.snapshot()).toMatchObject({ kind: "empty", detail: "Chat is live." });
      session.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps chat in reconnecting state while a queued message update expires", async () => {
    vi.useFakeTimers();
    try {
      let wire: WatchChatSocket | undefined;
      const session = createWatchChatSession({
        fetch: async () => new Response("{}"),
        socketFactory: () => {
          wire = {
            onopen: null,
            onclose: null,
            onerror: null,
            onmessage: null,
            send: () => undefined,
            close: () => undefined,
          };
          return wire;
        },
      });
      session.attach({ channelId: "1", channelName: "one", platform: "twitch" });
      wire?.onopen?.();
      wire?.onmessage?.({
        data: "@id=m1;display-name=Ada :ada!ada@ada PRIVMSG #one :hello",
      });
      wire?.onclose?.({ code: 1006 });
      await vi.advanceTimersByTimeAsync(100);
      expect(session.snapshot()).toEqual({
        kind: "connecting",
        detail: "Reconnecting chat.",
      });
      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it("ignores old channel frames and closes without reconnecting after disposal", () => {
    const sockets: WatchChatSocket[] = [];
    const session = createWatchChatSession({
      fetch: async () => new Response("{}"),
      socketFactory: () => {
        const socket: WatchChatSocket = {
          onopen: null,
          onclose: null,
          onerror: null,
          onmessage: null,
          send: () => undefined,
          close: () => {
            socket.onclose?.({ code: 1000 });
          },
        };
        sockets.push(socket);
        return socket;
      },
    });
    session.attach({ channelId: "1", channelName: "one", platform: "twitch" });
    sockets[0]?.onopen?.();
    session.attach({ channelId: "2", channelName: "two", platform: "twitch" });
    sockets[1]?.onopen?.();
    sockets[0]?.onmessage?.({
      data: "@id=old;display-name=Old :old!old@old PRIVMSG #one :stale",
    });
    sockets[1]?.onmessage?.({
      data: "@id=current;display-name=Ada :ada!ada@ada PRIVMSG #two :hello",
    });
    expect(session.snapshot()).toMatchObject({
      kind: "live",
      messages: [{ id: "current", text: "hello" }],
    });
    session.dispose();
    sockets[1]?.onmessage?.({
      data: "@id=disposed;display-name=Ada :ada!ada@ada PRIVMSG #two :late",
    });
    expect(session.snapshot()).toEqual({
      kind: "connecting",
      detail: "Connecting guest chat.",
    });
    expect(sockets).toHaveLength(2);
  });
  it("does not retain an unbounded IRC fragment buffer", () => {
    let socket: WatchChatSocket | undefined;
    const session = createWatchChatSession({
      fetch: async () => new Response("{}"),
      socketFactory: () => {
        socket = {
          onopen: null,
          onclose: null,
          onerror: null,
          onmessage: null,
          send: () => undefined,
          close: () => undefined,
        };
        return socket;
      },
    });
    session.attach({ channelId: "1", channelName: "one", platform: "twitch" });
    socket?.onopen?.();
    socket?.onmessage?.({ data: "a".repeat(65_537) });
    expect(session.snapshot()).toEqual({
      kind: "failed",
      retry: "manual",
      detail: "Twitch chat sent an oversized frame.",
    });
    session.dispose();
  });
});
