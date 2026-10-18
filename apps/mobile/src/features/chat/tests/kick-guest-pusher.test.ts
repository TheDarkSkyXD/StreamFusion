import { describe, expect, it, vi } from "vitest";

import { connectKickGuestChat } from "../adapters/kick-guest-pusher";
import type { WatchChatSocket } from "../capabilities/watch-chat";

function socket(): WatchChatSocket & {
  readonly sent: string[];
  readonly closeSpy: ReturnType<typeof vi.fn>;
} {
  const sent: string[] = [];
  const closeSpy = vi.fn();
  return {
    sent,
    closeSpy,
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    close: closeSpy,
    send: (frame) => sent.push(frame),
  };
}

function frame(
  socket: WatchChatSocket,
  event: string,
  channel?: string,
  data: unknown = {},
) {
  socket.onmessage?.({ data: JSON.stringify({ event, channel, data }) });
}

async function connect() {
  const wire = socket();
  const onOpen = vi.fn();
  const onError = vi.fn();
  const onClose = vi.fn();
  const onMessage = vi.fn();
  const close = await connectKickGuestChat({
    fetch: async (url) =>
      Response.json(
        String(url).includes("realtime/connection")
          ? {
              data: {
                mode: "websocket",
                connections: [
                  {
                    provider: "pusher",
                    credentials: { app_key: "currentkey", cluster: "us2" },
                  },
                ],
              },
            }
          : { chatroom: { id: 44 } },
      ),
    socketFactory: () => wire,
    signal: new AbortController().signal,
    randomUuid: () => "test-client-id",
    target: { platform: "kick", channelId: "1", channelName: "spreen" },
    onClose,
    onOpen,
    onError,
    onMessage,
  });
  return { wire, onOpen, onError, onClose, onMessage, close };
}

describe("Kick guest Pusher subscription", () => {
  it("negotiates a fresh public Pusher endpoint before opening a socket", async () => {
    const urls: string[] = [];
    const requests: string[] = [];
    const close = await connectKickGuestChat({
      fetch: async (url) => {
        requests.push(String(url));
        return Response.json(
          String(url).includes("realtime/connection")
            ? {
                data: {
                  mode: "websocket",
                  connections: [
                    {
                      provider: "pusher",
                      credentials: { app_key: "rotatedkey", cluster: "eu" },
                    },
                  ],
                },
              }
            : { chatroom: { id: 44 } },
        );
      },
      socketFactory: (url) => {
        urls.push(url);
        return socket();
      },
      signal: new AbortController().signal,
      randomUuid: () => "test-client-id",
      target: { platform: "kick", channelId: "1", channelName: "spreen" },
      onClose: vi.fn(),
      onOpen: vi.fn(),
      onError: vi.fn(),
      onMessage: vi.fn(),
    });
    expect(requests).toContain("https://web.kick.com/api/v1/realtime/connection");
    expect(urls).toEqual([
      "wss://ws-eu.pusher.com/app/rotatedkey?protocol=7&client=js&version=8.4.0&flash=false",
    ]);
    close();
  });

  it("reconnects after a transient close and negotiates new credentials", async () => {
    vi.useFakeTimers();
    try {
      const wires: WatchChatSocket[] = [];
      const keys = ["firstkey", "secondkey"];
      const onOpen = vi.fn();
      const close = await connectKickGuestChat({
        fetch: async (url) =>
          Response.json(
            String(url).includes("realtime/connection")
              ? {
                  data: {
                    mode: "websocket",
                    connections: [
                      {
                        provider: "pusher",
                        credentials: {
                          app_key: keys.shift(),
                          cluster: "us2",
                        },
                      },
                    ],
                  },
                }
              : { chatroom: { id: 44 } },
          ),
        socketFactory: () => {
          const wire = socket();
          wires.push(wire);
          return wire;
        },
        signal: new AbortController().signal,
        randomUuid: () => "test-client-id",
        target: { platform: "kick", channelId: "1", channelName: "spreen" },
        onClose: vi.fn(),
        onOpen,
        onError: vi.fn(),
        onMessage: vi.fn(),
      });
      frame(wires[0]!, "pusher:connection_established");
      frame(wires[0]!, "pusher:subscription_succeeded", "chatrooms.44.v2");
      expect(onOpen).toHaveBeenCalledTimes(1);
      wires[0]?.onclose?.({ code: 1006 });
      frame(wires[0]!, "pusher:subscription_succeeded", "chatrooms.44.v2");
      expect(onOpen).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(wires).toHaveLength(2);
      frame(wires[1]!, "pusher:connection_established");
      frame(wires[1]!, "pusher:subscription_succeeded", "chatrooms.44.v2");
      expect(onOpen).toHaveBeenCalledTimes(2);
      wires[1]?.onclose?.({ code: 1006 });
      close();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(wires).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a failed initial channel read before creating a socket", async () => {
    vi.useFakeTimers();
    try {
      let channelReads = 0;
      const wires: WatchChatSocket[] = [];
      const close = await connectKickGuestChat({
        fetch: async (url) => {
          if (!String(url).includes("realtime/connection")) {
            channelReads += 1;
            if (channelReads === 1) throw new Error("Network unavailable");
            return Response.json({ chatroom: { id: 44 } });
          }
          return Response.json({
            data: {
              mode: "websocket",
              connections: [
                {
                  provider: "pusher",
                  credentials: { app_key: "currentkey", cluster: "us2" },
                },
              ],
            },
          });
        },
        socketFactory: () => {
          const wire = socket();
          wires.push(wire);
          return wire;
        },
        signal: new AbortController().signal,
        randomUuid: () => "test-client-id",
        target: { platform: "kick", channelId: "1", channelName: "spreen" },
        onClose: vi.fn(),
        onOpen: vi.fn(),
        onError: vi.fn(),
        onMessage: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(channelReads).toBe(2);
      expect(wires).toHaveLength(1);
      close();
    } finally {
      vi.useRealTimers();
    }
  });
  it("opens only after the matching subscription succeeds and fences cross-channel messages", async () => {
    const { wire, onOpen, onMessage, close } = await connect();
    frame(wire, "pusher:connection_established");
    expect(JSON.parse(wire.sent[0] ?? "{}")).toMatchObject({
      event: "pusher:subscribe",
      data: { channel: "chatrooms.44.v2" },
    });
    expect(onOpen).not.toHaveBeenCalled();
    frame(wire, "pusher_internal:subscription_succeeded", "chatrooms.45.v2");
    expect(onOpen).not.toHaveBeenCalled();
    frame(wire, "pusher_internal:subscription_succeeded", "chatrooms.44.v2");
    expect(onOpen).toHaveBeenCalledTimes(1);
    const message = {
      id: "k1",
      content: "hi",
      sender: { username: "Ada", slug: "ada" },
    };
    frame(
      wire,
      "App\\Events\\ChatMessageEvent",
      "chatrooms.45.v2",
      JSON.stringify(message),
    );
    expect(onMessage).not.toHaveBeenCalled();
    frame(
      wire,
      "App\\Events\\ChatMessageEvent",
      "chatrooms.44.v2",
      JSON.stringify(message),
    );
    expect(onMessage).toHaveBeenCalledTimes(1);
    close();
  });

  it("retries a rejected subscription without claiming a live chat", async () => {
    const { wire, onOpen, onClose, close } = await connect();
    frame(wire, "pusher:connection_established");
    frame(wire, "pusher:subscription_error", "chatrooms.44.v2", {
      status: 403,
    });
    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(wire.closeSpy).toHaveBeenCalledTimes(1);
    close();
  });

  it("retries a channel-less Pusher protocol error", async () => {
    const { wire, onOpen, onClose, close } = await connect();
    frame(wire, "pusher:connection_established");
    frame(wire, "pusher:error", undefined, {
      code: 4201,
      message: "Bad event name",
    });
    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(wire.closeSpy).toHaveBeenCalledTimes(1);
    close();
  });
});
