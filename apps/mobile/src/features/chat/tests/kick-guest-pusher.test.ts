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
  const onMessage = vi.fn();
  const close = await connectKickGuestChat({
    fetch: async () => Response.json({ chatroom: { id: 44 } }),
    socketFactory: () => wire,
    signal: new AbortController().signal,
    target: { platform: "kick", channelId: "1", channelName: "spreen" },
    onClose: vi.fn(),
    onOpen,
    onError,
    onMessage,
  });
  return { wire, onOpen, onError, onMessage, close };
}

describe("Kick guest Pusher subscription", () => {
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

  it("fails a rejected subscription without claiming a live chat", async () => {
    const { wire, onOpen, onError } = await connect();
    frame(wire, "pusher:connection_established");
    frame(wire, "pusher:subscription_error", "chatrooms.44.v2", {
      status: 403,
    });
    expect(onOpen).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(wire.closeSpy).toHaveBeenCalledTimes(1);
  });

  it("fails a channel-less Pusher protocol error", async () => {
    const { wire, onOpen, onError } = await connect();
    frame(wire, "pusher:connection_established");
    frame(wire, "pusher:error", undefined, {
      code: 4201,
      message: "Bad event name",
    });
    expect(onOpen).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(wire.closeSpy).toHaveBeenCalledTimes(1);
  });
});
