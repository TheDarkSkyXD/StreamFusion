import { describe, expect, it } from "vitest";
import { createWatchChatSession } from "../adapters/create-watch-chat-session";
import type { WatchChatSocket } from "../capabilities/watch-chat";

describe("guest socket generations", () => {
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
